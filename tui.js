"use strict";

const ANSI=/\x1b\[[0-?]*[ -/]*[@-~]/g;
const strip=s=>String(s).replace(ANSI,"");
const COMMANDS=[
 ["/agent ","Run an approved multi-step coding task"],["/plan ","Create a plan without executing changes"],
 ["/review","Review current Git changes"],["/review all","Run independent parallel reviews"],
 ["/files","List project files"],["/search ","Search project source"],["/skills","List reusable skills"],
 ["/status","Show provider and project status"],["/models","Discover provider models"],
 ["/git status","Show Git working-tree status"],["/git diff","Show current diff"],["/test","Run tests with approval"],
 ["/session save ","Save this conversation"],["/memory show","Show project memory"],["/help","Show all commands"],["/exit","Exit Demon Agent"]
];
const filterCommands=(query="")=>{const q=String(query).trim().toLowerCase();return COMMANDS.filter(([c,d])=>!q||(c+" "+d).toLowerCase().includes(q));};
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
class TUI {
 constructor(agent){
  this.agent=agent;this.logs=["Welcome to Demon Agent. Type a message or /help."];
  this.maxLogs=500;this.status="READY";this.busy=false;this.frame=0;this.scroll=0;
  this.frames=["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
 }
 dimensions(){return {w:Math.max(40,process.stdout.columns||80),h:Math.max(12,process.stdout.rows||24)};}
 line(s,w){return "│"+truncate(s,w-2).padEnd(w-2)+"│";}
 render(){
  const {w,h}=this.dimensions(),small=w<76,left=small?0:Math.max(22,Math.min(30,Math.floor(w*.27))),right=small?w:w-left-1;
  const out=[],top="╭"+"─".repeat(w-2)+"╮",mid="├"+"─".repeat(w-2)+"┤",bottom="╰"+"─".repeat(w-2)+"╯";
  out.push(top,this.line(" ◈ DEMON AGENT 2.5 · NODE TUI ⚡",w),mid);
  const rows=Math.max(4,h-9),side=[];
  if(!small){
   side.push(" PROVIDERS");
   const ids=["openai","openrouter","groq","together","cerebras","deepseek","mistral","fireworks","xai","sambanova","perplexity","anthropic","gemini","ollama",...Object.keys(this.agent.c.custom||{})];
   for(const id of ids){const active=id===this.agent.c.provider;side.push((active?" ❯ ":"   ")+id+(active?"  ●":""));}
   side.push(""," MODEL",this.agent.c.model||"not selected",""," PROJECT",truncate(process.cwd(),left-4),""," SHORTCUTS","↑/↓ input history","Ctrl+K command palette","/palette search commands","/search code","/skills select skill","/review changes","/agent coding task");
  }
  const chat=[];
  for(const log of this.logs)chat.push(...wrap(log,small?w-4:right-4));
  const end=Math.max(0,chat.length-this.scroll),start=Math.max(0,end-rows),visible=chat.slice(start,end);
  for(let i=0;i<rows;i++){
   const message=visible[i]||"";
   if(small)out.push(this.line(" "+message,w));
   else out.push("│"+truncate(side[i]||"",left-2).padEnd(left-2)+"│ "+truncate(message,right-2).padEnd(right-2)+" │");
  }
  out.push(mid,this.line(" "+(this.busy?this.frames[this.frame%this.frames.length]+" WORKING":"● "+this.status)+"  │  "+this.agent.c.provider+" / "+(this.agent.c.model||"choose model")+"  │  "+(this.scroll?"SCROLL":"LIVE"),w));
  out.push(this.line(" Enter send · /scroll up|down · /commands · Ctrl+C exit",w),bottom);
  process.stdout.write("\x1b[?25l\x1b[2J\x1b[H"+out.join("\n")+"\n\x1b[?25h");
 }
 stream(chunk){const parts=String(chunk).split("\n");if(!this.logs.length)this.logs.push("");this.logs[this.logs.length-1]+=parts.shift();for(const part of parts)this.logs.push(part);if(this.logs.length>this.maxLogs)this.logs.splice(0,this.logs.length-this.maxLogs);}
 log(...args){
  const s=args.map(x=>typeof x==="string"?x:(x instanceof Error?x.stack||x.message:JSON.stringify(x))).join(" ");
  this.logs.push(...s.split("\n"));
  if(this.logs.length>this.maxLogs)this.logs.splice(0,this.logs.length-this.maxLogs);
  if(!this.scroll)this.scroll=0;
 }

 async commandPalette(){
  const query=await this.agent.ask("Command search (type to filter, blank for all): ");
  const matches=filterCommands(query);
  if(!matches.length){this.log("No commands match: "+query);return "";}
  this.log("COMMAND PALETTE");
  matches.forEach(([command,description],index)=>this.log(String(index+1).padStart(2," ")+". "+command+" — "+description));
  const answer=await this.agent.ask("Select command number (blank to cancel): ");
  if(!answer)return "";
  if(!/^\\d+$/.test(answer)||Number(answer)<1||Number(answer)>matches.length){this.log("Invalid command selection");return "";}
  return matches[Number(answer)-1][0];
 }
 async start(){
  const a=this.agent,originalLog=console.log,originalError=console.error,originalStream=a.onStream,oldDemonTui=process.env.DEMON_TUI;
  if(!process.stdin.isTTY||!process.stdout.isTTY){originalLog("Demon Agent TUI needs an interactive terminal. Launch it directly in Termux.");a.rl.close();return;}
  console.log=(...x)=>this.log(...x);console.error=(...x)=>this.log(...x);a.onStream=chunk=>this.stream(chunk);
  process.env.DEMON_TUI="1";
  let animation=null;
  const redraw=()=>{if(this.busy){this.frame++;this.render();}};
  const onResize=()=>this.render();
  const sig=()=>{this.status="STOPPING";this.render();a.rl.close();process.exitCode=130;};\n  const onKeypress=(str,key)=>{if(key?.ctrl&&key.name==="k"&&!this.busy){a.rl.write(null,{ctrl:true,name:"u"});a.rl.write("/palette");a.rl.write(null,{name:"return"});}};\n  require("node:readline").emitKeypressEvents(process.stdin);process.stdin.on("keypress",onKeypress);
  process.once("SIGINT",sig);process.stdout.on("resize",onResize);
  try{
   let live=true;
   while(live){
    this.busy=false;this.status="READY";this.render();
    let input=await a.ask("\x1b[36m❯\x1b[0m ");
    if(!input)continue;
    if(input==="/palette"){input=await this.commandPalette();if(!input)continue;}
    this.log("❯ "+input);this.busy=true;this.status="PROCESSING";animation=setInterval(redraw,100);
    try{
     if(input.startsWith("/agent "))await a.askModel(input.slice(7).trim(),true);
     else if(input==="/scroll up"){this.scroll=Math.min(this.logs.length-1,this.scroll+8);this.render();}else if(input==="/scroll down"){this.scroll=Math.max(0,this.scroll-8);this.render();}else if(input==="/scroll bottom"){this.scroll=0;this.render();}else if(input.startsWith("/"))live=await a.command(input);
     else await a.askModel(input,false);
    }catch(e){this.log("ERROR: "+(e?.message||String(e)));}
    finally{this.busy=false;if(animation){clearInterval(animation);animation=null;}this.render();}
   }
  }finally{
   if(animation)clearInterval(animation);
   console.log=originalLog;console.error=originalError;a.onStream=originalStream;
   process.removeListener("SIGINT",sig);process.stdout.removeListener("resize",onResize);process.stdin.removeListener("keypress",onKeypress);
   if(oldDemonTui===undefined)delete process.env.DEMON_TUI;else process.env.DEMON_TUI=oldDemonTui;
   if(!a.rl.closed)a.rl.close();
   process.stdout.write("\x1b[0m\x1b[?25h\n");originalLog("Demon Agent closed.");
  }
 }
}
module.exports={TUI,wrap,truncate,strip,filterCommands};
