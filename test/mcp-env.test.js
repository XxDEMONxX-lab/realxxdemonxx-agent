import test from "node:test";
import assert from "node:assert/strict";
import {listMcpTools,callMcpTool} from "../src/mcp.js";

test("MCP stdio arguments resolve environment placeholders without shell expansion",async()=>{
 const serverCode=[
  "let buffer='';",
  "process.stdin.on('data',chunk=>{buffer+=chunk.toString();let i;",
  "while((i=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;",
  "const req=JSON.parse(line);let result={};",
  "if(req.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'env-mock',version:'1'}};",
  "else if(req.method==='tools/list')result={tools:[{name:'read-arg',inputSchema:{type:'object',properties:{}}}]};",
  "else if(req.method==='tools/call')result={content:[{type:'text',text:process.argv[1]}]};",
  "if(req.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\\n');",
  "}});"
 ].join("");
 const config={mcpServers:[{name:"envmock",command:process.execPath,args:["-e",serverCode,"${MCP_TEST_VALUE}"],env:{MCP_TEST_VALUE:"resolved-value"}}]};
 const tools=await listMcpTools(config);
 assert.equal(tools.length,1);
 assert.equal(await callMcpTool(config,tools[0].function.name,{}),"resolved-value");
});
