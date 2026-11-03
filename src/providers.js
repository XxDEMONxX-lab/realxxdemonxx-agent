const MODELS_DEV = "https://models.dev/api.json";
const BUILT_INS = [
 {id:"openrouter",name:"OpenRouter",baseURL:"https://openrouter.ai/api/v1",defaultModel:"openai/gpt-4o-mini",category:"Aggregators"},
 {id:"openai",name:"OpenAI",baseURL:"https://api.openai.com/v1",defaultModel:"gpt-4.1-mini",category:"Major providers"},
 {id:"groq",name:"Groq",baseURL:"https://api.groq.com/openai/v1",defaultModel:"llama-3.3-70b-versatile",category:"Fast inference"},
 {id:"together",name:"Together AI",baseURL:"https://api.together.xyz/v1",defaultModel:"meta-llama/Llama-3.3-70B-Instruct-Turbo",category:"Inference platforms"},
 {id:"fireworks",name:"Fireworks AI",baseURL:"https://api.fireworks.ai/inference/v1",defaultModel:"accounts/fireworks/models/llama-v3p3-70b-instruct",category:"Inference platforms"},
 {id:"deepseek",name:"DeepSeek",baseURL:"https://api.deepseek.com/v1",defaultModel:"deepseek-chat",category:"Major providers"},
 {id:"mistral",name:"Mistral",baseURL:"https://api.mistral.ai/v1",defaultModel:"mistral-small-latest",category:"Major providers"},
 {id:"ollama",name:"Ollama (local)",baseURL:"http://127.0.0.1:11434/v1",defaultModel:"qwen2.5-coder:7b",category:"Local / self-hosted"},
 {id:"lmstudio",name:"LM Studio (local)",baseURL:"http://127.0.0.1:1234/v1",defaultModel:"local-model",category:"Local / self-hosted"},
 {id:"custom",name:"Custom OpenAI-compatible endpoint",baseURL:"",defaultModel:"",category:"Custom"}
];
let directoryCache = null;

