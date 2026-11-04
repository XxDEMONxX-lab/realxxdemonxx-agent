import fs from "node:fs/promises";
import path from "node:path";

const IGNORED=new Set([".git","node_modules","dist","build",".next",".venv","venv",".realxxdemonxx-backups",".agent-worktrees"]);
const SECRET_PATTERNS=[
  ["Private key",/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["GitHub token",/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g],
  ["OpenAI-style API key",/\bsk-[A-Za-z0-9_-]{24,}\b/g],
  ["AWS access key",/\bAKIA[0-9A-Z]{16}\b/g],
  ["Generic credential assignment",/\b(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*["'][^"'\s]{12,}["']/gi]
];
const RISK_PATTERNS=[
  ["Dynamic code execution",/\beval\s*\(/g],
  ["Shell execution",/\b(?:exec|execSync|spawn|spawnSync)\s*\(/g],
  ["Disabled TLS verification",/rejectUnauthorized\s*:\s*false/g],
  ["Unsafe HTML injection",/\.innerHTML\s*=/g],
  ["SQL string concatenation",/\b(?:SELECT|UPDATE|DELETE|INSERT)\b[^\n]{0,100}\+\s*[A-Za-z_$]/gi]
];
const TEXT_EXT=/\.(?:[cm]?js|jsx|ts|tsx|json|ya?ml|toml|env|md|html|css|sql|sh)$/i;

export async function runSecurityAudit(root=process.cwd()){
 const base=await fs.realpath(root),findings=[],counts={files:0,secrets:0,risky:0,packages:0};
 async function walk(dir,depth=0){
  if(depth>8||counts.files>=1800)return;
  let entries=[];try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
  for(const ent of entries){
   if(counts.files>=1800)break;
   if(ent.isDirectory()){if(!IGNORED.has(ent.name)&&!ent.name.startsWith(".realxxdemonxx"))await walk(path.join(dir,ent.name),depth+1);continue;}
   if(!ent.isFile()||!TEXT_EXT.test(ent.name))continue;
   const file=path.join(dir,ent.name),rel=path.relative(base,file);
   let stat,content;try{stat=await fs.stat(file);if(stat.size>300000)continue;content=await fs.readFile(file,"utf8");}catch{continue;}
   counts.files++;
   for(const [label,pattern] of SECRET_PATTERNS){
    pattern.lastIndex=0;let match,found=0;
    while((match=pattern.exec(content))&&found<3){
     const line=content.slice(0,match.index).split("\n").length;
     findings.push({severity:"HIGH",type:"Potential secret",label,file:rel,line,evidence:"[redacted]"});counts.secrets++;found++;
     if(pattern.lastIndex===match.index)pattern.lastIndex++;
    }
   }
   for(const [label,pattern] of RISK_PATTERNS){
    pattern.lastIndex=0;let match,found=0;
    while((match=pattern.exec(content))&&found<2){
     const line=content.slice(0,match.index).split("\n").length;
     findings.push({severity:label==="Disabled TLS verification"?"HIGH":"REVIEW",type:"Risk pattern",label,file:rel,line,evidence:match[0].slice(0,90)});counts.risky++;found++;
     if(pattern.lastIndex===match.index)pattern.lastIndex++;
    }
   }
   if(ent.name==="package.json"){
    try{
     const pkg=JSON.parse(content);counts.packages++;
     for(const [name,version] of Object.entries(pkg.dependencies||{})){
      if(typeof version==="string"&&(version==="*"||version==="latest"||version.startsWith("git+")||version.startsWith("http:")))findings.push({severity:"REVIEW",type:"Dependency",label:"Unpinned or remote dependency",file:rel,line:1,evidence:name+"@"+version});
     }
     for(const [name,script] of Object.entries(pkg.scripts||{})){
      if(typeof script==="string"&&/(curl\s+[^|]+\|\s*(?:sh|bash)|wget\s+[^;]+;\s*(?:sh|bash)|rm\s+-rf\s+\/)/i.test(script))findings.push({severity:"HIGH",type:"Script",label:"Potentially dangerous package script",file:rel,line:1,evidence:name+": "+script.slice(0,100)});
     }
    }catch{}
   }
  }
 }
 await walk(base);
 const rank={HIGH:0,REVIEW:1};
 findings.sort((a,b)=>rank[a.severity]-rank[b.severity]||a.file.localeCompare(b.file)||a.line-b.line);
 const summary={root:base,scannedFiles:counts.files,secretFindings:counts.secrets,riskPatterns:counts.risky,packages:counts.packages,findings:findings.slice(0,100),truncated:findings.length>100};
 return JSON.stringify(summary,null,2);
}

export async function projectProfile(root=process.cwd()){
 const base=await fs.realpath(root),extensions={},top=[];
 async function walk(dir,depth=0){
  if(depth>5||top.length>=1000)return;
  let entries=[];try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
  for(const ent of entries){
   if(top.length>=1000)break;
   if(ent.isDirectory()){if(!IGNORED.has(ent.name)&&!ent.name.startsWith("."))await walk(path.join(dir,ent.name),depth+1);}
   else if(ent.isFile()){
    top.push(path.relative(base,path.join(dir,ent.name)));
    const ext=path.extname(ent.name).toLowerCase()||"(no extension)";extensions[ext]=(extensions[ext]||0)+1;
   }
  }
 }
 await walk(base);
 let pkg={};try{pkg=JSON.parse(await fs.readFile(path.join(base,"package.json"),"utf8"));}catch{}
 const stack=[];
 if(pkg.name)stack.push("Node.js project: "+pkg.name);
 if(pkg.dependencies?.discord.js||pkg.devDependencies?.["discord.js"])stack.push("Discord.js");
 if(pkg.dependencies?.react||pkg.devDependencies?.react)stack.push("React");
 if(pkg.dependencies?.next||pkg.devDependencies?.next)stack.push("Next.js");
 if(pkg.dependencies?.typescript||pkg.devDependencies?.typescript)stack.push("TypeScript");
 for(const name of ["pyproject.toml","requirements.txt","Cargo.toml","go.mod","pom.xml","composer.json","Gemfile"]){try{await fs.access(path.join(base,name));stack.push(name);}catch{}}
 return JSON.stringify({root:base,stack:stack.length?stack:["No framework detected from common manifests"],fileCount:top.length,extensions:Object.entries(extensions).sort((a,b)=>b[1]-a[1]).slice(0,20),sampleFiles:top.slice(0,100),scripts:pkg.scripts||{},dependencies:Object.keys(pkg.dependencies||{}).length,devDependencies:Object.keys(pkg.devDependencies||{}).length},null,2);
}
