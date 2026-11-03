import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const projectRoot=path.resolve(process.cwd());
const key=crypto.createHash("sha256").update(projectRoot).digest("hex").slice(0,20);
const stateDir=path.join(os.homedir(),".realxxdemonxx-agent","workspaces",key);
const historyFile=path.join(stateDir,"history.json");
const memoryFile=path.join(stateDir,"memory.md");
const checkpointDir=path.join(stateDir,"checkpoints");

async function ensureState(){await fs.mkdir(checkpointDir,{recursive:true,mode:0o700});}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,"utf8"));}catch(e){if(e.code==="ENOENT")return fallback;throw e;}}
async function atomicWrite(file,data){await ensureState();const temp=file+"."+process.pid+".tmp";await fs.writeFile(temp,data,{mode:0o600});await fs.rename(temp,file);}

export async function readProjectMemory(){
  try{return await fs.readFile(memoryFile,"utf8");}catch(e){if(e.code==="ENOENT")return "";throw e;}
}
export async function writeProjectMemory(content){
  if(typeof content!=="string"||content.length>30000)throw new Error("Project memory must be text under 30 KB.");
  await atomicWrite(memoryFile,content);
  return "Project memory saved.";
}
export async function addTaskHistory(entry){
  const rows=await readJson(historyFile,[]);
  rows.push({id:Date.now().toString(36)+"-"+crypto.randomBytes(3).toString("hex"),at:new Date().toISOString(),...entry});
  await atomicWrite(historyFile,JSON.stringify(rows.slice(-100),null,2));
}
export async function getTaskHistory(limit=20){
  const rows=await readJson(historyFile,[]);
  return rows.slice(-Math.max(1,Math.min(100,Number(limit)||20))).reverse();
}
export async function createCheckpoint(label="manual"){
  await ensureState();
  const id=new Date().toISOString().replace(/[:.]/g,"-");
  const target=path.join(checkpointDir,id);
  await fs.mkdir(target,{recursive:true});
  const files=[];
  async function walk(dir,depth=0){
    if(depth>6||files.length>=300)return;
    let entries=[];try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
    for(const ent of entries){
      if(files.length>=300)break;
      if([".git","node_modules",".next","dist","build",".venv","venv",".realxxdemonxx-backups"].includes(ent.name))continue;
      const abs=path.join(dir,ent.name);
      if(ent.isDirectory()){await walk(abs,depth+1);continue;}
      if(!ent.isFile())continue;
      const rel=path.relative(projectRoot,abs);
      try{const st=await fs.stat(abs);if(st.size>250000)continue;const dest=path.join(target,rel);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(abs,dest);files.push({path:rel,size:st.size});}catch{}
    }
  }
  await walk(projectRoot);
  await fs.writeFile(path.join(target,"checkpoint.json"),JSON.stringify({id,label,createdAt:new Date().toISOString(),files},null,2),{mode:0o600});
  return {id,count:files.length};
}
export async function listCheckpoints(){
  await ensureState();const dirs=await fs.readdir(checkpointDir,{withFileTypes:true});
  const out=[];
  for(const d of dirs.filter(x=>x.isDirectory()).sort((a,b)=>b.name.localeCompare(a.name)).slice(0,30)){
    try{out.push(JSON.parse(await fs.readFile(path.join(checkpointDir,d.name,"checkpoint.json"),"utf8")));}catch{}
  }
  return out;
}
export async function restoreCheckpoint(id){
  if(typeof id!=="string"||!/^[0-9TZa-z-]+$/.test(id))throw new Error("Invalid checkpoint ID.");
  const folder=path.join(checkpointDir,id);
  const meta=JSON.parse(await fs.readFile(path.join(folder,"checkpoint.json"),"utf8"));
  if(!Array.isArray(meta.files))throw new Error("Checkpoint metadata is invalid.");
  await createCheckpoint("before-restore-"+id);
  const restored=[];
  for(const item of meta.files){
    if(!item||typeof item.path!=="string"||path.isAbsolute(item.path)||item.path.split(/[\\\\/]/).includes(".."))continue;
    const dest=path.resolve(projectRoot,item.path);
    if(dest===projectRoot||!dest.startsWith(projectRoot+path.sep))continue;
    const source=path.resolve(folder,item.path);
    if(!source.startsWith(folder+path.sep))continue;
    await fs.mkdir(path.dirname(dest),{recursive:true});
    const parent=await fs.realpath(path.dirname(dest));
    if(parent!==projectRoot&&!parent.startsWith(projectRoot+path.sep))throw new Error("Restore path resolves outside the project.");
    try{const existing=await fs.realpath(dest);if(existing!==projectRoot&&!existing.startsWith(projectRoot+path.sep))throw new Error("Restore target is a symlink outside the project.");}catch(e){if(e.code!=="ENOENT")throw e;}
    await fs.copyFile(source,dest);restored.push(item.path);
  }
  return restored;
}
