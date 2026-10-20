/**
 * The card is asked for after the first result. These promises must not return.
 * Run: pnpm test:trial-card-copy
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = resolve(import.meta.dirname, "..");
const banned = ["card is required at signup", "bills automatically"];
const skipDirs = new Set([
  "node_modules",
  "dist",
  ".git",
  "coverage",
  ".vercel",
  "playwright-report",
]);
const exts = new Set([".ts", ".tsx", ".mts", ".js", ".jsx", ".md"]);

function walk(dir: string, hits: string[]) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const path = join(dir, name);
    if (name === "trial-card-copy-test.mts") continue;
    const info = statSync(path);
    if (info.isDirectory()) {
      walk(path, hits);
      continue;
    }
    const dot = name.lastIndexOf(".");
    if (dot < 0 || !exts.has(name.slice(dot))) continue;
    const text = readFileSync(path, "utf8").toLowerCase();
    for (const phrase of banned) {
      if (text.includes(phrase)) hits.push(`${relative(root, path)}: ${phrase}`);
    }
  }
}

const hits: string[] = [];
walk(root, hits);
assert(hits.length === 0, `banned trial copy came back:\n${hits.join("\n")}`);
console.log("trial-card-copy ok");
