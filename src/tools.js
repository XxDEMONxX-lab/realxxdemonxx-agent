import fs from "node:fs/promises";
import path from "node:path";
import { ask } from "./ui.js";

const root=await fs.realpath(process.cwd());
const ignored=new Set([".git","node_modules",".venv","venv","dist","build",".next",".realxxdemonxx-backups"]);

async function safePath(input=".") {
  const target=path.resolve(root,input);
  if (target!==root && !target.startsWith(root+path.sep)) throw new Error("Path escapes the current project directory.");
  let probe=target;
  while (true) {
    try {
      const actual=await fs.realpath(probe);
      if (actual!==root && !actual.startsWith(root+path.sep)) throw new Error("Symlink points outside the current project.");
      break;
    } catch(e) {
      if (e.code!=="ENOENT" && e.code!=="ENOTDIR") throw e;
      const parent=path.dirname(probe);
      if (parent===probe) throw new Error("Could not validate requested path.");
      probe=parent;
    }
  }
  return target;
}

const backupRoot=path.join(root,".realxxdemonxx-backups");
async function backupExisting(file) {
  try {
    const stat=await fs.stat(file);
    if (!stat.isFile()) throw new Error("Refusing to replace a non-file path.");
    const relative=path.relative(root,file);
    const folder=path.join(backupRoot,String(Date.now()));
    const destination=path.join(folder,relative);
    await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.copyFile(file,destination);
    await fs.writeFile(path.join(folder,"backup.json"),JSON.stringify({relative},null,2));
    return true;
  } catch(e) {
    if(e.code==="ENOENT") return false;
    throw e;
  }
}
export async function undoLastChange() {
  let folders=[];
  try { folders=await fs.readdir(backupRoot,{withFileTypes:true}); }
  catch(e) { if(e.code==="ENOENT") return "No file backup exists yet."; throw e; }
  const stamps=folders.filter(x=>x.isDirectory() && /^\\d+$/.test(x.name)).map(x=>x.name).sort((a,b)=>Number(b)-Number(a));
  for(const stamp of stamps) {
    const folder=path.join(backupRoot,stamp);
    try {
      const meta=JSON.parse(await fs.readFile(path.join(folder,"backup.json"),"utf8"));
      const destination=await safePath(meta.relative);
      await fs.mkdir(path.dirname(destination),{recursive:true});
      await fs.copyFile(path.join(folder,meta.relative),destination);
      return "Restored previous version of "+meta.relative+".";
    } catch {}
  }
  return "No restorable backup was found.";
}

