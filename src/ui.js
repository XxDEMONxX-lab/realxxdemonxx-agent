import readline from "node:readline";

const rl=readline.createInterface({input:process.stdin,output:process.stdout});
const tty=Boolean(process.stdout.isTTY);
const color=(code,value)=>tty?`\x1b[${code}m${value}\x1b[0m`:value;
const cyan=s=>color("38;5;81",s);
const violet=s=>color("38;5;141",s);
const dim=s=>color("2;37",s);
const green=s=>color("38;5;78",s);
const red=s=>color("38;5;203",s);
const bold=s=>color("1",s);

export const ask=prompt=>new Promise(resolve=>rl.question(prompt,resolve));
export const say=value=>console.log(value);
export const closeInput=()=>rl.close();

export function banner() {
  if (tty) console.clear();
  console.log("");
  console.log(`  ${bold(violet("REALXXDEMONXX"))} ${bold(cyan("AGENT"))} ${dim(" / TERMINAL CODING ENVIRONMENT")}`);
  console.log(`  ${dim("────────────────────────────────────────────────────────────")}`);
  console.log(`  ${dim("BUILD")}  ${cyan("Plan")}  ${dim("›")}  ${cyan("Code")}  ${dim("›")}  ${cyan("Test")}  ${dim("›")}  ${cyan("Refine")}`);
  console.log("");
}
export function section(title) { console.log(`\n${violet("◆")} ${bold(title)}`); }
export function success(message) { console.log(`${green("✓")} ${message}`); }
export function error(message) { console.log(`${red("✕")} ${message}`); }
export function info(message) { console.log(`${dim("│")} ${message}`); }

export function chatReady(model,provider) {
  section("CHAT READY");
  success("Connected to " + (provider || "provider"));
  info("Model  " + model);
  info("Type a message and press Enter to chat.");
  info("Use /help for commands, /menu for quick actions, or /exit to quit.");
  console.log("");
}

export function quickMenu() {
  section("QUICK MENU");
  console.log("  /chat       Return to the chat prompt");
  console.log("  /files      Show project files");
  console.log("  /pwd        Show current project directory");
  console.log("  /models     Change model");
  console.log("  /providers  Change provider");
  console.log("  /test       Test model connection");
  console.log("  /status     Show active configuration");
  console.log("  /clear      Clear conversation context");
  console.log("  /help       Show all commands");
  console.log("  /exit       Exit agent");
}

export async function withSpinner(label,task) {
  if (!tty) { info(label); return task(); }
  const frames=["◐","◓","◑","◒"];
  let i=0;
  const timer=setInterval(()=>{
    readline.cursorTo(process.stdout,0);
    process.stdout.write(`${cyan(frames[i++%frames.length])} ${label}`);
  },100);
  try {
    const result=await task();
    clearInterval(timer);
    readline.clearLine(process.stdout,0);
    readline.cursorTo(process.stdout,0);
    console.log(`${green("✓")} ${label}`);
    return result;
  } catch(e) {
    clearInterval(timer);
    readline.clearLine(process.stdout,0);
    readline.cursorTo(process.stdout,0);
    console.log(`${red("✕")} ${label}`);
    throw e;
  }
}
export function showTool(name,args={}) {
  const detail=Object.entries(args).map(([k,v])=>`${k}: ${String(v).replace(/\s+/g," ").slice(0,75)}`).join(" · ");
  console.log(`\n  ${violet("⚙")} ${bold(name)} ${dim(detail)}`);
}
export function agentText(value) {
  if (value) console.log(`\n${cyan("◆")} ${bold("AGENT")}\n${value.trim()}\n`);
}
export function promptLabel() { return `\n${green("YOU")} ${violet("›")} `; }
