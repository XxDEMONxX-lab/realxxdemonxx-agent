"use strict";

const ANSI=/\x1b\[[0-?]*[ -/]*[@-~]/g;
const strip=s=>String(s).replace(ANSI,"");
const truncate=(s,n)=>{s=strip(s);return s.length>n?s.slice(0,Math.max(0,n-1))+"…":s;};
const wrap=(value,width)=>{
 const out=[],limit=Math.max(1,width|0);
 for(const raw of String(value).split("\n")){
  let line="";
  for(let word of strip(raw).split(/\s+/)){
   if(!word)continue;
   if(line&&line.length+1+word.length>limit){out.push(line);line="";}
   while(word.length>limit){if(line){out.push(line);line="";}out.push(word.slice(0,limit));word=word.slice(limit);}
   line+=(line?" ":"")+word;
  }
  out.push(line);
 }
 return out;
};
const COMMANDS=[
 ["/help","Show every command"],["/palette","Open command search"],["/providers","List AI providers"],["/provider","Select provider"],["/key","Configure API key"],["/models","Discover available models"],["/model","Select model"],["/base","Set provider base URL"],["/custom","Add custom provider"],["/fallback","Configure provider fallback"],["/fallbacks","Toggle provider fallback"],["/status","Show agent configuration"],["/files","List project files"],["/search","Search project source"],["/symbols","Find code symbols"],["/diagnose","Diagnose project"],["/verify","Check syntax and tests"],["/subagents","Run parallel analysis"],["/skills","List installed skills"],["/skill","Activate a skill"],["/review","Review project changes"],["/read","Read a project file"],["/write","Write a project file"],["/run","Run command with approval"],["/test","Run test suite"],["/agent","Run a coding task"],["/plan","Plan a coding task"],["/hook","Manage lifecycle hooks"],["/mcp","Manage MCP servers"],["/github","GitHub operations"],["/git","Inspect Git state"],["/memory","Manage project memory"],["/session","Manage sessions"],["/undo","Restore a file backup"],["/scroll","Scroll conversation"],["/clear","Clear conversation"],["/exit","Exit Demon Agent"],["/quit","Exit Demon Agent"]
];
const SPIN=["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
const BAR=["▰▱▱▱▱▱▱▱","▰▰▱▱▱▱▱▱","▰▰▰▱▱▱▱▱","▰▰▰▰▱▱▱▱","▰▰▰▰▰▱▱▱","▰▰▰▰▰▰▱▱","▰▰▰▰▰▰▰▱","▰▰▰▰▰▰▰▰","▱▰▰▰▰▰▰▰","▱▱▰▰▰▰▰▰","▱▱▱▰▰▰▰▰","▱▱▱▱▰▰▰▰","▱▱▱▱▱▰▰▰","▱▱▱▱▱▱▰▰","▱▱▱▱▱▱▱▰","▱▱▱▱▱▱▱▱"];
class TUI {
 constructor(agent){
  this.agent=agent;this.logs=["Welcome to Demon Agent 3.0. Type a message or /help."];
  this.maxLogs=500;this.status="READY";this.busy=false;this.frame=0;this.scroll=0;this.maxScroll=0;this.viewportRows=3;
  this.input="";this.cursor=0;this.prompt="";this.pending=null;this.history=[];this.historyIndex=0;this.savedInput="";
  this.exitRequested=false;this.started=false;this.lastRender="";this.streamOpen=false;this.commandSelection=0;
 }
 dimensions(){return {w:Math.max(40,process.stdout.columns||80),h:Math.max(12,process.stdout.rows||24)};}
 line(s,w){const raw=String(s),visible=strip(raw),body=visible.length>w-2?truncate(visible,w-2):raw;return "│"+body+" ".repeat(Math.max(0,w-2-strip(body).length))+"│";}
 addLog(s){
  this.logs.push(...String(s).split("\n"));
  if(this.logs.length>this.maxLogs)this.logs.splice(0,this.logs.length-this.maxLogs);
  if(!this.scroll)this.scroll=0;
 }
 commandMatches(){
  if(!this.input.startsWith("/")||this.input.includes(" "))return [];
  const query=this.input.slice(1).toLowerCase();
  return COMMANDS.filter(([name])=>name.slice(1).startsWith(query));
 }
 completeCommand(){
  const matches=this.commandMatches();if(!matches.length)return false;
  this.input=matches[Math.min(this.commandSelection,matches.length-1)][0]+" ";
  this.cursor=this.input.length;this.commandSelection=0;return true;
 }
 render(){
  const {w,h}=this.dimensions(),out=[];
  const top="╭"+"─".repeat(w-2)+"╮",mid="├"+"─".repeat(w-2)+"┤",bottom="╰"+"─".repeat(w-2)+"╯";
  const model=truncate(this.agent.c.model||"choose model",Math.max(12,w-38));
  out.push(top,this.line(" ◈ DEMON AGENT 3.1  ⚡  FULL SCREEN  │  "+(this.busy?"WORKING":"READY"),w));
  out.push(this.line(" "+this.agent.c.provider+" / "+model+"  │  "+truncate(process.cwd(),Math.max(12,w-30)),w),mid);
  const matches=this.commandMatches(),menuStart=Math.max(0,Math.min(this.commandSelection-3,matches.length-7)),visibleMatches=matches.slice(menuStart,menuStart+7),menuRows=visibleMatches.length?visibleMatches.length+2:0;
  const rows=Math.max(1,h-9-menuRows),chat=[];
  for(const log of this.logs)chat.push(...wrap(log,w-4));
  this.viewportRows=rows;this.maxScroll=Math.max(0,chat.length-rows);
  this.scroll=Math.max(0,Math.min(this.scroll,this.maxScroll));
  const end=Math.max(0,chat.length-this.scroll),visible=chat.slice(Math.max(0,end-rows),end);
  for(let i=0;i<rows;i++)out.push(this.line(" "+(visible[i]||""),w));
  if(matches.length){
   out.push(mid,this.line(" COMMANDS  ·  ↑/↓ select  ·  Tab complete  ·  Esc close",w));
   visibleMatches.forEach(([name,desc],i)=>{const selected=menuStart+i===this.commandSelection;out.push(this.line((selected?" ❯ ":"   ")+name.padEnd(19)+" "+desc,w));});
  }
  out.push(mid);
  const activity=this.busy?SPIN[this.frame%SPIN.length]+" "+this.status:"● "+this.status;
  out.push(this.line(" "+activity+"  │  "+(this.scroll?"SCROLL "+this.scroll+"/"+this.maxScroll:"LATEST")+"  │  Ctrl+K commands",w));
  const prompt=truncate(this.prompt||"MESSAGE",8),available=Math.max(1,w-14);
  let value=this.input,cursor=this.cursor;
  if(value.length>available){const offset=Math.max(0,Math.min(value.length-available,cursor-available+1));value=value.slice(offset,offset+available);cursor-=offset;}
  out.push(this.line(" "+prompt+" ❯ "+value.slice(0,cursor)+"\x1b[7m"+(value[cursor]||" ")+"\x1b[0m"+value.slice(cursor+1),w));
  out.push(this.line(" Enter send/run  ·  ↑/↓ history  ·  PgUp/PgDn scroll  ·  Ctrl+C exit",w),bottom);
  process.stdout.write("\x1b[?25l\x1b[H\x1b[2J"+out.join("\n")+"\n");
 }
 beginStream(){
  // Stream chunks belong to one response, even when a chunk ends with a newline.
  this.streamOpen=false;
 }
 endStream(){this.streamOpen=false;}
 stream(chunk){
  const value=String(chunk);
  // Create exactly one speaker header per response, not once per line or chunk.
  if(!this.streamOpen){
   if(this.logs.length&&this.logs[this.logs.length-1]!=="")this.logs.push("");
   this.logs.push("Demon Agent");this.logs.push("");this.streamOpen=true;
  }
  const parts=value.split("\n");
  if(!this.logs.length)this.logs.push("");
  this.logs[this.logs.length-1]+=parts.shift();
  for(const part of parts)this.logs.push(part);
  if(this.logs.length>this.maxLogs)this.logs.splice(0,this.logs.length-this.maxLogs);
 }
 log(...args){
  const s=args.map(x=>typeof x==="string"?x:(x instanceof Error?x.stack||x.message:JSON.stringify(x))).join(" ");
  this.addLog(s);
 }
 scrollBy(delta){
  const amount=Number.isFinite(delta)?Math.trunc(delta):0;
  this.scroll=Math.max(0,Math.min(this.maxScroll,this.scroll+amount));
  this.render();
 }
 scrollToBottom(){this.scroll=0;this.render();}
 readLine(prompt,{remember=false}={}){
  if(this.pending) return Promise.reject(new Error("TUI input is already pending"));
  this.prompt=String(prompt||"").replace(/\s+/g," ").trim()||"MESSAGE";
  this.input="";this.cursor=0;
  if(remember){this.historyIndex=this.history.length;this.savedInput="";}
  this.render();
  return new Promise(resolve=>{this.pending={resolve,remember};});
 }
 finishInput(value){
  if(!this.pending)return;
  if(key?.name==="escape"&&this.input.startsWith("/")){this.input="";this.cursor=0;this.commandSelection=0;this.render();return;}
  if(key?.name==="tab"&&this.commandMatches().length){this.completeCommand();this.render();return;}
  const pending=this.pending;this.pending=null;
  if(pending.remember&&value!==null&&value.trim()){
   this.history.push(value);if(this.history.length>100)this.history.shift();
  }
  this.prompt="";this.input="";this.cursor=0;this.render();pending.resolve(value);
 }
 onKeypress(str,key){
  if(!this.pending)return;
  if(key?.ctrl){
   if(key.name==="c"){this.exitRequested=true;this.finishInput(null);return;}
   if(key.name==="d"){this.exitRequested=true;this.finishInput(null);return;}
   if(key.name==="k"){this.input="/palette";this.cursor=this.input.length;this.render();return;}
   if(key.name==="up"){this.scrollBy(3);return;}
   if(key.name==="down"){this.scrollBy(-3);return;}
   if(key.name==="a"){this.cursor=0;this.render();return;}
   if(key.name==="e"){this.cursor=this.input.length;this.render();return;}
   if(key.name==="u"){this.input=this.input.slice(this.cursor);this.cursor=0;this.render();return;}
   if(key.name==="w"){const left=this.input.slice(0,this.cursor).replace(/\s+$/,"").replace(/\S+$/,"");this.input=left+this.input.slice(this.cursor);this.cursor=left.length;this.render();return;}
   return;
  }
  switch(key?.name){
   case "pageup":this.scrollBy(Math.max(1,this.viewportRows-2));return;
   case "pagedown":this.scrollBy(-Math.max(1,this.viewportRows-2));return;
   case "return":case "enter":this.finishInput(this.input);return;
   case "backspace":if(this.cursor){this.input=this.input.slice(0,this.cursor-1)+this.input.slice(this.cursor);this.cursor--;}break;
   case "delete":this.input=this.input.slice(0,this.cursor)+this.input.slice(this.cursor+1);break;
   case "left":this.cursor=Math.max(0,this.cursor-1);break;
   case "right":this.cursor=Math.min(this.input.length,this.cursor+1);break;
   case "home":if(key?.ctrl){this.scroll=this.maxScroll;this.render();return;}this.cursor=0;break;
   case "end":if(key?.ctrl){this.scrollToBottom();return;}this.cursor=this.input.length;break;
   case "up":
    if(this.commandMatches().length){this.commandSelection=(this.commandSelection+this.commandMatches().length-1)%this.commandMatches().length;this.render();return;}
    if(key?.shift){this.scrollBy(Math.max(1,this.viewportRows-2));return;}
    if(this.history.length){if(this.historyIndex===this.history.length)this.savedInput=this.input;this.historyIndex=Math.max(0,this.historyIndex-1);this.input=this.history[this.historyIndex];this.cursor=this.input.length;}break;
   case "down":
    if(this.commandMatches().length){this.commandSelection=(this.commandSelection+1)%this.commandMatches().length;this.render();return;}
    if(key?.shift){this.scrollBy(-Math.max(1,this.viewportRows-2));return;}
    if(this.historyIndex<this.history.length-1){this.historyIndex++;this.input=this.history[this.historyIndex];}
    else if(this.historyIndex===this.history.length-1){this.historyIndex=this.history.length;this.input=this.savedInput;}
    this.cursor=this.input.length;break;
   case "tab":this.input+="  ";this.cursor=this.input.length;break;
   default:
    if(typeof str==="string"&&str&&!key?.meta&&!key?.ctrl){this.input=this.input.slice(0,this.cursor)+str+this.input.slice(this.cursor);this.cursor+=str.length;}
  }
  this.render();
 }
 async start(){
  const a=this.agent,originalLog=console.log,originalError=console.error,originalStream=a.onStream,originalAsk=a.ask,oldDemonTui=process.env.DEMON_TUI;
  if(!process.stdin.isTTY||!process.stdout.isTTY){originalLog("Demon Agent TUI needs an interactive terminal. Launch it directly in Termux.");a.rl.close();return;}
  const readline=require("node:readline");
  readline.emitKeypressEvents(process.stdin);
  const onKey=(str,key)=>this.onKeypress(str,key),onResize=()=>this.render();
  const onSignal=()=>{this.exitRequested=true;this.finishInput(null);};
  console.log=(...x)=>this.log(...x);console.error=(...x)=>this.log(...x);
  a.onStream=chunk=>{this.stream(chunk);};
  a.ask=(prompt)=>this.readLine(prompt);
  process.env.DEMON_TUI="1";this.started=true;
  process.stdout.write("\x1b[?1049h\x1b[?25l");
  process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on("keypress",onKey);
  process.stdout.on("resize",onResize);process.once("SIGINT",onSignal);process.once("SIGTERM",onSignal);
  const animation=setInterval(()=>{if(this.busy){this.frame++;this.render();}},80);animation.unref?.();
  try{
   while(!this.exitRequested){
    this.busy=false;this.status="READY";
    const input=await this.readLine("MESSAGE",{remember:true});
    if(input===null||this.exitRequested)break;
    if(!input.trim())continue;
    this.addLog("❯ "+input);this.busy=true;this.status="THINKING";this.scroll=0;this.render();
    try{
     if(input.startsWith("/agent ")){this.beginStream();try{await a.askModel(input.slice(7).trim(),true);}finally{this.endStream();}}
     else if(input==="/scroll up"){this.scrollBy(8);}
     else if(input==="/scroll down"){this.scrollBy(-8);}
     else if(input==="/scroll top"){this.scroll=this.maxScroll;this.render();}
     else if(input==="/scroll bottom"){this.scrollToBottom();}
     else if(input==="/clear"){this.logs=["Conversation cleared."];this.scroll=0;}
     else if(input.startsWith("/")){this.status="RUNNING COMMAND";const keep=await a.command(input);if(!keep)this.exitRequested=true;}
     else{this.status="GENERATING";this.beginStream();try{await a.askModel(input,false);}finally{this.endStream();}}
    }catch(e){this.log("ERROR: "+(e?.message||String(e)));}
    finally{this.busy=false;this.status="READY";this.render();}
   }
  }finally{
   clearInterval(animation);
   if(this.pending)this.finishInput(null);
   console.log=originalLog;console.error=originalError;a.onStream=originalStream;a.ask=originalAsk;
   process.stdin.removeListener("keypress",onKey);process.stdout.removeListener("resize",onResize);
   process.removeListener("SIGINT",onSignal);process.removeListener("SIGTERM",onSignal);
   if(process.stdin.isTTY)process.stdin.setRawMode(false);
   if(oldDemonTui===undefined)delete process.env.DEMON_TUI;else process.env.DEMON_TUI=oldDemonTui;
   if(!a.rl.closed)a.rl.close();
   process.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l\n");originalLog("Demon Agent closed.");
  }
 }
}
module.exports={TUI,wrap,truncate,strip,SPIN,BAR,COMMANDS};
