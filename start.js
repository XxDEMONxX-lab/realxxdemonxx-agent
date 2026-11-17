#!/usr/bin/env node
'use strict';

/**
 * DEMONPM JS — dependency-free interactive Node.js process manager.
 * Version 8.0.0 adds atomic state writes, locked log rotation, durable event history,
 * graceful shutdown, health-aware startup, and a non-interactive self-test.
 * Runtime: Node.js 18+. No npm packages, Python, shell command execution, or daemon required.
 *
 * Managed applications are launched as detached Node processes. Their PID, working
 * directory, entry point, arguments and log path are stored under ~/.demonpm-js.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const http = require('node:http');
const https = require('node:https');
const { promisify } = require('node:util');
const sleep = promisify(setTimeout);

const VERSION = '8.0.0';
const HOME = path.join(os.homedir(), '.demonpm-js');
const STATE_FILE = path.join(HOME, 'state.json');
const LOG_DIR = path.join(HOME, 'logs');
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAX_HISTORY_BYTES = 2 * 1024 * 1024;
const lockWaitCell = new Int32Array(new SharedArrayBuffer(4));
const logWarnings = new Map();
const NODE = process.execPath;
const IS_TTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const state = { apps: [] };
let selected = 0;
let filterText = '';
const selectedIds = new Set();
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

function atomicWriteFile(file, data, mode = 0o600) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory,
    '.' + path.basename(file) + '.tmp-' + process.pid + '-' + crypto.randomBytes(8).toString('hex'));
  let fd = null;
  try {
    fd = fs.openSync(temporary, 'wx', mode);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    let offset = 0;
    while (offset < buffer.length) {
      const written = fs.writeSync(fd, buffer, offset, buffer.length - offset);
      if (written <= 0) throw new Error('Short write while saving ' + path.basename(file));
      offset += written;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, file);
    try {
      const dirFd = fs.openSync(directory, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {}
    try { fs.chmodSync(file, mode); } catch {}
  } catch (error) {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function withFileLock(file, operation) {
  const lockFile = file + '.lock';
  const deadline = Date.now() + 1500;
  let lockFd = null;
  while (lockFd === null) {
    try {
      const candidateFd = fs.openSync(lockFile, 'wx', 0o600);
      try {
        fs.writeSync(candidateFd, String(process.pid));
        lockFd = candidateFd;
      } catch (error) {
        try { fs.closeSync(candidateFd); } catch {}
        try { fs.unlinkSync(lockFile); } catch {}
        throw error;
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > 30000) fs.unlinkSync(lockFile);
      } catch (statError) {
        if (statError.code !== 'ENOENT') throw statError;
      }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for file lock: ' + path.basename(file));
      Atomics.wait(lockWaitCell, 0, 0, 10);
    }
  }
  try { return operation(); }
  finally {
    try { fs.closeSync(lockFd); } catch {}
    try { fs.unlinkSync(lockFile); } catch {}
  }
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
      restartDelayMs: Number.isInteger(app.restartDelayMs) ? Math.max(500, Math.min(app.restartDelayMs, 30000)) : 1000,
      gracefulShutdownMs: Number.isInteger(app.gracefulShutdownMs) ? Math.max(1000, Math.min(app.gracefulShutdownMs, 30000)) : 5000,
      waitForHealthyBeforeNext: app.waitForHealthyBeforeNext === true,
      healthStartupTimeoutMs: Number.isInteger(app.healthStartupTimeoutMs) ? Math.max(5000, Math.min(app.healthStartupTimeoutMs, 120000)) : 30000
    }));
  } catch (error) {
    const backup = STATE_FILE + '.corrupt-' + Date.now();
    try { fs.renameSync(STATE_FILE, backup); } catch {}
    notice = 'State file was invalid; moved aside: ' + path.basename(backup);
  }
}

function saveState() {
  ensureStorage();
  atomicWriteFile(STATE_FILE, JSON.stringify({ version: VERSION, apps: state.apps }, null, 2), 0o600);
}

function safeId() {
  return crypto.randomBytes(8).toString('hex');
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

function visibleApps() {
  const q = filterText.trim().toLowerCase();
  return state.apps.filter(app => !q || [app.name, app.cwd, app.entry].some(v => String(v || '').toLowerCase().includes(q)));
}


const metricSamples = new Map();
function processMetrics(app) {
  if (process.platform !== 'linux' || !isAlive(app)) return null;
  let entries;
  try { entries = fs.readdirSync('/proc'); } catch { return null; }
  const processes = new Map();
  for (const item of entries) {
    if (!/^\d+$/.test(item)) continue;
    try {
      const raw = fs.readFileSync('/proc/' + item + '/stat', 'utf8');
      const end = raw.lastIndexOf(')');
      if (end < 0) continue;
      const f = raw.slice(end + 2).trim().split(/\s+/);
      const pid = Number(item);
      processes.set(pid, { pid, ppid: Number(f[1]), ticks: Number(f[11]) + Number(f[12]), rss: Math.max(0, Number(f[21])) });
    } catch {}
  }
  const children = new Map();
  for (const proc of processes.values()) {
    if (!children.has(proc.ppid)) children.set(proc.ppid, []);
    children.get(proc.ppid).push(proc);
  }
  const stack = [app.pid];
  const seen = new Set();
  let totalTicks = 0;
  let totalRss = 0;
  let count = 0;
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const proc = processes.get(pid);
    if (!proc) continue;
    totalTicks += proc.ticks;
    totalRss += proc.rss;
    count++;
    for (const child of children.get(pid) || []) stack.push(child.pid);
  }
  if (!count) return null;
  const now = Date.now();
  const previous = metricSamples.get(app.id);
  let cpu = 0;
  if (previous && now > previous.time && totalTicks >= previous.ticks) {
    const elapsed = (now - previous.time) / 1000;
    const hz = 100;
    cpu = ((totalTicks - previous.ticks) / hz) / elapsed * 100;
    cpu = Math.max(0, Math.min(cpu, os.cpus().length * 100));
  }
  metricSamples.set(app.id, { time: now, ticks: totalTicks });
  return { cpu, memoryMb: totalRss * (4096) / (1024 * 1024), processes: count };
}

function rotateLog(app, force = false) {
  const file = logPath(app);
  try {
    const size = fs.statSync(file).size;
    if (!force && size < MAX_LOG_BYTES) return;
    try { fs.unlinkSync(file + '.1'); } catch {}
    fs.renameSync(file, file + '.1');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function appendLogChunk(app, chunk) {
  const file = logPath(app);
  try {
    let data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    if (!data.length) return true;
    withFileLock(file, () => {
      let currentSize = 0;
      try { currentSize = fs.statSync(file).size; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (currentSize + data.length > MAX_LOG_BYTES) rotateLog(app, true);
      if (data.length > MAX_LOG_BYTES) data = data.subarray(data.length - MAX_LOG_BYTES);
      fs.appendFileSync(file, data, { mode: 0o600 });
    });
    logWarnings.delete(app.id);
    return true;
  } catch (error) {
    logWarnings.set(app.id, error.message);
    return false;
  }
}

function eventPath(app) {
  return path.join(LOG_DIR, app.id + '.events.jsonl');
}

function recordEvent(app, type, message, details = null) {
  const file = eventPath(app);
  const event = { timestamp: new Date().toISOString(), appId: app.id, appName: app.name, type, message };
  if (details && typeof details === 'object') event.details = details;
  const line = Buffer.from(JSON.stringify(event) + '\n');
  try {
    withFileLock(file, () => {
      let size = 0;
      try { size = fs.statSync(file).size; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (size + line.length > MAX_HISTORY_BYTES) {
        try { fs.unlinkSync(file + '.1'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { fs.renameSync(file, file + '.1'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      fs.appendFileSync(file, line, { mode: 0o600 });
    });
    logWarnings.delete(app.id);
    return true;
  } catch (error) {
    logWarnings.set(app.id, 'Event history write failed: ' + error.message);
    return false;
  }
}

function writeLog(app, message) {
  return appendLogChunk(app, '[' + new Date().toISOString() + '] ' + message + '\n');
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

async function waitForHealthy(app) {
  if (!app.healthCheckUrl) return true;
  const timeoutMs = Math.max(5000, Math.min(Number(app.healthStartupTimeoutMs) || 30000, 120000));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(app)) return false;
    const remaining = Math.max(1000, deadline - Date.now());
    if (await checkHealth(app.healthCheckUrl, Math.min(5000, remaining))) return true;
    if (Date.now() < deadline) await sleep(Math.min(1000, deadline - Date.now()));
  }
  return false;
}

function checkHealth(url, timeoutMs) {
  return new Promise(resolve => {
    let parsed;
    try { parsed = new URL(url); } catch { resolve(false); return; }
    const transport = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
    if (!transport) { resolve(false); return; }
    const req = transport.get(parsed, { timeout: timeoutMs, headers: { 'User-Agent': 'DEMONPM-JS-HealthCheck' } }, response => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 400);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
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
  recordEvent(app, 'supervisor-start', 'Supervisor started.', { pid: app.pid });
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
  let healthTimer = null;
  let healthBusy = false;
  let healthFailures = 0;
  const healthUrl = typeof app.healthCheckUrl === 'string' ? app.healthCheckUrl : '';
  const healthIntervalMs = Math.max(5000, Math.min(Number(app.healthIntervalMs) || 15000, 300000));
  const healthTimeoutMs = Math.max(1000, Math.min(Number(app.healthTimeoutMs) || 5000, 30000));
  const healthFailureLimit = Math.max(1, Math.min(Number(app.healthFailureLimit) || 3, 20));
  const stop = () => {
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    if (healthTimer) clearInterval(healthTimer);
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
    child = spawn(nodePath, [entryPath, ...(Array.isArray(app.args) ? app.args : [])], {
      cwd: app.cwd,
      env: { ...process.env, ...(app.env || {}) },
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    child.stdout.on('data', chunk => appendLogChunk(app, chunk));
    child.stderr.on('data', chunk => appendLogChunk(app, chunk));
    healthFailures = 0;
    if (!child.pid) {
      writeLog(app, 'Supervisor could not spawn the application process.');
      recordEvent(app, 'spawn-error', 'Supervisor could not spawn the application process.');
      scheduleRestart();
      return;
    }
    writeLog(app, 'Application process started (PID ' + child.pid + ').');
    recordEvent(app, 'process-start', 'Application process started.', { pid: child.pid });
    if (healthUrl) {
      healthTimer = setInterval(async () => {
        if (stopping || !child || child.exitCode !== null || healthBusy) return;
        healthBusy = true;
        const healthy = await checkHealth(healthUrl, healthTimeoutMs);
        healthBusy = false;
        if (stopping || !child || child.exitCode !== null) return;
        healthFailures = healthy ? 0 : healthFailures + 1;
        writeLog(app, 'Health check ' + (healthy ? 'passed' : 'failed (' + healthFailures + '/' + healthFailureLimit + ')') + '.');
        if (!healthy && healthFailures >= healthFailureLimit) {
          writeLog(app, 'Health failure threshold reached; restarting application.');
          recordEvent(app, 'health-failure', 'Health check failure threshold reached.', { failures: healthFailures });
          try { child.kill('SIGTERM'); } catch {}
          const target = child;
          setTimeout(() => { if (child === target && target.exitCode === null) { try { target.kill('SIGKILL'); } catch {} } }, 1000).unref();
        }
      }, healthIntervalMs);
      healthTimer.unref();
    }
    const spawned = child;
    spawned.once('error', error => {
      writeLog(app, 'Application spawn error: ' + error.message);
      recordEvent(app, 'spawn-error', 'Application spawn error: ' + error.message);
      if (child === spawned) {
        child = null;
        if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
        if (!stopping) scheduleRestart();
      }
    });
    spawned.once('exit', (code, signal) => {
      if (child !== spawned) return;
      writeLog(app, 'Application exited (code=' + code + ', signal=' + signal + ').');
      recordEvent(app, 'app-exit', 'Application exited.', { code, signal, stopping });
      child = null;
      if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
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
      recordEvent(app, 'restart-limit', 'Restart limit reached; supervisor stopped.');
      stopping = true;
      process.exitCode = 1;
      return;
    }
    const delay = Math.min(maxDelay, baseDelay * Math.pow(2, Math.max(0, restartTimes.length - 1)));
    writeLog(app, 'Restarting application in ' + delay + 'ms (attempt ' + restartTimes.length + ').');
    recordEvent(app, 'restart-scheduled', 'Application restart scheduled.', { delayMs: delay, attempt: restartTimes.length });
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

async function stopApp(app, gracefulMs = Math.max(1000, Math.min(Number(app.gracefulShutdownMs) || 5000, 30000))) {
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

  // Let the supervisor forward SIGTERM; force-stop the process group only after the grace period.
  signalGroup('SIGTERM');
  const deadline = Date.now() + gracefulMs;
  while (Date.now() < deadline && isAlive(app)) await sleep(50);
  if (isProcessGroupAlive(app)) signalGroup('SIGKILL');

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
  recordEvent(app, 'app-stopped', 'Application stopped by DEMONPM.', { gracefulShutdownMs: gracefulMs });
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
  add(frame(muted + '↑/↓ navigate  Enter start/stop  V mark  F filter  B bulk  ? help  Q quit' + reset));
  add(cyan + '╠' + border + '╣' + reset);
  const apps = visibleApps();
  add(frame('\x1b[1;37m APPLICATIONS \x1b[0m' + muted + ' (' + apps.length + '/' + state.apps.length + ')' + reset));
  if (filterText) add(frame('Filter: ' + filterText));

  if (!apps.length) {
    add(frame(muted + 'No matching apps. Press F to change the filter.' + reset));
  } else {
    const listCapacity = Math.max(1, Math.min(apps.length, height - 16));
    let first = Math.max(0, Math.min(selected - Math.floor(listCapacity / 2), apps.length - listCapacity));
    const last = Math.min(apps.length, first + listCapacity);
    if (first > 0) add(frame(muted + '  ↑ ' + first + ' more above' + reset));
    for (let i = first; i < last; i++) {
      const app = apps[i];
      const active = i === selected;
      const runningText = status(app) === 'RUNNING';
      const marker = (active ? cyan + '❯' : ' ') + (selectedIds.has(app.id) ? '\x1b[1;33m◆' : ' ') + reset;
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
    if (last < apps.length) add(frame(muted + '  ↓ ' + (apps.length - last) + ' more below' + reset));
  }

  add(cyan + '╠' + border + '╣' + reset);
  const app = apps[selected];
  add(frame('\x1b[1;37m SELECTED \x1b[0m'));
  if (app) {
    add(frame('Name: ' + app.name));
    add(frame('File: ' + path.join(app.cwd, app.entry)));
    add(frame('Node: ' + (app.nodePath || NODE)));
    add(frame('Startup order: ' + (Number.isInteger(app.startupOrder) ? app.startupOrder : 100) + '   Health check: ' + (app.healthCheckUrl || 'disabled')));
    const metrics = processMetrics(app);
    add(frame('PID: ' + (isAlive(app) ? app.pid : '—') +
      '    Status: ' + status(app) +
      (app.startedAt ? '    Started: ' + app.startedAt.replace('T', ' ').slice(0, 19) : '')));
    if (metrics) add(frame('Tree: ' + metrics.processes + ' processes   CPU: ' + metrics.cpu.toFixed(1) + '%   RAM: ' + metrics.memoryMb.toFixed(1) + ' MB'));
    else add(frame('CPU/RAM: unavailable (Linux /proc metrics require a running app).'));
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
    add(frame('[L] Logs  [E] Env  [C] Crash history  [T] Startup order'));
    add(frame('[V] Mark  [F] Filter  [B] Bulk  [I] Import  [O] Export'));
    add(frame('[P] Start all  [Z] Stop all  [?] Close help  [Q] Quit'));
  } else {
    add(frame('[A] Add  [S] Start  [X] Stop  [R] Restart  [L] Logs  [E] Env'));
    add(frame('[V] Mark  [F] Filter  [B] Bulk  [I] Import  [O] Export  [C] Crashes  [T] Order'));
    add(frame('[P] Start all  [Z] Stop all  [D] Delete  [Q] Quit'));
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
  const healthInput = await prompt('Health-check URL (blank disables HTTP health checks): ', '');
  if (healthInput && !isHttpUrl(healthInput)) throw new Error('Health-check URL must be a valid http:// or https:// URL.');
  const healthIntervalMs = 15000;
  const healthTimeoutMs = 5000;
  const healthFailureLimit = 3;
  const waitForHealthyBeforeNext = healthInput
    ? (await prompt('Wait for this app to become healthy before starting the next app? (y/N): ', 'n')).toLowerCase() === 'y'
    : false;
  const healthStartupTimeoutMs = waitForHealthyBeforeNext
    ? Number(await prompt('Health readiness timeout ms (5000–120000, default 30000): ', '30000'))
    : 30000;
  if (!Number.isInteger(healthStartupTimeoutMs) || healthStartupTimeoutMs < 5000 || healthStartupTimeoutMs > 120000) {
    throw new Error('Health readiness timeout must be 5000–120000ms.');
  }
  const gracefulShutdownMs = Number(await prompt('Graceful shutdown timeout ms (1000–30000, default 5000): ', '5000'));
  if (!Number.isInteger(gracefulShutdownMs) || gracefulShutdownMs < 1000 || gracefulShutdownMs > 30000) {
    throw new Error('Graceful shutdown timeout must be 1000–30000ms.');
  }
  const orderInput = await prompt('Startup order (lower numbers start first, default 100): ', '100');
  const startupOrder = Number(orderInput);
  if (!Number.isInteger(startupOrder) || startupOrder < 0 || startupOrder > 10000) throw new Error('Startup order must be 0–10000.');
  const limitInput = await prompt('Max restarts per 60 seconds (0 = unlimited): ', '0');
  const maxRestarts = Number(limitInput);
  if (!Number.isInteger(maxRestarts) || maxRestarts < 0 || maxRestarts > 1000) throw new Error('Restart limit must be 0–1000.');
  const app = { id: safeId(), name, cwd, entry, args: parts, nodePath, env: {}, autoRestart: true, desiredRunning: false, restartDelayMs, gracefulShutdownMs, maxRestartDelayMs: 30000, maxRestarts, restartWindowMs: 60000, healthCheckUrl: healthInput, healthIntervalMs, healthTimeoutMs, healthFailureLimit, waitForHealthyBeforeNext, healthStartupTimeoutMs, startupOrder, pid: null, procStartTicks: null, createdAt: new Date().toISOString() };
  const resolved = path.resolve(cwd, entry);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new Error('Entry file not found: ' + resolved);
  state.apps.push(app);
  selected = state.apps.length - 1;
  saveState();
  notice = name + ' added. Press S to start it.';
}

async function exportConfig() {
  const destination = path.resolve(await prompt('Export config file path: ', path.join(process.cwd(), 'demonpm-config.json')));
  const payload = {
    format: 'demonpm-js-config',
    version: 1,
    apps: state.apps.map(({ id, pid, procStartTicks, desiredRunning, startedAt, stoppedAt, env, ...app }) => ({
      ...app,
      env: {},
      desiredRunning: false
    }))
  };
  fs.writeFileSync(destination, JSON.stringify(payload, null, 2), { mode: 0o600, flag: 'wx' });
  notice = 'Exported ' + payload.apps.length + ' app config(s) to ' + destination + ' (environment secrets excluded).';
}

async function importConfig() {
  const source = path.resolve(await prompt('Import config file path: '));
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('Config file not found.');
  const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (!parsed || parsed.format !== 'demonpm-js-config' || parsed.version !== 1 || !Array.isArray(parsed.apps)) {
    throw new Error('Unsupported or invalid DEMONPM config file.');
  }
  const imported = [];
  for (const raw of parsed.apps) {
    if (!raw || typeof raw.name !== 'string' || !/^[a-zA-Z0-9._-]{1,48}$/.test(raw.name) ||
        typeof raw.cwd !== 'string' || typeof raw.entry !== 'string' || !Array.isArray(raw.args) ||
        !raw.args.every(arg => typeof arg === 'string')) {
      throw new Error('Config contains an invalid app entry.');
    }
    if (state.apps.some(app => app.name.toLowerCase() === raw.name.toLowerCase()) ||
        imported.some(app => app.name.toLowerCase() === raw.name.toLowerCase())) continue;
    const cwd = path.resolve(raw.cwd);
    const entry = raw.entry;
    const nodePath = typeof raw.nodePath === 'string' && path.isAbsolute(raw.nodePath) ? raw.nodePath : NODE;
    imported.push({
      id: safeId(), name: raw.name, cwd, entry, args: raw.args.slice(0, 256),
      nodePath, env: {}, autoRestart: raw.autoRestart !== false, desiredRunning: false,
      restartDelayMs: Number.isInteger(raw.restartDelayMs) ? Math.max(500, Math.min(raw.restartDelayMs, 30000)) : 1000,
      gracefulShutdownMs: Number.isInteger(raw.gracefulShutdownMs) ? Math.max(1000, Math.min(raw.gracefulShutdownMs, 30000)) : 5000,
      maxRestartDelayMs: 30000,
      maxRestarts: Number.isInteger(raw.maxRestarts) ? Math.max(0, Math.min(raw.maxRestarts, 1000)) : 0,
      restartWindowMs: 60000, healthCheckUrl: typeof raw.healthCheckUrl === 'string' && isHttpUrl(raw.healthCheckUrl) ? raw.healthCheckUrl : '', healthIntervalMs: 15000, healthTimeoutMs: 5000, healthFailureLimit: 3, waitForHealthyBeforeNext: raw.waitForHealthyBeforeNext === true, healthStartupTimeoutMs: Number.isInteger(raw.healthStartupTimeoutMs) ? Math.max(5000, Math.min(raw.healthStartupTimeoutMs, 120000)) : 30000, startupOrder: Number.isInteger(raw.startupOrder) ? Math.max(0, Math.min(raw.startupOrder, 10000)) : 100, pid: null, procStartTicks: null, createdAt: new Date().toISOString()
    });
  }
  state.apps.push(...imported);
  selected = Math.max(0, visibleApps().length - 1);
  saveState();
  notice = 'Imported ' + imported.length + ' app(s); duplicates skipped. Apps were not started.';
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

async function setStartupOrder(app) {
  const value = Number(await prompt('Startup order for ' + app.name + ' (0–10000; lower starts first): ', String(app.startupOrder ?? 100)));
  if (!Number.isInteger(value) || value < 0 || value > 10000) throw new Error('Startup order must be 0–10000.');
  app.startupOrder = value;
  saveState();
  notice = app.name + ' startup order set to ' + value + '.';
}

async function startAllApps() {
  const ordered = [...state.apps].sort((a, b) => (a.startupOrder ?? 100) - (b.startupOrder ?? 100));
  let started = 0;
  const errors = [];
  for (const app of ordered) {
    try {
      if (!isAlive(app)) { startApp(app); started++; }
      if (app.waitForHealthyBeforeNext && app.healthCheckUrl) {
        notice = 'Waiting for ' + app.name + ' health check before continuing…';
        render();
        if (!await waitForHealthy(app)) {
          errors.push(app.name + ': health readiness timed out; later apps were not started.');
          recordEvent(app, 'readiness-timeout', 'Health readiness timed out during start-all.');
          break;
        }
      }
      await sleep(250);
    } catch (error) { errors.push(app.name + ': ' + error.message); }
  }
  notice = 'Start-all: ' + started + ' started in startup order.' + (errors.length ? ' ' + errors.slice(0,2).join('; ') : '');
}

async function stopAllApps() {
  const ordered = [...state.apps].sort((a, b) => (b.startupOrder ?? 100) - (a.startupOrder ?? 100));
  let stopped = 0;
  const errors = [];
  for (const app of ordered) {
    if (!isAlive(app)) continue;
    try { await stopApp(app); stopped++; }
    catch (error) { errors.push(app.name + ': ' + error.message); }
  }
  notice = 'Stop-all: ' + stopped + ' stopped in reverse startup order.' + (errors.length ? ' ' + errors.slice(0,2).join('; ') : '');
}

async function viewCrashHistory(app) {
  const files = [eventPath(app) + '.1', eventPath(app)];
  const events = [];
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue;
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event && typeof event.timestamp === 'string' && typeof event.type === 'string') {
            events.push(event.timestamp + '  ' + event.type.toUpperCase() + ': ' + String(event.message || ''));
          }
        } catch {}
      }
    } catch {}
  }
  const legacy = logPath(app);
  try {
    if (fs.existsSync(legacy)) {
      events.push(...fs.readFileSync(legacy, 'utf8').split(/\r?\n/)
        .filter(line => /exited \(code=|Restarting application|Restart limit reached|Health failure threshold|spawn error/i.test(line)));
    }
  } catch {}
  const tail = events.slice(-Math.max(10, (process.stdout.rows || 24) - 6));
  clearScreen();
  console.log('\x1b[1;36mEVENT HISTORY · ' + app.name + '\x1b[0m  (press any key to return)\n');
  console.log(tail.length ? tail.join('\n') : 'No lifecycle/crash events recorded.');
  await waitAnyKey();
  notice = 'Returned from event history for ' + app.name + '.';
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
  const app = visibleApps()[selected];
  if (!app) { notice = 'Select an application first.'; return null; }
  return app;
}

async function bulkAction() {
  const targets = state.apps.filter(app => selectedIds.has(app.id));
  if (!targets.length) { notice = 'Mark apps with V before bulk actions.'; return; }
  const choice = (await prompt('Bulk action: start / stop / restart / clear: ')).toLowerCase();
  if (choice === 'clear') { selectedIds.clear(); notice = 'Selection cleared.'; return; }
  if (!['start', 'stop', 'restart'].includes(choice)) { notice = 'Bulk action cancelled.'; return; }
  let ok = 0;
  const errors = [];
  for (const app of targets) {
    try {
      if (choice === 'start') startApp(app);
      else if (choice === 'stop') await stopApp(app);
      else { if (isAlive(app)) await stopApp(app); startApp(app); }
      ok++;
    } catch (error) { errors.push(app.name + ': ' + error.message); }
  }
  notice = 'Bulk ' + choice + ': ' + ok + '/' + targets.length + ' succeeded' + (errors.length ? ' | ' + errors.slice(0,2).join('; ') : '');
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
      case 'i':
        await importConfig();
        break;
      case 'o':
        await exportConfig();
        break;
      case 'c':
        if (app) await viewCrashHistory(app);
        break;
      case 't':
        if (app) await setStartupOrder(app);
        break;
      case 'p':
        await startAllApps();
        break;
      case 'z':
        await stopAllApps();
        break;
      case 'd':
        if (!app) break;
        if (isAlive(app)) throw new Error('Stop the application before deleting its entry.');
        if ((await prompt('Delete ' + app.name + ' from demonpm? Type yes to confirm: ')).toLowerCase() !== 'yes') {
          notice = 'Delete cancelled.';
          break;
        }
        state.apps.splice(state.apps.findIndex(item => item.id === app.id), 1);
        selectedIds.delete(app.id);
        selected = Math.max(0, Math.min(selected, visibleApps().length - 1));
        saveState();
        notice = 'Application entry deleted. Source files and logs were kept.';
        break;
      case 'f': {
        filterText = await prompt('Filter by app name/path (blank clears): ');
        selected = 0;
        notice = filterText ? 'Filter applied.' : 'Filter cleared.';
        break;
      }
      case 'v':
        if (app) { if (selectedIds.has(app.id)) selectedIds.delete(app.id); else selectedIds.add(app.id); }
        notice = app ? (selectedIds.has(app.id) ? app.name + ' marked.' : app.name + ' unmarked.') : 'No app selected.';
        break;
      case 'b':
        await bulkAction();
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

async function runSelfTest() {
  const results = [];
  const warnings = [];
  const check = (name, fn) => {
    try { fn(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, error: error.message }); }
  };

  check('Storage directory and permissions', () => {
    ensureStorage();
    fs.accessSync(HOME, fs.constants.R_OK | fs.constants.W_OK);
    fs.accessSync(LOG_DIR, fs.constants.R_OK | fs.constants.W_OK);
  });

  const atomicTest = path.join(HOME, '.self-test-' + process.pid + '.json');
  check('Atomic state-file write', () => {
    atomicWriteFile(atomicTest, '{"ok":true}', 0o600);
    if (fs.readFileSync(atomicTest, 'utf8') !== '{"ok":true}') throw new Error('Read-back did not match.');
    fs.unlinkSync(atomicTest);
  });
  try { fs.unlinkSync(atomicTest); } catch {}

  const testApp = { id: 'selftest-' + crypto.randomBytes(6).toString('hex'), name: 'self-test' };
  const testLog = logPath(testApp);
  check('Locked log append and rotation', () => {
    appendLogChunk(testApp, Buffer.alloc(Math.floor(MAX_LOG_BYTES * 0.75), 0x61));
    appendLogChunk(testApp, Buffer.alloc(Math.floor(MAX_LOG_BYTES * 0.5), 0x62));
    if (logWarnings.has(testApp.id)) throw new Error(logWarnings.get(testApp.id));
    const activeSize = fs.statSync(testLog).size;
    const backupSize = fs.statSync(testLog + '.1').size;
    if (activeSize > MAX_LOG_BYTES || backupSize > MAX_LOG_BYTES || backupSize === 0) {
      throw new Error('Rotation size bounds were not respected.');
    }
  });
  for (const file of [testLog, testLog + '.1', testLog + '.lock']) {
    try { fs.unlinkSync(file); } catch {}
  }

  check('Node executable', () => {
    if (!fs.existsSync(NODE) || !fs.statSync(NODE).isFile()) throw new Error('Node executable is missing.');
    if (process.platform !== 'win32') fs.accessSync(NODE, fs.constants.X_OK);
  });

  check('Saved configuration schema', () => {
    if (!fs.existsSync(STATE_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.apps)) throw new Error('state.json must contain an apps array.');
    for (const app of parsed.apps) {
      if (!app || typeof app.id !== 'string' || typeof app.name !== 'string' ||
          typeof app.cwd !== 'string' || typeof app.entry !== 'string' || !Array.isArray(app.args)) {
        throw new Error('Invalid app entry in state.json.');
      }
      if (app.healthCheckUrl && !isHttpUrl(app.healthCheckUrl)) warnings.push(app.name + ': invalid health-check URL in saved config.');
      if (!fs.existsSync(app.cwd) || !fs.existsSync(path.resolve(app.cwd, app.entry))) {
        warnings.push(app.name + ': working directory or entry file is missing.');
      }
      const configuredNode = typeof app.nodePath === 'string' && path.isAbsolute(app.nodePath) ? app.nodePath : NODE;
      if (!fs.existsSync(configuredNode) || !fs.statSync(configuredNode).isFile()) {
        warnings.push(app.name + ': configured Node.js executable is missing.');
      } else if (process.platform !== 'win32') {
        try { fs.accessSync(configuredNode, fs.constants.X_OK); }
        catch { warnings.push(app.name + ': configured Node.js executable is not executable.'); }
      }
      if (!app.args.every(arg => typeof arg === 'string')) warnings.push(app.name + ': arguments contain non-string values.');
      if (app.env !== undefined && (!app.env || typeof app.env !== 'object' || Array.isArray(app.env))) {
        warnings.push(app.name + ': environment configuration is not an object.');
      }
      if (app.pid && !isAlive(app)) {
        warnings.push(app.name + ': saved supervisor PID is stale.');
        if (isProcessGroupAlive(app)) warnings.push(app.name + ': process group remains after its supervisor PID; inspect for orphaned children (not killed automatically).');
      }
    }
  });

  await new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(NODE, ['-e', 'process.exit(0)'], { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('Node child-process smoke test timed out.'));
    }, 5000);
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('Node child process exited with code ' + code));
    });
  }).then(() => results.push({ name: 'Node child-process spawn', ok: true }))
    .catch(error => results.push({ name: 'Node child-process spawn', ok: false, error: error.message }));

  for (const result of results) {
    console.log((result.ok ? 'PASS ' : 'FAIL ') + result.name + (result.error ? ': ' + result.error : ''));
  }
  for (const warning of warnings) console.log('WARN ' + warning);
  const failed = results.filter(result => !result.ok).length;
  console.log('\nDEMONPM JS ' + VERSION + ' self-test: ' + (results.length - failed) + '/' + results.length + ' checks passed; ' + warnings.length + ' warning(s).');
  return failed === 0;
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
  for (const app of [...state.apps].sort((a, b) => (a.startupOrder ?? 100) - (b.startupOrder ?? 100))) {
    if (app.autoRestart && app.desiredRunning && !isAlive(app)) {
      try {
        startApp(app);
        writeLog(app, 'Startup recovery: supervisor relaunched by DEMONPM.');
        recordEvent(app, 'startup-recovery', 'Supervisor relaunched during manager startup.');
        if (app.waitForHealthyBeforeNext && app.healthCheckUrl && !await waitForHealthy(app)) {
          writeLog(app, 'Startup recovery health readiness timed out.');
          recordEvent(app, 'readiness-timeout', 'Health readiness timed out during startup recovery.');
        }
      } catch (error) {
        writeLog(app, 'Startup recovery failed: ' + error.message);
        recordEvent(app, 'startup-recovery-error', 'Startup recovery failed: ' + error.message);
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
      selected = Math.min(Math.max(0, visibleApps().length - 1), selected + 1);
    } else if (key.name === 'home' || str === 'g') {
      selected = 0;
    } else if (key.name === 'end' || str === 'G') {
      selected = Math.max(0, visibleApps().length - 1);
    } else if (key.name === 'pageup') {
      selected = Math.max(0, selected - Math.max(1, (process.stdout.rows || 24) - 15));
    } else if (key.name === 'pagedown') {
      selected = Math.min(Math.max(0, visibleApps().length - 1), selected + Math.max(1, (process.stdout.rows || 24) - 16));
    } else if (key.name === 'q' || str === 'Q') {
      shutdown();
      return;
    } else if (key.name === 'return' || key.name === 'space') {
      const app = visibleApps()[selected];
      if (app) await action(isAlive(app) ? 'x' : 's');
      else notice = 'Press A to add your first Node.js app.';
    } else if (str === '?' || str === 'h' || str === 'H') {
      showHelp = !showHelp;
    } else if (str && 'asxrledmfvb ioct pz'.replace(/ /g, '').includes(str.toLowerCase())) {
      await action(str.toLowerCase());
    }
    render();
  };
  process.stdin.on('keypress', keyHandler);
  const onResize = () => render();
  process.stdout.on('resize', onResize);
  render();
  const metricsTimer = setInterval(() => { if (running && !prompting && !actionBusy) render(); }, 1000);
  // Render only on user input or terminal resize. A periodic full-screen clear
  // causes visible flicker and is unnecessary for process status display.
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await new Promise(resolve => {
    const check = setInterval(() => {
      if (!running) { clearInterval(check); resolve(); }
    }, 100);
  });
  clearInterval(metricsTimer);
  process.stdout.off('resize', onResize);
  saveState();
}

if (process.argv[2] === '--self-test') {
  runSelfTest().then(ok => { process.exitCode = ok ? 0 : 1; }).catch(error => {
    console.error('DEMONPM self-test failed:', error.message);
    process.exitCode = 1;
  });
} else if (process.argv[2] === '--supervise' && process.argv[3]) {
  runSupervisor(process.argv[3]).catch(error => {
    const message = 'Supervisor error: ' + error.message;
    try {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      const app = Array.isArray(parsed.apps) ? parsed.apps.find(item => item.id === process.argv[3]) : null;
      if (app) {
        writeLog(app, message);
        recordEvent(app, 'supervisor-error', message);
      } else {
        fs.appendFileSync(path.join(LOG_DIR, process.argv[3] + '.log'), '[' + new Date().toISOString() + '] ' + message + '\\n');
      }
    } catch {
      try { fs.appendFileSync(path.join(LOG_DIR, process.argv[3] + '.log'), '[' + new Date().toISOString() + '] ' + message + '\\n'); } catch {}
    }
    process.exitCode = 1;
  });
} else {
  main().catch(error => {
    shutdown();
    console.error('DEMONPM JS fatal error:', error.message);
    process.exitCode = 1;
  });
}
