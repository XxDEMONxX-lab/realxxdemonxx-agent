"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {runSubagents}=require("../subagents");
test("runs bounded independent analysis roles and returns per-agent failures",async()=>{const calls=[];const result=await runSubagents("inspect safely",[{id:"a",model:"m1"},{id:"b",model:"m2"},{id:"c",model:"m3"},{id:"d",model:"m4"}],async(id,model,role,task)=>{calls.push({id,role:role.id,task});if(role.id==="tester")throw Error("offline");return model+" "+role.id;});assert.equal(result.length,3);assert.equal(calls.length,3);assert.ok(result.filter(x=>x.ok).length===2);assert.ok(result.some(x=>x.role==="tester"&&!x.ok));});
test("rejects empty tasks and missing models",async()=>{await assert.rejects(()=>runSubagents("",[],async()=>""),/Task/);await assert.rejects(()=>runSubagents("task",[],async()=>""),/models/);});
