"use strict";

function validateReview(value){
 if(!value||typeof value!=="object"||Array.isArray(value)||typeof value.complete!=="boolean")throw Error("Main-model review must contain a boolean complete field");
 const summary=typeof value.summary==="string"?value.summary.slice(0,2000):"";
 const nextTask=typeof value.nextTask==="string"?value.nextTask.trim():"";
 if(!value.complete&&(!nextTask||nextTask.length>50000))throw Error("Main-model review must provide a bounded nextTask while work remains");
 return {complete:value.complete,summary,nextTask};
}

/**
 * Re-run the planner and worker pool after every review. The caller stages results;
 * this loop never writes files and is deliberately bounded to prevent runaway API use.
 */
async function runOrchestrationLoop(options){
 const {task,runIteration,reviewIteration}=options||{};
 const maxIterations=options?.maxIterations??4;
 if(typeof task!=="string"||!task.trim()||task.length>50000)throw Error("Task must be 1-50000 characters");
 if(!Number.isInteger(maxIterations)||maxIterations<1||maxIterations>8)throw Error("maxIterations must be between 1 and 8");
 if(typeof runIteration!=="function"||typeof reviewIteration!=="function")throw Error("Iteration and review callbacks are required");
 const staged=new Map(),history=[];
 let currentTask=task,complete=false;
 for(let iteration=1;iteration<=maxIterations;iteration++){
  const readFile=async(file)=>{
   if(staged.has(file))return staged.get(file);
   return options.readFile?options.readFile(file):null;
  };
  const changes=await runIteration({task:currentTask,iteration,readFile,stagedFiles:new Map(staged)});
  if(!Array.isArray(changes)||changes.length===0)throw Error("Iteration "+iteration+" produced no staged file changes");
  for(const change of changes){
   if(!change||typeof change.path!=="string"||typeof change.content!=="string")throw Error("Iteration "+iteration+" returned an invalid staged change");
   staged.set(change.path,change.content);
  }
  const review=validateReview(await reviewIteration({
   originalTask:task,task:currentTask,iteration,changes,stagedFiles:new Map(staged),history:history.slice()
  }));
  history.push({iteration,task:currentTask,summary:review.summary,changedFiles:changes.map(x=>x.path)});
  if(review.complete){complete=true;break;}
  if(iteration===maxIterations)break;
  currentTask=review.nextTask;
 }
 return {
  complete,iterations:history.length,history,
  changes:[...staged].map(([path,content])=>({path,content})),
  nextTask:complete?null:currentTask
 };
}

module.exports={runOrchestrationLoop,validateReview};