export const toolSchemas=[
 {type:"function",function:{name:"list_files",description:"List project files and folders. Hidden dependency and build directories are skipped.",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"]}}},
 {type:"function",function:{name:"search_files",description:"Search project text files for a word or phrase. Returns matching file paths and line numbers.",parameters:{type:"object",properties:{query:{type:"string"},path:{type:"string"}},required:["query"]}}},
 {type:"function",function:{name:"read_file",description:"Read a UTF-8 project text file. Always read a file before modifying it.",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"]}}},
 {type:"function",function:{name:"write_file",description:"Create or replace a UTF-8 project file. Preserve existing code unless the requested change requires otherwise.",parameters:{type:"object",properties:{path:{type:"string"},content:{type:"string"}},required:["path","content"]}}},
 {type:"function",function:{name:"run_command",description:"Run a shell command in the project directory. User approval is required.",parameters:{type:"object",properties:{command:{type:"string"}},required:["command"]}}}
];

export async function executeTool(name,args={},config={}) {
  if (name==="list_files") {
    if (config.permissions?.readFiles!==true && (await ask("  List files? Type YES to approve: ")).trim()!=="YES") return "User denied file listing.";
    const dir=await safePath(args.path||".");
    const entries=await fs.readdir(dir,{withFileTypes:true});
    const visible=entries.filter(e=>!ignored.has(e.name)).slice(0,200);
    return visible.map(e=>(e.isDirectory()?"[DIR] ":"[FILE] ")+e.name).join("\n") || "(empty directory)";
  }
  if (name==="search_files") {
    if (config.permissions?.searchFiles!==true && (await ask("  Search files? Type YES to approve: ")).trim()!=="YES") return "User denied file search.";
    const query=String(args.query||"").trim();
    if (!query) throw new Error("Search query cannot be empty.");
    const start=await safePath(args.path||".");
    const hits=[];
    let scanned=0;
    async function walk(dir) {
      if (hits.length>=60 || scanned>=1200) return;
      let entries;
      try { entries=await fs.readdir(dir,{withFileTypes:true}); } catch { return; }
      for (const entry of entries) {
        if (hits.length>=60 || scanned>=1200) break;
        if (entry.isDirectory()) {
          if (!ignored.has(entry.name)) await walk(path.join(dir,entry.name));
        } else if (entry.isFile()) {
          const file=path.join(dir,entry.name);
          try {
            const stat=await fs.stat(file);
            if (stat.size>180000 || /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|mp4|mp3|woff2?|ttf|lock)$/i.test(entry.name)) continue;
            scanned++;
            const text=await fs.readFile(file,"utf8");
            const lines=text.split(/\r?\n/);
            for (let i=0;i<lines.length;i++) {
              if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                hits.push(`${path.relative(root,file)}:${i+1}: ${lines[i].trim().slice(0,240)}`);
                if (hits.length>=60) break;
              }
            }
          } catch {}
        }
      }
    }
    await walk(start);
    return hits.join("\n") || `No matches found. Scanned ${scanned} files.`;
  }
  if (name==="read_file") {
    if (config.permissions?.readFiles!==true && (await ask("  Read file? Type YES to approve: ")).trim()!=="YES") return "User denied file read.";
    const file=await safePath(args.path);
    const stat=await fs.stat(file);
    if (!stat.isFile()) throw new Error("The requested path is not a regular file.");
    if (stat.size>400000) throw new Error("File is larger than 400 KB; inspect a smaller file or split it.");
    return await fs.readFile(file,"utf8");
  }
  if (name==="write_file") {
    if (config.permissions?.writeFiles!==true && (await ask("  Write/edit file? Type YES to approve: ")).trim()!=="YES") return "User denied file write.";
    const file=await safePath(args.path);
    if (typeof args.content!=="string") throw new Error("File content must be text.");
    if (Buffer.byteLength(args.content,"utf8")>500000) throw new Error("Refusing to write a file larger than 500 KB in one operation.");
    const backedUp=await backupExisting(file);
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,args.content,"utf8");
    return `Wrote ${path.relative(root,file)} (${Buffer.byteLength(args.content,"utf8")} bytes)${backedUp?" · previous version backed up":""}`;
  }
  if (name==="run_command") {
    const command=String(args.command||"").trim();
    if (!command) throw new Error("Command cannot be empty.");
    console.log(`\n  $ ${command}\n`);
    const packageInstall=/\b(npm|pnpm|yarn|bun|pip|pip3|pkg|apt)\s+(install|add|i)\b/i.test(command);
    const destructive=/\b(rm|rmdir|unlink)\b|\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/i.test(command);
    const permissionKey=destructive?"destructive":packageInstall?"packageInstall":"terminal";
    const permissionLabel=destructive?"destructive command":packageInstall?"package installation":"terminal command";
    const approval=config.permissions?.[permissionKey]===true?"YES":(await ask(`  Approve ${permissionLabel}? Type YES: `)).trim();
    if (approval!=="YES") return "User denied command execution.";
    const {execFile}=await import("node:child_process");
    return await new Promise(resolve=>execFile("sh",["-lc",command],{
      cwd:root,timeout:120000,maxBuffer:1024*1024,env:process.env
    },(err,stdout,stderr)=>{
      const code=err?(err.code??"unknown"):0;
      const result=[stdout,stderr,`Exit code: ${code}`].filter(Boolean).join("\n");
      resolve(result.slice(0,16000)||"(command completed with no output)");
    }));
  }
  throw new Error("Unknown tool: "+name);
}
