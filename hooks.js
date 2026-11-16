"use strict";
const {spawn}=require("node:child_process");
const EVENTS=["before_write","after_write","before_run","after_run"];
const SAFE_ENV=["PATH","HOME","TMPDIR","TEMP","TMP","TERM","LANG","LC_ALL","PREFIX","ANDROID_ROOT","ANDROID_DATA"];
function validateHook(event,config){
 if(!EVENTS.includes(event))throw Error("Unsupported hook event");
 if(!config||typeof config.command!=="string"||!config.command.trim()||config.command.length>256)throw Error("Invalid hook executable");
 if(!Array.isArray(config.args)||config.args.length>32||config.args.some(x=>typeof x!=="string"||x.length>1000))throw Error("Hook args must be an array of at most 32 strings");
 const envAllow=config.envAllow===undefined?[]:config.envAllow;
 if(!Array.isArray(envAllow)||envAllow.length>16||envAllow.some(x=>typeof x!=="string"||!/^[A-Z_][A-Z0-9_]{0,63}$/.test(x)))throw Error("Hook envAllow must contain at most 16 environment variable names");
 return {command:config.command.trim(),args:config.args,envAllow};
}
function runHook(event,config,payload,cwd){
 const hook=validateHook(event,config);
 const env={};for(const name of SAFE_ENV)if(process.env[name]!==undefined)env[name]=process.env[name];
 for(const name of hook.envAllow)if(process.env[name]!==undefined)env[name]=process.env[name];
 return new Promise((resolve,reject)=>{
  const grouped=process.platform!=="win32";
  const child=spawn(hook.command,hook.args,{cwd,shell:false,detached:grouped,stdio:["pipe","pipe","pipe"],env});
  let output="",timedOut=false,killTimer=null,settled=false;
  const append=chunk=>{output+=chunk.toString();if(output.length>8000)output=output.slice(-8000);};
  const signal=s=>{try{if(grouped&&child.pid)process.kill(-child.pid,s);else child.kill(s);}catch{}};
  const timer=setTimeout(()=>{timedOut=true;signal("SIGTERM");killTimer=setTimeout(()=>signal("SIGKILL"),1000);},15000);
  timer.unref?.();
  child.stdout.on("data",append);child.stderr.on("data",append);
  child.on("error",error=>{if(settled)return;settled=true;clearTimeout(timer);if(killTimer)clearTimeout(killTimer);reject(error);});
  child.on("close",code=>{if(settled)return;settled=true;clearTimeout(timer);if(killTimer)clearTimeout(killTimer);resolve({code:code??128,output:output||"(no output)",timedOut});});
  child.stdin.on("error",()=>{});
  child.stdin.end(JSON.stringify({event,payload}));
 });
}
module.exports={EVENTS,validateHook,runHook};
