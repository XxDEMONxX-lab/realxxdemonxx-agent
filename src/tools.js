import fs from "node:fs/promises";
import path from "node:path";
import { ask } from "./ui.js";
const root = process.cwd();
function safePath(input) {
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
export async function executeTool(name,args) {
 if (name==="list_files") {
  const dir=safePath(args.path || ".");
  const entries=await fs.readdir(dir,{withFileTypes:true});
  return entries.map(e=>(e.isDirectory()?"[DIR] ":"[FILE] ")+e.name).join("\n") || "(empty)";
 }
 if (name==="read_file") return await fs.readFile(safePath(args.path),"utf8");
 if (name==="write_file") {
  const file=safePath(args.path); await fs.mkdir(path.dirname(file),{recursive:true});
  await fs.writeFile(file,args.content,"utf8"); return `Wrote ${args.path}`;
 }
 if (name==="run_command") {
  console.log("\nCommand requested:",args.command);
  const approval=(await ask("Approve execution? Type YES: ")).trim();
  if (approval!=="YES") return "User denied command execution.";
  const {execFile}=await import("node:child_process");
  return await new Promise(resolve=>execFile("sh",["-lc",args.command],{cwd:root,timeout:120000,maxBuffer:1024*1024},(err,stdout,stderr)=>{
   resolve([stdout,stderr,err?("Exit code: "+err.code):""].filter(Boolean).join("\n").slice(0,12000));
  }));
 }
 throw new Error("Unknown tool: "+name);
}