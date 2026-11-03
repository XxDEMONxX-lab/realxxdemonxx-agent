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
  const res = await fetch(MODELS_DEV, {signal:AbortSignal.timeout(9000)});
  if (res.ok) {
   const data = await res.json();
   dynamic = Object.entries(data).map(([id,p]) => ({
    id, name:p.name || id, baseURL:p.api || "", defaultModel:Object.keys(p.models || {})[0] || "",
    env:p.env || [], npm:p.npm || "", source:"models.dev"
   })).filter(p => p.baseURL);
  }
 } catch {}
 const map = new Map();
 for (const p of [...BUILT_INS, ...dynamic]) map.set(p.id, {...map.get(p.id), ...p});
 return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export async function chooseProvider(catalog, current) {
 console.log(`Provider directory: ${catalog.length} API endpoint profiles loaded.\n`);
 const query = (await import("./ui.js")).ask;
 const {ask} = await import("./ui.js");
 const term = await ask("Search provider (or type custom): ");
 const matches = catalog.filter(p => (p.name+" "+p.id).toLowerCase().includes(term.toLowerCase())).slice(0,25);
 matches.forEach((p,i)=>console.log(` ${i+1}. ${p.name} [${p.id}]`));
 if (!matches.length) { console.log("No match. Choose custom to enter an endpoint."); return chooseProvider(catalog.filter(p=>p.id==="custom"),current); }
 const n = Number(await ask("Select number: "));
 const selected = matches[n-1];
 if (!selected) return null;
 if (selected.id==="custom") selected.baseURL = await ask("Base URL (example https://host/v1): ");
 return selected;
}
export async function chatCompletion(config, messages, tools) {
 const base = (config.baseURL || "").replace(/\/+$/,"");
 if (!base) throw new Error("Provider base URL is missing. Re-run setup or edit ~/.realxxdemonxx-agent/config.json");
 const headers = {"content-type":"application/json","authorization":`Bearer ${config.apiKey}`};
 const body = {model:config.model,messages,temperature:0.2};
 if (tools?.length) body.tools = tools;
 const response = await fetch(base+"/chat/completions",{method:"POST",headers,body:JSON.stringify(body)});
 const raw = await response.text();
 if (!response.ok) throw new Error(`Provider HTTP ${response.status}: ${raw.slice(0,1200)}`);
 return JSON.parse(raw);
}