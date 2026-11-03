import {chatCompletion,configureProvider,chooseCurrentModel} from "./providers.js";
import {toolSchemas,executeTool,undoLastChange} from "./tools.js";
import {saveConfig} from "./config.js";
import {ask,say,withSpinner,showTool,agentText,promptLabel,section,info,success,error,chatReady,quickMenu,startTUI,ESC} from "./ui.js";

const SYSTEM=`You are REALXXDEMONXX AGENT, a capable terminal software engineering agent.
You work inside the user's current project directory. Behave like a practical coding partner, not a generic chatbot.
For normal questions, answer directly and clearly. For coding tasks, inspect the project first, explain a short plan when useful, read relevant files, make focused edits, run appropriate checks, fix failures where possible, and report exactly what changed and what was verified.
Use tools to perform work rather than merely explaining how the user could do it. Do not invent files, command output, test results, or capabilities. Never claim a command passed unless its output confirms it.
Respect existing architecture and style. Avoid replacing unrelated code. Ask before destructive actions, installing dependencies, publishing, or any action outside the project. Shell commands require explicit user approval. Stay inside the current project directory.`;

const HELP=`REALXXDEMONXX AGENT — COMMANDS
  /chat       Return to the chat prompt
  /menu       Show quick actions
  /files      List project files
  /pwd        Show current project directory
  /providers  Switch API provider
  /models     Browse models for current provider
  /model      Enter model ID manually
  /provider   Show active API configuration
  /test       Test model connection
  /maxsteps   Set maximum tool cycles (1-30)
  /settings   Configure permissions and agent settings
  /limits     Set maximum response tokens
  /undo       Restore the latest backed-up file
  /status     Show workspace status
  /clear      Clear chat context
  /exit       Exit agent

TRY ASKING
  Inspect this project and explain how it works.
  Find and fix the login bug, then run the tests.
  Add a Discord.js v14 ticket system matching this project's style.
  Review the code for bugs and security issues.`;

