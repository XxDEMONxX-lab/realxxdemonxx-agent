const MODELS_DEV = "https://models.dev/api.json";
const BUILT_INS = [
 {id:"openrouter",name:"OpenRouter",baseURL:"https://openrouter.ai/api/v1",defaultModel:"openai/gpt-4o-mini"},
 {id:"openai",name:"OpenAI",baseURL:"https://api.openai.com/v1",defaultModel:"gpt-4.1-mini"},
 {id:"groq",name:"Groq",baseURL:"https://api.groq.com/openai/v1",defaultModel:"llama-3.3-70b-versatile"},
 {id:"together",name:"Together AI",baseURL:"https://api.together.xyz/v1",defaultModel:"meta-llama/Llama-3.3-70B-Instruct-Turbo"},
 {id:"fireworks",name:"Fireworks AI",baseURL:"https://api.fireworks.ai/inference/v1",defaultModel:"accounts/fireworks/models/llama-v3p3-70b-instruct"},
 {id:"deepseek",name:"DeepSeek",baseURL:"https://api.deepseek.com/v1",defaultModel:"deepseek-chat"},
 {id:"mistral",name:"Mistral",baseURL:"https://api.mistral.ai/v1",defaultModel:"mistral-small-latest"},
 {id:"ollama",name:"Ollama (local)",baseURL:"http://127.0.0.1:11434/v1",defaultModel:"qwen2.5-coder:7b"},
 {id:"lmstudio",name:"LM Studio (local)",baseURL:"http://127.0.0.1:1234/v1",defaultModel:"local-model"},
 {id:"custom",name:"Custom OpenAI-compatible endpoint",baseURL:"",defaultModel:""}
];

export async function discoverProviders() {
  let dynamic = [];
  try {
    const res = await fetch(MODELS_DEV, { signal: AbortSignal.timeout(9000) });
    if (res.ok) {
      const data = await res.json();
      dynamic = Object.entries(data).map(([id,p]) => ({
        id, name:p.name || id, baseURL:p.api || "", defaultModel:Object.keys(p.models || {})[0] || "",
        env:p.env || [], npm:p.npm || "", source:"models.dev"
      })).filter(p => p.baseURL);
    }
  } catch {}
  const map = new Map();
  for (const p of [...BUILT_INS, ...dynamic]) map.set(p.id, { ...map.get(p.id), ...p });
  return [...map.values()].sort((a,b) => a.name.localeCompare(b.name));
}

export async function chooseProvider(catalog) {
  const { ask } = await import("./ui.js");
  console.log(`\n  ${catalog.length} API endpoint profiles discovered. Search by provider name.\n`);
  const term = (await ask("  Search provider: ")).trim().toLowerCase();
  const matches = catalog.filter(p => (p.name+" "+p.id).toLowerCase().includes(term)).slice(0,30);
  if (!matches.length) {
    console.log("  No provider matched. Try a shorter search, or search for custom.");
    return chooseProvider(catalog);
  }
  matches.forEach((p,i) => console.log(`  ${String(i+1).padStart(2," ")}  ${p.name} ${p.source ? "(directory)" : "(built-in)"}`));
  const n = Number((await ask("\n  Select provider number: ")).trim());
  const selected = matches[n-1];
  if (!selected) { console.log("  Invalid selection. Try again."); return chooseProvider(catalog); }
  if (selected.id === "custom") selected.baseURL = await ask("  Base URL (example https://host/v1): ");
  return selected;
}

async function request(config, messages, toolsEnabled) {
  const base = (config.baseURL || "").replace(/\/+$/, "");
  if (!base) throw new Error("Provider base URL is missing. Edit ~/.realxxdemonxx-agent/config.json");
  if (!config.apiKey && !["ollama","lmstudio"].includes(config.provider)) throw new Error("API key is missing. Edit ~/.realxxdemonxx-agent/config.json");
  const headers = { "content-type":"application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/XxDEMONxX-lab/realxxdemonxx-agent";
    headers["X-Title"] = "REALXXDEMONXX AGENT";
  }
  const body = { model:config.model, messages, temperature:0.2, stream:false };
  if (toolsEnabled && tools?.length) body.tools = tools;
  const response = await fetch(base+"/chat/completions", {
    method:"POST", headers, body:JSON.stringify(body), signal:AbortSignal.timeout(120000)
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`Provider returned invalid JSON (HTTP ${response.status}): ${raw.slice(0,700)}`); }
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || raw;
    const err = new Error(`Provider HTTP ${response.status}: ${String(detail).slice(0,1000)}`);
    err.status = response.status;
    throw err;
  }
  return data;
}

export async function chatCompletion(config, messages, tools) {
  try {
    return await request(config, messages, tools);
  } catch (e) {
    const message = String(e.message || "");
    const toolUnsupported = /tool|function|unsupported parameter|does not support/i.test(message) && [400,404,422].includes(e.status);
    if (!toolUnsupported || !tools?.length) throw e;
    console.log("\nProvider/model rejected tool calling. Retrying as a normal chat request...");
    return request(config, messages, []);
  }
}
