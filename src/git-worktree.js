import fs from "node:fs/promises";
import path from "node:path";
import {execFile} from "node:child_process";
const root=path.resolve(process.cwd());
const base=path.join(root,".agent-worktrees");
function git(args){
 return new Promise((resolve,reject)=>execFile("git",args,{cwd:root,timeout:30000,maxBuffer:1024*1024},(error,stdout,stderr)=>{
  if(error){reject(new Error((stderr||stdout||error.message).trim().slice(0,1800)));return;}
  resolve(stdout.trim());
 }));
}
function safeName(value){
 const name=String(value||"").trim();
 if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,50}$/.test(name))throw new Error("Worktree name must use letters, numbers, dot, underscore or dash.");
 return name;
}
export async function listWorktrees(){
 const raw=await git(["worktree","list","--porcelain"]);
 return raw||"(no Git worktrees found)";
}
export async function createWorktree(name,branch){
 const id=safeName(name),branchName=safeName(branch||("agent/"+id));
 await fs.mkdir(base,{recursive:true});
 const target=path.join(base,id);
 try{await fs.access(target);throw new Error("Worktree path already exists: "+target);}catch(e){if(e.code!=="ENOENT")throw e;}
 await git(["worktree","add","-b",branchName,target]);
 return "Created worktree "+target+" on branch "+branchName;
}
export async function removeWorktree(name){
 const id=safeName(name),target=path.join(base,id);
 const actual=path.resolve(target);
 if(!actual.startsWith(base+path.sep))throw new Error("Invalid worktree path.");
 await git(["worktree","remove",target]);
 return "Removed worktree "+id;
}
