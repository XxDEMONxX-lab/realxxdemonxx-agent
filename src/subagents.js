import {chatCompletion} from "./providers.js";
import {toolSchemas,executeTool} from "./tools.js";

const ALLOWED=new Set(["list_files","search_files","project_map","read_file"]);
const TOOLS=toolSchemas.filter(tool=>ALLOWED.has(tool.function?.name));

export async function runSubagent(config,role,task){
  const messages=[
    {role:"system",content:"You are a specialist read-only software engineering subagent. Role: "+String(role)+". Investigate the assigned task. Specialist guidance: architect maps design and boundaries; debugger traces failure evidence; security-reviewer identifies concrete vulnerabilities; test-analyst identifies missing tests and regression coverage; researcher investigates repository documentation and public sources only when explicitly assigned; performance-analyst finds measurable bottlenecks; dependency-analyst audits package usage and compatibility; documentation improves developer-facing explanations.  You cannot edit files, execute shell commands, install packages, or delegate. Use read-only tools when useful. Return concise evidence-based findings with file paths and line references."},
    {role:"user",content:String(task).slice(0,5000)}
  ];
  for(let step=0;step<4;step++){
    const response=await chatCompletion(config,messages,TOOLS);
    const message=response?.choices?.[0]?.message;
    if(!message)return "Subagent returned no response.";
    messages.push(message);
    const calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
    if(!calls.length)return String(message.content||"(No findings returned.)").slice(0,10000);
    for(const call of calls){
      let output;
      try{
        const name=call.function?.name;
        if(!ALLOWED.has(name))throw new Error("Tool is not available to subagents.");
        output=await executeTool(name,JSON.parse(call.function.arguments||"{}"),config);
      }catch(error){output="Subagent tool error: "+error.message;}
      messages.push({role:"tool",tool_call_id:call.id,content:String(output).slice(0,8000)});
    }
  }
  return "Subagent reached its investigation limit.";
}
