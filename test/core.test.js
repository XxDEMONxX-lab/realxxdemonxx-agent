import test from "node:test";
import assert from "node:assert/strict";
import {clipAnsi,stripAnsi,classifyCommand,previousCursorIndex,nextCursorIndex,lineStartIndex,lineEndIndex} from "../src/core.js";
import {runInteractiveCommand,editText} from "../src/ui.js";

test("stripAnsi removes terminal color sequences",()=>{
  assert.equal(stripAnsi("\u001b[31mred\u001b[0m"),"red");
});

test("clipAnsi preserves color controls and resets truncated output",()=>{
  assert.equal(clipAnsi("\u001b[31mabcdef\u001b[0m",3),"\u001b[31mabc…\u001b[0m");
});

test("clipAnsi does not truncate short strings",()=>{
  assert.equal(clipAnsi("hello",8),"hello");
});

test("classifyCommand detects package installation commands",()=>{
  assert.equal(classifyCommand("npm install discord.js"),"packageInstall");
  assert.equal(classifyCommand("cd app && pnpm add zod"),"packageInstall");
});

test("classifyCommand detects destructive shell commands",()=>{
  assert.equal(classifyCommand("rm -rf ./build"),"destructive");
  assert.equal(classifyCommand("find . -type f -delete"),"destructive");
  assert.equal(classifyCommand("git reset --hard HEAD"),"destructive");
  assert.equal(classifyCommand("sudo rm -rf ./cache"),"destructive");
  assert.equal(classifyCommand("echo start && busybox rm -rf ./cache"),"destructive");
  assert.equal(classifyCommand("env npm install lodash"),"packageInstall");
  assert.equal(classifyCommand("sudo dd if=/dev/zero of=/dev/sda"),"destructive");
});

test("classifyCommand leaves ordinary commands in the terminal category",()=>{
  assert.equal(classifyCommand("node index.js"),"terminal");
  assert.equal(classifyCommand("git status --short"),"terminal");
  assert.equal(classifyCommand(""),"empty");
});

test("cursor movement does not split Unicode surrogate pairs",()=>{
  const value="A😀B";
  assert.equal(previousCursorIndex(value,3),1);
  assert.equal(nextCursorIndex(value,1),3);
});

test("Home and End move within the current chat line",()=>{
  const value="first\nsecond\nthird";
  assert.equal(lineStartIndex(value,10),6);
  assert.equal(lineEndIndex(value,10),12);
});

import {validatePublicUrl} from "../src/research.js";
import {listMcpTools,callMcpTool} from "../src/mcp.js";
import {listSkills,readSkill} from "../src/skills.js";

test("web research accepts public HTTP URLs and rejects local targets",()=>{
  assert.equal(validatePublicUrl("https://example.com").hostname,"example.com");
  assert.throws(()=>validatePublicUrl("file:///etc/passwd"));
  assert.throws(()=>validatePublicUrl("http://127.0.0.1"));
  assert.throws(()=>validatePublicUrl("http://localhost"));
});

test("MCP tool discovery safely handles an empty server list",async()=>{
  assert.deepEqual(await listMcpTools({mcpServers:[]}),[]);
});

test("skills discovery is safe and invalid skill paths are rejected",async()=>{
  assert.ok(Array.isArray(await listSkills()));
  await assert.rejects(()=>readSkill("../outside"));
});

test("MCP stdio client initializes, discovers and calls a tool",async()=>{
  const serverCode = [
    "let buffer='';",
    "process.stdin.on('data',chunk=>{buffer+=chunk.toString();let i;",
    "while((i=buffer.indexOf('\\n'))>=0){",
    "const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;",
    "const req=JSON.parse(line);let result={};",
    "if(req.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'mock',version:'1'}};",
    "else if(req.method==='tools/list')result={tools:[{name:'echo',description:'Echo tool',inputSchema:{type:'object',properties:{value:{type:'string'}}}}]};",
    "else if(req.method==='tools/call')result={content:[{type:'text',text:'pong'}]};",
    "if(req.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result})+'\\n');",
    "}});"
  ].join("");
  const config={mcpServers:[{name:"mock",command:process.execPath,args:["-e",serverCode]}]};
  const tools=await listMcpTools(config);
  assert.equal(tools.length,1);
  assert.equal(await callMcpTool(config,tools[0].function.name,{value:"ping"}),"pong");
});

test("interactive terminal runner returns the real shell exit status",async()=>{
  assert.equal(await runInteractiveCommand("exit 7",process.cwd()),"Exit code: 7");
});

test("editor reports unavailable when no interactive TTY exists",async()=>{
  const result=await editText("preserve this text","test.txt");
  assert.equal(result.saved,false);
  assert.equal(result.content,"preserve this text");
});
