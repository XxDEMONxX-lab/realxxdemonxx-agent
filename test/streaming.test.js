"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {streamCompletion}=require("../streaming");

test("external abort cancels an in-flight provider stream",async()=>{
 const originalFetch=global.fetch,controller=new AbortController();
 global.fetch=(_url,{signal})=>new Promise((resolve,reject)=>{
  const abort=()=>{const error=Error("aborted");error.name="AbortError";reject(error);};
  if(signal.aborted)abort();else signal.addEventListener("abort",abort,{once:true});
 });
 try{
  const pending=streamCompletion({kind:"openai",url:"https://provider.invalid"},"test-key","model",[],()=>{},controller.signal);
  await new Promise(resolve=>setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending,{name:"AbortError",message:"Request cancelled"});
 }finally{global.fetch=originalFetch;}
});
