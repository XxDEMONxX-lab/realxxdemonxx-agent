"use strict";

const MAX_EVENT=1024*1024;

function emitText(value,onToken,state){
 if(typeof value!=="string"||!value)return;
 state.text+=value;
 if(state.text.length>2_000_000)throw Error("Streaming response exceeded 2MB");
 onToken(value);
}

function parseSSE(buffer,handler){
 let boundary;
 while((boundary=buffer.search(/\r?\n\r?\n/))>=0){
  const frame=buffer.slice(0,boundary);
  const sep=/\r?\n\r?\n/.exec(buffer.slice(boundary))[0];
  buffer=buffer.slice(boundary+sep.length);
  const data=frame.split(/\r?\n/).filter(x=>x.startsWith("data:")).map(x=>x.slice(5).replace(/^ /,"")).join("\n");
  if(data)handler(data);
 }
 return buffer;
}

async function readSSE(response,kind,onToken,state){
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let buffer="",finished=false;
 const handle=data=>{
  if(data==="[DONE]"){finished=true;return;}
  let event;try{event=JSON.parse(data);}catch{return;}
  if(kind==="openai"){
   const delta=event.choices?.[0]?.delta?.content;
   if(typeof delta==="string")emitText(delta,onToken,state);
   else if(Array.isArray(delta))for(const part of delta)emitText(part?.text,onToken,state);
  }else if(kind==="anthropic"){
   if(event.type==="content_block_delta")emitText(event.delta?.text,onToken,state);
  }else if(kind==="gemini"){
   const parts=event.candidates?.[0]?.content?.parts||[];
   for(const part of parts)emitText(part.text,onToken,state);
  }
 };
 try{
  while(!finished){
   const {value,done}=await reader.read();if(done)break;
   buffer+=decoder.decode(value,{stream:true});
   if(buffer.length>MAX_EVENT)throw Error("Streaming event exceeds 1MiB");
   buffer=parseSSE(buffer,handle);
  }
  buffer+=decoder.decode();
  if(buffer.trim())parseSSE(buffer+"\n\n",handle);
 }finally{try{await reader.cancel();}catch{}try{reader.releaseLock();}catch{}}
}

async function readOllama(response,onToken,state){
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";
 try{
  while(true){
   const {value,done}=await reader.read();if(done)break;
   buffer+=decoder.decode(value,{stream:true});
   if(buffer.length>MAX_EVENT)throw Error("Streaming event exceeds 1MiB");
   let index;
   while((index=buffer.indexOf("\n"))>=0){
    const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);
    if(!line)continue;
    let item;try{item=JSON.parse(line);}catch{throw Error("Invalid Ollama streaming JSON");}
    emitText(item.message?.content,onToken,state);
    if(item.error)throw Error(String(item.error));
    if(item.done) return;
   }
  }
  buffer+=decoder.decode();
  if(buffer.trim()){
   const item=JSON.parse(buffer);emitText(item.message?.content,onToken,state);
   if(item.error)throw Error(String(item.error));
  }
 }finally{try{await reader.cancel();}catch{}try{reader.releaseLock();}catch{}}
}

async function streamCompletion(provider,apiKey,model,messages,onToken){
 if(!provider||!["openai","anthropic","gemini","ollama"].includes(provider.kind))throw Error("Unsupported streaming provider");
 if(provider.kind!=="ollama"&&!apiKey)throw Error("API key missing");
 if(typeof onToken!=="function")throw Error("A streaming callback is required");
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000);
 const state={text:""};
 let url,headers={"content-type":"application/json"},body;
 if(provider.kind==="openai"){
  url=provider.url+"/chat/completions";headers.Authorization="Bearer "+apiKey;headers.Accept="text/event-stream";
  body={model,messages,temperature:.2,stream:true};
 }else if(provider.kind==="anthropic"){
  url=provider.url+"/messages";headers["x-api-key"]=apiKey;headers["anthropic-version"]="2023-06-01";headers.Accept="text/event-stream";
  const system=messages.filter(x=>x.role==="system").map(x=>x.content).join("\n");
  body={model,max_tokens:4096,system,messages:messages.filter(x=>x.role!=="system"),temperature:.2,stream:true};
 }else if(provider.kind==="gemini"){
  url=provider.url+"/models/"+encodeURIComponent(model)+":streamGenerateContent?alt=sse&key="+encodeURIComponent(apiKey);
  headers.Accept="text/event-stream";
  const system=messages.filter(x=>x.role==="system").map(x=>x.content).join("\n");
  const contents=messages.filter(x=>x.role!=="system").map(x=>({role:x.role==="assistant"?"model":"user",parts:[{text:x.content}]}));
  body={contents,systemInstruction:{parts:[{text:system}]},generationConfig:{temperature:.2}};
 }else{
  url=provider.url+"/chat";body={model,messages,stream:true};
 }
 try{
  const response=await fetch(url,{method:"POST",headers,body:JSON.stringify(body),signal:controller.signal});
  if(!response.ok){const detail=await response.text();throw Error("HTTP "+response.status+": "+detail.slice(0,500));}
  if(!response.body)throw Error("Streaming response body unavailable");
  if(provider.kind==="ollama")await readOllama(response,onToken,state);
  else await readSSE(response,provider.kind,onToken,state);
  if(!state.text)throw Error("Streaming provider returned no text");
  return state.text;
 }catch(error){
  if(error.name==="AbortError")throw Error("Streaming request timed out");
  throw error;
 }finally{clearTimeout(timer);}
}

module.exports={streamCompletion,parseSSE};
