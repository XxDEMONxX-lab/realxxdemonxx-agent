import {spawn} from "node:child_process";

const PROTOCOL="2024-11-05";
const SAFE=/^[a-zA-Z0-9_-]{1,40}$/;
const toolMap=new Map();

function validateServer(server){
 if(!server||typeof server!=="object"||typeof server.command!=="string"||!server.command.trim())throw new Error("MCP server needs a command.");
 if(!Array.isArray(server.args)||server.args.some(x=>typeof x!=="string")||server.args.length>40)throw new Error("MCP server args must be an array of strings (max 40).");
 if(server.env&&(!server.env||typeof server.env!=="object"||Array.isArray(server.env)))throw new Error("MCP environment must be an object.");
 return server;
}

async function withServer(server,work){
 validateServer(server);
 const child=spawn(server.command,server.args,{stdio:["pipe","pipe","pipe"],shell:false,env:{...process.env,...Object.fromEntries(Object.entries(server.env||{}).filter(([k,v])=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)&&typeof v==="string"))}});
 let buffer="",nextId=0,stderr="";
 const pending=new Map();
 child.on("error",error=>{for(const entry of pending.values())entry.reject(new Error("Could not start MCP server: "+error.message));pending.clear();});
 child.on("exit",code=>{for(const entry of pending.values())entry.reject(new Error("MCP server exited ("+code+"): "+stderr.slice(-500)));pending.clear();});
 child.stderr.on("data",chunk=>{stderr=(stderr+chunk.toString()).slice(-3000);});
 child.stdout.on("data",chunk=>{
  buffer+=chunk.toString("utf8");
  let index;
  while((index=buffer.indexOf("\n"))>=0){
   const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);
   if(!line)continue;
   let packet;try{packet=JSON.parse(line);}catch{continue;}
   if(packet.id!==undefined&&pending.has(packet.id)){
    const entry=pending.get(packet.id);pending.delete(packet.id);
    packet.error?entry.reject(new Error(packet.error.message||"MCP server error")):entry.resolve(packet.result);
   }
  }
 });
 const request=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++nextId;pending.set(id,{resolve,reject});
  child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n",error=>{if(error){pending.delete(id);reject(error);}});
  const timer=setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error("MCP request timed out: "+method));}},15000);
  const done=()=>clearTimeout(timer);
  const entry=pending.get(id);
  pending.set(id,{resolve:value=>{done();entry.resolve(value);},reject:error=>{done();entry.reject(error);}});
 });
 try{
  const initialized=await request("initialize",{protocolVersion:PROTOCOL,capabilities:{},clientInfo:{name:"realxxdemonxx-agent",version:"0.2.0"}});
  child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized",params:{}})+"\n");
  return await work({request,initialized});
 }finally{
  for(const entry of pending.values())entry.reject(new Error("MCP server closed."));
  child.stdin.end();
  const killTimer=setTimeout(()=>child.kill("SIGTERM"),1200);
  child.once("exit",()=>clearTimeout(killTimer));
 }
}

export async function listMcpTools(config){
 const servers=config.mcpServers||[];
 const output=[];toolMap.clear();
 for(const server of servers){
  if(!SAFE.test(server.name||""))continue;
  try{
   const result=await withServer(server,({request})=>request("tools/list"));
   let index=0;
   for(const tool of result?.tools||[]){
    if(!tool?.name||typeof tool.name!=="string")continue;
    const id="mcp_"+server.name+"_"+(index++);toolMap.set(id,{serverName:server.name,toolName:tool.name});
    output.push({type:"function",function:{name:id,description:("[MCP "+server.name+"] "+String(tool.description||"External MCP tool")).slice(0,900),parameters:tool.inputSchema&&typeof tool.inputSchema==="object"?tool.inputSchema:{type:"object",properties:{}}}});
   }
  }catch(error){console.error("[MCP] "+server.name+": "+error.message);}
 }
 return output;
}

export async function callMcpTool(config,qualifiedName,args){
 const mapped=toolMap.get(String(qualifiedName));
 if(!mapped)throw new Error("MCP tool is no longer available. Retry the task to refresh tool discovery.");
 const server=(config.mcpServers||[]).find(item=>item.name===mapped.serverName);
 if(!server)throw new Error("MCP server is not configured: "+mapped.serverName);
 return await withServer(server,async({request})=>{
  const result=await request("tools/call",{name:mapped.toolName,arguments:args||{}});
  if(result?.isError)throw new Error((result.content||[]).map(item=>item.text||"").join("\n").slice(0,2000)||"MCP tool reported an error.");
  const parts=(result?.content||[]).map(item=>item.type==="text"?item.text:item.type==="image"?"[Image content returned]":JSON.stringify(item));
  return parts.join("\n").slice(0,16000)||JSON.stringify(result).slice(0,16000);
 });
}
