import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DIR=path.join(os.homedir(),".realxxdemonxx-agent");
const FILE=path.join(DIR,"config.json");
const DEFAULTS={provider:"",providerName:"",baseURL:"",apiKey:"",model:"",fallbackModels:[],mcpServers:[],maxSteps:8,maxTokens:512,permissions:{mcpServers:false,network:false,readFiles:true,searchFiles:true,writeFiles:false,terminal:false,packageInstall:false,destructive:false,gitOperations:false,runTests:false}};

export async function loadConfig() {
  try {
    const parsed=JSON.parse(await fs.readFile(FILE,"utf8"));
    if (!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw new Error("Invalid config format");
    return {...DEFAULTS,...parsed,permissions:{...DEFAULTS.permissions,...(parsed.permissions||{})}};
  } catch (e) {
    if (e.code!=="ENOENT") console.error("Could not read saved settings:",e.message);
    return {...DEFAULTS,permissions:{...DEFAULTS.permissions}};
  }
}
export async function saveConfig(config) {
  await fs.mkdir(DIR,{recursive:true,mode:0o700});
  const safe={...config};
  await fs.writeFile(FILE,JSON.stringify(safe,null,2),{mode:0o600});
  try { await fs.chmod(FILE,0o600); } catch {}
}
export const configPath=FILE;
