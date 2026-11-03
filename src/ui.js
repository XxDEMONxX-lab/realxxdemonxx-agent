import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
export const ask = q => new Promise(resolve => rl.question(q, resolve));
export const say = s => console.log(s);
export const closeInput = () => rl.close();
export function banner() {
 console.log("\n  REALXXDEMONXX AGENT");
 console.log("  Termux-first autonomous coding assistant\n");
}