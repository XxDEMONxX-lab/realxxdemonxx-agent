#!/usr/bin/env node
import { loadConfig, saveConfig } from "./src/config.js";
import { configureProvider, PROVIDERS } from "./src/providers.js";
import { runAgent } from "./src/agent.js";
import { banner, say, closeInput, error } from "./src/ui.js";

async function main() {
  banner();
  const config = await loadConfig();
  const provider = PROVIDERS.find(p => p.id === config.provider);
  const supported = Boolean(provider);
  if (provider) {
    config.providerName = provider.name;
    config.baseURL = provider.baseURL;
  }

  if (!supported || !config.apiKey || !config.model) {
    if (config.provider && !supported) {
      error("The saved provider is no longer supported. Select a supported provider or OpenRouter Auto.");
    }
    const selected = await configureProvider(config, saveConfig);
    if (!selected) {
      say("Setup cancelled. Run npm start to configure a provider.");
      return;
    }
  }

  say(`\n  CONNECTED  ${config.providerName || config.provider}  ·  ${config.model}`);
  say("  Type /help for commands.\n");
  try {
    await runAgent(config);
  } finally {
    closeInput();
  }
}

main().catch(error => {
  console.error("\n[FATAL]", error.stack || error.message);
  process.exitCode = 1;
});
