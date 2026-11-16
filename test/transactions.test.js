"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {hashFile,atomicWrite,applyTextPatch}=require("../transactions");

function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"demon-tx-"));
 return {dir,file:path.join(dir,"sample.txt"),close(){fs.rmSync(dir,{recursive:true,force:true});}};
}

test("atomic write creates files and returns a content hash",()=>{
 const f=fixture();try{
  const result=atomicWrite(f.file,"hello");
  assert.equal(fs.readFileSync(f.file,"utf8"),"hello");
  assert.equal(result.sha256,hashFile(f.file));
  assert.equal(result.previousHash,null);
 }finally{f.close();}
});

test("compare-and-swap rejects stale writes without modifying the file",()=>{
 const f=fixture();try{
  atomicWrite(f.file,"before");
  const expected=hashFile(f.file);
  atomicWrite(f.file,"external change");
  assert.throws(()=>atomicWrite(f.file,"agent overwrite",{expectedHash:expected}),/changed since it was read/);
  assert.equal(fs.readFileSync(f.file,"utf8"),"external change");
 }finally{f.close();}
});

test("atomic write preserves existing file permissions",()=>{
 const f=fixture();try{
  fs.writeFileSync(f.file,"before",{mode:0o640});
  fs.chmodSync(f.file,0o640);
  atomicWrite(f.file,"after");
  assert.equal(fs.statSync(f.file).mode&0o777,0o640);
 }finally{f.close();}
});

test("text patch requires matching hash and unique context",()=>{
 const f=fixture();try{
  atomicWrite(f.file,"alpha\nbeta\ngamma\n");
  const expected=hashFile(f.file);
  const result=applyTextPatch(f.file,{expectedHash:expected,oldText:"beta",newText:"BETA"});
  assert.equal(fs.readFileSync(f.file,"utf8"),"alpha\nBETA\ngamma\n");
  assert.equal(result.sha256,hashFile(f.file));
 }finally{f.close();}
});

test("text patch rejects missing or ambiguous context",()=>{
 const f=fixture();try{
  atomicWrite(f.file,"same\nsame\n");
  const expected=hashFile(f.file);
  assert.throws(()=>applyTextPatch(f.file,{expectedHash:expected,oldText:"absent",newText:"x"}),/context not found/);
  assert.throws(()=>applyTextPatch(f.file,{expectedHash:expected,oldText:"same",newText:"x"}),/ambiguous/);
 }finally{f.close();}
});

test("text patch rejects stale hashes",()=>{
 const f=fixture();try{
  atomicWrite(f.file,"before");
  const expected=hashFile(f.file);
  atomicWrite(f.file,"changed");
  assert.throws(()=>applyTextPatch(f.file,{expectedHash:expected,oldText:"changed",newText:"patched"}),/changed since it was read/);
 }finally{f.close();}
});
