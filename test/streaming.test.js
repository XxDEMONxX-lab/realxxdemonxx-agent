"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {streamCompletion}=require("../streaming");

function responseChunks(chunks,contentType="text/event-stream"){
 const body=new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(Buffer.from(chunk));controller.close();}});
 return new Response(body,{status:200,headers:{"content-type":contentType}});
}
async function withFetch(response,fn){
 const previous=global.fetch;global.fetch=async()=>response;
 try{return await fn();}finally{global.fetch=previous;}
}
test("streams OpenAI-compatible SSE including split frames",async()=>{
 await withFetch(responseChunks(['data: {"choices":[{"delta":{"content":"hello"}}]}\r\n\r\n','data: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n']),async()=>{
  const chunks=[],text=await streamCompletion({kind:"openai",url:"https://provider.test/v1"},"key","model",[],x=>chunks.push(x));
  assert.equal(text,"hello world");assert.deepEqual(chunks,["hello"," world"]);
 });
});
test("streams Anthropic content_block_delta events",async()=>{
 await withFetch(responseChunks(['event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"anthropic"}}\n\n']),async()=>{
  assert.equal(await streamCompletion({kind:"anthropic",url:"https://provider.test/v1"},"key","model",[],()=>{}),"anthropic");
 });
});
test("streams Gemini candidate text events",async()=>{
 await withFetch(responseChunks(['data: {"candidates":[{"content":{"parts":[{"text":"gemini"}]}}]}\n\n']),async()=>{
  assert.equal(await streamCompletion({kind:"gemini",url:"https://provider.test/v1beta"},"key","model",[],()=>{}),"gemini");
 });
});
test("streams Ollama newline-delimited JSON",async()=>{
 await withFetch(responseChunks(['{"message":{"content":"olla"}}\n','{"message":{"content":"ma"},"done":true}\n'],"application/x-ndjson"),async()=>{
  assert.equal(await streamCompletion({kind:"ollama",url:"http://127.0.0.1:11434/api"},"","model",[],()=>{}),"ollama");
 });
});
test("rejects a streaming response without text",async()=>{
 await withFetch(responseChunks(["data: [DONE]\n\n"]),async()=>{
  await assert.rejects(streamCompletion({kind:"openai",url:"https://provider.test/v1"},"key","model",[],()=>{}),/no text/);
 });
});
