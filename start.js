#!/usr/bin/env node
"use strict";

// Node.js entry point for the Python agent. No shell is involved, so arguments
// and paths are passed safely and Ctrl+C is forwarded to the child process.
const { spawn } = require("node:child_process");
const path = require("node:path");

const script = path.join(__dirname, "agent.py");
const candidates = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
let child = null;
let index = 0;
let finished = false;

function launch() {
  if (index >= candidates.length) {
    if (!finished) {
      finished = true;
      console.error("Demon Agent needs Python 3.10+. Install it, then retry.");
      process.exitCode = 127;
    }
    return;
  }

  const executable = candidates[index++];
  child = spawn(executable, [script, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });

  child.once("error", (error) => {
    if (error.code === "ENOENT") {
      launch();
      return;
    }
    if (!finished) {
      finished = true;
      console.error("Could not start Python:", error.message);
      process.exitCode = 1;
    }
  });

  child.once("exit", (code, signal) => {
    if (finished) return;
    finished = true;
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exitCode = code ?? 1;
    }
  });
}

process.once("SIGINT", () => {
  if (child && !child.killed) child.kill("SIGINT");
});
process.once("SIGTERM", () => {
  if (child && !child.killed) child.kill("SIGTERM");
});

launch();
