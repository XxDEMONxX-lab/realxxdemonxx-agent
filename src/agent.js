import {chatCompletion,configureProvider,chooseCurrentModel} from "./providers.js";
import {toolSchemas,executeTool} from "./tools.js";
import {saveConfig} from "./config.js";
import {ask,say,withSpinner,showTool,agentText,promptLabel,section,info,success,error} from "./ui.js";

const SYSTEM=`You are REALXXDEMONXX AGENT, a terminal software engineering agent similar in workflow to a modern AI coding CLI.
You are working in the user's current project directory. Your primary job is to understand, plan, implement, debug, and verify software changes—not merely give generic advice.
For a greeting, respond normally. For a coding task:
1. Inspect the project structure and relevant files before proposing changes.
2. Give a concise plan when the task is substantial.
3. Use file and search tools to understand existing conventions.
4. Implement the requested changes directly using write_file.
5. Run relevant syntax checks or tests using run_command.
6. Summarize changed files and actual verification results.
Use tools whenever they can perform the requested work. Do not invent file contents, command output, tests, or capabilities. Do not claim work is complete unless you made the changes.
Preserve existing features and style. Make focused edits; do not rewrite unrelated files. Ask before destructive commands, dependency installation, publishing, or actions outside the project. Shell execution requires the user's explicit YES approval. Stay inside the current project directory.`;

const HELP=`REALXXDEMONXX AGENT
  /help        Show commands
  /providers   Switch API provider
  /models      Browse models for current provider
  /model       Enter model ID manually
  /provider    Show active API configuration
  /test        Test model connection
  /maxsteps    Set maximum tool cycles (1-30)
  /status      Show workspace status
  /clear       Clear chat context
  /exit        Exit agent

EXAMPLES
  Inspect this project and explain how it works.
  Find and fix the login bug, then run tests.
  Add a Discord.js v14 ticket system to this project.`;

export async function runAgent(config) {
  const messages=[{role:"system",content:SYSTEM}];
  const persist=()=>saveConfig(config);
  section("CODING WORKSPACE");
  info(`Model     ${config.model}`);
  info(`Provider  ${config.providerName||config.provider}`);
  info(`Project   ${process.cwd()}`);
  info("Tools     search · read · write · terminal");
  info("Safety    terminal commands require approval");
  say(HELP);

  while (true) {
    const input=(await ask(promptLabel())).trim();
    if (!input) continue;
    const command=input.toLowerCase();
    if (command==="/exit"||command==="/quit") break;
    if (command==="/help") {say(HELP);continue;}
    if (command==="/clear") {messages.splice(1);success("Conversation context cleared.");continue;}
    if (command==="/provider") {
      info(`Provider: ${config.providerName||config.provider}`);
      info(`Endpoint: ${config.baseURL}`);
      info(`Model: ${config.model}`);
      continue;
    }
    if (command==="/providers"||command==="/switch") {
      const selected=await configureProvider(config,persist);
      if (selected) {
        messages.splice(1);
        success(`Switched to ${config.providerName} · ${config.model}`);
      }
      continue;
    }
    if (command==="/models") {
      try {
        const model=await chooseCurrentModel(config,persist);
        if (model) {messages.splice(1);success(`Model changed to ${model}`);}
      } catch(e) {error(e.message);}
      continue;
    }
    if (command==="/model") {
      const model=(await ask("  Exact model ID: ")).trim();
      if (model) {
        config.model=model;
        await persist();
        messages.splice(1);
        success("Model saved.");
      }
      continue;
    }
    if (command==="/test") {
      try {
        const result=await withSpinner("Testing API connection...",()=>chatCompletion(config,[
          {role:"user",content:"Reply with exactly CONNECTION OK"}
        ],[]));
        const text=result?.choices?.[0]?.message?.content;
        if (typeof text==="string"&&text.trim()) success("API connection works · "+text.trim().slice(0,120));
        else error("The API responded but returned no text. Check the model ID.");
      } catch(e) {error(e.message);}
      continue;
    }
    if (command==="/maxsteps") {
      const raw=(await ask(`  Maximum tool cycles [${config.maxSteps||8}]: `)).trim();
      if (!raw) continue;
      const n=Number(raw);
      if (Number.isInteger(n)&&n>=1&&n<=30) {
        config.maxSteps=n;
        await persist();
        success(`Maximum tool cycles set to ${n}`);
      } else error("Enter a whole number from 1 to 30.");
      continue;
    }
    if (command==="/status") {
      info(`Provider: ${config.providerName||config.provider}`);
      info(`Model: ${config.model}`);
      info(`Project: ${process.cwd()}`);
      info(`Max tool cycles: ${config.maxSteps||8}`);
      info(`Conversation messages: ${messages.length-1}`);
      continue;
    }

    const userMessageIndex=messages.length;
    messages.push({role:"user",content:input});
    let completed=false;
    let hadOutput=false;
    const maxSteps=config.maxSteps||8;

    for (let step=0;step<maxSteps;step++) {
      let result;
      try {
        result=await withSpinner(
          step===0?"Thinking...":`Reviewing tool results · step ${step+1}/${maxSteps}...`,
          ()=>chatCompletion(config,messages,toolSchemas)
        );
      } catch(e) {
        error(e.message);
        if (/tool|function|unsupported parameter/i.test(e.message)) {
          info("This model may not support tool calling. Choose a coding model with function/tool calling using /models.");
        }
        messages.splice(userMessageIndex);
        completed=true;
        break;
      }

      const choice=result?.choices?.[0];
      const msg=choice?.message;
      if (!msg||typeof msg!=="object") {
        error("Invalid response from provider. Run /test or check your model ID.");
        messages.splice(userMessageIndex);
        completed=true;
        break;
      }
      messages.push(msg);
      if (typeof msg.content==="string"&&msg.content.trim()) {
        agentText(msg.content);
        hadOutput=true;
      }
      const calls=Array.isArray(msg.tool_calls)?msg.tool_calls:[];
      if (!calls.length) {
        if (!hadOutput) {
          error(`Model returned no text${choice.finish_reason?` (finish: ${choice.finish_reason})`:""}. Try another model with chat-completion support.`);
        }
        completed=true;
        break;
      }

      for (const call of calls) {
        const name=call?.function?.name||"unknown";
        let output;
        try {
          const args=JSON.parse(call?.function?.arguments||"{}");
          showTool(name,args);
          output=await executeTool(name,args);
          success(`Completed ${name}`);
        } catch(e) {
          output=`Tool failed: ${e.message}`;
          error(output);
        }
        messages.push({
          role:"tool",
          tool_call_id:call.id,
          content:String(output??"No output").slice(0,16000)
        });
      }
    }
    if (!completed) {
      say("Tool-cycle limit reached. Ask the agent to continue if more work is needed.");
    } else if (!hadOutput && messages.length===userMessageIndex) {
      info("No response was added to the conversation.");
    }
  }
  success("Session ended.");
}
