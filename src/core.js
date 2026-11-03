const ANSI=/\u001b\[[0-?]*[ -/]*[@-~]/g;

export function stripAnsi(value){
  return String(value??"").replace(ANSI,"");
}

export function clipAnsi(value,maxWidth){
  const limit=Math.max(0,Number(maxWidth)||0);
  const source=String(value??"").replace(/\r/g,"");
  const tokens=source.match(/\u001b\[[0-?]*[ -/]*[@-~]|[^\u001b]/gu)||[];
  let output="",visible=0,truncated=false;
  for(const token of tokens){
    if(token.startsWith("\u001b[")){output+=token;continue;}
    if(visible>=limit){truncated=true;break;}
    output+=token;visible++;
  }
  if(!truncated)return output;
  return output+"…"+(source.includes("\u001b[")?"\u001b[0m":"");
}

export function classifyCommand(command){
  const value=String(command??"").trim();
  if(!value)return "empty";
  const packageInstall=/(^|[;&|]\s*)(npm|pnpm|yarn|bun|pip|pip3|pkg|apt|apt-get)\s+(install|ci|add|i|update|uninstall|remove|upgrade|reinstall)\b/i.test(value);
  if(packageInstall)return "packageInstall";
  const destructive=/(^|[;&|]\s*)(sudo\s+)?(rm|rmdir|unlink|shred|truncate|mkfs(?:\.[\w-]+)?|dd|wipefs|fdisk|parted)\b/i.test(value)
    ||/\bfind\b[^;\n]*\s-delete\b/i.test(value)
    ||/\bsed\b[^;\n]*\s-i(?:\s|$)/i.test(value)
    ||/\bgit\s+(reset\s+--hard|clean\s+-[\w]*f|restore\s+--source|checkout\s+--)\b/i.test(value)
    ||/\b(>|>>|2>)\s*\/dev\/(sd[a-z]|nvme|mmcblk|zero|random)\b/i.test(value);
  return destructive?"destructive":"terminal";
}
