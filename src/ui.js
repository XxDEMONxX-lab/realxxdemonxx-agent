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
  const onKey=(str,key={})=>{if(finished)return;if(key.name==="escape"){done(ESC);return;}if(key.name==="return"||key.name==="enter"){done(value);return;}if(key.name==="c"&&key.ctrl){done(ESC);return;}if(key.name==="backspace"){value=value.slice(0,-1);render();return;}if(key.name==="tab"){const hits=COMMANDS.filter(x=>x.startsWith(value));if(hits.length){value=hits[matchIndex++%hits.length];render();if(hits.length>1)process.stdout.write(dim("  ["+hits.join("  ")+"]"));}return;}if(str&&!key.ctrl&&!key.meta&&str.length===1){value+=str;render();if(value==="/"){process.stdout.write("\n"+dim("  COMMANDS  ")+COMMANDS.join("  "));render();}}};
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
export async function quickMenu(){
 if(!tty){section("COMMAND PALETTE");COMMANDS.forEach((cmd,i)=>console.log("  "+(i+1)+". "+cmd));const choice=(await ask("  Select command number (Esc to cancel): ")).trim();return /^\\d+$/.test(choice)?COMMANDS[Number(choice)-1]||null:null;}
 const entries=[
  ["/chat","Return to coding chat"],["/files","Browse project files"],["/providers","Switch API provider"],["/models","Choose a model"],["/test","Test API connection"],["/settings","Permissions and preferences"],["/limits","Response token limit"],["/undo","Restore previous file version"],["/status","Session status"],["/help","Command reference"],["/exit","Exit agent"]
 ];
 let selected=0,done=false,result=null;
 const input=process.stdin;
 return await new Promise(resolve=>{
  const draw=()=>{
   readline.cursorTo(process.stdout,0,0);readline.clearScreenDown(process.stdout);
   console.log(bold(violet("  REALXXDEMONXX AGENT"))+"  "+dim("COMMAND CENTER"));
   console.log(dim("  ↑ ↓ Navigate     Enter Select     Esc Back"));
   console.log(dim("  ─────────────────────────────────────────────────────────"));
   entries.forEach(([cmd,desc],i)=>{
    const active=i===selected;
    console.log((active?cyan("  ❯ "):"    ")+(active?bold(cmd.padEnd(15)):cmd.padEnd(15))+" "+(active?desc:dim(desc)));
   });
   console.log("\\n"+dim("  Workspace: "+process.cwd()));
  };
  const finish=value=>{if(done)return;done=true;input.removeListener("keypress",onKey);try{input.setRawMode(false);}catch{}process.stdout.write("\\x1b[?25h\\x1b[?1049l");resolve(value);};
  const onKey=(str,key={})=>{
   if(key.name==="up")selected=(selected+entries.length-1)%entries.length;
   else if(key.name==="down")selected=(selected+1)%entries.length;
   else if(key.name==="return"||key.name==="enter"){result=entries[selected][0];finish(result);return;}
   else if(key.name==="escape"||(key.name==="c"&&key.ctrl)){finish(null);return;}
   else if(str&&/^[1-9]$/.test(str)){const n=Number(str)-1;if(n<entries.length){result=entries[n][0];finish(result);return;}}
   draw();
  };
  process.stdout.write("\\x1b[?1049h\\x1b[?25l");try{input.setRawMode(true);}catch{}input.resume();draw();input.on("keypress",onKey);
 });
}
export async function withSpinner(label,task){if(!tty){info(label);return task();}const frames=["◐","◓","◑","◒"];let i=0;const timer=setInterval(()=>{readline.cursorTo(process.stdout,0);process.stdout.write(cyan(frames[i++%frames.length])+" "+label);},100);try{const result=await task();clearInterval(timer);readline.clearLine(process.stdout,0);readline.cursorTo(process.stdout,0);console.log(green("✓")+" "+label);return result;}catch(e){clearInterval(timer);readline.clearLine(process.stdout,0);readline.cursorTo(process.stdout,0);console.log(red("✕")+" "+label);throw e;}}
export function showTool(name,args={}){const detail=Object.entries(args).map(([k,v])=>k+": "+String(v).replace(/\s+/g," ").slice(0,75)).join(" · ");console.log("\n  "+violet("⚙")+" "+bold(name)+" "+dim(detail));}
export function agentText(value){if(value)console.log("\n"+cyan("◆")+" "+bold("AGENT")+"\n"+value.trim()+"\n");}
export function promptLabel(){return "\n"+green("YOU")+" "+violet("›")+" ";}
