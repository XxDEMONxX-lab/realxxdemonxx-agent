import readline from "node:readline";
export const ESC="\u001b";
const COMMANDS=["/help","/menu","/chat","/files","/pwd","/providers","/models","/model","/provider","/test","/maxsteps","/settings","/limits","/undo","/status","/clear","/exit"];
const tty=Boolean(process.stdin.isTTY&&process.stdout.isTTY);
const color=(code,value)=>tty?"\x1b["+code+"m"+value+"\x1b[0m":value;
const cyan=s=>color("38;5;81",s),violet=s=>color("38;5;141",s),dim=s=>color("2;37",s),green=s=>color("38;5;78",s),red=s=>color("38;5;203",s),bold=s=>color("1",s);
let activePrompt=null;
if(tty)readline.emitKeypressEvents(process.stdin);
export const ask=prompt=>{
 if(!tty){const rl=readline.createInterface({input:process.stdin,output:process.stdout});return new Promise(resolve=>rl.question(prompt,value=>{rl.close();resolve(value);}));}
 return new Promise(resolve=>{
  let value="",finished=false,matchIndex=0;const input=process.stdin;
  const render=()=>{readline.clearLine(process.stdout,0);readline.cursorTo(process.stdout,0);process.stdout.write(prompt+value);};
  const done=result=>{if(finished)return;finished=true;input.removeListener("keypress",onKey);try{input.setRawMode(false);}catch{}process.stdout.write("\n");activePrompt=null;resolve(result);};
  const onKey=(str,key={})=>{if(finished)return;if(key.name==="escape"){done(ESC);return;}if(key.name==="return"||key.name==="enter"){done(value);return;}if(key.name==="c"&&key.ctrl){done(ESC);return;}if(key.name==="backspace"){value=value.slice(0,-1);render();return;}if(key.name==="tab"){const hits=COMMANDS.filter(x=>x.startsWith(value));if(hits.length){value=hits[matchIndex++%hits.length];render();if(hits.length>1)process.stdout.write(dim("  ["+hits.join("  ")+"]"));}return;}if(str&&!key.ctrl&&!key.meta&&str.length===1){value+=str;render();if(value==="/"){process.stdout.write("\\n"+dim("  COMMANDS  ")+COMMANDS.join("  "));render();}}};
  activePrompt=done;process.stdout.write(prompt);try{input.setRawMode(true);}catch{}input.resume();input.on("keypress",onKey);
 });
};
export const say=value=>console.log(value);
export const closeInput=()=>{if(activePrompt)activePrompt(ESC);try{if(tty)process.stdin.setRawMode(false);}catch{}};
export function banner(){if(tty)console.clear();console.log("");console.log("  "+bold(violet("REALXXDEMONXX"))+" "+bold(cyan("AGENT"))+" "+dim("// AI DEVELOPMENT ENVIRONMENT"));console.log("  "+dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));console.log("  "+dim("WORKSPACE")+"  "+cyan("BUILD")+"  "+dim("›")+"  "+cyan("DEBUG")+"  "+dim("›")+"  "+cyan("TEST")+"  "+dim("›")+"  "+cyan("SHIP"));console.log("");}
export function section(title){console.log("\n"+violet("◆")+" "+bold(title));}
export function success(message){console.log(green("✓")+" "+message);}
export function error(message){console.log(red("✕")+" "+message);}
export function info(message){console.log(dim("│")+" "+message);}
export function chatReady(model,provider){section("SESSION");success("Connected · "+(provider||"provider"));info("Model     "+model);info("Workspace "+process.cwd());info("Enter a task to start.  / opens commands · Tab completes · Esc backs out.");console.log("");}
export function quickMenu(){section("COMMAND PALETTE");const rows=[["/files","Browse project"],["/providers","Change provider"],["/models","Select model"],["/test","Test connection"],["/settings","Permissions and settings"],["/undo","Undo last file change"],["/status","Session status"],["/help","All commands"],["/exit","Exit agent"]];rows.forEach(([cmd,label])=>console.log("  "+cyan(cmd.padEnd(14))+" "+dim(label)));}
export async function withSpinner(label,task){if(!tty){info(label);return task();}const frames=["◐","◓","◑","◒"];let i=0;const timer=setInterval(()=>{readline.cursorTo(process.stdout,0);process.stdout.write(cyan(frames[i++%frames.length])+" "+label);},100);try{const result=await task();clearInterval(timer);readline.clearLine(process.stdout,0);readline.cursorTo(process.stdout,0);console.log(green("✓")+" "+label);return result;}catch(e){clearInterval(timer);readline.clearLine(process.stdout,0);readline.cursorTo(process.stdout,0);console.log(red("✕")+" "+label);throw e;}}
export function showTool(name,args={}){const detail=Object.entries(args).map(([k,v])=>k+": "+String(v).replace(/\s+/g," ").slice(0,75)).join(" · ");console.log("\n  "+violet("⚙")+" "+bold(name)+" "+dim(detail));}
export function agentText(value){if(value)console.log("\n"+cyan("◆")+" "+bold("AGENT")+"\n"+value.trim()+"\n");}
export function promptLabel(){return "\n"+green("YOU")+" "+violet("›")+" ";}
