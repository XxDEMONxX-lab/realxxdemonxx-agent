#!/usr/bin/env node
"use strict";
const path=require("node:path"),{spawn}=require("node:child_process");
if(+process.versions.node.split(".")[0]<18){console.error("Node 18+ required: pkg install nodejs");process.exit(1);}
const child=spawn(process.execPath,[path.join(__dirname,"runtime.js"),...process.argv.slice(2)],{cwd:process.cwd(),env:process.env,stdio:"inherit"});
child.once("error",e=>{console.error(e.message);process.exitCode=1;});
child.once("exit",(code,signal)=>{process.exitCode=signal?128:(code??1);});
for(const s of ["SIGINT","SIGTERM"])process.once(s,()=>child.kill(s));
