import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const tty = Boolean(process.stdout.isTTY);
const c = (code, value) => tty ? `\x1b[${code}m${value}\x1b[0m` : value;
const cyan = s => c("38;5;45", s);
const purple = s => c("38;5;141", s);
const muted = s => c("38;5;244", s);
const green = s => c("38;5;78", s);
const red = s => c("38;5;203", s);
const bold = s => c("1", s);

export const ask = q => new Promise(resolve => rl.question(q, resolve));
export const say = s => console.log(s);
export const closeInput = () => rl.close();

export function banner() {
  console.clear?.();
  console.log("");
  console.log(purple("  ██████╗ ███████╗███╗   ███╗ ██████╗ ███╗   ██╗"));
  console.log(purple("  ██╔══██╗██╔════╝████╗ ████║██╔═══██╗████╗  ██║"));
  console.log(cyan("  ██████╔╝█████╗  ██╔████╔██║██║   ██║██╔██╗ ██║"));
  console.log(cyan("  ██╔══██╗██╔══╝  ██║╚██╔╝██║██║   ██║██║╚██╗██║"));
  console.log(purple("  ██║  ██║███████╗██║ ╚═╝ ██║╚██████╔╝██║ ╚████║"));
  console.log(purple("  ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝"));
  console.log("");
  console.log(`  ${bold("REALXXDEMONXX AGENT")} ${muted("· TERMUX EDITION")}`);
  console.log(`  ${muted("AI SOFTWARE ENGINEERING WORKSPACE")}`);
  console.log(`  ${muted("────────────────────────────────────────────────────────")}`);
}

export function section(title) {
  console.log(`\n${cyan("◆")} ${bold(title)}`);
}
export function success(message) { console.log(`${green("✓")} ${message}`); }
export function error(message) { console.log(`${red("✕")} ${message}`); }
export function info(message) { console.log(`${muted("│")} ${message}`); }

export async function withSpinner(label, task) {
  if (!tty) { info(label); return task(); }
  const frames = ["◐","◓","◑","◒"];
  let i = 0;
  const timer = setInterval(() => {
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${cyan(frames[i++ % frames.length])} ${label}`);
  }, 90);
  try {
    const result = await task();
    clearInterval(timer);
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`${green("✓")} ${label}`);
    return result;
  } catch (e) {
    clearInterval(timer);
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`${red("✕")} ${label}`);
    throw e;
  }
}

export function showTool(name, args = {}) {
  const detail = Object.entries(args).map(([k,v]) => `${k}: ${String(v).slice(0,90)}`).join(" · ");
  console.log(`\n  ${purple("⚙")} ${bold(name)} ${muted(detail)}`);
}
export function agentText(text) {
  if (text) console.log(`\n${cyan("◈")} ${bold("AGENT")}\n${text.trim()}\n`);
}
export function promptLabel() {
  return `\n${purple("┌─")} ${bold("YOU")}\n${purple("└─")} `;
}
