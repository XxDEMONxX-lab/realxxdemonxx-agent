"use strict";
const fs=require("node:fs"),path=require("node:path");
const {projectFiles}=require("./features");
const MAX_FILES=800,MAX_BYTES=300000,MAX_RESULTS=300;
const EXT=/\.(?:js|jsx|mjs|cjs|ts|tsx|py|lua|java|c|cc|cpp|h|hpp|go|rs|php|rb|sh)$/i;
const PATTERNS=[
 ["javascript",/\b(?:export\s+)?(?:async\s+)?function\s+([\w$]+)|\bclass\s+([\w$]+)|\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/g],
 ["python",/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)|^\s*class\s+([A-Za-z_]\w*)/gm],
 ["lua",/^\s*function\s+([\w.:]+)|^\s*(?:local\s+)?([\w_]+)\s*=\s*function/gm],
 ["java-cpp",/\b(?:class|struct|interface|enum)\s+([A-Za-z_]\w*)/g],
 ["go",/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)|^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/gm],
 ["rust",/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)|^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/gm],
 ["php",/^\s*(?:(?:public|protected|private|static|final|abstract)\s+)*function\s+([A-Za-z_]\w*)|^\s*class\s+([A-Za-z_]\w*)/gm],
 ["ruby",/^\s*def\s+([A-Za-z_]\w*[!?=]?)|^\s*(?:class|module)\s+([A-Za-z_]\w*)/gm],
 ["shell",/^\s*([A-Za-z_]\w*)\s*\(\s*\)\s*\{|^\s*function\s+([A-Za-z_]\w*)/gm]
];
function buildSymbolIndex(root,options={}){
 const files=projectFiles(root).filter(x=>EXT.test(x)).slice(0,MAX_FILES),symbols=[];
 for(const rel of files){
  const file=path.resolve(root,rel),inside=path.relative(root,file);
  if(inside.startsWith(".."+path.sep)||path.isAbsolute(inside))continue;
  let st;try{st=fs.lstatSync(file);}catch{continue;}
  if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)continue;
  let source;try{source=fs.readFileSync(file,"utf8");}catch{continue;}
  if(source.includes("\0"))continue;
  for(const [language,pattern] of PATTERNS){
   pattern.lastIndex=0;let match;
   while((match=pattern.exec(source))&&symbols.length<MAX_RESULTS){
    const name=match.slice(1).find(Boolean);if(!name)continue;
    const line=source.slice(0,match.index).split("\n").length;
    symbols.push({name,path:rel,line,language});
   }
   if(symbols.length>=MAX_RESULTS)break;
  }
  if(symbols.length>=MAX_RESULTS)break;
 }
 return {symbols,filesScanned:files.length,truncated:files.length>=MAX_FILES||symbols.length>=MAX_RESULTS};
}
function findSymbols(root,query="",options={}){
 const index=buildSymbolIndex(root,options),q=String(query).trim().toLowerCase();
 const symbols=q?index.symbols.filter(x=>(x.name+" "+x.path+" "+x.language).toLowerCase().includes(q)):index.symbols;
 return {...index,symbols:symbols.slice(0,MAX_RESULTS)};
}
function diagnoseProject(root){
 const findings=[],pkg=path.join(root,"package.json");
 if(fs.existsSync(pkg)){
  try{const p=JSON.parse(fs.readFileSync(pkg,"utf8"));if(!p.scripts||!Object.keys(p.scripts).length)findings.push({severity:"warning",message:"package.json has no scripts"});if(p.engines?.node&&p.engines.node.includes("18")===false)findings.push({severity:"info",message:"Check the declared Node.js engine against the installed runtime"});}
  catch(e){findings.push({severity:"error",message:"package.json is invalid JSON: "+e.message});}
 }
 for(const name of ["package-lock.json","pnpm-lock.yaml","yarn.lock"]){if(fs.existsSync(path.join(root,name))){}}
 for(const name of ["node_modules",".git","vendor","dist","build"]){const p=path.join(root,name);try{if(fs.existsSync(p)&&!fs.statSync(p).isDirectory())findings.push({severity:"warning",message:name+" exists but is not a directory"});}catch{}}
 return findings;
}
module.exports={buildSymbolIndex,findSymbols,diagnoseProject};
