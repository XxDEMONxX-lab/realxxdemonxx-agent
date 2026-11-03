import net from "node:net";

function validatePublicUrl(value){
 let url;
 try{url=new URL(value);}catch{throw new Error("Enter a valid http(s) URL.");}
 if(!["http:","https:"].includes(url.protocol))throw new Error("Only http and https URLs are allowed.");
 const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,"");
 if(!host||host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal"))throw new Error("Local and private network hosts are blocked.");
 if(net.isIP(host)){
  const parts=host.split(".").map(Number);
  const private4=host==="0.0.0.0"||host.startsWith("10.")||host.startsWith("127.")||host.startsWith("192.168.")||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||host.startsWith("169.254.");
  const private6=host==="::"||host==="::1"||host.startsWith("fc")||host.startsWith("fd")||host.startsWith("fe80");
  if(private4||private6)throw new Error("Private IP addresses are blocked.");
 }
 return url;
}

async function fetchText(urlValue){
 let url=validatePublicUrl(urlValue);
 for(let redirects=0;redirects<=4;redirects++){
  const response=await fetch(url,{redirect:"manual",headers:{"user-agent":"REALXXDEMONXX-Agent/0.2 (+https://github.com/XxDEMONxX-lab/realxxdemonxx-agent)","accept":"text/html,text/plain,application/json,application/xml;q=0.8"},signal:AbortSignal.timeout(15000)});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get("location");if(!location)throw new Error("Redirect did not include a destination.");
   url=validatePublicUrl(new URL(location,url).href);continue;
  }
  if(!response.ok)throw new Error("HTTP "+response.status+" while fetching "+url.hostname);
  const type=response.headers.get("content-type")||"";
  if(!/(text\/|application\/(json|xml|xhtml\+xml))/.test(type))throw new Error("Unsupported response content type: "+type);
  const reader=response.body?.getReader();if(!reader)throw new Error("Empty response body.");
  const chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>900000)throw new Error("Page exceeds 900 KB limit.");chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let text=new TextDecoder().decode(bytes);
  text=text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/[ \t]+/g," ").replace(/\n\s+/g,"\n");
  return {url:url.href,title:response.headers.get("content-type")||type,text:text.slice(0,24000)};
 }
 throw new Error("Too many redirects.");
}

export async function researchUrl(url){return await fetchText(url);}
export async function searchWeb(query){
 const q=String(query||"").trim();if(!q||q.length>300)throw new Error("Search query must be 1–300 characters.");
 const url="https://html.duckduckgo.com/html/?q="+encodeURIComponent(q);
 const result=await fetchText(url);
 const html=result.text;
 const links=[...html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
 const clean=value=>String(value).replace(/<[^>]*>/g,"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim();
 const results=links.slice(0,8).map(match=>({title:clean(match[2]),url:match[1].startsWith("//")?"https:"+match[1]:match[1]})).filter(item=>/^https?:\/\//i.test(item.url));
 if(!results.length)return "Search returned no parseable results. Try a different query or open a known URL.";
 return results.map((item,index)=>(index+1)+". "+item.title+"\n   "+item.url).join("\n\n");
}
