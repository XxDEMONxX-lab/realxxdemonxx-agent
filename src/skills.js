import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const roots=[path.join(process.cwd(),".agent","skills"),path.join(os.homedir(),".realxxdemonxx-agent","skills")];
const valid=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
async function resolveSkill(root,name){
 const file=path.join(root,name,"SKILL.md");
 const real=await fs.realpath(file);
 const base=await fs.realpath(root);
 if(!real.startsWith(base+path.sep))throw new Error("Skill path escapes its directory.");
 return real;
}
export async function listSkills(){
 const found=new Map();
 for(const root of roots){
  let entries=[];try{entries=await fs.readdir(root,{withFileTypes:true});}catch(e){if(e.code==="ENOENT")continue;throw e;}
  for(const entry of entries){
   if(!entry.isDirectory()||!valid.test(entry.name))continue;
   try{
    const file=await resolveSkill(root,entry.name),content=(await fs.readFile(file,"utf8")).slice(0,20000);
    const description=content.split(/\r?\n/).find(line=>line.trim()&&!line.startsWith("#"))||"No description";
    if(!found.has(entry.name))found.set(entry.name,{name:entry.name,description:description.slice(0,180),source:root===roots[0]?"project":"global"});
   }catch{}
  }
 }
 return [...found.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export async function readSkill(name){
 const skill=String(name||"").trim();if(!valid.test(skill))throw new Error("Invalid skill name.");
 for(const root of roots){
  try{return (await fs.readFile(await resolveSkill(root,skill),"utf8")).slice(0,20000);}
  catch(e){if(e.code!=="ENOENT"&&e.code!=="ENOTDIR")throw e;}
 }
 throw new Error("Skill not found: "+skill);
}
