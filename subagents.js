"use strict";
const ROLES=[
 {id:"planner",task:"Produce an implementation plan with dependencies, sequencing and acceptance criteria."},
 {id:"architect",task:"Review architecture, interfaces, scalability and compatibility risks. Do not propose unnecessary rewrites."},
 {id:"tester",task:"Identify critical test cases, failure modes, race conditions and verification commands."}
];
async function runSubagents(task,models,invoke,options={}){
 if(typeof task!=="string"||!task.trim()||task.length>20000)throw Error("Task must be 1-20000 characters");
 if(typeof invoke!=="function")throw Error("Subagent invocation callback required");
 const selected=ROLES.slice(0,Math.max(1,Math.min(3,options.maxAgents||3)));
 const candidates=models.filter(x=>x&&x.model).slice(0,selected.length);
 if(!candidates.length)throw Error("No configured models available for subagents");
 const jobs=selected.map(async(role,i)=>{
  const target=candidates[i%candidates.length];
  try{
   const result=await invoke(target.id,target.model,role,task);
   return {role:role.id,provider:target.id,ok:true,result:String(result).slice(0,12000)};
  }catch(error){return {role:role.id,provider:target.id,ok:false,error:error.message};}
 });
 return Promise.all(jobs);
}
module.exports={ROLES,runSubagents};
