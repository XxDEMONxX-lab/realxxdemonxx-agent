import {chatCompletion,configureProvider,chooseCurrentModel} from "./providers.js";
import {toolSchemas,executeTool,undoLastChange} from "./tools.js";
import {saveConfig} from "./config.js";
import {readProjectMemory,writeProjectMemory,addTaskHistory,getTaskHistory,createCheckpoint,listCheckpoints,restoreCheckpoint} from "./workspace.js";
import {ask,say,withSpinner,showTool,agentText,promptLabel,section,info,success,error,chatReady,quickMenu,startTUI,streamToken,streamEnd,setTaskLabel,ESC} from "./ui.js";

const SYSTEM=`You are REALXXDEMONXX AGENT, a capable terminal software engineering agent.
You work inside the user's current project directory. Behave like a practical coding partner, not a generic chatbot.
For normal questions, answer directly and clearly. For coding tasks, inspect the project first, explain a short plan when useful, read relevant files, preview proposed edits with preview_file_change, make focused edits, run appropriate checks, fix failures where possible, and report exactly what changed and what was verified.
Use tools to perform work rather than merely explaining how the user could do it. Delegate independent read-only investigations to specialist subagents when they can provide useful parallel findings. Do not invent files, command output, test results, or capabilities. Never claim a command passed unless its output confirms it.
Respect existing architecture and style. Avoid replacing unrelated code. Ask before destructive actions, installing dependencies, publishing, or any action outside the project. Shell commands require explicit user approval. Stay inside the current project directory.`;

const HELP=`REALXXDEMONXX AGENT — COMMANDS
  /chat       Return to the chat prompt
  /menu       Open command palette
  /plan       Plan a task before editing
  /review     Review project code
  /debug      Investigate a bug or error
  /files      List project files
  /map        Display project structure
  /pwd        Show current project directory
  /providers  Switch API provider
  /models     Browse models for current provider
  /model      Enter model ID manually
  /provider   Show active API configuration
  /test       Test model connection
  /maxsteps   Set maximum tool cycles (1-30)
  /settings   Configure permissions and agent settings
  /limits     Set maximum response tokens
  /usage      Show session token usage
  /memory     View or update persistent project memory
  /history    Show recent task history
  /git        Show Git working-tree status
  /diff       Show current Git diff
  /run-tests  Run the configured test/check script
  /checkpoint Save a project snapshot
  /checkpoints List saved snapshots
  /restore    Restore a saved snapshot
  /undo       Restore the latest backed-up file
  /status     Show workspace status
  /clear      Clear chat context
  /exit       Exit agent

TRY ASKING
  Inspect this project and explain its architecture.
  Find and fix a bug, then run the tests.
  Review this project for security issues.`

