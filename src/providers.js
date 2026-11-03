import { ask, ESC } from "./ui.js";

export const PROVIDERS = [
  {id:"openrouter",name:"OpenRouter",baseURL:"https://openrouter.ai/api/v1"},
  {id:"openrouter-auto",name:"OpenRouter Auto",baseURL:"https://openrouter.ai/api/v1",fixedModel:"openrouter/auto"},
  {id:"groq",name:"Groq",baseURL:"https://api.groq.com/openai/v1"},
  {id:"nvidia",name:"NVIDIA NIM",baseURL:"https://integrate.api.nvidia.com/v1"},
  {id:"deepseek",name:"DeepSeek",baseURL:"https://api.deepseek.com"},
  {id:"mistral",name:"Mistral",baseURL:"https://api.mistral.ai/v1"},
  {id:"together",name:"Together AI",baseURL:"https://api.together.xyz/v1"},
  {id:"fireworks",name:"Fireworks AI",baseURL:"https://api.fireworks.ai/inference/v1"},
  {id:"cerebras",name:"Cerebras",baseURL:"https://api.cerebras.ai/v1"}
];

export function listProviders(config = {}) {
  console.log("\n  PROVIDER SELECT");
  console.log("  ─────────────────────────────────────────────");
  PROVIDERS.forEach((p,i) => {
    const active = p.id === config.provider ? "  [ACTIVE]" : "";
    console.log(`  ${i+1}. ${p.name}${active}`);
  });
  console.log("  0. Back");
}

