/**
 * After `pnpm run build:vercel`, fail if a US-reachable client asset
 * contains rand pricing copy. The allowlist is the isolated ZA chunk.
 *
 * Scanned: HTML, the client entry and its static imports (not import()),
 * plus index-*.js and onboarding-*.js and their static imports.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve("dist/client");
const needles = ["R799", "rand ", "ZAR", "South Africa", "South African", "50%"];
const allow = /za-pricing/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const files = walk(root);
const html = files.filter((path) => path.endsWith(".html"));
const js = files.filter((path) => path.endsWith(".js"));

function staticImports(code) {
  const specs = [];
  const re =
    /\b(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?["'](\.[^"']+)["']|^\s*import\s+["'](\.[^"']+)["']/gm;
  let match;
  while ((match = re.exec(code))) {
    const spec = match[1] || match[2];
    if (spec) specs.push(spec);
  }
  return specs;
}

function resolveSpec(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  if (js.includes(base)) return base;
  if (js.includes(`${base}.js`)) return `${base}.js`;
  return null;
}

const byName = new Map(js.map((path) => [path.split("/").pop(), path]));

function entryFromHtml(path) {
  const text = readFileSync(path, "utf8");
  const found = [];
  const re = /<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/g;
  let match;
  while ((match = re.exec(text))) {
    const src = match[1].split("?")[0].split("/").pop();
    const file = src ? byName.get(src) : null;
    if (file) found.push(file);
  }
  return found;
}

const seeds = new Set();
for (const path of html) {
  for (const entry of entryFromHtml(path)) seeds.add(entry);
}
for (const path of js) {
  const base = path.split("/").pop() ?? "";
  if (/^(index|onboarding)-/.test(base)) seeds.add(path);
}

const reachable = new Set();
const queue = [...seeds];
while (queue.length) {
  const path = queue.pop();
  if (!path || reachable.has(path)) continue;
  reachable.add(path);
  let code = "";
  try {
    code = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  for (const spec of staticImports(code)) {
    const next = resolveSpec(path, spec);
    if (next && !reachable.has(next)) queue.push(next);
  }
}

const scanned = [...html, ...reachable];
function cssPercent(text, at) {
  const before = text.slice(Math.max(0, at - 80), at);
  return /border-radius|borderRadius|radius|left:|top:|bottom:|right:|translate|gradient|mask|keyframes|rotate|ellipse|inset|margin|width:|height:|place-items|var\(--m|--mx|--my|style=\{|left-\[|top-\[|right-\[|bottom-\[|inset-\[|translate-/.test(
    before,
  );
}

/** "rand " is the currency word. A letter before it is a different word (brand). */
function randInsideWord(text, at) {
  if (at === 0) return false;
  return /[A-Za-z]/.test(text[at - 1]);
}

const hits = [];
for (const path of scanned) {
  if (allow.test(path)) continue;
  const text = readFileSync(path, "utf8");
  for (const needle of needles) {
    let from = 0;
    while (from < text.length) {
      const at = text.indexOf(needle, from);
      if (at === -1) break;
      from = at + needle.length;
      if (needle === "50%" && cssPercent(text, at)) continue;
      if (needle === "rand " && randInsideWord(text, at)) continue;
      const line = text.slice(0, at).split("\n").length;
      const excerpt = text.slice(Math.max(0, at - 40), at + needle.length + 40).replace(/\s+/g, " ");
      hits.push(`${path}:${line}: ${JSON.stringify(needle)} ${excerpt}`);
    }
  }
}

console.log(`za-bundle-leak: scanned ${scanned.length} assets (${reachable.size} js, ${html.length} html)`);
if (hits.length) {
  console.log(hits.join("\n"));
  console.error(`za-bundle-leak: ${hits.length} hit(s) outside /za-pricing/`);
  process.exit(1);
}
console.log("za-bundle-leak: no SA pricing strings in US-reachable assets");
