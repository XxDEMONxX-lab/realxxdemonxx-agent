"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {runOrchestrationLoop,validateReview}=require("../orchestrator");

test("review schema rejects ambiguous completion states",()=>{
 assert.throws(()=>validateReview({complete:"yes"}),/boolean complete/);
 assert.throws(()=>validateReview({complete:false,nextTask:""}),/nextTask/);
 assert.deepEqual(validateReview({complete:true,summary:"done"}),{complete:true,summary:"done",nextTask:""});
});

test("main model assigns follow-up work until it declares completion",async()=>{
 const tasks=[],reviews=[];
 const result=await runOrchestrationLoop({
  task:"Build a feature",maxIterations:4,
  runIteration:async({task,iteration,readFile})=>{
   tasks.push(task);
   const prior=await readFile("src/a.js");
   return [{path:"src/a.js",content:(prior||"")+"round"+iteration,summary:"round "+iteration}];
  },
  reviewIteration:async({iteration,stagedFiles})=>{
   reviews.push({iteration,content:stagedFiles.get("src/a.js")});
   return iteration===3?{complete:true,summary:"verified"}:{complete:false,summary:"more work",nextTask:"Continue pass "+(iteration+1)};
  }
 });
 assert.equal(result.complete,true);
 assert.equal(result.iterations,3);
 assert.deepEqual(tasks,["Build a feature","Continue pass 2","Continue pass 3"]);
 assert.equal(result.changes[0].content,"round1round2round3");
 assert.equal(reviews.length,3);
});

test("iteration limit stops runaway orchestration and exposes next task",async()=>{
 const result=await runOrchestrationLoop({
  task:"task",maxIterations:2,
  runIteration:async({iteration})=>[{path:"a.js",content:String(iteration)}],
  reviewIteration:async({iteration})=>({complete:false,nextTask:"next "+iteration})
 });
 assert.equal(result.complete,false);
 assert.equal(result.iterations,2);
 assert.equal(result.nextTask,"next 2");
});

test("invalid iteration output fails closed",async()=>{
 await assert.rejects(()=>runOrchestrationLoop({task:"task",runIteration:async()=>[],reviewIteration:async()=>({complete:true})}),/no staged file changes/);
});

test("max iteration setting is bounded",async()=>{
 await assert.rejects(()=>runOrchestrationLoop({task:"task",maxIterations:99,runIteration:async()=>[],reviewIteration:async()=>({complete:true})}),/between 1 and 8/);
});
