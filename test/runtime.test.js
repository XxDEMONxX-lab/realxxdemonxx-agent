"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path");
const {safe,parse,provider}=require("../runtime");
test("blocks traversal",()=>assert.throws(()=>safe("../outside"),/outside project/));
test("allows relative paths",()=>assert.equal(safe("src/a.js"),path.join(process.cwd(),"src/a.js")));
test("parses agent JSON",()=>assert.equal(parse('{"message":"ok","actions":[{"type":"list"}]}').actions.length,1));
test("rejects malformed schema",()=>assert.throws(()=>parse('{"message":"bad"}'),/schema/));
test("limits actions",()=>assert.throws(()=>parse(JSON.stringify({message:"x",actions:Array(21).fill({type:"list"})})),/20 actions/));
test("rejects unknown providers",()=>assert.throws(()=>provider("unknown",{custom:{}}),/Unknown provider/));