export async function runAgent(config) {
  const projectMemory=await readProjectMemory();
  const messages=[{role:"system",content:SYSTEM+(projectMemory?"\n\nPROJECT MEMORY (user-maintained; treat as project context):\n"+projectMemory:"")}];
  let nextMode="";
  const usage={prompt:0,completion:0,total:0};
  let currentTaskStarted=0;
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
    if (command==="/memory") {
      const current=await readProjectMemory();
      section("PROJECT MEMORY");
      say(current||"(No project memory saved.)");
      const edit=(await ask("  Replace memory? Enter YES to edit, anything else to return: ")).trim();
      if(edit==="YES"){
        const value=await ask("  Enter memory text on one line: ");
        if(value!==ESC){await writeProjectMemory(value);success("Project memory updated.");}
      }
      continue;
    }
    if (command==="/history") {
      const rows=await getTaskHistory(20);
      section("RECENT TASK HISTORY");
      if(!rows.length)info("No saved tasks yet.");
      for(const row of rows)info(new Date(row.at).toLocaleString()+" · "+row.status+" · "+String(row.task||"").slice(0,180));
      continue;
    }
    if (command==="/checkpoint") {
      const label=(await ask("  Snapshot label: ")).trim()||"manual";
      try{const cp=await createCheckpoint(label);success("Checkpoint "+cp.id+" saved · "+cp.count+" files.");}
      catch(e){error("Checkpoint failed: "+e.message);}
      continue;
    }
    if (command==="/checkpoints") {
      const rows=await listCheckpoints();section("CHECKPOINTS");
      if(!rows.length)info("No checkpoints saved.");
      rows.forEach(x=>info(x.id+" · "+x.label+" · "+x.files.length+" files"));
      continue;
    }
    if (command==="/restore") {
      const rows=await listCheckpoints();section("RESTORE CHECKPOINT");
      if(!rows.length){info("No checkpoints available.");continue;}
      rows.forEach((x,i)=>info((i+1)+". "+x.id+" · "+x.label+" · "+x.files.length+" files"));
      const choice=(await ask("  Checkpoint number (or Esc): ")).trim();
      if(choice===ESC)continue;
      const cp=rows[Number(choice)-1];
      if(!cp){error("Invalid checkpoint number.");continue;}
      const confirm=(await ask("  This overwrites matching project files. Type RESTORE to continue: ")).trim();
      if(confirm!=="RESTORE"){info("Restore cancelled.");continue;}
      try{const restored=await restoreCheckpoint(cp.id);success("Restored "+restored.length+" files from "+cp.id);}
      catch(e){error("Restore failed: "+e.message);}
      continue;
    }
    if(command==="/git"||command==="/diff"||command==="/run-tests"){
      const tool=command==="/git"?"git_status":command==="/diff"?"git_diff":"run_tests";
      try{section(command.slice(1).toUpperCase());say(await executeTool(tool,{},config));}
      catch(e){error(e.message);}
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
    if(command==="/fallback"){
      section("FALLBACK MODELS");
      const current=Array.isArray(config.fallbackModels)?config.fallbackModels:[];
      info(current.length?current.join(" · "):"No fallback models configured.");
      info("Enter comma-separated model IDs in priority order. Leave empty to clear.");
      const raw=(await ask("  Fallback model IDs: ")).trim();
      if(raw===ESC)continue;
      const models=[...new Set(raw.split(",").map(x=>x.trim()).filter(Boolean))].filter(x=>x!==config.model).slice(0,5);
      config.fallbackModels=models;
      await persist();
      success(models.length?"Saved "+models.length+" fallback model(s).":"Fallback models cleared.");
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
        ["destructive","Auto-approve destructive commands"],
        ["gitOperations","Auto-approve read-only Git inspection"],
        ["runTests","Auto-approve test/check scripts"]
      ];
      config.permissions=config.permissions||{};
      while (true) {
        section("SETTINGS / PERMISSIONS");
        labels.forEach(([key,label],i)=>info(`${i+1}. ${label}: ${config.permissions[key]===true?"ON":"OFF"}`));
        info("0. Back");
        const choice=(await ask("  Toggle setting number: ")).trim();
        if (choice===ESC || choice==="0" || choice.toLowerCase()==="back") { info("Returned to chat."); break; }
        const item=labels[Number(choice)-1];
        if (!item) {error("Choose a number from 0 to 8.");continue;}
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
    currentTaskStarted=Date.now();
    setTaskLabel(input);
    const modeInstruction=nextMode?({plan:"\n\nMODE: PLANNING. First inspect relevant project files, then present a numbered plan and wait for approval before making edits.",review:"\n\nMODE: CODE REVIEW. Inspect relevant files and report findings ordered by severity with file and line references. Do not edit files.",debug:"\n\nMODE: DEBUGGING. Reproduce or trace the issue from available evidence, inspect relevant files, explain the likely root cause, then make a minimal fix only when sufficiently supported."}[nextMode]||""):"";
    messages.push({role:"user",content:input+modeInstruction});
    nextMode="";
    let completed=false;
    let hadOutput=false;
    const maxSteps=config.maxSteps||8;

    for (let step=0;step<maxSteps;step++) {
      let result;
      let streamed=false;
      const requestedModel=config.model;
      try {
        result=await withSpinner(
          step===0?"Thinking...":`Working through tool results · step ${step+1}/${maxSteps}...`,
          ()=>chatCompletion(config,messages,toolSchemas,{onToken:token=>{streamed=true;streamToken(token);},onRetry:(attempt,wait)=>info("Provider retry "+attempt+" · waiting "+wait+" ms")})
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

      if(streamed)streamEnd();
      if(config.model!==requestedModel){await persist();info("Primary model unavailable; switched to fallback "+config.model);}
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
        if(!streamed)agentText(msg.content);
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

      const executeCall=async call=>{
        const name=call?.function?.name||"unknown";
        try{
          if(!call.id)throw new Error("Provider returned a tool call without an ID; choose a model with compatible tool calling.");
          const args=JSON.parse(call?.function?.arguments||"{}");
          showTool(name,args);
          const output=await executeTool(name,args,config);
          success("Completed "+name);
          return {role:"tool",tool_call_id:call.id,content:String(output??"No output").slice(0,16000)};
        }catch(e){
          const output="Tool failed: "+e.message;
          error(output);
          return {role:"tool",tool_call_id:call?.id||"missing-tool-call-id",content:output};
        }
      };
      const parallelDelegation=calls.length>1&&calls.every(call=>call?.function?.name==="delegate_subagent");
      const toolMessages=parallelDelegation?await Promise.all(calls.map(executeCall)):[];
      if(parallelDelegation)messages.push(...toolMessages);
      else for(const call of calls)messages.push(await executeCall(call));
    }
    if (!completed) {
      say("Tool-cycle limit reached. Review the changes so far, then ask the agent to continue.");
    } else if (!hadOutput && messages.length===userMessageIndex) {
      info("No response was added to the conversation.");
    }
    if(input && !input.startsWith("/")){
      try{await addTaskHistory({task:input.slice(0,1000),durationMs:Date.now()-currentTaskStarted,status:completed?"completed":"incomplete"});}
      catch(e){info("Task history could not be saved: "+e.message);}
    }
  }
  success("Session ended.");
}
