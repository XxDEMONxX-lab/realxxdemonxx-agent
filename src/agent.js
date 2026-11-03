import { chatCompletion } from "./providers.js";
import { toolSchemas, executeTool } from "./tools.js";
import { ask, say } from "./ui.js";
const SYSTEM = `You are REALXXDEMONXX AGENT, a careful senior software engineer operating inside the user's current project directory. Understand the task, inspect relevant files before editing, make minimal coherent changes, and verify with tests or syntax checks when possible. Never claim a test passed unless you ran it. Use tools for file operations. Do not access files outside the current project. Shell commands always require user approval. Explain important changes and risks concisely. Ask before destructive operations, installing packages, network uploads, or commands that modify system state.`;
export async function runAgent(config) {
 const messages=[{role:"system",content:SYSTEM}];
 while(true) {
  const input=(await ask("\nYou > ")).trim();
  if(!input) continue;
  if(input==="/exit"||input==="/quit") break;
  if(input==="/help") { say("/help  /exit  /clear  /provider"); continue; }
  if(input==="/clear") { messages.splice(1); say("Conversation cleared."); continue; }
  if(input==="/provider") { say(`Provider: ${config.provider}\nEndpoint: ${config.baseURL}\nModel: ${config.model}`); continue; }
  messages.push({role:"user",content:input});
  let finished=false;
  for(let step=0;step<(config.maxSteps||8)&&!finished;step++) {
   let result;
   try { result=await chatCompletion(config,messages,toolSchemas); }
   catch(e) { say("[Provider error] "+e.message); finished=true; break; }
   const msg=result.choices?.[0]?.message;
   if(!msg) { say("Provider returned no assistant message."); finished=true; break; }
   messages.push(msg);
   if(msg.content) say("\nAgent > "+msg.content);
   if(!msg.tool_calls?.length) { finished=true; break; }
   for(const call of msg.tool_calls) {
    let output;
    try {
     const args=JSON.parse(call.function.arguments||"{}");
     output=await executeTool(call.function.name,args);
    } catch(e) { output="Tool error: "+e.message; }
    messages.push({role:"tool",tool_call_id:call.id,content:String(output).slice(0,14000)});
   }
  }
  if(!finished) say("Step limit reached. Send a follow-up to continue.");
 }
 say("Session ended.");
}