#!/usr/bin/env node
import { loadConfig, saveConfig } from "./src/config.js";
import { chooseProvider, discoverProviders } from "./src/providers.js";
import { runAgent } from "./src/agent.js";
import { banner, ask, say, closeInput } from "./src/ui.js";

async function main() {
  banner();
  const config = await loadConfig();
  let provider = config.provider;
  if (!provider || !config.apiKey) {
    const catalog = await discoverProviders();
    provider = await chooseProvider(catalog, config.provider);
    if (!provider) return;
    config.provider = provider.id;
    config.baseURL = provider.baseURL || "";
    config.apiKey = await ask("API key (input hidden is not available in basic Termux mode): ");
    config.model = await ask(`Model [${provider.defaultModel || "enter model name"}]: `) || provider.defaultModel || "";
    await saveConfig(config);
  }
  say(`Connected profile: ${provider?.name || config.provider} | Model: ${config.model || "not set"}`);
  say("Type /help for commands. Use /exit to quit.\n");
  try { await runAgent(config); }
  finally { closeInput(); }
}
main().catch(e => { console.error("\n[FATAL]", e.message); process.exitCode = 1; });