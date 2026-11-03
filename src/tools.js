import fs from "node:fs/promises";
import path from "node:path";
import { ask } from "./ui.js";

const root = process.cwd();
function safePath(input = ".") {
  const target = path.resolve(root, input);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Path escapes the current project directory.");
  return target;
}

export const toolSchemas = [
 {type:"function",function:{name:"list_files",description:"List files and folders in a project directory. Use a relative path.",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"]}}},
 {type:"function",function:{name:"read_file",description:"Read a UTF-8 text file. Use a relative path.",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"]}}},
 {type:"function",function:{name:"write_file",description:"Create or replace a UTF-8 file in the project. Use a relative path.",parameters:{type:"object",properties:{path:{type:"string"},content:{type:"string"}},required:["path","content"]}}},
 {type:"function",function:{name:"run_command",description:"Run a shell command in the project directory. Commands require explicit user approval.",parameters:{type:"object",properties:{command:{type:"string"}},required:["command"]}}}
];

export async function executeTool(name,args={}) {
  if (name === "list_files") {
    const dir = safePath(args.path || ".");
    const entries = await fs.readdir(dir,{withFileTypes:true});
    return entries.map(e => (e.isDirectory()?"[DIR] ":"[FILE] ")+e.name).join("\n") || "(empty directory)";
  }
  if (name === "read_file") {
    const file = safePath(args.path);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("The requested path is not a regular file.");
    if (stat.size > 300000) throw new Error("File is larger than 300 KB; inspect a smaller file or split it.");
    return await fs.readFile(file,"utf8");
  }
  if (name === "write_file") {
    const file = safePath(args.path);
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,args.content,"utf8");
    return `Wrote ${path.relative(root,file)} (${Buffer.byteLength(args.content,"utf8")} bytes)`;
  }
  if (name === "run_command") {
    console.log(`\n  Requested command: ${args.command}\n`);
    const approval = (await ask("  Execute this command? Type YES to approve: ")).trim();
    if (approval !== "YES") return "User denied command execution.";
    const {execFile} = await import("node:child_process");
    return await new Promise(resolve => execFile("sh",["-lc",args.command],{
      cwd:root,timeout:120000,maxBuffer:1024*1024,env:process.env
    },(err,stdout,stderr) => {
      const result = [stdout,stderr,err ? ("Exit code: "+(err.code ?? "unknown")) : "Exit code: 0"].filter(Boolean).join("\n");
      resolve(result.slice(0,14000) || "(command completed with no output)");
    }));
  }
  throw new Error("Unknown tool: "+name);
}
