import net from "node:net";
import {lookup} from "node:dns/promises";

export function validatePublicUrl(value){
 let url;try{url=new URL(value);}catch{throw new Error("Enter a valid http(s) URL.");}
 if(!["http:","https:"].includes(url.protocol))throw new Error("Only http and https URLs are allowed.");
 if(url.username||url.password)throw new Error("URLs containing embedded credentials are blocked.");
 const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,"");
 if(!host||host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal"))throw new Error("Local and private network hosts are blocked.");
 if(net.isIP(host)&&isPrivateAddress(host))throw new Error("Private IP addresses are blocked.");
 return url;
}

function isPrivateAddress(address){
 const version=net.isIP(address);
 if(version===4){
  const p=address.split(".").map(Number);
  return p[0]===0||p[0]===10||p[0]===127||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&(p[1]===0||p[1]===168))||(p[0]===169&&p[1]===254)||(p[0]===100&&p[1]>=64&&p[1]<=127)||(p[0]===198&&(p[1]===18||p[1]===19))||p[0]>=224;
 }
 if(version===6){
  const host=address.toLowerCase();
  if(host.startsWith("::ffff:"))return isPrivateAddress(host.slice(7));
  return host==="::"||host==="::1"||host.startsWith("fc")||host.startsWith("fd")||/^fe[89ab]/.test(host)||host.startsWith("ff");
 }
 return true;
}
async function assertPublicHost(url){
 if(net.isIP(url.hostname))return;
 const addresses=await lookup(url.hostname,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(item=>isPrivateAddress(item.address)))throw new Error("The destination resolves to a private or reserved IP address.");
}

async function fetchPage(value){
 let url=validatePublicUrl(value);
 for(let redirects=0;redirects<=4;redirects++){
  await assertPublicHost(url);
  const response=await fetch(url,{redirect:"manual",headers:{"user-agent":"REALXXDEMONXX-Agent/0.2","accept":"text/html,text/plain,application/json,application/xml;q=0.8"},signal:AbortSignal.timeout(15000)});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get("location");if(!location)throw new Error("Redirect destination missing.");
   url=validatePublicUrl(new URL(location,url).href);continue;
  }
  if(!response.ok)throw new Error("HTTP "+response.status+" while fetching "+url.hostname);
  const type=response.headers.get("content-type")||"";
  if(!/(text\/|application\/(json|xml|xhtml\+xml))/.test(type))throw new Error("Unsupported content type: "+type);
  const reader=response.body?.getReader();if(!reader)throw new Error("Empty response.");
  const chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>900000)throw new Error("Page exceeds 900 KB limit.");chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return {url:url.href,type,raw:new TextDecoder().decode(bytes)};
 }
 throw new Error("Too many redirects.");
}
function cleanHtml(value){
 return String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/[ \t]+/g," ").replace(/\n\s+/g,"\n").trim();
}
export async function researchUrl(url){
 const page=await fetchPage(url);
 return "URL: "+page.url+"\nContent type: "+page.type+"\n\n"+cleanHtml(page.raw).slice(0,24000);
}
export async function searchWeb(query){
 const q=String(query||"").trim();if(!q||q.length>300)throw new Error("Search query must be 1–300 characters.");
 const page=await fetchPage("https://html.duckduckgo.com/html/?q="+encodeURIComponent(q));
 const links=[...page.raw.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
 const results=links.slice(0,8).map(m=>({title:cleanHtml(m[2]),url:m[1].startsWith("//")?"https:"+m[1]:m[1]})).filter(x=>/^https?:\/\//i.test(x.url));
 return results.length?results.map((x,i)=>(i+1)+". "+x.title+"\n   "+x.url).join("\n\n"):"No search results could be parsed; try another query.";
}
