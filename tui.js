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
const SPIN=["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
const BAR=["▰▱▱▱▱▱▱▱","▰▰▱▱▱▱▱▱","▰▰▰▱▱▱▱▱","▰▰▰▰▱▱▱▱","▰▰▰▰▰▱▱▱","▰▰▰▰▰▰▱▱","▰▰▰▰▰▰▰▱","▰▰▰▰▰▰▰▰","▱▰▰▰▰▰▰▰","▱▱▰▰▰▰▰▰","▱▱▱▰▰▰▰▰","▱▱▱▱▰▰▰▰","▱▱▱▱▱▰▰▰","▱▱▱▱▱▱▰▰","▱▱▱▱▱▱▱▰","▱▱▱▱▱▱▱▱"];
class TUI {
 constructor(agent){
  this.agent=agent;this.logs=["Welcome to Demon Agent 3.0. Type a message or /help."];
  this.maxLogs=500;this.status="READY";this.busy=false;this.frame=0;this.scroll=0;
  this.input="";this.cursor=0;this.prompt="";this.pending=null;this.history=[];this.historyIndex=0;this.savedInput="";
  this.exitRequested=false;this.started=false;this.lastRender="";this.streamOpen=false;
 }
 dimensions(){return {w:Math.max(40,process.stdout.columns||80),h:Math.max(12,process.stdout.rows||24)};}
 line(s,w){const raw=String(s),visible=strip(raw),body=visible.length>w-2?truncate(visible,w-2):raw;return "│"+body+" ".repeat(Math.max(0,w-2-strip(body).length))+"│";}
 addLog(s){
  this.logs.push(...String(s).split("\n"));
  if(this.logs.length>this.maxLogs)this.logs.splice(0,this.logs.length-this.maxLogs);
  if(!this.scroll)this.scroll=0;
 }
 render(){
  const {w,h}=this.dimensions(),small=w<76,left=small?0:Math.max(22,Math.min(30,Math.floor(w*.27))),right=small?w:w-left-1;
  const out=[],top="╭"+"─".repeat(w-2)+"╮",mid="├"+"─".repeat(w-2)+"┤",bottom="╰"+"─".repeat(w-2)+"╯";
  const model=truncate(this.agent.c.model||"choose model",small?w-28:right-4);
  out.push(top,this.line(" ◈ DEMON AGENT 3.0  ⚡  "+(this.busy?"LIVE":"READY"),w),mid);
  const rows=Math.max(3,h-10),side=[];
  if(!small){
   side.push(" PROVIDERS");
   const ids=["openai","openrouter","groq","together","cerebras","deepseek","mistral","fireworks","xai","sambanova","perplexity","anthropic","gemini","ollama",...Object.keys(this.agent.c.custom||{})];
   for(const id of ids){const active=id===this.agent.c.provider;side.push((active?" ❯ ":"   ")+id+(active?"  ●":""));}
   side.push(""," MODEL",model,""," PROJECT",truncate(process.cwd(),left-4),""," SHORTCUTS","↑/↓ history","Ctrl+K commands","/search code","/agent task");
  }
  const chat=[];
  for(const log of this.logs)chat.push(...wrap(log,small?w-4:right-4));
  const end=Math.max(0,chat.length-this.scroll),start=Math.max(0,end-rows),visible=chat.slice(start,end);
  for(let i=0;i<rows;i++){
   const message=visible[i]||"";
   if(small)out.push(this.line(" "+message,w));
   else out.push("│"+truncate(side[i]||"",left-2).padEnd(left-2)+"│ "+truncate(message,right-2).padEnd(right-2)+" │");
  }
  out.push(mid);
  const activity=this.busy?SPIN[this.frame%SPIN.length]+" "+this.status:"● "+this.status;
  out.push(this.line(" "+activity+"  │  "+this.agent.c.provider+" / "+model+"  │  "+(this.scroll?"SCROLL":"LIVE"),w));
  const prompt=truncate(this.prompt||"MESSAGE",8);
  const available=Math.max(1,w-7);
  let visibleInput=this.input;
  let cursor=this.cursor;
  if(visibleInput.length>available){const start=Math.max(0,Math.min(visibleInput.length-available,cursor-available+1));visibleInput=visibleInput.slice(start,start+available);cursor-=start;}
  const before=visibleInput.slice(0,cursor),at=visibleInput[cursor]||" ";
  const inputLine=" "+prompt+" ❯ "+before+"\x1b[7m"+at+"\x1b[0m"+visibleInput.slice(cursor+1);
  out.push(this.line(inputLine,w));
  out.push(this.line(" Enter send · ↑/↓ history · Ctrl+K palette · Ctrl+C exit",w),bottom);
  process.stdout.write("\x1b[?25l\x1b[H\x1b[2J"+out.join("\n")+"\n");
 }
 stream(chunk){
  const value=String(chunk);
  // A streamed assistant response must never share the user prompt line.
  if(!this.streamOpen){
   if(this.logs.length&&this.logs[this.logs.length-1]!=="")this.logs.push("");
   this.logs.push("Demon Agent");this.logs.push("");this.streamOpen=true;
  }
  const parts=value.split("\n");
  if(!this.logs.length)this.logs.push("");
  this.logs[this.logs.length-1]+=parts.shift();
  for(const part of parts)this.logs.push(part);
  if(value.endsWith("\n"))this.streamOpen=false;
  if(this.logs.length>this.maxLogs)this.logs.splice(0,this.logs.length-this.maxLogs);
 }
 log(...args){
  const s=args.map(x=>typeof x==="string"?x:(x instanceof Error?x.stack||x.message:JSON.stringify(x))).join(" ");
  this.addLog(s);
 }
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
   if(key.name==="a"){this.cursor=0;this.render();return;}
   if(key.name==="e"){this.cursor=this.input.length;this.render();return;}
   if(key.name==="u"){this.input=this.input.slice(this.cursor);this.cursor=0;this.render();return;}
   if(key.name==="w"){const left=this.input.slice(0,this.cursor).replace(/\s+$/,"").replace(/\S+$/,"");this.input=left+this.input.slice(this.cursor);this.cursor=left.length;this.render();return;}
   return;
  }
  switch(key?.name){
   case "return":case "enter":this.finishInput(this.input);return;
   case "backspace":if(this.cursor){this.input=this.input.slice(0,this.cursor-1)+this.input.slice(this.cursor);this.cursor--;}break;
   case "delete":this.input=this.input.slice(0,this.cursor)+this.input.slice(this.cursor+1);break;
   case "left":this.cursor=Math.max(0,this.cursor-1);break;
   case "right":this.cursor=Math.min(this.input.length,this.cursor+1);break;
   case "home":this.cursor=0;break;
   case "end":this.cursor=this.input.length;break;
   case "up":
    if(this.history.length){if(this.historyIndex===this.history.length)this.savedInput=this.input;this.historyIndex=Math.max(0,this.historyIndex-1);this.input=this.history[this.historyIndex];this.cursor=this.input.length;}break;
   case "down":
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
     if(input.startsWith("/agent "))await a.askModel(input.slice(7).trim(),true);
     else if(input==="/scroll up"){this.scroll=Math.min(this.logs.length-1,this.scroll+8);}
     else if(input==="/scroll down"){this.scroll=Math.max(0,this.scroll-8);}
     else if(input==="/scroll bottom"){this.scroll=0;}
     else if(input==="/clear"){this.logs=["Conversation cleared."];this.scroll=0;}
     else if(input.startsWith("/")){this.status="RUNNING COMMAND";const keep=await a.command(input);if(!keep)this.exitRequested=true;}
     else{this.status="GENERATING";await a.askModel(input,false);}
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
module.exports={TUI,wrap,truncate,strip,SPIN,BAR};
