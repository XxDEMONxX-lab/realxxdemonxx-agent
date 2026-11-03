import test from "node:test";
import assert from "node:assert/strict";
import {clipAnsi,stripAnsi,classifyCommand,previousCursorIndex,nextCursorIndex,lineStartIndex,lineEndIndex} from "../src/core.js";

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
import {listMcpTools} from "../src/mcp.js";

test("web research accepts public HTTP URLs and rejects local targets",()=>{
  assert.equal(validatePublicUrl("https://example.com").hostname,"example.com");
  assert.throws(()=>validatePublicUrl("file:///etc/passwd"));
  assert.throws(()=>validatePublicUrl("http://127.0.0.1"));
  assert.throws(()=>validatePublicUrl("http://localhost"));
});

test("MCP tool discovery safely handles an empty server list",async()=>{
  assert.deepEqual(await listMcpTools({mcpServers:[]}),[]);
});
