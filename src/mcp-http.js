const PROTOCOL="2024-11-05";

function validate(server){
 let url;try{url=new URL(server.url);}catch{throw new Error("HTTP MCP server requires a valid URL.");}
 if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw new Error("HTTP MCP URL must use http(s) without embedded credentials.");
 if(server.headers&&(!server.headers||typeof server.headers!=="object"||Array.isArray(server.headers)))throw new Error("HTTP MCP headers must be an object.");
 for(const [key,value] of Object.entries(server.headers||{})){
  if(!/^[A-Za-z0-9-]{1,80}$/.test(key)||typeof value!=="string"||value.length>4000)throw new Error("Invalid HTTP MCP header.");
 }
 return url;
}
function decodeResponse(contentType,body){
 if(contentType.includes("text/event-stream")){
  const events=body.split(/\r?\n\r?\n/).filter(Boolean);
  for(let i=events.length-1;i>=0;i--){
   const data=events[i].split(/\r?\n/).filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trim()).join("\n");
   if(data&&data!=="[DONE]"){try{return JSON.parse(data);}catch{}}
  }
  return null;
 }
 if(!body.trim())return null;
 try{return JSON.parse(body);}catch{throw new Error("HTTP MCP server returned invalid JSON.");}
}
export async function withHttpMcpServer(server,work){
 validate(server);
 let sessionId="",nextId=0;
 const endpoint=server.url;
 const request=async(method,params={})=>{
  const id=++nextId;
  const headers={...server.headers,"content-type":"application/json","accept":"application/json, text/event-stream","MCP-Protocol-Version":PROTOCOL};
  if(sessionId)headers["Mcp-Session-Id"]=sessionId;
  const packet={jsonrpc:"2.0",id,method,params};
  const response=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(packet),signal:AbortSignal.timeout(30000)});
  const received=response.headers.get("mcp-session-id");if(received)sessionId=received;
  if(response.status===202||response.status===204)return null;
  const raw=await response.text();
  if(!response.ok)throw new Error("HTTP MCP "+method+" failed ("+response.status+"): "+raw.slice(0,500));
  const result=decodeResponse(response.headers.get("content-type")||"",raw);
  if(result?.error)throw new Error(result.error.message||"Remote MCP request failed.");
  if(result&&result.id!==undefined&&result.id!==id)throw new Error("Remote MCP response ID did not match the request.");
  return result?.result??null;
 };
 try{
  const initialized=await request("initialize",{protocolVersion:PROTOCOL,capabilities:{},clientInfo:{name:"realxxdemonxx-agent",version:"0.3.0"}});
  const headers={...server.headers,"content-type":"application/json","accept":"application/json, text/event-stream","MCP-Protocol-Version":PROTOCOL};
  if(sessionId)headers["Mcp-Session-Id"]=sessionId;
  await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized",params:{}}),signal:AbortSignal.timeout(15000)});
  return await work({request,initialized});
 }finally{
  if(sessionId){
   try{await fetch(endpoint,{method:"DELETE",headers:{...server.headers,"Mcp-Session-Id":sessionId,"MCP-Protocol-Version":PROTOCOL},signal:AbortSignal.timeout(3000)});}catch{}
  }
 }
}
