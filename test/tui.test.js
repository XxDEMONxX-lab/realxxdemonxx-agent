"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {TUI,wrap,truncate,strip,SPIN,COMMANDS}=require("../tui");

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
test("streams assistant output on a separate transcript line from the user prompt",()=>{
 const ui=makeTui();ui.logs=["Welcome","❯ hi"];
 ui.beginStream();ui.stream("Hello\n");ui.stream("there!");
 assert.deepEqual(ui.logs,["Welcome","❯ hi","","Demon Agent","Hello","there!"]);
});
test("starts a fresh assistant block for the next response",()=>{
 const ui=makeTui();ui.logs=["❯ first"];
 ui.beginStream();ui.stream("reply one\n");ui.stream("reply two\n");ui.endStream();
 ui.beginStream();ui.stream("reply three\n");ui.endStream();
 assert.deepEqual(ui.logs,["❯ first","","Demon Agent","reply one","reply two","","Demon Agent","reply three",""]);
});
test("rejects concurrent input prompts",async()=>{
 const ui=makeTui();const pending=ui.readLine("first");
 await assert.rejects(ui.readLine("second"),/already pending/);
 ui.finishInput("ok");assert.equal(await pending,"ok");
});

test("PageUp and PageDown scroll the transcript without changing the input",async()=>{
 const ui=makeTui();ui.maxScroll=30;ui.viewportRows=10;
 const p=ui.readLine("MESSAGE");
 ui.onKeypress("",{name:"pageup"});
 assert.equal(ui.scroll,8);assert.equal(ui.input,"");
 ui.onKeypress("",{name:"pagedown"});
 assert.equal(ui.scroll,0);
 ui.finishInput("");await p;
});
test("Ctrl+Up and Ctrl+Down scroll by three lines",async()=>{
 const ui=makeTui();ui.maxScroll=12;
 const p=ui.readLine("MESSAGE");
 ui.onKeypress("",{name:"up",ctrl:true});assert.equal(ui.scroll,3);
 ui.onKeypress("",{name:"down",ctrl:true});assert.equal(ui.scroll,0);
 ui.finishInput("");await p;
});
test("scrolling clamps at transcript start and live bottom",()=>{
 const ui=makeTui();ui.maxScroll=5;
 ui.scrollBy(99);assert.equal(ui.scroll,5);
 ui.scrollBy(-99);assert.equal(ui.scroll,0);
 ui.scroll=4;ui.scrollToBottom();assert.equal(ui.scroll,0);
});

test("Shift+Up and Shift+Down scroll by one page without changing input",async()=>{
 const ui=makeTui();ui.maxScroll=20;ui.viewportRows=10;
 const p=ui.readLine("MESSAGE");
 ui.onKeypress("",{name:"up",shift:true});assert.equal(ui.scroll,8);assert.equal(ui.input,"");
 ui.onKeypress("",{name:"down",shift:true});assert.equal(ui.scroll,0);
 ui.finishInput("");await p;
});
test("Ctrl+Home and Ctrl+End jump to transcript extremes",async()=>{
 const ui=makeTui();ui.maxScroll=25;
 const p=ui.readLine("MESSAGE");
 ui.onKeypress("",{name:"home",ctrl:true});assert.equal(ui.scroll,25);
 ui.onKeypress("",{name:"end",ctrl:true});assert.equal(ui.scroll,0);
 ui.finishInput("");await p;
});

test("slash command menu filters known commands and completes selection",async()=>{
 const ui=makeTui(),p=ui.readLine("MESSAGE");
 ui.onKeypress("/",{name:"/"});
 assert.ok(ui.commandMatches().length>=30);
 ui.onKeypress("s",{name:"s"});
 assert.deepEqual(ui.commandMatches().map(x=>x[0]).slice(0,3),["/search","/symbols","/status"]);
 ui.onKeypress("",{name:"down"});
 assert.equal(ui.commandSelection,1);
 ui.onKeypress("",{name:"tab"});
 assert.equal(ui.input,"/symbols ");
 assert.equal(COMMANDS.some(x=>x[0]==="/verify"),true);
 ui.finishInput("");await p;
});
test("Escape aborts active work without exiting the TUI",()=>{
 const ui=makeTui(),controller=new AbortController();ui.busy=true;ui.activeController=controller;
 ui.onKeypress("",{name:"escape"});
 assert.equal(controller.signal.aborted,true);assert.equal(ui.exitRequested,false);assert.equal(ui.status,"CANCELLING");
});
test("Escape closes slash command suggestions",async()=>{
 const ui=makeTui(),p=ui.readLine("MESSAGE");
 ui.onKeypress("/",{name:"/"});
 assert.ok(ui.commandMatches().length);
 ui.onKeypress("",{name:"escape"});
 assert.equal(ui.input,"");assert.equal(ui.commandMatches().length,0);
 ui.finishInput("");await p;
});

test("Enter executes the highlighted slash command",async()=>{
 const ui=makeTui(),p=ui.readLine("MESSAGE");
 ui.onKeypress("/",{name:"/"});
 ui.onKeypress("s",{name:"s"});
 ui.onKeypress("",{name:"down"});
 ui.onKeypress("",{name:"enter"});
 assert.equal(await p,"/symbols");
 assert.equal(ui.input,"");
});
test("Enter executes the first slash suggestion without requiring Tab",async()=>{
 const ui=makeTui(),p=ui.readLine("MESSAGE");
 ui.onKeypress("/",{name:"/"});
 ui.onKeypress("",{name:"return"});
 assert.equal(await p,"/help");
});