async function fetchModels(provider, apiKey) {
  const headers = { authorization:`Bearer ${apiKey}` };
  const response = await fetch(provider.baseURL.replace(/\/+$/,"")+"/models", {
    headers, signal:AbortSignal.timeout(12000)
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Models endpoint returned HTTP ${response.status}: ${raw.slice(0,350)}`);
  const data = JSON.parse(raw);
  if (!Array.isArray(data.data)) throw new Error("Provider did not return a standard /models list.");
  return data.data.map(m=>({id:m.id,name:m.name || m.id})).filter(m=>m.id);
}

async function chooseModel(provider, apiKey, currentModel = "") {
  let models = [];
  try {
    console.log("\n  Fetching models from provider...");
    models = await fetchModels(provider,apiKey);
    console.log(`  ${models.length} models returned by ${provider.name}.`);
  } catch (e) {
    console.log(`  Model list unavailable: ${e.message}`);
  }

  while (true) {
    const query=(await ask("\n  Search model / enter exact model ID (or 'back'): ")).trim();
    if (!query) continue;
    if (query===ESC || query.toLowerCase()==="back") return null;
    if (query.toLowerCase()==="current" && currentModel) return currentModel;
    if (!models.length) return query;

    const matches=models.filter(m=>(m.id+" "+m.name).toLowerCase().includes(query.toLowerCase()));
    if (!matches.length) {
      const exact=(await ask("  No match. Use this exact model ID? (y/N): ")).trim().toLowerCase();
      if (exact==="y" || exact==="yes") return query;
      continue;
    }
    console.log("");
    matches.slice(0,25).forEach((m,i)=>console.log(`  ${i+1}. ${m.name===m.id?m.id:m.name+" ("+m.id+")"}`));
    if (matches.length>25) console.log(`  Showing 25 of ${matches.length}. Refine your search.`);
    const choice=(await ask("  Model number (or search again): ")).trim();
    if (/^\d+$/.test(choice) && Number(choice)>=1 && Number(choice)<=Math.min(25,matches.length)) return matches[Number(choice)-1].id;
    if (choice===ESC || choice.toLowerCase()==="back") return null;
    if (choice) {
      const exact=(await ask(`  Use "${choice}" as the exact model ID? (y/N): `)).trim().toLowerCase();
      if (exact==="y" || exact==="yes") return choice;
    }
  }
}

export async function configureProvider(config, save) {
  while (true) {
    listProviders(config);
    const value=(await ask("\n  Choose provider number: ")).trim();
    if (value===ESC || value==="0" || value.toLowerCase()==="back") return null;
    const provider=PROVIDERS[Number(value)-1];
    if (!provider) {
      console.log("  Invalid choice. Enter a number from 1 to 9.");
      continue;
    }
    console.log(`\n  Selected: ${provider.name}`);
    const sameOpenRouter=provider.id.startsWith("openrouter") && String(config.provider||"").startsWith("openrouter");
    let apiKey=(config.provider===provider.id || sameOpenRouter) ? config.apiKey : "";
    if (!apiKey) apiKey=(await ask("  API key: ")).trim();
    if (apiKey===ESC) return null;
    if (!apiKey) {
      console.log("  API key cannot be empty.");
      continue;
    }
    const model=provider.fixedModel || await chooseModel(provider,apiKey,config.provider===provider.id?config.model:"");
    if (!model) continue;
    config.provider=provider.id;
    config.providerName=provider.name;
    config.baseURL=provider.baseURL;
    config.apiKey=apiKey;
    config.model=model;
    await save(config);
    console.log(`\n  ✓ Saved ${provider.name} · ${model}`);
    return provider;
  }
}

export async function chooseCurrentModel(config,save) {
  const provider=PROVIDERS.find(p=>p.id===config.provider);
  if (!provider) throw new Error("Unknown provider. Use /providers to select one.");
  if (provider.fixedModel) {
    console.log("  OpenRouter Auto selects a model automatically; there is no model list to browse.");
    return null;
  }
  const model=await chooseModel(provider,config.apiKey,config.model);
  if (!model) return null;
  config.model=model;
  await save(config);
  return model;
}

async function requestCompletion(config,messages,tools,stream,onToken){
  if (!config.baseURL || !config.apiKey || !config.model) throw new Error("Provider setup is incomplete. Run /providers.");
  const headers={"content-type":"application/json",authorization:"Bearer "+config.apiKey};
  if(config.provider==="openrouter"||config.provider==="openrouter-auto"){
    headers["HTTP-Referer"]="https://github.com/XxDEMONxX-lab/realxxdemonxx-agent";
    headers["X-Title"]="REALXXDEMONXX AGENT";
  }
  const body={model:config.model,messages,temperature:0.2,stream,max_tokens:config.maxTokens||512};
  if(tools.length)body.tools=tools;
  const response=await fetch(config.baseURL.replace(/\\/+$/,"")+"/chat/completions",{
    method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(120000)
  });
  if(!response.ok){
    const raw=await response.text();
    let data={};try{data=JSON.parse(raw);}catch{}
    const detail=data?.error?.message||data?.message||raw;
    const error=new Error((config.providerName||config.provider)+" API error "+response.status+": "+String(detail).slice(0,900));
    error.status=response.status;
    throw error;
  }
  if(!stream){
    const raw=await response.text();
    try{return JSON.parse(raw);}catch{throw new Error("Provider returned invalid JSON: "+raw.slice(0,700));}
  }
  if(!response.body)throw new Error("Provider did not return a streaming response body.");
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let buffer="",content="",finishReason=null,usage=null;
  const calls=new Map();
  const processLine=line=>{
    if(!line.startsWith("data:"))return;
    const data=line.slice(5).trim();
    if(!data||data==="[DONE]")return;
    let packet;try{packet=JSON.parse(data);}catch{return;}
    if(packet.usage)usage=packet.usage;
    const choice=packet.choices?.[0];if(!choice)return;
    const delta=choice.delta||{};
    if(typeof delta.content==="string"){content+=delta.content;if(onToken)onToken(delta.content);}
    for(const part of delta.tool_calls||[]){
      const index=part.index??0;
      const old=calls.get(index)||{id:"",type:"function",function:{name:"",arguments:""}};
      if(part.id)old.id=part.id;
      if(part.type)old.type=part.type;
      if(part.function?.name)old.function.name+=part.function.name;
      if(part.function?.arguments)old.function.arguments+=part.function.arguments;
      calls.set(index,old);
    }
    if(choice.finish_reason)finishReason=choice.finish_reason;
  };
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      const lines=buffer.split(/\\r?\\n/);buffer=lines.pop()||"";
      for(const line of lines)processLine(line);
    }
    buffer+=decoder.decode();if(buffer)processLine(buffer);
  }finally{reader.releaseLock();}
  return {choices:[{message:{role:"assistant",content,tool_calls:[...calls.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1])},finish_reason:finishReason}],usage};
}

export async function chatCompletion(config,messages,tools=[],options={}){
  const models=[config.model,...(Array.isArray(config.fallbackModels)?config.fallbackModels:[])].filter((value,index,array)=>typeof value==="string"&&value.trim()&&array.indexOf(value)===index);
  let lastError;
  for(let modelIndex=0;modelIndex<models.length;modelIndex++){
    const model=models[modelIndex];
    for(let attempt=0;attempt<3;attempt++){
      try{
        const result=await requestCompletion({...config,model},messages,tools,typeof options.onToken==="function",options.onToken);
        if(modelIndex>0){
          config.model=model;
          if(options.onFallback)options.onFallback(model);
        }
        return result;
      }catch(error){
        lastError=error;
        const status=Number(error.status)||0;
        const retryable=!status||status===408||status===409||status===425||status===429||status>=500;
        const canTryNextModel=modelIndex<models.length-1&&(status===402||status===404||status===429||status>=500||!status);
        if(retryable&&attempt<2){
          const wait=700*(2**attempt);
          if(options.onRetry)options.onRetry(attempt+1,wait,error);
          await new Promise(resolve=>setTimeout(resolve,wait));
          continue;
        }
        if(canTryNextModel)break;
        throw error;
      }
    }
  }
  throw lastError||new Error("No available model configured.");
}
