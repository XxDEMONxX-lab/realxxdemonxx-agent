import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const roots=[
  path.join(process.cwd(),".agent","skills"),
  path.join(os.homedir(),".realxxdemonxx-agent","skills")
];

function validName(value){
  const name=String(value??"").trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(name))throw new Error("Invalid skill name.");
  return name;
}

export async function listSkills(){
  const found=new Map();
  for(const root of roots){
    let entries=[];
    try{entries=await fs.readdir(root,{withFileTypes:true});}catch(e){if(e.code==="ENOENT")continue;throw e;}
    for(const entry of entries){
      if(!entry.isDirectory()||! /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(entry.name))continue;
      const file=path.join(root,entry.name,"SKILL.md");
      try{
        const real=await fs.realpath(file);
        const base=await fs.realpath(root);
        if(!real.startsWith(base+path.sep))continue;
        const text=(await fs.readFile(real,"utf8")).slice(0,20000);
        const first=text.split(/\r?\n/).find(line=>line.trim()&&!line.startsWith("#"))||"No description";
        if(!found.has(entry.name))found.set(entry.name,{name:entry.name,description:first.slice(0,180),source:root===roots[0]?"project":"global"});
      }catch{}
    }
  }
  return [...found.values()].sort((a,b)=>a.name.localeCompare(b.name));
}

export async function readSkill(name){
  const skill=validName(name);
  for(const root of roots){
    const file=path.join(root,skill,"SKILL.md");
    try{
      const real=await fs.realpath(file),base=await fs.realpath(root);
      if(!real.startsWith(base+path.sep))throw new Error("Skill path escapes its directory.");
      return (await fs.readFile(real,"utf8")).slice(0,20000);
    }catch(e){if(e.code!=="ENOENT"&&e.code!=="ENOTDIR")throw e;}
  }
  throw new Error("Skill not found: "+skill);
}
