#!/usr/bin/env node
import { loadConfig, saveConfig } from "./src/config.js";
import { configureProvider } from "./src/providers.js";
import { runAgent } from "./src/agent.js";
import { banner, say, closeInput } from "./src/ui.js";

async function main() {
  banner();
  const config = await loadConfig();
  const local = ["ollama","lmstudio"].includes(config.provider);
  if (!config.provider || (!config.apiKey && !local)) {
    const selected = await configureProvider(config, saveConfig);
    if (!selected && !config.provider) {
      say("No provider configured. Exiting.");
      return;
    }
  }
  if (!config.provider || !config.baseURL || !config.model) {
    say("Provider setup is incomplete. Start again and configure a provider, endpoint and model.");
    return;
  }
  say(`\nConnected: ${config.providerName || config.provider} · ${config.model}`);
  say("Type /help for commands. Use /exit to quit.\n");
  try { await runAgent(config); }
  finally { closeInput(); }
}
main().catch(e => { console.error("\n[FATAL]", e.message); process.exitCode = 1; });
