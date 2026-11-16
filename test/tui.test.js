"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {TUI,wrap,truncate,strip,SPIN}=require("../tui");

function makeTui(){
 const agent={c:{provider:"openrouter",model:"test-model",custom:{}},rl:{closed:false,close(){this.closed=true;}},ask:async()=>"",command:async()=>true};
 const ui=new TUI(agent);
 ui.render=()=>{};
 return ui;
}

test("exports a full-screen TUI with animated activity frames",()=>{
 assert.equal(typeof TUI.prototype.start,"function");
 assert.ok(SPIN.length>=8);
});
test("wraps terminal text at requested width",()=>assert.deepEqual(wrap("alpha beta gamma",8),["alpha","beta","gamma"]));
test("splits oversized words",()=>assert.deepEqual(wrap("abcdefgh",4),["abcd","efgh"]));
test("truncates labels to terminal width",()=>assert.equal(truncate("abcdefgh",5),"abcd…"));
test("strips ANSI before measuring terminal text",()=>assert.equal(strip("\x1b[31mred\x1b[0m"),"red"));
test("inserts text at the cursor and supports cursor movement",async()=>{
 const ui=makeTui(),p=ui.readLine("MESSAGE");
 ui.onKeypress("a",{name:"a"});ui.onKeypress("c",{name:"c"});
 ui.onKeypress("",{name:"left"});ui.onKeypress("b",{name:"b"});
 ui.onKeypress("",{name:"return"});
 assert.equal(await p,"abc");
});
test("supports backspace, delete, home and end",async()=>{
 const ui=makeTui(),p=ui.readLine("MESSAGE");
 for(const c of "ac")ui.onKeypress(c,{name:c});
 ui.onKeypress("",{name:"left"});ui.onKeypress("b",{name:"b"});
 ui.onKeypress("",{name:"home"});ui.onKeypress("",{name:"delete"});
 ui.onKeypress("",{name:"end"});ui.onKeypress("",{name:"backspace"});
 ui.onKeypress("",{name:"return"});
 assert.equal(await p,"b");
});
test("maintains bounded-style command history navigation",async()=>{
 const ui=makeTui();
 let p=ui.readLine("MESSAGE",{remember:true});
 ui.onKeypress("o",{name:"o"});ui.onKeypress("n",{name:"n"});ui.onKeypress("",{name:"return"});
 assert.equal(await p,"on");
 p=ui.readLine("MESSAGE",{remember:true});
 ui.onKeypress("t",{name:"t"});ui.onKeypress("w",{name:"w"});ui.onKeypress("o",{name:"o"});
 ui.onKeypress("",{name:"up"});assert.equal(ui.input,"on");
 ui.onKeypress("",{name:"down"});assert.equal(ui.input,"two");
 ui.onKeypress("",{name:"return"});assert.equal(await p,"two");
});
test("Ctrl+K opens the command palette in the input editor",async()=>{
 const ui=makeTui(),p=ui.readLine("MESSAGE");
 ui.onKeypress("",{name:"k",ctrl:true});
 assert.equal(ui.input,"/palette");
 ui.onKeypress("",{name:"return"});assert.equal(await p,"/palette");
});
test("Ctrl+C cancels the active prompt and requests shutdown",async()=>{
 const ui=makeTui(),p=ui.readLine("MESSAGE");
 ui.onKeypress("",{name:"c",ctrl:true});
 assert.equal(await p,null);assert.equal(ui.exitRequested,true);
});
test("streams partial tokens into the transcript without losing line boundaries",()=>{
 const ui=makeTui();ui.stream("hello ");ui.stream("world\nnext");
 assert.deepEqual(ui.logs.slice(-2),["hello world","next"]);
});
test("rejects concurrent input prompts",async()=>{
 const ui=makeTui();const pending=ui.readLine("first");
 await assert.rejects(ui.readLine("second"),/already pending/);
 ui.finishInput("ok");assert.equal(await pending,"ok");
});