export async function discoverProviders(force = false) {
  if (directoryCache && !force) return directoryCache;
  let dynamic = [];
  try {
    const res = await fetch(MODELS_DEV, { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const data = await res.json();
      dynamic = Object.entries(data).map(([id,p]) => ({
        id, name:p.name || id, baseURL:p.api || "", env:p.env || [], npm:p.npm || "",
        models:Object.entries(p.models || {}).map(([modelId,m]) => ({
          id:modelId, name:m.name || modelId, tool_call:Boolean(m.tool_call),
          reasoning:Boolean(m.reasoning), context_length:m.limit?.context || null
        })),
        source:"models.dev"
      })).filter(p => p.baseURL);
    }
  } catch {}
  const map = new Map();
  for (const p of [...BUILT_INS, ...dynamic]) map.set(p.id, { ...map.get(p.id), ...p });
  directoryCache = [...map.values()].sort((a,b) => a.name.localeCompare(b.name));
  return directoryCache;
}

function categoryOf(p) {
  if (p.category) return p.category;
  const s = (p.id+" "+p.name).toLowerCase();
  if (/ollama|lm.?studio|local|vllm|llamacpp/.test(s)) return "Local / self-hosted";
  if (/router|openrouter|chutes|together|poe|cloudflare/.test(s)) return "Aggregators";
  if (/groq|cerebras|sambanova|hyperbolic|inference/.test(s)) return "Fast inference";
  if (/azure|aws|vertex|google|anthropic|openai|deepseek|mistral|cohere|xai|perplexity/.test(s)) return "Major providers";
  return "Other providers";
}
const categories = ["All","Major providers","Aggregators","Fast inference","Inference platforms","Local / self-hosted","Other providers","Custom","Favorites"];

async function selectModel(provider, apiKey, currentModel) {
  const {ask} = await import("./ui.js");
  let models = Array.isArray(provider.models) ? provider.models : [];
  const base = (provider.baseURL || "").replace(/\/+$/, "");
  if (base && provider.id !== "custom") {
    try {
      const headers = apiKey ? {authorization:`Bearer ${apiKey}`} : {};
      const r = await fetch(base+"/models",{headers,signal:AbortSignal.timeout(7000)});
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.data)) {
          const live = data.data.map(m=>({id:m.id,name:m.name || m.id,tool_call:false}));
          if (live.length) models = live;
        }
      }
    } catch {}
  }
  if (!models.length && provider.defaultModel) models = [{id:provider.defaultModel,name:provider.defaultModel}];
  console.log("\n  MODEL SELECTOR");
  console.log("  Search a model name, enter a number, or type manual.");
  if (currentModel) console.log(`  Current: ${currentModel}`);
  const query = (await ask("  Model search: ")).trim();
  if (!query) return currentModel || provider.defaultModel || "";
  if (query.toLowerCase() === "manual") return (await ask("  Enter exact model ID: ")).trim();
  let matches = models.filter(m => (m.id+" "+m.name).toLowerCase().includes(query.toLowerCase())).slice(0,30);
  if (/^\d+$/.test(query) && Number(query)>0 && Number(query)<=models.length) {
    const chosen=models[Number(query)-1]; return chosen.id;
  }
  if (!matches.length && query.length>2) return query;
  matches.forEach((m,i)=>{
    const flags=[m.tool_call?"tools":"",m.reasoning?"reasoning":""].filter(Boolean).join(" · ");
    console.log(`  ${String(i+1).padStart(2," ")}. ${m.name} ${flags ? "· "+flags : ""}`);
    if (m.id!==m.name) console.log(`      ${m.id}`);
  });
  if (!matches.length) return provider.defaultModel || "";
  const n=Number((await ask("  Select model number (0 to type manually): ")).trim());
  if (n===0) return (await ask("  Model ID: ")).trim();
  return matches[n-1]?.id || (await selectModel(provider,apiKey,currentModel));
}

