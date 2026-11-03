import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const DIR = path.join(os.homedir(), ".realxxdemonxx-agent");
const FILE = path.join(DIR, "config.json");
export async function loadConfig() {
  try { return JSON.parse(await fs.readFile(FILE, "utf8")); }
  catch { return { provider: "", baseURL: "", apiKey: "", model: "", maxSteps: 8 }; }
}
export async function saveConfig(config) {
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  try { await fs.chmod(FILE, 0o600); } catch {}
}
export const configPath = FILE;