import { chatCompletion, configureProvider, chooseCurrentModel } from "./providers.js";
import { toolSchemas, executeTool } from "./tools.js";
import { saveConfig } from "./config.js";
import { ask, say, withSpinner, showTool, agentText, promptLabel, section, info, success, error } from "./ui.js";

const SYSTEM = `You are REALXXDEMONXX AGENT, an advanced terminal-based software engineering agent.
You work inside the user's current project directory. You are not a generic small-talk chatbot: behave like a capable senior engineer and coding partner.
For greetings, answer naturally and briefly. For coding tasks, first inspect the project, understand its architecture, make a plan, then implement complete changes and verify them with relevant tests or syntax checks.
Use tools instead of merely telling the user what commands or code they could run. Read files before editing. Prefer focused, maintainable changes. Explain what you changed and report verification honestly.
Never claim a command or test passed unless it actually ran. Never invent tool results. Ask before destructive operations, installing packages, network uploads, or commands that modify system state. Shell commands require explicit approval. Do not access files outside the current project.`;

const HELP = `AGENT COMMANDS
  /help          Show this command panel
  /providers     Open provider search and model selector
  /provider      Show active provider and model
  /models        Browse models from the active provider
  /model         Enter a model ID manually
  /test          Test the current API connection
  /favorites     Show saved favorite providers
  /maxsteps      Change agent reasoning/tool step limit
  /clear         Clear conversation context
  /status        Show workspace and runtime settings
  /exit          Close the agent

EXAMPLES
  "Inspect this project and explain its architecture."
  "Find the bug, fix it, and run the tests."
  "Build a Discord.js v14 ticket system with buttons."

Provider changes are saved automatically.`;

export async function runAgent(config) {
  const messages = [{ role: "system", content: SYSTEM }];
  const persist = () => saveConfig(config);
  section("WORKSPACE READY");
  info(`Model     ${config.model}`);
  info(`Provider  ${config.providerName || config.provider}`);
  info("Tools     file system · terminal · project inspection");
  info("Safety    shell commands require your approval");
  say(HELP);

  while (true) {
    const input = (await ask(promptLabel())).trim();
    if (!input) continue;
    const command = input.toLowerCase();
    if (command === "/exit" || command === "/quit") break;
    if (command === "/help") { say(HELP); continue; }
    if (command === "/clear") { messages.splice(1); success("Conversation context cleared."); continue; }
    if (command === "/provider") {
      info(`Provider: ${config.providerName || config.provider}`);
      info(`Endpoint: ${config.baseURL}`);
      info(`Model: ${config.model}`);
      continue;
    }
    if (command === "/providers" || command === "/switch") {
      const selected = await configureProvider(config, persist);
      if (selected) {
        messages.splice(1);
        success(`Active model changed to ${config.model}. Conversation context reset.`);
      }
      continue;
    }
    if (command === "/models") {
      const model = await chooseCurrentModel(config, persist);
      if (model) {
        messages.splice(1);
        success(`Active model changed to ${model}. Conversation context reset.`);
      }
      continue;
    }
    if (command === "/model") {
      const model = (await ask("  Enter exact model ID: ")).trim();
      if (model) {
        config.model = model;
        await persist();
        messages.splice(1);
        success("Model saved. Conversation context reset.");
      }
      continue;
    }
    if (command === "/favorites") {
      const fav = config.favorites || [];
      if (!fav.length) info("No favorites saved. Open /providers and use f + number to save one.");
      else fav.forEach((id,i) => info(`${i+1}. ${id}`));
      continue;
    }
    if (command === "/maxsteps") {
      const n = Number((await ask(`  Agent steps [current ${config.maxSteps || 8}]: `)).trim());
      if (Number.isInteger(n) && n >= 1 && n <= 30) {
        config.maxSteps = n;
        await persist();
        success(`Step limit set to ${n}.`);
      } else error("Enter a whole number from 1 to 30.");
      continue;
    }
    if (command === "/test") {
      try {
        const result = await withSpinner("Testing provider connection...", () => chatCompletion(config, [
          {role:"user",content:"Reply with exactly: CONNECTION OK"}
        ], []));
        const answer = result?.choices?.[0]?.message?.content;
        if (answer) success("Connection works. Model response: " + String(answer).trim().slice(0,180));
        else error("Provider responded, but returned no text.");
      } catch (e) { error(e.message); }
      continue;
    }
    if (command === "/status") {
      info(`Max agent steps: ${config.maxSteps || 8}`);
      info(`Working directory: ${process.cwd()}`);
      info("Tool access: enabled (approval-gated shell)");
      info(`Favorite providers: ${(config.favorites || []).length}`);
      continue;
    }

    messages.push({role:"user",content:input});
    let completed = false;
    let hadOutput = false;
    for (let step = 0; step < (config.maxSteps || 8); step++) {
      let result;
      try {
        result = await withSpinner(
          step ? "Thinking through tool results..." : "Analyzing request and consulting model...",
          () => chatCompletion(config, messages, toolSchemas)
        );
      } catch (e) {
        error(e.message);
        messages.pop();
        completed = true;
        break;
      }
      const msg = result?.choices?.[0]?.message;
      if (!msg || typeof msg !== "object") {
        error("The provider returned an empty or unsupported response. Check the selected model and API endpoint.");
        completed = true;
        break;
      }
      messages.push(msg);
      if (typeof msg.content === "string" && msg.content.trim()) {
        agentText(msg.content);
        hadOutput = true;
      }
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (!calls.length) {
        if (!hadOutput) {
          const reason = result?.choices?.[0]?.finish_reason;
          error(`The model returned no visible text or tool calls${reason ? ` (finish reason: ${reason})` : ""}. Try another model that supports chat completions.`);
        }
        completed = true;
        break;
      }
      for (const call of calls) {
        const name = call?.function?.name;
        let output;
        try {
          const args = JSON.parse(call?.function?.arguments || "{}");
          showTool(name || "unknown_tool", args);
          output = await executeTool(name, args);
          success(`Tool completed: ${name}`);
        } catch (e) {
          output = `Tool error: ${e.message}`;
          error(output);
        }
        messages.push({
          role:"tool",
          tool_call_id:call.id,
          content:String(output ?? "Tool returned no output").slice(0,14000)
        });
      }
    }
    if (!completed) say("Agent step limit reached. Give it a follow-up to continue.");
  }
  success("Agent session closed.");
}