export async function configureProvider(config, save = async()=>{}) {
  const {ask} = await import("./ui.js");
  let catalog = await discoverProviders();
  const favorites = new Set(config.favorites || []);
  let category = "All", term = "", page = 0;
  const pageSize = 12;
  while (true) {
    let list = catalog.filter(p => {
      const cat=categoryOf(p);
      const categoryMatch=category==="All" || (category==="Favorites" ? favorites.has(p.id) : cat===category);
      const searchMatch=!term || (p.name+" "+p.id+" "+cat).toLowerCase().includes(term.toLowerCase());
      return categoryMatch && searchMatch;
    });
    const pages=Math.max(1,Math.ceil(list.length/pageSize));
    page=Math.min(page,pages-1);
    console.log("\n  ╔════════════════════════════════════════════════════╗");
    console.log("  ║             PROVIDER CONTROL CENTER               ║");
    console.log("  ╚════════════════════════════════════════════════════╝");
    console.log(`  ${catalog.length} providers · ${list.length} matches · ${category} · page ${page+1}/${pages}`);
    if (term) console.log(`  Search: "${term}"`);
    list.slice(page*pageSize,(page+1)*pageSize).forEach((p,i)=>{
      const index=page*pageSize+i+1;
      const star=favorites.has(p.id)?"★":" ";
      const active=config.provider===p.id?" [ACTIVE]":"";
      console.log(`  ${String(index).padStart(3," ")}. ${star} ${p.name}${active}`);
      console.log(`       ${mutedText(p.id+" · "+categoryOf(p))}`);
    });
    console.log("\n  [number] select  [s] search  [c] category  [f number] favorite");
    console.log("  [n] next  [p] previous  [r] refresh directory  [q] back");
    const action=(await ask("\n  Provider manager > ")).trim();
    if (!action) continue;
    if (action.toLowerCase()==="q") return null;
    if (action.toLowerCase()==="s") { term=(await ask("  Search: ")).trim(); page=0; continue; }
    if (action.toLowerCase()==="c") {
      categories.forEach((v,i)=>console.log(`  ${i+1}. ${v}`));
      const n=Number((await ask("  Category number: ")).trim());
      if (categories[n-1]) { category=categories[n-1]; page=0; }
      continue;
    }
    if (action.toLowerCase()==="n") { page=(page+1)%pages; continue; }
    if (action.toLowerCase()==="p") { page=(page-1+pages)%pages; continue; }
    if (action.toLowerCase()==="r") { catalog=await discoverProviders(true); console.log(`  Refreshed: ${catalog.length} profiles.`); page=0; continue; }
    const fav=action.match(/^f\s+(\d+)$/i);
    if (fav) {
      const p=list[Number(fav[1])-1];
      if (p) { favorites.has(p.id)?favorites.delete(p.id):favorites.add(p.id); config.favorites=[...favorites]; await save(config); }
      continue;
    }
    const n=Number(action);
    if (Number.isInteger(n) && n>0 && list[n-1]) {
      const chosen={...list[n-1]};
      console.log(`\n  Selected: ${chosen.name}`);
      console.log(`  Endpoint: ${chosen.baseURL || "(custom endpoint required)"}`);
      console.log(`  Listed models: ${chosen.models?.length || "not provided"}`);
      if (chosen.id==="custom") chosen.baseURL=(await ask("  Base URL: ")).trim();
      if (!chosen.baseURL) { console.log("  Provider has no compatible API URL. Choose another or use Custom."); continue; }
      let key=config.provider===chosen.id?config.apiKey:"";
      if (!["ollama","lmstudio"].includes(chosen.id) && !key) key=await ask("  API key: ");
      const model=await selectModel(chosen,key,config.provider===chosen.id?config.model:"");
      if (!model) { console.log("  No model selected."); continue; }
      config.provider=chosen.id; config.providerName=chosen.name; config.baseURL=chosen.baseURL;
      config.apiKey=key; config.model=model; config.favorites=[...favorites];
      await save(config);
      console.log(`  Saved provider: ${chosen.name} · ${model}`);
      return chosen;
    }
    console.log("  Unknown option. Use a listed number or command.");
  }
}
function mutedText(s) { return s.length>58 ? s.slice(0,55)+"..." : s; }

async function request(config, messages, tools) {
  const base = (config.baseURL || "").replace(/\/+$/, "");
  if (!base) throw new Error("Provider base URL is missing. Open /providers to configure it.");
  if (!config.apiKey && !["ollama","lmstudio"].includes(config.provider)) throw new Error("API key is missing. Open /providers to configure it.");
  const headers = { "content-type":"application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/XxDEMONxX-lab/realxxdemonxx-agent";
    headers["X-Title"] = "REALXXDEMONXX AGENT";
  }
  const body = { model:config.model, messages, temperature:0.2, stream:false };
  if (tools?.length) body.tools = tools;
  const response = await fetch(base+"/chat/completions", {
    method:"POST", headers, body:JSON.stringify(body), signal:AbortSignal.timeout(120000)
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error(`Provider returned invalid JSON (HTTP ${response.status}): ${raw.slice(0,700)}`); }
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || raw;
    const err = new Error(`Provider HTTP ${response.status}: ${String(detail).slice(0,1000)}`);
    err.status = response.status; throw err;
  }
  return data;
}
export async function chatCompletion(config,messages,tools) {
  try { return await request(config,messages,tools); }
  catch(e) {
    const unsupported=/tool|function|unsupported parameter|does not support/i.test(String(e.message||"")) && [400,404,422].includes(e.status);
    if (!unsupported || !tools?.length) throw e;
    console.log("\n  Provider rejected tool calling; retrying as chat-only.");
    return request(config,messages,[]);
  }
}
