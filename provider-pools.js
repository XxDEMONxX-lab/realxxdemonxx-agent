"use strict";

function normalizeFreePool(models){
 if(!Array.isArray(models)||models.length<1||models.length>6)throw Error("A free-model pool must contain 1-6 model IDs");
 const result=[],seen=new Set();
 for(const value of models){
  if(typeof value!=="string"||!value.trim()||value.length>256||/[\u0000-\u001f\u007f\s]/.test(value))throw Error("Invalid free-model ID");
  const model=value.trim();
  if(seen.has(model))throw Error("Duplicate free-model ID: "+model);
  seen.add(model);result.push(model);
 }
 return result;
}

function buildProviderCandidates(provider,model,fallbacks,fallbackModels,pools,enabled=true){
 const providers=[provider,...(enabled&&Array.isArray(fallbacks)?fallbacks:[])],out=[],seen=new Set();
 for(const id of providers){
  const primary=id===provider?model:fallbackModels?.[id];
  const pool=Array.isArray(pools?.[id])?pools[id]:[];
  const models=id===provider?[primary,...pool]:(pool.length?pool:[primary]);
  const limit=id===provider?7:6;
  for(const candidate of [...new Set(models)].filter(x=>typeof x==="string"&&x.trim()).slice(0,limit)){
   const identity=id+"\u0000"+candidate;
   if(seen.has(identity))continue;
   seen.add(identity);out.push({id,model:candidate});
  }
 }
 return out;
}

function isRetryableProviderError(error){
 const message=String(error?.message||error||"");
 return /HTTP\s+(?:408|409|425|429|500|502|503|504)\b/i.test(message)||
  /request timeout|timed out|fetch failed|network error|ECONN(?:RESET|REFUSED|TIMEOUT)|EAI_AGAIN|socket hang up|temporarily unavailable|overloaded/i.test(message);
}

module.exports={normalizeFreePool,buildProviderCandidates,isRetryableProviderError};
