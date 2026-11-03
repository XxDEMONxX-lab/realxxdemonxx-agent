import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import {execFile} from "node:child_process";
const root=path.resolve(process.cwd());
const projectKey=crypto.createHash("sha256").update(root).digest("hex").slice(0,20);
const base=path.join(os.homedir(),".realxxdemonxx-agent","worktrees",projectKey);
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
 const id=safeName(name),branchName=String(branch||("agent/"+id));
 if(!/^[a-zA-Z0-9._/-]{1,80}$/.test(branchName)||branchName.includes("..")||branchName.startsWith("/")||branchName.endsWith("/"))throw new Error("Invalid Git branch name.");
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
