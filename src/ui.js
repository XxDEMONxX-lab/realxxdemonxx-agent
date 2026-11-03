import readline from "node:readline";
export const ESC="\u001b";
const COMMANDS=["/help","/menu","/chat","/files","/pwd","/providers","/models","/model","/provider","/test","/maxsteps","/settings","/limits","/undo","/status","/clear","/exit"];
const tty=Boolean(process.stdin.isTTY&&process.stdout.isTTY);
const color=(code,value)=>tty?"\x1b["+code+"m"+value+"\x1b[0m":value;
const cyan=s=>color("38;5;81",s),violet=s=>color("38;5;141",s),dim=s=>color("2;37",s),green=s=>color("38;5;78",s),red=s=>color("38;5;203",s),bold=s=>color("1",s);
let activePrompt=null, dashboard=false, logs=[], inputValue="", selectedNav=0, session={provider:"",model:"",workspace:process.cwd(),status:"READY",task:"Waiting for instructions"};
const NAV=[["CHAT","/chat"],["PROJECT FILES","/files"],["PROVIDERS","/providers"],["MODELS","/models"],["API TEST","/test"],["PERMISSIONS","/settings"],["TOKEN LIMIT","/limits"],["UNDO CHANGE","/undo"],["SESSION STATUS","/status"],["HELP","/help"]];
let originalLog=null,originalError=null;
if(tty)readline.emitKeypressEvents(process.stdin);
function pushLog(value){logs.push(...String(value).split(/\r?\n/));if(logs.length>400)logs=logs.slice(-400);if(dashboard)drawDashboard();}
function drawDashboard(){
 if(!dashboard||!tty)return;
 const width=Math.max(60,process.stdout.columns||80),height=Math.max(18,process.stdout.rows||24);
 const side=22,main=width-side-3,body=height-12;
 const clip=(s,n)=>{s=String(s).replace(/\x1b\[[0-9;]*m/g,"").replace(/\r/g,"");return s.length>n?s.slice(0,Math.max(0,n-1))+"…":s;};
 const line=(s="")=>process.stdout.write(s+"\x1b[K\n");
 process.stdout.write("\x1b[H");
 line(" "+bold(violet("REALXXDEMONXX"))+" "+bold(cyan("AGENT"))+dim("  /  INTERACTIVE WORKSPACE")+ " ".repeat(Math.max(1,width-48))+green("● "+session.status));
 line(dim(" "+session.workspace.slice(0,Math.max(20,width-4))));
 line(dim("─".repeat(width)));
 line(" "+bold("WORKSPACE")+ " ".repeat(Math.max(1,side-10))+dim("│")+" "+bold("SESSION / ACTIVITY"));
 line(" "+dim("─".repeat(side))+"  "+dim("┌"+"─".repeat(Math.max(8,main-2))+"┐"));
 for(let r=0;r<body;r++){
  const nav=NAV[r];
  let left=nav?(r===selectedNav?cyan(" ❯ "+nav[0].padEnd(side-4)):dim("   "+nav[0].padEnd(side-4))):" ".repeat(side);
  const item=logs.slice(-body)[r]??"";
  line(left+"  "+dim("│")+" "+clip(item,Math.max(8,main-3)));
 }
 line(" "+dim("─".repeat(side))+"  "+dim("└"+"─".repeat(Math.max(8,main-2))+"┘"));
 line(" "+dim("PROVIDER")+"  "+clip(session.provider||"Not set",side-12)+"  "+dim("MODEL")+"  "+clip(session.model||"Not set",Math.max(8,main-18)));
 line(dim("─".repeat(width)));
 line(" "+bold(green("YOU"))+" "+violet("›")+" "+inputValue+"\x1b[K");
 const matches=inputValue.startsWith("/")?COMMANDS.filter(x=>x.startsWith(inputValue)).slice(0,7):[];
 if(matches.length)line(" "+dim("COMMANDS  ")+matches.join("   "));
 line(dim(" ↑↓ Navigate when input is empty   Enter Select/Send   Tab Complete   Esc Back   Ctrl+P Palette"));
}
function captureConsole(){
 if(!tty||originalLog)return;
 originalLog=console.log;originalError=console.error;
 console.log=(...args)=>pushLog(args.map(x=>typeof x==="string"?x:String(x)).join(" "));
 console.error=(...args)=>pushLog(red(args.map(x=>typeof x==="string"?x:String(x)).join(" ")));
}
export function startTUI(config={}){
 if(!tty)return;
 dashboard=true;session.provider=config.providerName||config.provider||"Not configured";session.model=config.model||"Not configured";session.workspace=process.cwd();session.status="ONLINE";
 process.stdout.write("\x1b[?1049h\x1b[?25l");
 process.stdout.on("resize",drawDashboard);
 captureConsole();drawDashboard();
}
export const say=value=>console.log(value);
export const closeInput=()=>{
 if(activePrompt)activePrompt(ESC);
 dashboard=false;
 if(originalLog){console.log=originalLog;console.error=originalError;originalLog=null;originalError=null;}
 try{if(tty)process.stdin.setRawMode(false);}catch{}
 if(tty)process.stdout.write("\x1b[?25h\x1b[?1049l");
};
export function banner(){if(tty)console.clear();console.log("");console.log("  "+bold(violet("REALXXDEMONXX"))+" "+bold(cyan("AGENT"))+" "+dim("// AI DEVELOPMENT ENVIRONMENT"));console.log("  "+dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"));console.log("  "+dim("WORKSPACE")+"  "+cyan("BUILD")+"  "+dim("›")+"  "+cyan("DEBUG")+"  "+dim("›")+"  "+cyan("TEST")+"  "+dim("›")+"  "+cyan("SHIP"));console.log("");}
export function section(title){console.log("\n"+violet("◆")+" "+bold(title));}
export function success(message){console.log(green("✓")+" "+message);}
export function error(message){console.log(red("✕")+" "+message);}
export function info(message){console.log(dim("│")+" "+message);}
export function chatReady(model,provider){session.model=model||session.model;session.provider=provider||session.provider;section("SESSION");success("Connected · "+(provider||"provider"));info("Model     "+model);info("Workspace "+process.cwd());info("Enter a task to start.  / opens commands · Tab completes · Esc backs out.");console.log("");}
export async function ask(prompt){
 if(!tty){const rl=readline.createInterface({input:process.stdin,output:process.stdout});return new Promise(resolve=>rl.question(prompt,value=>{rl.close();resolve(value);}));}
 return new Promise(resolve=>{
  let value="",finished=false,matchIndex=0,historyIndex=-1;const input=process.stdin;
  const render=()=>{if(dashboard){inputValue=value;drawDashboard();}else{readline.clearLine(process.stdout,0);readline.cursorTo(process.stdout,0);process.stdout.write(prompt+value);}};
  const done=result=>{if(finished)return;finished=true;input.removeListener("keypress",onKey);try{input.setRawMode(false);}catch{}activePrompt=null;inputValue="";if(dashboard)drawDashboard();else process.stdout.write("\n");resolve(result);};
  const onKey=(str,key={})=>{
   if(finished)return;
   if(key.name==="escape"){done(ESC);return;}
   if(key.ctrl&&key.name==="p"){done("/menu");return;}
   if(key.name==="return"||key.name==="enter"){
    if(!value.trim()&&dashboard){done(NAV[selectedNav]?.[1]||"/chat");return;}
    done(value);return;
   }
   if(key.ctrl&&key.name==="c"){done(ESC);closeInput();process.exit(130);}
   if(key.name==="backspace"){value=value.slice(0,-1);render();return;}
   if(key.name==="up"||key.name==="down"){
    if(!value&&dashboard){selectedNav=(selectedNav+(key.name==="up"?NAV.length-1:1))%NAV.length;render();return;}
    return;
   }
   if(key.name==="tab"){
    const hits=COMMANDS.filter(x=>x.startsWith(value));if(hits.length){value=hits[matchIndex++%hits.length];render();}return;
   }
   if(str&&!key.ctrl&&!key.meta&&str.length===1){value+=str;render();}
  };
  activePrompt=done;
  if(dashboard){inputValue="";drawDashboard();}else process.stdout.write(prompt);
  try{input.setRawMode(true);}catch{}input.resume();input.on("keypress",onKey);
 });
}
export async function quickMenu(){
 const entries=[["/chat","Return to coding chat"],["/files","Browse project files"],["/providers","Switch API provider"],["/models","Choose a model"],["/test","Test API connection"],["/settings","Permissions and preferences"],["/limits","Response token limit"],["/undo","Restore previous file version"],["/status","Session status"],["/help","Command reference"],["/exit","Exit agent"]];
 if(!tty){section("COMMAND PALETTE");entries.forEach(([cmd,desc],i)=>console.log("  "+(i+1)+". "+cmd+"  "+desc));const choice=(await ask("  Select command number (Esc to cancel): ")).trim();return /^\d+$/.test(choice)?entries[Number(choice)-1]?.[0]||null:null;}
 let selected=0,done=false;const input=process.stdin;
 return await new Promise(resolve=>{
  const draw=()=>{drawDashboard();const start=Math.max(0,Math.floor((process.stdout.rows||24)/2)-5);readline.cursorTo(process.stdout,2,start);process.stdout.write(bold(violet("COMMAND PALETTE"))+"\n");entries.forEach(([cmd,desc],i)=>process.stdout.write((i===selected?cyan(" ❯ "):"   ")+cmd.padEnd(14)+" "+dim(desc)+"\n"));process.stdout.write(dim(" ↑↓ Select · Enter Run · Esc Close"));};
  const finish=v=>{if(done)return;done=true;input.removeListener("keypress",onKey);try{input.setRawMode(false);}catch{}drawDashboard();resolve(v);};
  const onKey=(str,key={})=>{if(key.name==="up")selected=(selected+entries.length-1)%entries.length;else if(key.name==="down")selected=(selected+1)%entries.length;else if(key.name==="return"||key.name==="enter"){finish(entries[selected][0]);return;}else if(key.name==="escape"||(key.name==="c"&&key.ctrl)){finish(null);return;}else if(str&&/^[1-9]$/.test(str)){finish(entries[Number(str)-1]?.[0]||null);return;}draw();};
  try{input.setRawMode(true);}catch{}draw();input.on("keypress",onKey);
 });
}
export async function withSpinner(label,task){if(!tty||dashboard){session.status="WORKING";info(label);try{const result=await task();session.status="ONLINE";success(label);return result;}catch(e){session.status="ERROR";error(label);throw e;}}const frames=["◐","◓","◑","◒"];let i=0;const timer=setInterval(()=>{readline.cursorTo(process.stdout,0);process.stdout.write(cyan(frames[i++%frames.length])+" "+label);},100);try{const result=await task();clearInterval(timer);readline.clearLine(process.stdout,0);readline.cursorTo(process.stdout,0);console.log(green("✓")+" "+label);return result;}catch(e){clearInterval(timer);readline.clearLine(process.stdout,0);readline.cursorTo(process.stdout,0);console.log(red("✕")+" "+label);throw e;}}
export function showTool(name,args={}){const detail=Object.entries(args).map(([k,v])=>k+": "+String(v).replace(/\s+/g," ").slice(0,75)).join(" · ");console.log("\n  "+violet("⚙")+" "+bold(name)+" "+dim(detail));}
export function agentText(value){if(value)console.log("\n"+cyan("◆")+" "+bold("AGENT")+"\n"+value.trim()+"\n");}
export function promptLabel(){return "\n"+green("YOU")+" "+violet("›")+" ";}
