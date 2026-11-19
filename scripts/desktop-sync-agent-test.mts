/**
 * Desktop agent packaging smoke test (no network).
 * Run: pnpm test:desktop-sync-agent
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const readme = readFileSync(resolve("desktop-sync/README.md"), "utf8");
assert(readme.includes("keytar"), "keychain documented");
assert(readme.includes("Tauri"), "tray packaging proposal");
assert(readme.includes("APPLE_"), "signing env names");

const cli = readFileSync(resolve("desktop-sync/src/cli.ts"), "utf8");
assert(cli.includes("uninstall"), "uninstall command");

const pkg = JSON.parse(readFileSync(resolve("desktop-sync/package.json"), "utf8"));
assert(pkg.private === true, "agent package private");
console.log("desktop-sync-agent packaging ok");