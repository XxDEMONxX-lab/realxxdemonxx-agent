import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {runSecurityAudit,projectProfile} from "../src/security.js";

test("security audit detects and redacts a test credential",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"rdx-security-"));
 try{
  const secret="ghp_"+"abcdefghijklmnopqrstuvwxyz123456";
  await fs.writeFile(path.join(root,"sample.js"),'const token = "'+secret+'";\n');
  const result=JSON.parse(await runSecurityAudit(root));
  assert.equal(result.secretFindings,1);
  assert.equal(result.findings[0].severity,"HIGH");
  assert.equal(JSON.stringify(result).includes(secret),false);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test("project profile identifies package scripts and extensions",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"rdx-profile-"));
 try{
  await fs.writeFile(path.join(root,"package.json"),JSON.stringify({name:"fixture",scripts:{test:"node --test"},dependencies:{express:"1.0.0"}}));
  await fs.writeFile(path.join(root,"index.js"),"console.log('ok');");
  const result=JSON.parse(await projectProfile(root));
  assert.ok(result.stack.some(item=>item.includes("fixture")));
  assert.equal(result.scripts.test,"node --test");
  assert.equal(result.dependencies,1);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
