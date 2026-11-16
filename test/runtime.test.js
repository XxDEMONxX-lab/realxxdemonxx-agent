"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path"),fs=require("node:fs");
const {safe,parse,provider,sessionFile,writeFile,undoFile,diffPreview,completionStream}=require("../runtime");
test("blocks traversal",()=>assert.throws(()=>safe("../outside"),/outside project/));
test("allows relative paths",()=>assert.equal(safe("src/a.js"),path.join(process.cwd(),"src/a.js")));
test("parses agent JSON",()=>assert.equal(parse('{"message":"ok","actions":[{"type":"list"}]}').actions.length,1));
test("rejects malformed schema",()=>assert.throws(()=>parse('{"message":"bad"}'),/schema/));
test("limits actions",()=>assert.throws(()=>parse(JSON.stringify({message:"x",actions:Array(21).fill({type:"list"})})),/20 actions/));
test("rejects unknown providers",()=>assert.throws(()=>provider("unknown",{custom:{}}),/Unknown provider/));

const {TUI,wrap,truncate,strip}=require("../tui");
test("exports the TUI launcher class",()=>assert.equal(typeof TUI.prototype.start,"function"));
test("wraps terminal text at requested width",()=>assert.deepEqual(wrap("alpha beta gamma",8),["alpha","beta","gamma"]));
test("splits oversized words",()=>assert.deepEqual(wrap("abcdefgh",4),["abcd","efgh"]));
test("truncates labels to terminal width",()=>assert.equal(truncate("abcdefgh",5),"abcd…"));
test("strips ANSI before measuring terminal text",()=>assert.equal(strip("\x1b[31mred\x1b[0m"),"red"));
test("wraps ANSI-styled text without leaking escape codes",()=>assert.deepEqual(wrap("\x1b[32malpha beta\x1b[0m",5),["alpha","beta"]));
test("truncates ANSI-styled text by visible width",()=>assert.equal(truncate("\x1b[31mabcdef\x1b[0m",4),"abc…"));
test("parses braces and escaped quotes inside JSON strings",()=>{const x=parse('prefix {"message":"literal } and \\"quote\\" {","actions":[]} trailing');assert.equal(x.message,'literal } and "quote" {');});
test("rejects path-like session names",()=>assert.throws(()=>sessionFile("../escape"),/Session name/));
test("backs up overwritten files and restores the previous version",()=>{const file=".demon-undo-test-"+process.pid+".txt";try{fs.writeFileSync(file,"before");writeFile(file,"after");assert.equal(fs.readFileSync(file,"utf8"),"after");undoFile(file);assert.equal(fs.readFileSync(file,"utf8"),"before");}finally{try{fs.unlinkSync(file);}catch{}}});
test("previews proposed file changes without modifying the source",()=>{const file=".demon-diff-test-"+process.pid+".txt";try{fs.writeFileSync(file,"before\n");const diff=diffPreview(file,"after\n");assert.match(diff,/after/);assert.equal(fs.readFileSync(file,"utf8"),"before\n");}finally{try{fs.unlinkSync(file);}catch{}}});
test("streams OpenAI-compatible server-sent events",async()=>{const oldFetch=global.fetch,oldKey=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY="test-key";global.fetch=async()=>new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n',{status:200,headers:{"content-type":"text/event-stream"}});try{const chunks=[],answer=await completionStream("openrouter","test-model",[],{baseUrls:{},keys:{},custom:{}},x=>chunks.push(x));assert.equal(answer,"hello world");assert.deepEqual(chunks,["hello"," world"]);}finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=oldKey;}});

test("streams Anthropic message delta events",async()=>{const oldFetch=global.fetch,oldKey=process.env.ANTHROPIC_API_KEY;process.env.ANTHROPIC_API_KEY="test-key";global.fetch=async(url)=>{assert.match(url,/\/messages$/);return new Response('event: content_block_delta\\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"anthropic"}}\\n\\nevent: message_stop\\ndata: {"type":"message_stop"}\\n\\n',{status:200});};try{const chunks=[],answer=await completionStream("anthropic","claude-test",[],{baseUrls:{},keys:{},custom:{}},x=>chunks.push(x));assert.equal(answer,"anthropic");assert.deepEqual(chunks,["anthropic"]);}finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.ANTHROPIC_API_KEY;else process.env.ANTHROPIC_API_KEY=oldKey;}});
test("streams Gemini SSE candidate parts",async()=>{const oldFetch=global.fetch,oldKey=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY="test-key";global.fetch=async(url)=>{assert.match(url,/streamGenerateContent/);return new Response('data: {"candidates":[{"content":{"parts":[{"text":"gemini"}]}}]}\\n\\n',{status:200});};try{const answer=await completionStream("gemini","gemini-test",[],{baseUrls:{},keys:{},custom:{}},()=>{});assert.equal(answer,"gemini");}finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=oldKey;}});
test("streams Ollama newline-delimited JSON",async()=>{const oldFetch=global.fetch;global.fetch=async()=>new Response('{"message":{"content":"ollama"}}\\n{"done":true}\\n',{status:200});try{const answer=await completionStream("ollama","local-model",[],{baseUrls:{},keys:{},custom:{}},()=>{});assert.equal(answer,"ollama");}finally{global.fetch=oldFetch;}});
