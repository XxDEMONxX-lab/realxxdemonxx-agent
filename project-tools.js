"use strict";

const fs=require("node:fs");
const path=require("node:path");
const {spawnSync}=require("node:child_process");

const SKIP=new Set([".git","node_modules",".venv","venv","__pycache__",".demon",".next","dist","build","coverage"]);
const MAX_FILES=1200;
const MAX_FILE_BYTES=1024*1024;

function createProjectTools({root,safe}){
  function files(scope="."){
    const base=safe(scope),out=[];
    function walk(dir,depth){
      if(depth>12||out.length>=MAX_FILES)return;
      let entries;
      try{entries=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));}
      catch(e){if(e.code==="EACCES")return;throw e;}
      for(const entry of entries){
        if(SKIP.has(entry.name)||entry.isSymbolicLink())continue;
        const full=path.join(dir,entry.name),rel=path.relative(root,full);
        if(entry.isDirectory()){
          out.push(rel+"/");
          if(out.length<MAX_FILES)walk(full,depth+1);
        }else if(entry.isFile())out.push(rel);
        if(out.length>=MAX_FILES)break;
      }
    }
    const st=fs.statSync(base);
    if(st.isFile())return [path.relative(root,base)];
    if(!st.isDirectory())throw Error("Not a directory");
    walk(base,0);
    return out;
  }

  function search(query,scope="."){
    if(typeof query!=="string"||!query.trim()||query.length>500)throw Error("Search query must be 1-500 characters");
    const base=safe(scope),st=fs.statSync(base),candidates=[];
    if(st.isFile())candidates.push(base);
    else{
      const rel=path.relative(root,base);
      for(const item of files(rel||".")){
        if(item.endsWith("/"))continue;
        candidates.push(safe(item));
      }
    }
    const hits=[];let bytes=0;
    for(const file of candidates){
      if(hits.length>=100||bytes>=25*1024*1024)break;
      let stat;try{stat=fs.statSync(file);}catch{continue;}
      if(!stat.isFile()||stat.size>MAX_FILE_BYTES)continue;
      let data;try{data=fs.readFileSync(file);}catch{continue;}
      bytes+=data.length;
      if(data.includes(0))continue;
      const lines=data.toString("utf8").split(/\r?\n/);
      for(let i=0;i<lines.length;i++){
        if(lines[i].toLowerCase().includes(query.toLowerCase())){
          hits.push(path.relative(root,file)+":"+(i+1)+": "+lines[i].slice(0,300));
          if(hits.length>=100)break;
        }
      }
    }
    return {hits,filesScanned:candidates.length,bytesScanned:bytes,truncated:hits.length>=100||bytes>=25*1024*1024};
  }

  function git(kind){
    const commands={
      status:["status","--short","--branch"],
      diff:["diff","--no-ext-diff","--no-color"],
      "diff-stat":["diff","--stat"],
      "diff-check":["diff","--check"],
      log:["log","--oneline","-10"],
      branch:["branch","--show-current"]
    };
    const args=commands[kind];
    if(!args)throw Error("Git operation must be status, diff, diff-stat, diff-check, log, or branch");
    const r=spawnSync("git",args,{cwd:root,encoding:"utf8",timeout:8000,maxBuffer:1024*1024,env:{...process.env,GIT_PAGER:"cat",PAGER:"cat"}});
    if(r.error)throw Error("Git failed: "+r.error.message);
    if(r.signal)throw Error("Git terminated: "+r.signal);
    return {code:r.status??128,out:(r.stdout||"")+(r.stderr||"")};
  }

  function loadSkill(name){
    if(typeof name!=="string"||!/^[a-zA-Z0-9_-]{1,48}$/.test(name))throw Error("Invalid skill name");
    const file=safe(path.join(".demon","skills",name,"SKILL.md"));
    const st=fs.statSync(file);
    if(!st.isFile()||st.size>32768)throw Error("Skill must be a regular file no larger than 32KB");
    return fs.readFileSync(file,"utf8");
  }

  function listSkills(){
    const dir=safe(".demon/skills");
    let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}
    catch(e){if(e.code==="ENOENT")return [];throw e;}
    return entries.filter(x=>x.isDirectory()&&!x.isSymbolicLink()&&/^[a-zA-Z0-9_-]{1,48}$/.test(x.name))
      .filter(x=>{try{return fs.statSync(path.join(dir,x.name,"SKILL.md")).isFile();}catch{return false;}})
      .map(x=>x.name).sort();
  }

  function testCommand(){
    let pkg;try{pkg=JSON.parse(fs.readFileSync(safe("package.json"),"utf8"));}
    catch(e){if(e.code==="ENOENT")throw Error("No package.json found; use /run with your test command");throw Error("Invalid package.json: "+e.message);}
    if(!pkg.scripts||typeof pkg.scripts.test!=="string"||!pkg.scripts.test.trim())throw Error("No test script defined in package.json");
    return "npm test";
  }

  return {files,search,git,loadSkill,listSkills,testCommand};
}

module.exports={createProjectTools};