export async function runAgent(config) {
  const messages=[{role:"system",content:SYSTEM}];
  let nextMode="";
  const usage={prompt:0,completion:0,total:0};
  const persist=()=>saveConfig(config);
  startTUI(config);
  section("WORKSPACE");
  info("Project   " + process.cwd());
  info("Tools     search · read · write · terminal");
  info("Safety    terminal commands require approval");
  chatReady(config.model,config.providerName||config.provider);
  say("  Tip: ask for a change in plain English. The agent can inspect and edit files.");
  say("  Type /help to see all commands.");

  while (true) {
    let input=(await ask(promptLabel())).trim();
    if (input==="/menu") input=(await quickMenu())||"";
    if (!input || input===ESC) continue;
    const command=input.toLowerCase();
    if (command==="/exit"||command==="/quit") break;
    if (command==="/help" || command==="/") {say(HELP);continue;}
    if (command==="/chat") {info("Chat is active. Type your request below.");nextMode="";continue;}
    if (["/plan","/review","/debug"].includes(command)) {
      nextMode=command.slice(1);
      const descriptions={plan:"Create a concise implementation plan first. Do not edit files until the plan is presented and the user approves it.",review:"Perform a careful code review. Prioritize concrete bugs, security risks, regressions and missing tests. Do not modify files unless asked.",debug:"Investigate the reported failure systematically. Inspect relevant code and logs, identify the root cause, then propose a minimal fix before editing."};
      info(descriptions[nextMode]);
      continue;
    }
    if (command==="/map") {
      try { section("PROJECT MAP"); say(await executeTool("project_map",{path:"."},config)); }
      catch(e) { error(e.message); }
      continue;
    }
    if (command==="/usage") {
      section("SESSION USAGE");
      info("Prompt tokens: "+usage.prompt);
      info("Completion tokens: "+usage.completion);
      info("Total tokens: "+usage.total);
      continue;
    }
    if (command==="/pwd") {info(process.cwd());continue;}
    if (command==="/files") {
      try {
        const output=await executeTool("list_files",{path:"."},config);
        section("PROJECT FILES");
        say(output);
      } catch(e) {error(e.message);}
      continue;
    }
    if (command==="/clear") {messages.splice(1);success("Conversation context cleared.");continue;}
    if (command==="/undo") { try { success(await undoLastChange()); } catch(e) { error(e.message); } continue; }
    if (command==="/provider") {
      info("Provider: " + (config.providerName||config.provider));
      info("Endpoint: " + config.baseURL);
      info("Model: " + config.model);
      continue;
    }
    if (command==="/providers"||command==="/switch") {
      const selected=await configureProvider(config,persist);
      if (selected) {
        messages.splice(1);
        chatReady(config.model,config.providerName);
        success("Provider and model updated.");
      }
      continue;
    }
    if (command==="/models") {
      try {
        const model=await chooseCurrentModel(config,persist);
        if (model) {
          messages.splice(1);
          chatReady(config.model,config.providerName||config.provider);
          success("Model changed to " + model);
        }
      } catch(e) {error(e.message);}
      continue;
    }
    if (command==="/model") {
      const model=(await ask("  Exact model ID: ")).trim();
      if (model && model!==ESC) {
        config.model=model;
        await persist();
        messages.splice(1);
        chatReady(config.model,config.providerName||config.provider);
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
    if (command==="/settings") {
      const labels=[
        ["readFiles","Auto-approve file reads"],
        ["searchFiles","Auto-approve file searches"],
        ["writeFiles","Auto-approve file writes and edits"],
        ["terminal","Auto-approve ordinary terminal commands"],
        ["packageInstall","Auto-approve package installations"],
        ["destructive","Auto-approve destructive commands"]
      ];
      config.permissions=config.permissions||{};
      while (true) {
        section("SETTINGS / PERMISSIONS");
        labels.forEach(([key,label],i)=>info(`${i+1}. ${label}: ${config.permissions[key]===true?"ON":"OFF"}`));
        info("0. Back");
        const choice=(await ask("  Toggle setting number: ")).trim();
        if (choice===ESC || choice==="0" || choice.toLowerCase()==="back") { info("Returned to chat."); break; }
        const item=labels[Number(choice)-1];
        if (!item) {error("Choose a number from 0 to 6.");continue;}
        config.permissions[item[0]]=config.permissions[item[0]]!==true;
        await persist();
        success(item[1]+" "+(config.permissions[item[0]]?"ON":"OFF"));
      }
      continue;
    }
    if (command==="/limits") {
      const raw=(await ask(`  Maximum response tokens [${config.maxTokens||512}]: `)).trim();
      if (!raw || raw===ESC) continue;
      const n=Number(raw);
      if (Number.isInteger(n)&&n>=128&&n<=4096) {
        config.maxTokens=n;
        await persist();
        success("Maximum response tokens set to "+n);
      } else error("Enter a whole number from 128 to 4096.");
      continue;
    }
    if (command==="/maxsteps") {
      const raw=(await ask(`  Maximum tool cycles [${config.maxSteps||8}]: `)).trim();
      if (!raw) continue;
      const n=Number(raw);
      if (Number.isInteger(n)&&n>=1&&n<=30) {
        config.maxSteps=n;
        await persist();
        success("Maximum tool cycles set to " + n);
      } else error("Enter a whole number from 1 to 30.");
      continue;
    }
    if (command==="/status") {
      section("SESSION STATUS");
      info("Provider: " + (config.providerName||config.provider));
      info("Model: " + config.model);
      info("Project: " + process.cwd());
      info("Max tool cycles: " + (config.maxSteps||8));
      info("Conversation messages: " + (messages.length-1));
      continue;
    }

    const userMessageIndex=messages.length;
    const modeInstruction=nextMode?({plan:"\n\nMODE: PLANNING. First inspect relevant project files, then present a numbered plan and wait for approval before making edits.",review:"\n\nMODE: CODE REVIEW. Inspect relevant files and report findings ordered by severity with file and line references. Do not edit files.",debug:"\n\nMODE: DEBUGGING. Reproduce or trace the issue from available evidence, inspect relevant files, explain the likely root cause, then make a minimal fix only when sufficiently supported."}[nextMode]||""):"";
    messages.push({role:"user",content:input+modeInstruction});
    nextMode="";
    let completed=false;
    let hadOutput=false;
    const maxSteps=config.maxSteps||8;

    for (let step=0;step<maxSteps;step++) {
      let result;
      try {
        result=await withSpinner(
          step===0?"Thinking...":`Working through tool results · step ${step+1}/${maxSteps}...`,
          ()=>chatCompletion(config,messages,toolSchemas)
        );
      } catch(e) {
        if (/tool|function|unsupported parameter/i.test(e.message)) {
          info("Tool calling was rejected. Retrying once in chat-only mode...");
          try {
            result=await withSpinner("Retrying without tools...",()=>chatCompletion(config,messages,[]));
            const fallback=result?.choices?.[0]?.message;
            if (fallback && typeof fallback.content==="string" && fallback.content.trim()) {
              messages.push(fallback);
              agentText(fallback.content);
              hadOutput=true;
              info("Chat-only reply: this model did not accept tools, so it could not edit files or run commands for this request.");
              completed=true;
              break;
            }
            throw new Error("The model returned no text when retried without tools.");
          } catch(retryError) {
            error(retryError.message);
          }
        } else {
          error(e.message);
          if (/401|403/i.test(e.message)) {
            info("Check that your API key is valid for this provider.");
          } else if (/429/i.test(e.message)) {
            info("The provider may be rate-limiting this key or model. Wait or choose another model.");
          }
        }
        messages.splice(userMessageIndex);
        completed=true;
        break;
      }

      if (result?.usage) { usage.prompt+=Number(result.usage.prompt_tokens)||0; usage.completion+=Number(result.usage.completion_tokens)||0; usage.total+=Number(result.usage.total_tokens)||0; }
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
          error(`Model returned no text${choice.finish_reason?` (finish: ${choice.finish_reason})`:""}. Try /test, then select a model with chat-completion support.`);
        }
        completed=true;
        break;
      }

      for (const call of calls) {
        const name=call?.function?.name||"unknown";
        let output;
        try {
          if (!call.id) throw new Error("Provider returned a tool call without an ID; choose a model with compatible tool calling.");
          const args=JSON.parse(call?.function?.arguments||"{}");
          showTool(name,args);
          output=await executeTool(name,args,config);
          success("Completed " + name);
        } catch(e) {
          output="Tool failed: " + e.message;
          error(output);
        }
        messages.push({
          role:"tool",
          tool_call_id:call.id||"missing-tool-call-id",
          content:String(output??"No output").slice(0,16000)
        });
      }
    }
    if (!completed) {
      say("Tool-cycle limit reached. Review the changes so far, then ask the agent to continue.");
    } else if (!hadOutput && messages.length===userMessageIndex) {
      info("No response was added to the conversation.");
    }
  }
  success("Session ended.");
}
