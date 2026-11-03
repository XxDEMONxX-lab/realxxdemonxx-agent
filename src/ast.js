import fs from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";

const root=path.resolve(process.cwd());
const ignored=new Set([".git","node_modules",".next","dist","build",".agent-worktrees",".realxxdemonxx-backups"]);
const extensions=/\.(?:[cm]?js|jsx|ts|tsx)$/i;
async function collect(dir,files=[],depth=0){
 if(depth>8||files.length>=1500)return files;
 let entries=[];try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return files;}
 for(const entry of entries){
  if(files.length>=1500)break;
  if(entry.name.startsWith(".")&&entry.name!==".")continue;
  if(entry.isDirectory()){if(!ignored.has(entry.name))await collect(path.join(dir,entry.name),files,depth+1);}
  else if(entry.isFile()&&extensions.test(entry.name))files.push(path.join(dir,entry.name));
 }
 return files;
}
async function getTypescript(){
 try{return await import("typescript");}
 catch{
  try{return createRequire(path.join(root,"package.json"))("typescript");}
  catch{throw new Error("TypeScript compiler API is not installed in this project. Install it with: npm install -D typescript (approval required).");}
 }
}
export async function inspectAst(file){
 const absolute=path.resolve(root,file);
 if(!absolute.startsWith(root+path.sep))throw new Error("AST target must be inside the project.");
 if(!extensions.test(absolute))throw new Error("AST inspection supports JavaScript and TypeScript source files.");
 const ts=await getTypescript(),source=await fs.readFile(absolute,"utf8");
 const kind=absolute.endsWith(".tsx")?ts.ScriptKind.TSX:absolute.endsWith(".jsx")?ts.ScriptKind.JSX:absolute.endsWith(".ts")?ts.ScriptKind.TS:ts.ScriptKind.JS;
 const tree=ts.createSourceFile(absolute,source,ts.ScriptTarget.Latest,true,kind);
 const rows=[];
 function visit(node){
  if(ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node)||ts.isEnumDeclaration(node)){
   const name=node.name?.getText(tree)||"(anonymous)";
   const pos=tree.getLineAndCharacterOfPosition(node.getStart(tree));
   rows.push({kind:ts.SyntaxKind[node.kind],name,line:pos.line+1});
  }else if(ts.isVariableStatement(node)){
   const pos=tree.getLineAndCharacterOfPosition(node.getStart(tree));
   for(const decl of node.declarationList.declarations)rows.push({kind:"Variable",name:decl.name.getText(tree),line:pos.line+1});
  }else if(ts.isImportDeclaration(node)){
   const pos=tree.getLineAndCharacterOfPosition(node.getStart(tree));
   rows.push({kind:"Import",name:node.moduleSpecifier.text,line:pos.line+1});
  }
  ts.forEachChild(node,visit);
 }
 visit(tree);
 const diagnostics=[...tree.parseDiagnostics].slice(0,30).map(d=>({line:tree.getLineAndCharacterOfPosition(d.start||0).line+1,message:ts.flattenDiagnosticMessageText(d.messageText," ")}));
 return JSON.stringify({file:path.relative(root,absolute),language:kind===ts.ScriptKind.TS||kind===ts.ScriptKind.TSX?"TypeScript":"JavaScript",declarations:rows.slice(0,300),parseErrors:diagnostics},null,2);
}

export async function renameAstSymbol({file,line,column,newName,apply=false}){
 if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(String(newName||"")))throw new Error("New symbol name must be a valid JavaScript identifier.");
 const ts=await getTypescript();
 const files=await collect(root);
 const filePath=path.resolve(root,file);
 if(!filePath.startsWith(root+path.sep)||!files.includes(filePath))throw new Error("Rename target is not a supported project source file.");
 const contents=new Map();
 for(const name of files){try{contents.set(name,await fs.readFile(name,"utf8"));}catch{}}
 const options={allowJs:true,checkJs:false,jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.Latest,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext};
 const host={
  getScriptFileNames:()=>[...contents.keys()],
  getScriptVersion:()=>"0",
  getScriptSnapshot:name=>{const value=contents.get(path.resolve(name));return value===undefined?undefined:ts.ScriptSnapshot.fromString(value);},
  getCurrentDirectory:()=>root,
  getCompilationSettings:()=>options,
  getDefaultLibFileName:opts=>ts.getDefaultLibFilePath(opts),
  fileExists:name=>contents.has(path.resolve(name))||ts.sys.fileExists(name),
  readFile:name=>contents.get(path.resolve(name))??ts.sys.readFile(name),
  readDirectory:ts.sys.readDirectory,
  directoryExists:ts.sys.directoryExists,
  getDirectories:ts.sys.getDirectories,
  realpath:ts.sys.realpath,
  useCaseSensitiveFileNames:()=>ts.sys.useCaseSensitiveFileNames
 };
 const service=ts.createLanguageService(host,ts.createDocumentRegistry());
 const source=contents.get(filePath);
 const lines=source.split(/\r?\n/);
 const row=Math.max(1,Number(line)||1),col=Math.max(1,Number(column)||1);
 if(row>lines.length||col>lines[row-1].length+1)throw new Error("Line or column is outside the source file.");
 const position=lines.slice(0,row-1).reduce((sum,value)=>sum+value.length+1,0)+col-1;
 const info=service.getRenameInfo(filePath,position,{});
 if(!info.canRename)throw new Error(info.localizedErrorMessage||"TypeScript could not safely identify a renameable symbol at that location.");
 const locations=service.findRenameLocations(filePath,position,false,false,true)||[];
 if(!locations.length)throw new Error("No rename locations found.");
 const grouped=new Map();
 for(const item of locations){
  const target=path.resolve(item.fileName);
  if(!contents.has(target))continue;
  if(!grouped.has(target))grouped.set(target,[]);
  grouped.get(target).push(item.textSpan);
 }
 const changed=[];
 for(const [target,spans] of grouped){
  let value=contents.get(target);
  spans.sort((a,b)=>b.start-a.start);
  for(const span of spans)value=value.slice(0,span.start)+newName+value.slice(span.start+span.length);
  if(value!==contents.get(target))changed.push({path:target,content:value,count:spans.length});
 }
 if(!changed.length)throw new Error("No source changes were produced.");
 const preview=changed.map(item=>path.relative(root,item.path)+" · "+item.count+" occurrence(s)").join("\n");
 if(!apply)return {preview,files:changed.map(item=>({path:path.relative(root,item.path),content:item.content,count:item.count}))};
 return {changed,preview};
}
