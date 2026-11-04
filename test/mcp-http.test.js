import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {once} from "node:events";
import {listMcpTools,callMcpTool} from "../src/mcp.js";

test("MCP Streamable HTTP transport discovers and calls a tool",async()=>{
 const server=http.createServer(async(req,res)=>{
  if(req.method==="DELETE"){res.writeHead(200);res.end();return;}
  let raw="";for await(const chunk of req)raw+=chunk;
  const packet=raw?JSON.parse(raw):{};
  if(packet.method==="notifications/initialized"){res.writeHead(202);res.end();return;}
  let result={};
  if(packet.method==="initialize")result={protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"mock-http",version:"1"}};
  else if(packet.method==="tools/list")result={tools:[{name:"echo",description:"Echo tool",inputSchema:{type:"object",properties:{value:{type:"string"}}}}]};
  else if(packet.method==="tools/call")result={content:[{type:"text",text:"http-pong"}]};
  res.writeHead(200,{"content-type":"application/json","mcp-session-id":"test-session"});
  res.end(JSON.stringify({jsonrpc:"2.0",id:packet.id,result}));
 });
 server.listen(0,"127.0.0.1");await once(server,"listening");
 const address=server.address();
 const config={mcpServers:[{name:"remote",transport:"http",url:"http://127.0.0.1:"+address.port+"/mcp"}]};
 try{
  const tools=await listMcpTools(config);
  assert.equal(tools.length,1);
  assert.equal(await callMcpTool(config,tools[0].function.name,{value:"ping"}),"http-pong");
 }finally{server.close();await once(server,"close");}
});
