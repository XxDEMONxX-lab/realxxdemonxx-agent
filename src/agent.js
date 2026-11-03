import { chatCompletion } from "./providers.js";
import { toolSchemas, executeTool } from "./tools.js";
import { ask, say, withSpinner, showTool, agentText, promptLabel, section, info, success, error } from "./ui.js";

const SYSTEM = `You are REALXXDEMONXX AGENT, an advanced terminal-based software engineering agent.
You work inside the user's current project directory. You are not a generic small-talk chatbot: behave like a capable senior engineer and coding partner.
For greetings, answer naturally and briefly. For coding tasks, first inspect the project, understand its architecture, make a plan, then implement complete changes and verify them with relevant tests or syntax checks.
Use tools instead of merely telling the user what commands or code they could run. Read files before editing. Prefer focused, maintainable changes. Explain what you changed and report verification honestly.
Never claim a command or test passed unless it actually ran. Never invent tool results. Ask before destructive operations, installing packages, network uploads, or commands that modify system state. Shell commands require explicit approval. Do not access files outside the current project.`;

const HELP = `Commands
  /help       Show commands
  /clear      Clear conversation context
  /provider   Show active model and endpoint
  /status     Show agent runtime settings
  /exit       Close the agent

Tip: ask for a feature, a bug fix, a code review, or "inspect this project".`;

export async function runAgent(config) {
  const messages = [{ role: "system", content: SYSTEM }];
  section("WORKSPACE READY");
  info(`Model     ${config.model}`);
  info(`Provider  ${config.provider}`);
  info("Tools     file system · terminal · project inspection");
  info("Safety    shell commands require your approval");
  say(HELP);

  while (true) {
    const input = (await ask(promptLabel())).trim();
    if (!input) continue;
    if (input === "/exit" || input === "/quit") break;
    if (input === "/help") { say(HELP); continue; }
    if (input === "/clear") { messages.splice(1); success("Conversation context cleared."); continue; }
    if (input === "/provider") {
      info(`Provider: ${config.provider}`);
      info(`Endpoint: ${config.baseURL}`);
      info(`Model: ${config.model}`);
      continue;
    }
    if (input === "/status") {
      info(`Max agent steps: ${config.maxSteps || 8}`);
      info(`Working directory: ${process.cwd()}`);
      info(`Tool access: enabled (approval-gated shell)`);
      continue;
    }

    messages.push({ role: "user", content: input });
    let completed = false;
    let hadOutput = false;

    for (let step = 0; step < (config.maxSteps || 8); step++) {
      let result;
      try {
        result = await withSpinner(step ? "Thinking through tool results..." : "Analyzing request and consulting model...", () =>
          chatCompletion(config, messages, toolSchemas)
        );
      } catch (e) {
        error(e.message);
        messages.pop();
        completed = true;
        break;
      }

      const msg = result?.choices?.[0]?.message;
      if (!msg || (typeof msg !== "object")) {
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
        let args = {};
        let output;
        try {
          args = JSON.parse(call?.function?.arguments || "{}");
          showTool(name || "unknown_tool", args);
          output = await executeTool(name, args);
          success(`Tool completed: ${name}`);
        } catch (e) {
          output = `Tool error: ${e.message}`;
          error(output);
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: String(output ?? "Tool returned no output").slice(0, 14000)
        });
      }
    }

    if (!completed) say("Agent step limit reached. Give it a follow-up to continue.");
  }

  success("Agent session closed.");
}
