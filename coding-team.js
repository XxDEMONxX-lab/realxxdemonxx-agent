"use strict";
function parseObject(raw,label){
 if(typeof raw!=="string"||raw.length>1500000)throw Error(label+" response is empty or oversized");
 const start=raw.indexOf("{");if(start<0)throw Error(label+" must return a JSON object");
 let depth=0,string=false,escape=false,end=-1;
 for(let i=start;i<raw.length;i++){const ch=raw[i];if(string){if(escape)escape=false;else if(ch==="\\")escape=true;else if(ch==='"')string=false;continue;}if(ch==='"'){string=true;continue;}if(ch==="{")depth++;else if(ch==="}"&&--depth===0){end=i+1;break;}}
 if(end<0)throw Error(label+" returned incomplete JSON");
 let value;try{value=JSON.parse(raw.slice(start,end));}catch(e){throw Error(label+" returned invalid JSON: "+e.message);}
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error(label+" response must be an object");return value;
}
function validateAssignments(raw,expected=5){
 const value=typeof raw==="string"?parseObject(raw,"File planner"):raw;
 if(!Array.isArray(value.files)||value.files.length!==expected)throw Error("File planner must assign exactly "+expected+" different files; it assigned "+(Array.isArray(value.files)?value.files.length:0)+".");
 const seen=new Set();
 return value.files.map((entry,index)=>{const file=typeof entry==="string"?entry:entry?.path;
  if(typeof file!=="string"||!file.trim()||file.length>240||file.includes("\0")||file.includes("\\")||file.startsWith("/")||/^[A-Za-z]:/.test(file)||file.split("/").some(x=>!x||x==="."||x===".."))throw Error("Invalid path in worker assignment "+(index+1));
  if(seen.has(file))throw Error("Workers cannot share a file: "+file);seen.add(file);
  return {path:file,goal:typeof entry==="object"&&typeof entry.goal==="string"?entry.goal.slice(0,2000):"Implement the relevant part of the requested task in this file."};
 });
}
function validateWorkerChange(raw,assignment){
 const value=typeof raw==="string"?parseObject(raw,"Worker for "+assignment.path):raw;
 if(value.path!==assignment.path)throw Error("Worker was assigned "+assignment.path+" but returned "+String(value.path));
 if(typeof value.content!=="string"||Buffer.byteLength(value.content)>1048576)throw Error("Worker output for "+assignment.path+" must contain complete file content no larger than 1MiB");
 if(typeof value.summary!=="string"||!value.summary.trim())throw Error("Worker output for "+assignment.path+" is missing a change summary");
 return {path:assignment.path,content:value.content,summary:value.summary.slice(0,2000)};
}
async function runCodingTeam(task,models,invokePlanner,invokeWorker,options={}){
 if(typeof task!=="string"||!task.trim()||task.length>50000)throw Error("Coding task must be 1-50000 characters");
 if(!Array.isArray(models)||models.length!==5||models.some(x=>!x||!x.provider||!x.model))throw Error("Coding mode requires five configured provider/model pairs");
 if(typeof invokePlanner!=="function"||typeof invokeWorker!=="function")throw Error("Coding team callbacks are required");
 const manifest=Array.isArray(options.files)?options.files.slice(0,250):[];
 const assignments=validateAssignments(await invokePlanner(models[0],task,manifest),5);
 const results=await Promise.all(assignments.map(async(assignment,index)=>{const model=models[index];try{const source=await options.readFile(assignment.path);const response=await invokeWorker(model,assignment,task,source,manifest);const raw=response&&typeof response==="object"&&Object.prototype.hasOwnProperty.call(response,"raw")?response.raw:response;const change=validateWorkerChange(raw,assignment);return {index:index+1,provider:response?.provider||model.provider,model:response?.model||model.model,ok:true,...change};}catch(error){return {index:index+1,provider:model.provider,model:model.model,path:assignment.path,ok:false,error:error.message};}}));
 const failures=results.filter(x=>!x.ok);if(failures.length){const error=new Error("Coding team stopped: "+failures.length+" of 5 file workers failed. No files were changed.");error.results=results;throw error;}return results;
}
module.exports={parseObject,validateAssignments,validateWorkerChange,runCodingTeam};
