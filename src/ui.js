import readline from "node:readline";
import {clipAnsi,previousCursorIndex,nextCursorIndex,lineStartIndex,lineEndIndex} from "./core.js";
export const ESC="\u001b";
const COMMANDS=["/help","/menu","/chat","/plan","/review","/debug","/files","/open","/edit","/editor","/terminal","/map","/skills","/pwd","/providers","/models","/routing","/web","/mcp","/skills","/fallback","/model","/provider","/test","/maxsteps","/settings","/limits","/usage","/memory","/history","/git","/diff","/run-tests","/checkpoint","/checkpoints","/restore","/undo","/status","/clear","/exit"];
const tty=Boolean(process.stdin.isTTY&&process.stdout.isTTY);
const color=(code,value)=>tty?"\x1b["+code+"m"+value+"\x1b[0m":value;
const cyan=s=>color("38;5;81",s),violet=s=>color("38;5;141",s),dim=s=>color("2;37",s),green=s=>color("38;5;78",s),red=s=>color("38;5;203",s),bold=s=>color("1",s);
let activePrompt=null, dashboard=false, logs=[], inputValue="", inputCursor=0, selectedNav=0, session={provider:"",model:"",workspace:process.cwd(),status:"READY",task:"Waiting for instructions",diff:[]};
const NAV=[["CHAT","/chat"],["PROJECT FILES","/files"],["EDITOR","/editor"],["TERMINAL","/terminal"],["PROVIDERS","/providers"],["MODELS","/models"],["API TEST","/test"],["PERMISSIONS","/settings"],["TOKEN LIMIT","/limits"],["UNDO CHANGE","/undo"],["SESSION STATUS","/status"],["HELP","/help"]];
let originalLog=null,originalError=null,renderCache=null,promptHistory=[];
if(tty)readline.emitKeypressEvents(process.stdin);
function pushLog(value){logs.push(...String(value).split(/\r?\n/));if(logs.length>400)logs=logs.slice(-400);if(dashboard)drawDashboard();}
function drawDashboard(){
 if(!dashboard||!tty)return;
 const width=Math.max(60,process.stdout.columns||80),height=Math.max(18,process.stdout.rows||24);
 const side=22,contextWidth=width>=105?22:0,main=Math.max(18,width-side-contextWidth-6),body=height-12;
 const clip=clipAnsi;
 const context=session.diff.length?["LATEST DIFF","──────────────",...session.diff.slice(0,14)]:["PROJECT CONTEXT","───────────────","Provider",session.provider||"Not set","","Model",session.model||"Not set","","Workspace",session.workspace.split("/").filter(Boolean).slice(-2).join("/")||session.workspace,"","Current task",session.task||"Waiting for instructions","","Status",session.status];
 const rows=[];
 rows.push(" "+bold(violet("REALXXDEMONXX"))+" "+bold(cyan("AGENT"))+dim("  /  HYBRID CODING WORKSPACE")+" ".repeat(Math.max(1,width-52))+green("● "+session.status));
 rows.push(dim(" "+session.workspace.slice(0,Math.max(20,width-4))));
 rows.push(dim("─".repeat(width)));
 rows.push(" "+bold("EXPLORER")+" ".repeat(Math.max(1,side-10))+dim("│")+" "+bold("ACTIVITY")+(contextWidth?" ".repeat(Math.max(1,main-8))+dim("│")+" "+bold("DIFF / CONTEXT"):""));
 rows.push(" "+dim("─".repeat(side))+"  "+dim("┌"+"─".repeat(Math.max(8,main-2))+"┐")+(contextWidth?"  "+dim("┌"+"─".repeat(contextWidth-2)+"┐"):""));
 const visibleLogs=logs.slice(-body);if(streamLine)visibleLogs.push(streamLine);
 for(let r=0;r<body;r++){
  const nav=NAV[r];
  const left=nav?(r===selectedNav?cyan(" ❯ "+nav[0].padEnd(side-4)):dim("   "+nav[0].padEnd(side-4))):" ".repeat(side);
  const middle=clip(visibleLogs[r]??"",Math.max(8,main-3));
  const right=contextWidth?"  "+dim("│")+" "+clip(context[r]??"",contextWidth-4):"";
  rows.push(left+"  "+dim("│")+" "+middle+right);
 }
 rows.push(" "+dim("─".repeat(side))+"  "+dim("└"+"─".repeat(Math.max(8,main-2))+"┘")+(contextWidth?"  "+dim("└"+"─".repeat(contextWidth-2)+"┘"):""));
 rows.push(" "+dim("PROVIDER")+"  "+clip(session.provider||"Not set",side-12)+"  "+dim("MODEL")+"  "+clip(session.model||"Not set",Math.max(8,width-side-20)));
 rows.push(dim("─".repeat(width)));
 const inputLines=inputValue.split("\n");
 const beforeLines=inputValue.slice(0,inputCursor).split("\n");
 const cursorLine=beforeLines.length-1;
 const firstVisibleLine=Math.max(0,Math.min(cursorLine,inputLines.length-2));
 const firstPrefixWidth=firstVisibleLine===0?5:3;
 const firstPrefix=firstVisibleLine===0?" "+bold(green("YOU"))+" "+violet("›")+" ":"   ";
 const secondPrefix="   ";
 const firstChars=Array.from(inputLines[firstVisibleLine]||"");
 const cursorChars=Array.from(beforeLines[beforeLines.length-1]||"");
 const firstOffset=cursorLine===firstVisibleLine?Math.max(0,cursorChars.length-Math.max(8,width-firstPrefixWidth-2)+1):0;
 rows.push(firstPrefix+firstChars.slice(firstOffset,firstOffset+Math.max(8,width-firstPrefixWidth-2)).join(""));
 if(inputLines.length>1)rows.push(secondPrefix+Array.from(inputLines[firstVisibleLine+1]||"").slice(0,Math.max(8,width-secondPrefix.length-2)).join(""));
 const matches=inputLines.length===1&&inputValue.startsWith("/")?COMMANDS.filter(x=>x.startsWith(inputValue)).slice(0,7):[];
 if(matches.length)rows.push(" "+dim("COMMANDS  ")+matches.join("   "));
 rows.push(dim(" ↑↓ Navigate when input is empty   Enter Select/Send   Tab Complete   Esc Back   Ctrl+P Palette"));
 while(rows.length<height)rows.push("");
 rows.length=height;
 if(!renderCache||renderCache.length!==height)renderCache=Array(height).fill(null);
 for(let i=0;i<height;i++){const next=clip(rows[i],width);if(renderCache[i]!==next){process.stdout.write("\x1b["+(i+1)+";1H"+next+"\x1b[K");renderCache[i]=next;}}
 const promptRow=Math.max(1,rows.findIndex(line=>line.includes("YOU"))+1);const cursorRow=Math.min(height,promptRow+cursorLine-firstVisibleLine);const cursorPrefix=cursorLine===0?5:3;const cursorCol=Math.min(width,cursorPrefix+cursorChars.length-firstOffset+1);process.stdout.write("\x1b["+cursorRow+";"+cursorCol+"H\x1b[?25h");
}
function captureConsole(){
 if(!tty||originalLog)return;
 originalLog=console.log;originalError=console.error;
 console.log=(...args)=>pushLog(args.map(x=>typeof x==="string"?x:String(x)).join(" "));
 console.error=(...args)=>pushLog(red(args.map(x=>typeof x==="string"?x:String(x)).join(" ")));
}
export function startTUI(config={}){
 if(!tty)return;
 dashboard=true;renderCache=null;session.provider=config.providerName||config.provider||"Not configured";session.model=config.model||"Not configured";session.workspace=process.cwd();session.status="ONLINE";
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
  let value="",cursor=0,finished=false,matchIndex=0,historyIndex=-1,draft="";const input=process.stdin;
  const render=()=>{if(dashboard){inputValue=value;inputCursor=cursor;drawDashboard();}else{readline.clearLine(process.stdout,0);readline.cursorTo(process.stdout,0);process.stdout.write(prompt+value);readline.cursorTo(process.stdout,prompt.length+cursor);}};
  const done=result=>{if(finished)return;finished=true;if(result!==ESC&&String(result||"").trim()){promptHistory.push(String(result));if(promptHistory.length>100)promptHistory.shift();}input.removeListener("keypress",onKey);try{input.setRawMode(false);}catch{}activePrompt=null;inputValue="";inputCursor=0;if(dashboard)drawDashboard();else process.stdout.write("\n");resolve(result);};
  const onKey=(str,key={})=>{
   if(finished)return;
   if(key.name==="escape"){done(ESC);return;}
   if(key.ctrl&&key.name==="p"){done("/menu");return;}
   if(key.name==="return"||key.name==="enter"){
    if(key.shift){value=value.slice(0,cursor)+"\n"+value.slice(cursor);cursor++;render();return;}
    if(!value.trim()&&dashboard){done(NAV[selectedNav]?.[1]||"/chat");return;}
    done(value);return;
   }
   if(key.ctrl&&key.name==="c"){done(ESC);closeInput();process.exit(130);}
   if(key.ctrl&&key.name==="a"){cursor=0;render();return;}
   if(key.ctrl&&key.name==="e"){cursor=value.length;render();return;}
   if(key.ctrl&&key.name==="u"){value=value.slice(cursor);cursor=0;render();return;}
   if(key.ctrl&&key.name==="w"){const left=value.slice(0,cursor).replace(/\s+$/,"").replace(/\S+$/,"");value=left+value.slice(cursor);cursor=left.length;render();return;}
   if(key.name==="backspace"){if(cursor>0){const previous=previousCursorIndex(value,cursor);value=value.slice(0,previous)+value.slice(cursor);cursor=previous;}render();return;}
   if(key.name==="delete"){if(cursor<value.length){const next=nextCursorIndex(value,cursor);value=value.slice(0,cursor)+value.slice(next);}render();return;}
   if(key.name==="left"){cursor=previousCursorIndex(value,cursor);render();return;}
   if(key.name==="right"){cursor=nextCursorIndex(value,cursor);render();return;}
   if(key.name==="home"){cursor=lineStartIndex(value,cursor);render();return;}
   if(key.name==="end"){cursor=lineEndIndex(value,cursor);render();return;}
   if(key.name==="up"||key.name==="down"){
    if(!value&&dashboard){selectedNav=(selectedNav+(key.name==="up"?NAV.length-1:1))%NAV.length;render();return;}
    if(key.name==="up"&&promptHistory.length){if(historyIndex===-1)draft=value;historyIndex=Math.min(promptHistory.length-1,historyIndex+1);value=promptHistory[promptHistory.length-1-historyIndex];cursor=value.length;render();return;}
    if(key.name==="down"&&historyIndex>=0){historyIndex--;value=historyIndex<0?draft:promptHistory[promptHistory.length-1-historyIndex];cursor=value.length;render();return;}
    return;
   }
   if(key.name==="tab"){
    const hits=COMMANDS.filter(x=>x.startsWith(value));if(hits.length){value=hits[matchIndex++%hits.length];cursor=value.length;render();}return;
   }
   if(str&&!key.ctrl&&!key.meta){const clean=String(str).replace(/\r\n?/g,"\n").replace(/[^\P{Cc}\n\t]/gu,"");if(clean){value=value.slice(0,cursor)+clean+value.slice(cursor);cursor+=clean.length;render();}}
  };
  activePrompt=done;
  if(dashboard){inputValue="";inputCursor=0;drawDashboard();}else process.stdout.write(prompt);
  try{input.setRawMode(true);}catch{}input.resume();input.on("keypress",onKey);
 });
}
export async function quickMenu(){
 const entries=[["/chat","Return to coding chat"],["/plan","Plan a task before editing"],["/review","Review project code"],["/debug","Investigate an error"],["/files","Browse project files"],["/open","Read a project file"],["/edit","Edit a file with the agent"],["/editor","Open built-in file editor"],["/terminal","Run an approved command"],["/map","Display project structure"],["/skills","Reusable project skills"],["/providers","Switch API provider"],["/models","Choose a model"],["/routing","Task-specific model routing"],["/web","Public web research"],["/mcp","External MCP tool servers"],["/test","Test API connection"],["/settings","Permissions and preferences"],["/limits","Response token limit"],["/usage","Session token usage"],["/fallback","Configure backup models"],["/memory","Project memory"],["/history","Recent tasks"],["/git","Git status"],["/diff","Git diff"],["/run-tests","Run project checks"],["/checkpoint","Save checkpoint"],["/checkpoints","List checkpoints"],["/restore","Restore checkpoint"],["/undo","Restore previous file version"],["/status","Session status"],["/help","Command reference"],["/exit","Exit agent"]];
 if(!tty){section("COMMAND PALETTE");entries.forEach(([cmd,desc],i)=>console.log("  "+(i+1)+". "+cmd+"  "+desc));const choice=(await ask("  Select command number (Esc to cancel): ")).trim();return /^\d+$/.test(choice)?entries[Number(choice)-1]?.[0]||null:null;}
 let selected=0,done=false;const input=process.stdin;
 return await new Promise(resolve=>{
  const draw=()=>{drawDashboard();const start=Math.max(0,Math.floor((process.stdout.rows||24)/2)-5);readline.cursorTo(process.stdout,2,start);process.stdout.write(bold(violet("COMMAND PALETTE"))+"\n");entries.forEach(([cmd,desc],i)=>process.stdout.write((i===selected?cyan(" ❯ "):"   ")+cmd.padEnd(14)+" "+dim(desc)+"\n"));process.stdout.write(dim(" ↑↓ Select · Enter Run · Esc Close"));};
  const finish=v=>{if(done)return;done=true;input.removeListener("keypress",onKey);try{input.setRawMode(false);}catch{}drawDashboard();resolve(v);};
  const onKey=(str,key={})=>{if(key.name==="up")selected=(selected+entries.length-1)%entries.length;else if(key.name==="down")selected=(selected+1)%entries.length;else if(key.name==="return"||key.name==="enter"){finish(entries[selected][0]);return;}else if(key.name==="escape"||(key.name==="c"&&key.ctrl)){finish(null);return;}else if(str&&/^[1-9]$/.test(str)){finish(entries[Number(str)-1]?.[0]||null);return;}draw();};
  try{input.setRawMode(true);}catch{}draw();input.on("keypress",onKey);
 });
}
export async function editText(initial="",filename="untitled"){
 if(!tty)return {saved:false,content:initial};
 const input=process.stdin,wasDashboard=dashboard;
 const lines=String(initial).split("\n");
 let row=0,col=0,top=0,left=0,dirty=false,done=false;
 const width=Math.max(30,process.stdout.columns||80),height=Math.max(10,process.stdout.rows||24),visible=height-3;
 const render=()=>{
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(bold(violet("EDITOR"))+"  "+filename+(dirty?yellowMark():"")+"\n");
  if(row<top)top=row;if(row>=top+visible)top=row-visible+1;if(col<left)left=col;if(col>=left+width-6)left=col-width+7;
  for(let i=0;i<visible;i++){
   const line=lines[top+i];
   process.stdout.write(line===undefined?"\n":String(i+top+1).padStart(3)+" "+line.slice(left,left+width-6)+"\n");
  }
  process.stdout.write(dim(" Ctrl+S Save   Ctrl+Q Cancel   Enter New line   Tab Indent"));
  readline.cursorTo(process.stdout,Math.min(width-1,4+col-left),Math.min(visible,row-top)+1);
 };
 const yellowMark=()=>color("33"," *");
 return await new Promise(resolve=>{
  const finish=result=>{if(done)return;done=true;input.removeListener("keypress",onKey);try{input.setRawMode(false);}catch{}dashboard=wasDashboard;if(dashboard){renderCache=null;drawDashboard();}else process.stdout.write("\x1b[?25h");resolve(result);};
  const onKey=(str,key={})=>{
   if(key.ctrl&&key.name==="s"){finish({saved:true,content:lines.join("\n")});return;}
   if(key.ctrl&&key.name==="q"){finish({saved:false,content:lines.join("\n")});return;}
   if(key.name==="left"){if(col>0)col--;else if(row>0){row--;col=lines[row].length;}}
   else if(key.name==="right"){if(col<lines[row].length)col++;else if(row<lines.length-1){row++;col=0;}}
   else if(key.name==="up"){if(row>0)row--;col=Math.min(col,lines[row].length);}
   else if(key.name==="down"){if(row<lines.length-1)row++;col=Math.min(col,lines[row].length);}
   else if(key.name==="home")col=0;
   else if(key.name==="end")col=lines[row].length;
   else if(key.name==="backspace"){if(col>0){lines[row]=lines[row].slice(0,col-1)+lines[row].slice(col);col--;dirty=true;}else if(row>0){const previous=lines[row-1].length;lines[row-1]+=lines[row];lines.splice(row,1);row--;col=previous;dirty=true;}}
   else if(key.name==="delete"){if(col<lines[row].length){lines[row]=lines[row].slice(0,col)+lines[row].slice(col+1);dirty=true;}else if(row<lines.length-1){lines[row]+=lines[row+1];lines.splice(row+1,1);dirty=true;}}
   else if(key.name==="return"||key.name==="enter"){const rest=lines[row].slice(col);lines[row]=lines[row].slice(0,col);lines.splice(row+1,0,rest);row++;col=0;dirty=true;}
   else if(key.name==="tab"){lines[row]=lines[row].slice(0,col)+"  "+lines[row].slice(col);col+=2;dirty=true;}
   else if(str&&!key.ctrl&&!key.meta&&str.length===1&&str>=" "){lines[row]=lines[row].slice(0,col)+str+lines[row].slice(col);col++;dirty=true;}
   render();
  };
  dashboard=false;
  try{input.setRawMode(true);}catch{}
  input.resume();input.on("keypress",onKey);render();
 });
}
export async function withSpinner(label,task){if(!tty||dashboard){session.status="WORKING";info(label);try{const result=await task();session.status="ONLINE";success(label);return result;}catch(e){session.status="ERROR";error(label);throw e;}}const frames=["◐","◓","◑","◒"];let i=0;const timer=setInterval(()=>{readline.cursorTo(process.stdout,0);process.stdout.write(cyan(frames[i++%frames.length])+" "+label);},100);try{const result=await task();clearInterval(timer);readline.clearLine(process.stdout,0);readline.cursorTo(process.stdout,0);console.log(green("✓")+" "+label);return result;}catch(e){clearInterval(timer);readline.clearLine(process.stdout,0);readline.cursorTo(process.stdout,0);console.log(red("✕")+" "+label);throw e;}}
export function showTool(name,args={}){const detail=Object.entries(args).map(([k,v])=>k+": "+String(v).replace(/\s+/g," ").slice(0,75)).join(" · ");console.log("\n  "+violet("⚙")+" "+bold(name)+" "+dim(detail));}
export function agentText(value){if(value)console.log("\n"+cyan("◆")+" "+bold("AGENT")+"\n"+formatMarkdown(value.trim())+"\n");}
let streamLine="",streamInCode=false;
function formatMarkdownLine(line,state){
 if(/^\s*```/.test(line)){state.code=!state.code;return cyan(line);}
 if(state.code)return color("38;5;114",line);
 const heading=line.match(/^(#{1,3})\s+(.+)$/);
 if(heading)return violet(bold(heading[2]));
 const bullet=line.match(/^(\s*(?:[-*]|\d+\.)\s+)(.*)$/);
 if(bullet)return cyan(bullet[1])+formatInline(bullet[2]);
 return formatInline(line);
}
function formatInline(line){
 return String(line).replace(/\*\*(.+?)\*\*/g,(_,v)=>bold(v)).replace(/`([^`]+)`/g,(_,v)=>color("38;5;221",v));
}
export function formatMarkdown(value){
 const state={code:false};
 return String(value??"").split("\n").map(line=>formatMarkdownLine(line,state)).join("\n");
}
export function streamToken(value){
 if(!value)return;
 if(dashboard){
  streamLine+=value;
  const parts=streamLine.split("\n");streamLine=parts.pop()||"";
  if(parts.length){logs.push(...parts.map(line=>formatMarkdownLine(line,{get code(){return streamInCode;},set code(v){streamInCode=v;}})));if(logs.length>400)logs=logs.slice(-400);}
  drawDashboard();
 }else process.stdout.write(color("38;5;252",value));
}
export function streamEnd(){
 if(dashboard){if(streamLine){logs.push(formatMarkdownLine(streamLine,{get code(){return streamInCode;},set code(v){streamInCode=v;}}));streamLine="";if(logs.length>400)logs=logs.slice(-400);}streamInCode=false;drawDashboard();}
 else process.stdout.write("\n");
}
export function setDiffPanel(value){session.diff=String(value||"").split("\n").slice(0,30);if(dashboard)drawDashboard();}
export function setTaskLabel(value){session.task=String(value||"Waiting for instructions").slice(0,160);if(dashboard)drawDashboard();}
export function promptLabel(){return "\n"+green("YOU")+" "+violet("›")+" ";}
