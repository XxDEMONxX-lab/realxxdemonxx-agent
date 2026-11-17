#!/usr/bin/env node
'use strict';

/**
 * DEMONPM JS — dependency-free interactive Node.js process manager.
 * Runtime: Node.js 18+. No npm packages, Python, shell command execution, or daemon required.
 *
 * Managed applications are launched as detached Node processes. Their PID, working
 * directory, entry point, arguments and log path are stored under ~/.demonpm-js.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { promisify } = require('node:util');
const sleep = promisify(setTimeout);

const VERSION = '6.0.0';
const HOME = path.join(os.homedir(), '.demonpm-js');
const STATE_FILE = path.join(HOME, 'state.json');
const LOG_DIR = path.join(HOME, 'logs');
const NODE = process.execPath;
const IS_TTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const state = { apps: [] };
let selected = 0;
let notice = 'Use ↑/↓ to select, Enter to open, q to quit.';
let running = true;
let prompting = false;
let actionBusy = false;
let showHelp = false;
let alternateScreen = false;
let keyHandler;

function ensureStorage() {
  fs.mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(HOME, 0o700); } catch {}
  try { fs.chmodSync(LOG_DIR, 0o700); } catch {}
}

function loadState() {
  ensureStorage();
  if (!fs.existsSync(STATE_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.apps)) throw new Error('Invalid state format');
    state.apps = parsed.apps.filter(app =>
      app && typeof app.id === 'string' &&
      typeof app.name === 'string' &&
      typeof app.cwd === 'string' &&
      typeof app.entry === 'string' &&
      Array.isArray(app.args)
    ).map(app => ({
      ...app,
      autoRestart: app.autoRestart !== false,
      desiredRunning: typeof app.desiredRunning === 'boolean' ? app.desiredRunning : Number.isInteger(app.pid),
      restartDelayMs: Number.isInteger(app.restartDelayMs) ? Math.max(500, Math.min(app.restartDelayMs, 30000)) : 1000
    }));
  } catch (error) {
    const backup = STATE_FILE + '.corrupt-' + Date.now();
    try { fs.renameSync(STATE_FILE, backup); } catch {}
    notice = 'State file was invalid; moved aside: ' + path.basename(backup);
  }
}

function saveState() {
  ensureStorage();
  const tmp = STATE_FILE + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, apps: state.apps }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STATE_FILE);
  try { fs.chmodSync(STATE_FILE, 0o600); } catch {}
}

function safeId() {
  return require('node:crypto').randomBytes(8).toString('hex');
}

function logPath(app) {
  return path.join(LOG_DIR, app.id + '.log');
}

function procStartTicks(pid) {
  if (process.platform !== 'linux') return null;
  try {
    // /proc/<pid>/stat field 22; command names may contain spaces and parentheses.
    const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    const end = stat.lastIndexOf(')');
    if (end < 0) return null;
    const fields = stat.slice(end + 2).trim().split(/\s+/);
    return fields[19] || null;
  } catch { return null; }
}

function isAlive(app) {
  if (!Number.isInteger(app.pid) || app.pid <= 1) return false;
  try { process.kill(app.pid, 0); } catch (error) {
    if (error.code === 'EPERM') return true;
    return false;
  }
  if (app.procStartTicks && process.platform === 'linux') {
    const actual = procStartTicks(app.pid);
    if (actual && actual !== app.procStartTicks) return false;
  }
  return true;
}

function status(app) {
  return isAlive(app) ? 'RUNNING' : 'STOPPED';
}

function rotateLog(app) {
  const file = logPath(app);
  try {
    if (fs.statSync(file).size < 2 * 1024 * 1024) return;
    try { fs.unlinkSync(file + '.1'); } catch {}
    fs.renameSync(file, file + '.1');
  } catch {}
}

function writeLog(app, message) {
  try {
    rotateLog(app);
    fs.appendFileSync(logPath(app), '[' + new Date().toISOString() + '] ' + message + '\n', { mode: 0o600 });
  } catch {}
}

function startApp(app) {
  if (isAlive(app)) throw new Error(app.name + ' is already running.');
  if (!fs.existsSync(app.cwd) || !fs.statSync(app.cwd).isDirectory()) {
    throw new Error('Working directory does not exist: ' + app.cwd);
  }
  const entryPath = path.resolve(app.cwd, app.entry);
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
    throw new Error('Node entry file does not exist: ' + entryPath);
  }
  const nodePath = app.nodePath || NODE;
  if (!path.isAbsolute(nodePath) || !fs.existsSync(nodePath) || !fs.statSync(nodePath).isFile()) throw new Error('Configured Node.js executable is invalid: ' + nodePath);
  if (process.platform !== 'win32') {
    try { fs.accessSync(nodePath, fs.constants.X_OK); } catch { throw new Error('Configured Node.js executable is not executable: ' + nodePath); }
  }

  // A detached supervisor owns the app's process group and restarts crashed bots.
  const supervisor = spawn(NODE, [__filename, '--supervise', app.id], {
    cwd: app.cwd,
    env: process.env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  if (!supervisor.pid) throw new Error('Could not start the application supervisor.');
  app.pid = supervisor.pid;
  app.desiredRunning = true;
  app.procStartTicks = null;
  app.startedAt = new Date().toISOString();
  app.node = NODE;
  if (process.platform === 'linux') {
    const ticks = procStartTicks(supervisor.pid);
    if (ticks) app.procStartTicks = ticks;
  }
  supervisor.unref();
  saveState();
  writeLog(app, 'Supervisor started (PID ' + app.pid + '); crash recovery is enabled.');
}

async function runSupervisor(appId) {
  ensureStorage();
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { process.exit(2); }
  const app = Array.isArray(parsed.apps) ? parsed.apps.find(item => item.id === appId) : null;
  if (!app) process.exit(2);
  const entryPath = path.resolve(app.cwd, app.entry);
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) process.exit(2);
  const nodePath = app.nodePath || NODE;
  if (!path.isAbsolute(nodePath) || !fs.existsSync(nodePath) || !fs.statSync(nodePath).isFile()) process.exit(2);
  const baseDelay = Math.max(500, Math.min(Number(app.restartDelayMs) || 1000, 30000));
  const maxDelay = Math.max(baseDelay, Math.min(Number(app.maxRestartDelayMs) || 30000, 300000));
  const maxRestarts = Math.max(0, Number.isInteger(app.maxRestarts) ? app.maxRestarts : 0);
  const restartWindowMs = Math.max(10000, Number(app.restartWindowMs) || 60000);
  const restartTimes = [];

  let stopping = false;
  let child = null;
  let restartTimer = null;
  const stop = () => {
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    if (child && child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        if (child && child.exitCode === null && child.signalCode === null) {
          try { child.kill('SIGKILL'); } catch {}
        }
      }, 500).unref();
    }
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  const launch = () => {
    if (stopping) return;
    const fd = fs.openSync(logPath(app), 'a', 0o600);
    try {
      child = spawn(nodePath, [entryPath, ...(Array.isArray(app.args) ? app.args : [])], {
        cwd: app.cwd,
        env: { ...process.env, ...(app.env || {}) },
        detached: false,
        stdio: ['ignore', fd, fd],
        windowsHide: true
      });
    } finally { fs.closeSync(fd); }
    if (!child.pid) {
      writeLog(app, 'Supervisor could not spawn the application process.');
      scheduleRestart();
      return;
    }
    writeLog(app, 'Application process started (PID ' + child.pid + ').');
    child.once('error', error => writeLog(app, 'Application spawn error: ' + error.message));
    child.once('exit', (code, signal) => {
      writeLog(app, 'Application exited (code=' + code + ', signal=' + signal + ').');
      child = null;
      if (!stopping) scheduleRestart();
      else process.exit(0);
    });
  };
  const scheduleRestart = () => {
    if (stopping) return;
    const now = Date.now();
    restartTimes.push(now);
    while (restartTimes.length && now - restartTimes[0] > restartWindowMs) restartTimes.shift();
    if (maxRestarts > 0 && restartTimes.length > maxRestarts) {
      writeLog(app, 'Restart limit reached; supervisor stopped to prevent a crash loop.');
      stopping = true;
      process.exitCode = 1;
      return;
    }
    const delay = Math.min(maxDelay, baseDelay * Math.pow(2, Math.max(0, restartTimes.length - 1)));
    writeLog(app, 'Restarting application in ' + delay + 'ms (attempt ' + restartTimes.length + ').');
    restartTimer = setTimeout(launch, delay);
  };
  launch();
  while (!stopping) await sleep(250);
  process.exit(0);
}

function isProcessGroupAlive(app) {
  if (process.platform === 'win32' || !Number.isInteger(app.pid) || app.pid <= 1) {
    return isAlive(app);
  }
  try {
    process.kill(-app.pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function stopApp(app, gracefulMs = 250) {
  const leaderAlive = isAlive(app);
  const groupAlive = isProcessGroupAlive(app);
  if (!leaderAlive && !groupAlive) {
    app.pid = null;
    app.desiredRunning = false;
    app.procStartTicks = null;
    saveState();
    return;
  }

  // Guard against signalling a different process after PID reuse.
  if (leaderAlive && app.procStartTicks && process.platform === 'linux') {
    const actualTicks = procStartTicks(app.pid);
    if (actualTicks && actualTicks !== app.procStartTicks) {
      throw new Error('Process ID was reused; refusing to stop an unrelated process.');
    }
  }

  const pid = app.pid;
  const signalGroup = signal => {
    try {
      if (process.platform !== 'win32') process.kill(-pid, signal);
      else process.kill(pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') {
        try { process.kill(pid, signal); } catch (inner) {
          if (inner.code !== 'ESRCH') throw inner;
        }
      }
    }
  };

  // Give the app a brief chance to flush data, then force-stop remaining group members.
  signalGroup('SIGTERM');
  const deadline = Date.now() + gracefulMs;
  while (Date.now() < deadline && isAlive(app)) await sleep(25);
  signalGroup('SIGKILL');

  // Verify the managed leader, not kill(0) on the group: Linux may retain zombie
  // descendants briefly even after SIGKILL, which must not stall the TUI.
  const verifyDeadline = Date.now() + 300;
  while (Date.now() < verifyDeadline && isAlive(app)) await sleep(25);
  if (isAlive(app)) {
    throw new Error('Application did not stop; the host may be preventing termination.');
  }

  app.pid = null;
  app.desiredRunning = false;
  app.procStartTicks = null;
  app.stoppedAt = new Date().toISOString();
  saveState();
  writeLog(app, 'Stopped; termination signal sent to its process group.');
}

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

function truncate(value, width) {
  const text = String(value ?? '');
  if (width <= 0) return '';
  return text.length > width ? text.slice(0, Math.max(0, width - 1)) + '…' : text;
}

function render() {
  if (prompting || actionBusy || !running) return;

  const width = Math.max(36, Math.min(process.stdout.columns || 80, 110));
  const height = Math.max(12, process.stdout.rows || 24);
  const inner = width - 2;
  const cyan = '\x1b[1;36m';
  const muted = '\x1b[90m';
  const reset = '\x1b[0m';
  const lines = [];
  const border = '─'.repeat(inner);
  const top = '═'.repeat(inner);
  const add = value => lines.push(value);
  const pad = (value, size) => truncate(value, size).padEnd(size);
  const frame = value => cyan + '║' + reset + ' ' + pad(value, inner - 2) + ' ' + cyan + '║' + reset;

  add(cyan + '╔' + top + '╗' + reset);
  add(cyan + '║' + reset + pad('  DEMONPM JS  ·  NODE PROCESS MANAGER', inner) + cyan + '║' + reset);
  add(cyan + '╠' + border + '╣' + reset);
  add(frame(muted + '↑/↓ or j/k navigate   Enter start/stop   ? help   q quit' + reset));
  add(cyan + '╠' + border + '╣' + reset);
  add(frame('\x1b[1;37m APPLICATIONS \x1b[0m' + muted + ' (' + state.apps.length + ')' + reset));

  if (!state.apps.length) {
    add(frame(muted + 'No applications yet. Press A to add a Node.js app.' + reset));
  } else {
    const listCapacity = Math.max(1, Math.min(state.apps.length, height - 15));
    let first = Math.max(0, Math.min(selected - Math.floor(listCapacity / 2), state.apps.length - listCapacity));
    const last = Math.min(state.apps.length, first + listCapacity);
    if (first > 0) add(frame(muted + '  ↑ ' + first + ' more above' + reset));
    for (let i = first; i < last; i++) {
      const app = state.apps[i];
      const active = i === selected;
      const runningText = status(app) === 'RUNNING';
      const marker = active ? cyan + '❯' + reset : ' ';
      const stateLabel = runningText ? '\x1b[1;32m● RUNNING' : muted + '○ STOPPED';
      const leftWidth = Math.max(12, Math.floor(inner * 0.43));
      const name = pad(app.name, leftWidth);
      const file = truncate(path.join(app.cwd, app.entry), Math.max(8, inner - leftWidth - 18));
      add(cyan + '║' + reset + ' ' + marker + ' ' +
        (active ? '\x1b[1;37m' : '') + name + reset + ' ' +
        stateLabel + reset + ' ' + muted + file + reset +
        ' '.repeat(Math.max(0, inner - 3 - leftWidth - 1 - stateLabel.replace(/\x1b\[[0-9;]*m/g, '').length - 1 - file.length)) +
        cyan + '║' + reset);
    }
    if (last < state.apps.length) add(frame(muted + '  ↓ ' + (state.apps.length - last) + ' more below' + reset));
  }

  add(cyan + '╠' + border + '╣' + reset);
  const app = state.apps[selected];
  add(frame('\x1b[1;37m SELECTED \x1b[0m'));
  if (app) {
    add(frame('Name: ' + app.name));
    add(frame('File: ' + path.join(app.cwd, app.entry)));
    add(frame('Node: ' + (app.nodePath || NODE)));
    add(frame('PID: ' + (isAlive(app) ? app.pid : '—') +
      '    Status: ' + status(app) +
      (app.startedAt ? '    Started: ' + app.startedAt.replace('T', ' ').slice(0, 19) : '')));
  } else {
    add(frame(muted + 'Select an application to see details.' + reset));
  }

  add(cyan + '╠' + border + '╣' + reset);
  if (showHelp) {
    add(frame('\x1b[1;37m KEYBOARD HELP \x1b[0m'));
    add(frame('[↑/↓] or [J/K]  Move selection'));
    add(frame('[Home/G]       First app     [End/Shift+G] Last app'));
    add(frame('[Enter/Space]  Start or stop selected app'));
    add(frame('[A] Add  [S] Start  [X] Stop  [R] Restart'));
    add(frame('[L] Logs  [E] Environment  [D] Delete  [M] Refresh status'));
    add(frame('[?] Close help  [Q] Quit'));
  } else {
    add(frame('[A] Add  [S] Start  [X] Stop  [R] Restart  [L] Logs  [E] Env  [D] Delete'));
    add(frame('[M] Refresh  [?] Help  [Q] Quit'));
  }
  add(cyan + '╠' + border + '╣' + reset);
  add(frame((notice.startsWith('Error:') ? '\x1b[1;31m' : muted) + truncate(notice, inner - 2) + reset));
  add(cyan + '╚' + top + '╝' + reset);

  // Move to the home position and erase only the remainder; no full-screen flash.
  const visible = lines.slice(0, height);
  process.stdout.write('\x1b[H' + visible.join('\r\n') + '\x1b[J');
}

function prompt(question, initial = '') {
  return new Promise((resolve, reject) => {
    // Line prompts temporarily own stdin. Never let typed characters fall through
    // to the menu hotkeys (e.g. "LHA" triggering L=logs and A=add).
    prompting = true;
    if (keyHandler) process.stdin.off('keypress', keyHandler);
    if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      rl.close();
      prompting = false;
      if (error) reject(error);
      else resolve(value.trim() || initial);
    };
    rl.question(question, answer => finish(null, answer));
    rl.on('SIGINT', () => finish(new Error('Cancelled.')));
  });
}

function tokenize(input) {
  const result = [];
  let token = '';
  let quote = null;
  let escaped = false;
  for (const char of input) {
    if (escaped) { token += char; escaped = false; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; continue; }
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (token) { result.push(token); token = ''; }
    } else token += char;
  }
  if (escaped) token += '\\';
  if (quote) throw new Error('Unclosed quote in command.');
  if (token) result.push(token);
  return result;
}

async function addApp() {
  const name = await prompt('Application name: ');
  if (!name || name.length > 48 || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error('Use 1–48 letters, numbers, dots, underscores or hyphens for the name.');
  }
  if (state.apps.some(app => app.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('An application with that name already exists.');
  }
  const cwdInput = await prompt('Working directory (default: current directory): ', process.cwd());
  const cwd = path.resolve(cwdInput);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('That working directory does not exist.');
  const command = await prompt('Entry file and arguments (example: bot.js --color): ');
  const parts = tokenize(command);
  if (!parts.length) throw new Error('An entry file is required.');
  const entry = parts.shift();
  if (!entry.toLowerCase().endsWith('.js') && !entry.toLowerCase().endsWith('.cjs') && !entry.toLowerCase().endsWith('.mjs')) {
    throw new Error('Only JavaScript entry files (.js, .cjs, .mjs) are supported.');
  }
  const nodeInput = await prompt('Node.js executable (blank = current Node): ', NODE);
  const nodePath = path.resolve(nodeInput || NODE);
  if (!fs.existsSync(nodePath) || !fs.statSync(nodePath).isFile()) throw new Error('Node.js executable not found: ' + nodePath);
  if (process.platform !== 'win32') {
    try { fs.accessSync(nodePath, fs.constants.X_OK); } catch { throw new Error('Node.js executable is not executable: ' + nodePath); }
  }
  const delayInput = await prompt('Restart delay in ms (500–30000, default 1000): ', '1000');
  const restartDelayMs = Number(delayInput);
  if (!Number.isInteger(restartDelayMs) || restartDelayMs < 500 || restartDelayMs > 30000) throw new Error('Restart delay must be 500–30000ms.');
  const limitInput = await prompt('Max restarts per 60 seconds (0 = unlimited): ', '0');
  const maxRestarts = Number(limitInput);
  if (!Number.isInteger(maxRestarts) || maxRestarts < 0 || maxRestarts > 1000) throw new Error('Restart limit must be 0–1000.');
  const app = { id: safeId(), name, cwd, entry, args: parts, nodePath, env: {}, autoRestart: true, desiredRunning: false, restartDelayMs, maxRestartDelayMs: 30000, maxRestarts, restartWindowMs: 60000, pid: null, procStartTicks: null, createdAt: new Date().toISOString() };
  const resolved = path.resolve(cwd, entry);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error('Entry file not found: ' + resolved);
  state.apps.push(app);
  selected = state.apps.length - 1;
  saveState();
  notice = name + ' added. Press S to start it.';
}

async function editEnvironment(app) {
  const env = app.env && typeof app.env === 'object' && !Array.isArray(app.env) ? { ...app.env } : {};
  const key = await prompt('Environment variable name (blank to cancel): ');
  if (!key) { notice = 'Environment edit cancelled.'; return; }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid environment variable name.');
  if (['PATH', 'HOME', 'NODE_OPTIONS', 'LD_PRELOAD'].includes(key)) throw new Error('This variable is protected from editing in the TUI.');
  const exists = Object.prototype.hasOwnProperty.call(env, key);
  const value = await prompt(exists ? 'New value (blank deletes this variable): ' : 'Value: ');
  if (exists && value === '') delete env[key];
  else env[key] = value;
  app.env = env;
  saveState();
  notice = exists && value === '' ? 'Environment variable deleted.' : 'Environment variable saved.';
}

async function viewLogs(app) {
  const file = logPath(app);
  if (!fs.existsSync(file)) { notice = 'No logs yet for ' + app.name + '.'; return; }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const tail = lines.slice(-Math.max(10, (process.stdout.rows || 24) - 6));
  clearScreen();
  console.log('\x1b[1;36mLOGS · ' + app.name + '\x1b[0m  (press any key to return)\n');
  console.log(tail.join('\n'));
  await waitAnyKey();
  notice = 'Returned from logs for ' + app.name + '.';
}

function waitAnyKey() {
  return new Promise(resolve => {
    const done = () => {
      process.stdin.off('data', done);
      resolve();
    };
    process.stdin.once('data', done);
  });
}

async function selectedApp() {
  const app = state.apps[selected];
  if (!app) { notice = 'Select an application first.'; return null; }
  return app;
}

async function action(key) {
  // Suspend both menu input and periodic redraws while an action owns the terminal.
  actionBusy = true;
  if (keyHandler) process.stdin.off('keypress', keyHandler);
  try {
    const app = await selectedApp();
    switch (key) {
      case 'a': await addApp(); break;
      case 's':
        if (!app) break;
        startApp(app);
        notice = app.name + ' started (PID ' + app.pid + ').';
        break;
      case 'x':
        if (!app) break;
        await stopApp(app);
        notice = app.name + ' stopped.';
        break;
      case 'r':
        if (!app) break;
        if (isAlive(app)) await stopApp(app);
        startApp(app);
        notice = app.name + ' restarted (PID ' + app.pid + ').';
        break;
      case 'l':
        if (app) await viewLogs(app);
        break;
      case 'e':
        if (app) await editEnvironment(app);
        break;
      case 'd':
        if (!app) break;
        if (isAlive(app)) throw new Error('Stop the application before deleting its entry.');
        if ((await prompt('Delete ' + app.name + ' from demonpm? Type yes to confirm: ')).toLowerCase() !== 'yes') {
          notice = 'Delete cancelled.';
          break;
        }
        state.apps.splice(selected, 1);
        selected = Math.max(0, Math.min(selected, state.apps.length - 1));
        saveState();
        notice = 'Application entry deleted. Source files and logs were kept.';
        break;
      case 'm':
        notice = 'Status refreshed.';
        break;
    }
  } catch (error) {
    notice = 'Error: ' + error.message;
  }
  if (process.stdin.isTTY && !process.stdin.isRaw && running) process.stdin.setRawMode(true);
  process.stdin.resume();
  actionBusy = false;
  if (keyHandler && running) process.stdin.on('keypress', keyHandler);
}

function shutdown() {
  if (!running) return;
  running = false;
  if (keyHandler) process.stdin.off('keypress', keyHandler);
  if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
  process.stdout.write('\x1b[0m\x1b[?25h' + (alternateScreen ? '\x1b[?1049l' : '') + '\n');
  alternateScreen = false;
}

async function main() {
  if (!IS_TTY) {
    console.error('DEMONPM JS needs an interactive terminal. Run it with: node start.js');
    process.exitCode = 1;
    return;
  }
  loadState();
  // Recover apps configured for automatic restart when the manager is opened again.
  for (const app of state.apps) {
    if (app.autoRestart && app.desiredRunning && !isAlive(app)) {
      try {
        startApp(app);
        writeLog(app, 'Startup recovery: supervisor relaunched by DEMONPM.');
      } catch (error) {
        writeLog(app, 'Startup recovery failed: ' + error.message);
      }
    }
  }
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l');
  alternateScreen = true;
  keyHandler = async (str, key = {}) => {
    if (!running || prompting || actionBusy) return;
    if (key.ctrl && key.name === 'c') { shutdown(); return; }

    if (key.name === 'up' || str === 'k' || str === 'K') {
      selected = Math.max(0, selected - 1);
    } else if (key.name === 'down' || str === 'j' || str === 'J') {
      selected = Math.min(Math.max(0, state.apps.length - 1), selected + 1);
    } else if (key.name === 'home' || str === 'g') {
      selected = 0;
    } else if (key.name === 'end' || str === 'G') {
      selected = Math.max(0, state.apps.length - 1);
    } else if (key.name === 'pageup') {
      selected = Math.max(0, selected - Math.max(1, (process.stdout.rows || 24) - 15));
    } else if (key.name === 'pagedown') {
      selected = Math.min(Math.max(0, state.apps.length - 1), selected + Math.max(1, (process.stdout.rows || 24) - 15));
    } else if (key.name === 'q' || str === 'Q') {
      shutdown();
      return;
    } else if (key.name === 'return' || key.name === 'space') {
      const app = state.apps[selected];
      if (app) await action(isAlive(app) ? 'x' : 's');
      else notice = 'Press A to add your first Node.js app.';
    } else if (str === '?' || str === 'h' || str === 'H') {
      showHelp = !showHelp;
    } else if (str && 'asxrledm'.includes(str.toLowerCase())) {
      await action(str.toLowerCase());
    }
    render();
  };
  process.stdin.on('keypress', keyHandler);
  const onResize = () => render();
  process.stdout.on('resize', onResize);
  render();
  // Render only on user input or terminal resize. A periodic full-screen clear
  // causes visible flicker and is unnecessary for process status display.
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (!running) { clearInterval(check); resolve(); }
    }, 100);
  });
  process.stdout.off('resize', onResize);
  saveState();
}

if (process.argv[2] === '--supervise' && process.argv[3]) {
  runSupervisor(process.argv[3]).catch(error => {
    try { fs.appendFileSync(path.join(LOG_DIR, process.argv[3] + '.log'), '[' + new Date().toISOString() + '] Supervisor error: ' + error.message + '\\n'); } catch {}
    process.exitCode = 1;
  });
} else {
  main().catch(error => {
    shutdown();
    console.error('DEMONPM JS fatal error:', error.message);
    process.exitCode = 1;
  });
}
