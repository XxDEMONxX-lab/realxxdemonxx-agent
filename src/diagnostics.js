import fs from "node:fs/promises";
import path from "node:path";
import {execFile} from "node:child_process";

export async function runDiagnostics(root){
 const pkg=await fs.readFile(path.join(root,"package.json"),"utf8").then(JSON.parse).catch(()=>({}));
 const scripts=pkg.scripts||{},jobs=[];
 for(const name of ["check","test","lint","typecheck"])if(scripts[name])jobs.push({label:"npm run "+name,command:"npm",args:["run",name]});
 for(const [name,args] of [["tsc",["--noEmit"]],["eslint",["."]],["prettier",["--check","."]]]){
  const bin=path.join(root,"node_modules",".bin",name);
  try{await fs.access(bin);jobs.push({label:name,command:bin,args});}catch{}
 }
 if(!jobs.length)return "No configured scripts or local TypeScript/ESLint/Prettier tools were found.";
 const results=[];
 for(const job of jobs){
  const result=await new Promise(resolve=>execFile(job.command,job.args,{cwd:root,timeout:90000,maxBuffer:1024*1024},(error,stdout,stderr)=>resolve({code:error?(error.code??"unknown"):0,output:[stdout,stderr].filter(Boolean).join("\n").slice(0,4000)})));
  results.push(job.label+"\nExit code: "+result.code+"\n"+(result.output||"(no output)"));
 }
 return results.join("\n\n").slice(0,18000);
}
