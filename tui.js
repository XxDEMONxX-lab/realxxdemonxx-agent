"use strict";

const ANSI=/\x1b\[[0-?]*[ -/]*[@-~]/g;
const strip=s=>String(s).replace(ANSI,"");
const truncate=(s,n)=>{s=String(s);return s.length>n?s.slice(0,Math.max(0,n-1))+"…":s;};
const wrap=(value,width)=>{
 const out=[];
 for(const raw of String(value).split("\n")){
  let line="";
  for(let word of raw.split(/\s+/)){
   if(!word)continue;
   if(line&&strip(line+" "+word).length>width){out.push(line);line="";}
   while(strip(word).length>width){out.push(word.slice(0,width));word=word.slice(width);}
   line+=(line?" ":"")+word;
  }
  out.push(line);
 }
 return out;
};
class TUI {
 constructor(agent){this.agent=agent;this.logs=["Welcome to Demon Agent. Type a message or /help."];this.maxLogs=500;this.status="READY";this.busy=false;}
 dimensions(){return {w:Math.max(40,process.stdout.columns||80),h:Math.max(12,process.stdout.rows||24)};}
 line(s,w){return "│"+truncate(s,w-2).padEnd(w-2)+"│";}
 render(){
  const {w,h}=this.dimensions(),small=w<72,left=small?0:Math.max(22,Math.min(29,Math.floor(w*.27))),right=small?w:w-left-1;
  const out=[],top="╭"+"─".repeat(w-2)+"╮",mid="├"+"─".repeat(w-2)+"┤",bottom="╰"+"─".repeat(w-2)+"╯";
  out.push(top,this.line(" ◈ DEMON AGENT 2.1 · NODE TUI ⚡",w),mid);
  const rows=Math.max(4,h-9),side=[];
  if(!small){
   side.push(" PROVIDERS");
   const ids=["openai","openrouter","groq","together","cerebras","deepseek","mistral","fireworks","xai","sambanova","perplexity","anthropic","gemini","ollama",...Object.keys(this.agent.c.custom||{})];
   for(const id of ids){const active=id===this.agent.c.provider;side.push((active?" ❯ ":"   ")+id+(active?"  ●":""));}
   side.push(""," MODEL",this.agent.c.model||"not selected",""," PROJECT",truncate(process.cwd(),left-4),""," SHORTCUTS","/help  commands","/models discover","/agent  code task","/clear  reset chat");
  }
  const chat=this.logs.slice(-rows);
  for(let i=0;i<rows;i++){
   const message=chat[i]||"";
   if(small)out.push(this.line(message,w));
   else out.push("│"+truncate(side[i]||"",left-2).padEnd(left-2)+"│ "+truncate(message,right-3).padEnd(right-3)+"│");
  }
  out.push(mid,this.line(" "+(this.busy?"◌ WORKING":"● "+this.status)+"  │  "+this.agent.c.provider+" / "+(this.agent.c.model||"choose model"),w));
  out.push(this.line(" Enter send · / commands · Ctrl+C exit · NO_COLOR=1 disables color",w),bottom);
  process.stdout.write("\x1b[2J\x1b[H"+out.join("\n")+"\n");
 }
 log(...args){const s=args.map(x=>typeof x==="string"?x:(x instanceof Error?x.stack||x.message:JSON.stringify(x))).join(" ");this.logs.push(...s.split("\n"));if(this.logs.length>this.maxLogs)this.logs.splice(0,this.logs.length-this.maxLogs);}
 async start(){
  const a=this.agent,originalLog=console.log,originalError=console.error;
  console.log=(...x)=>this.log(...x);console.error=(...x)=>this.log(...x);
  process.env.DEMON_TUI="1";
  const sig=()=>{this.status="STOPPING";this.render();a.rl.close();process.exitCode=130;};
  process.once("SIGINT",sig);
  try{
   let live=true;
   while(live){
    this.busy=false;this.status="READY";this.render();
    const input=await a.ask("\x1b[36m❯\x1b[0m ");
    if(!input)continue;
    this.log("\x1b[36m❯ "+input+"\x1b[0m");this.busy=true;this.status="PROCESSING";
    try{if(input.startsWith("/agent "))await a.askModel(input.slice(7).trim(),true);else if(input.startsWith("/"))live=await a.command(input);else await a.askModel(input,false);}
    catch(e){this.log("\x1b[31m"+e.message+"\x1b[0m");}
    finally{this.busy=false;}
   }
  }finally{
   console.log=originalLog;console.error=originalError;process.removeListener("SIGINT",sig);
   if(!a.rl.closed)a.rl.close();
   process.stdout.write("\x1b[0m\x1b[?25h\n");originalLog("Demon Agent closed.");
  }
 }
}
module.exports={TUI,wrap,truncate};
