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

const VERSION = '1.0.0';
const HOME = path.join(os.homedir(), '.demonpm-js');
const STATE_FILE = path.join(HOME, 'state.json');
const LOG_DIR = path.join(HOME, 'logs');
const NODE = process.execPath;
const IS_TTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const state = { apps: [] };
let selected = 0;
let notice = 'Use ↑/↓ to select, Enter to open, q to quit.';
let running = true;
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
    );
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

function writeLog(app, message) {
  try {
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

  const fd = fs.openSync(logPath(app), 'a', 0o600);
  const child = spawn(NODE, [entryPath, ...app.args], {
    cwd: app.cwd,
    env: { ...process.env, ...(app.env || {}) },
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true
  });
  fs.closeSync(fd);

  if (!child.pid) throw new Error('Node failed to create the application process.');
  app.pid = child.pid;
  app.procStartTicks = null;
  app.startedAt = new Date().toISOString();
  app.node = NODE;
  // Give Linux /proc a moment to publish the new process identity.
  if (process.platform === 'linux') {
    const ticks = procStartTicks(child.pid);
    if (ticks) app.procStartTicks = ticks;
  }
  child.unref();
  saveState();
  writeLog(app, 'Started: ' + [NODE, entryPath, ...app.args].join(' '));
}

async function stopApp(app, timeoutMs = 8000) {
  if (!isAlive(app)) {
    app.pid = null;
    app.procStartTicks = null;
    saveState();
    return;
  }
  const pid = app.pid;
  const signalGroup = signal => {
    try {
      // detached=true creates a process group on POSIX; use PID fallback elsewhere.
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
  signalGroup('SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && isAlive(app)) await sleep(150);
  if (isAlive(app)) signalGroup('SIGKILL');
  const killDeadline = Date.now() + 2000;
  while (Date.now() < killDeadline && isAlive(app)) await sleep(100);
  if (isAlive(app)) throw new Error('Process did not stop; it may be protected by the host.');
  app.pid = null;
  app.procStartTicks = null;
  app.stoppedAt = new Date().toISOString();
  saveState();
  writeLog(app, 'Stopped.');
}

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

function truncate(value, width) {
  const text = String(value ?? '');
  return text.length > width ? text.slice(0, Math.max(0, width - 1)) + '…' : text;
}

function render() {
  const width = Math.max(54, Math.min(process.stdout.columns || 80, 110));
  const line = '─'.repeat(width - 2);
  clearScreen();
  console.log('\x1b[1;36m╔' + '═'.repeat(width - 2) + '╗\x1b[0m');
  console.log('\x1b[1;36m║\x1b[0m' + ' '.repeat(Math.max(0, Math.floor((width - 2 - 27) / 2))) +
    '\x1b[1;37mDEMONPM JS v' + VERSION + '\x1b[0m' +
    ' '.repeat(Math.max(0, width - 2 - 27 - Math.floor((width - 2 - 27) / 2))) + '\x1b[1;36m║\x1b[0m');
  console.log('\x1b[1;36m╠' + '═'.repeat(width - 2) + '╣\x1b[0m');
  console.log('\x1b[1;36m║\x1b[0m  \x1b[90mNode.js process manager · ' +
    truncate(os.platform() + ' ' + os.arch(), width - 39) + '\x1b[0m' +
    ' '.repeat(Math.max(0, width - 5 - 36 - (os.platform() + ' ' + os.arch()).length)) + '\x1b[1;36m║\x1b[0m');
  console.log('\x1b[1;36m╠' + line + '╣\x1b[0m');
  console.log('\x1b[1;37m  APPLICATIONS\x1b[0m');
  if (!state.apps.length) {
    console.log('  \x1b[90mNo applications configured. Choose “Add Node app” to begin.\x1b[0m');
  } else {
    state.apps.forEach((app, index) => {
      const active = index === selected;
      const marker = active ? '\x1b[1;36m❯' : ' ';
      const stateText = status(app);
      const stateColor = stateText === 'RUNNING' ? '\x1b[1;32m' : '\x1b[90m';
      const label = '  ' + marker + ' ' + truncate(app.name, 20).padEnd(20) +
        ' ' + stateColor + stateText.padEnd(8) + '\x1b[0m ' +
        truncate(path.join(app.cwd, app.entry), Math.max(10, width - 48));
      console.log(label + (active ? '\x1b[0m' : ''));
    });
  }
  console.log('\x1b[1;36m╠' + line + '╣\x1b[0m');
  console.log('\x1b[1;37m  ACTIONS\x1b[0m');
  console.log('   [A] Add Node app       [S] Start selected     [X] Stop selected');
  console.log('   [R] Restart selected   [L] View logs          [D] Delete entry');
  console.log('   [M] Refresh            [Q] Quit');
  console.log('\x1b[1;36m╠' + line + '╣\x1b[0m');
  console.log('  ' + truncate(notice, width - 5));
  console.log('\x1b[1;36m╚' + '═'.repeat(width - 2) + '╝\x1b[0m');
}

function prompt(question, initial = '') {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
    process.stdin.pause();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim() || initial);
    });
    rl.on('SIGINT', () => { rl.close(); reject(new Error('Cancelled.')); });
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
  const app = { id: safeId(), name, cwd, entry, args: parts, env: {}, pid: null, procStartTicks: null, createdAt: new Date().toISOString() };
  const resolved = path.resolve(cwd, entry);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error('Entry file not found: ' + resolved);
  state.apps.push(app);
  selected = state.apps.length - 1;
  saveState();
  notice = name + ' added. Press S to start it.';
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
}

function shutdown() {
  running = false;
  if (keyHandler) process.stdin.off('keypress', keyHandler);
  if (process.stdin.isTTY && process.stdin.isRaw) process.stdin.setRawMode(false);
  process.stdout.write('\x1b[0m\x1b[?25h\n');
}

async function main() {
  if (!IS_TTY) {
    console.error('DEMONPM JS needs an interactive terminal. Run it with: node start.js');
    process.exitCode = 1;
    return;
  }
  loadState();
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write('\x1b[?25l');
  keyHandler = async (str, key = {}) => {
    if (!running) return;
    if (key.ctrl && key.name === 'c') { shutdown(); return; }
    if (key.name === 'up') selected = Math.max(0, selected - 1);
    else if (key.name === 'down') selected = Math.min(state.apps.length - 1, selected + 1);
    else if (key.name === 'q' || str === 'Q') { shutdown(); return; }
    else if (key.name === 'return' && state.apps[selected]) {
      notice = 'Selected: ' + state.apps[selected].name + '. Use S, X, R or L.';
    } else if (str && 'asxrldm'.includes(str.toLowerCase())) {
      await action(str.toLowerCase());
    }
    render();
  };
  process.stdin.on('keypress', keyHandler);
  const onResize = () => render();
  process.stdout.on('resize', onResize);
  render();
  const refresh = setInterval(() => { if (running) render(); }, 2000);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (!running) { clearInterval(check); resolve(); }
    }, 100);
  });
  clearInterval(refresh);
  process.stdout.off('resize', onResize);
  saveState();
}

main().catch(error => {
  shutdown();
  console.error('DEMONPM JS fatal error:', error.message);
  process.exitCode = 1;
});
