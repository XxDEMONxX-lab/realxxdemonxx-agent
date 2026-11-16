"use strict";
const fs=require("node:fs");
const path=require("node:path");
const crypto=require("node:crypto");

function hashFile(file){
 try{
  const stat=fs.statSync(file);
  if(!stat.isFile())throw Error("Target is not a regular file");
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
 }catch(error){if(error.code==="ENOENT")return null;throw error;}
}

function atomicWrite(file,content,options={}){
 if(typeof content!=="string")throw Error("Content must be a string");
 const bytes=Buffer.from(content,"utf8");
 if(bytes.length>1048576)throw Error("Write exceeds 1MiB");
 const dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true});
 const currentHash=hashFile(file);
 if(Object.prototype.hasOwnProperty.call(options,"expectedHash")&&currentHash!==options.expectedHash){
  throw Error("File changed since it was read; refusing stale write (expected "+(options.expectedHash||"missing")+", current "+(currentHash||"missing")+")");
 }
 let mode=options.mode;
 if(mode===undefined){try{mode=fs.statSync(file).mode&0o777;}catch{mode=0o600;}}
 const temp=path.join(dir,"."+path.basename(file)+"."+process.pid+"."+crypto.randomBytes(8).toString("hex")+".tmp");
 let fd;
 try{
  fd=fs.openSync(temp,"wx",mode);
  fs.writeFileSync(fd,bytes);
  fs.fsyncSync(fd);
  fs.closeSync(fd);fd=undefined;
  fs.renameSync(temp,file);
  try{const dfd=fs.openSync(dir,"r");try{fs.fsyncSync(dfd);}finally{fs.closeSync(dfd);}}catch{}
 }catch(error){
  if(fd!==undefined)try{fs.closeSync(fd);}catch{}
  try{fs.unlinkSync(temp);}catch{}
  throw error;
 }
 return {sha256:crypto.createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,previousHash:currentHash};
}

function applyTextPatch(file,patch){
 if(!patch||typeof patch!=="object"||typeof patch.oldText!=="string"||typeof patch.newText!=="string")throw Error("Patch requires oldText and newText strings");
 if(!patch.oldText.length)throw Error("Empty oldText patches are not allowed");
 const before=fs.readFileSync(file,"utf8");
 const hash=crypto.createHash("sha256").update(Buffer.from(before,"utf8")).digest("hex");
 if(hash!==patch.expectedHash)throw Error("File changed since it was read; refusing stale patch");
 const first=before.indexOf(patch.oldText);
 if(first<0)throw Error("Patch context not found; reread the file");
 if(before.indexOf(patch.oldText,first+patch.oldText.length)>=0)throw Error("Patch context is ambiguous; include more surrounding text");
 const after=before.slice(0,first)+patch.newText+before.slice(first+patch.oldText.length);
 return atomicWrite(file,after,{expectedHash:hash});
}

module.exports={hashFile,atomicWrite,applyTextPatch};
