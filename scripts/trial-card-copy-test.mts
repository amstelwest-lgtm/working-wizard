/**
 * The card is asked for after the first result. These promises must not return.
 * The US production build must not carry the Starter rand price. That price is
 * produced only by the ZA server chunk.
 * Run: pnpm test:trial-card-copy
 */
import { spawnSync } from "node:child_process";
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

/** Spaced, tight, and no-break-space spellings of the Starter rand price. */
const RAND_SPELLINGS = ["R 299", "R299", "R\u00a0299"] as const;

function filesUnder(dir: string, wanted: Set<string>): string[] {
  const out: string[] = [];
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) {
      out.push(...filesUnder(path, wanted));
      continue;
    }
    const dot = name.lastIndexOf(".");
    if (dot >= 0 && wanted.has(name.slice(dot))) out.push(path);
  }
  return out;
}

function spellingHits(text: string): string[] {
  return RAND_SPELLINGS.filter((spelling) => text.includes(spelling));
}

const build = spawnSync("pnpm", ["run", "build:vercel"], {
  cwd: root,
  encoding: "utf8",
  env: process.env,
  maxBuffer: 32 * 1024 * 1024,
});
assert(
  build.status === 0,
  `US build failed\n${`${build.stdout ?? ""}\n${build.stderr ?? ""}`.slice(-4000)}`,
);

const clientJs = filesUnder(join(root, "dist/client"), new Set([".js", ".mjs"]));
const clientHtmlFiles = filesUnder(join(root, "dist/client"), new Set([".html"]));
assert(clientJs.length > 0, "the US build produced a client JS bundle");
for (const path of [...clientJs, ...clientHtmlFiles]) {
  const found = spellingHits(readFileSync(path, "utf8"));
  assert(found.length === 0, `${relative(root, path)} contains ${found.join(", ")}`);
}

const serverJs = filesUnder(join(root, "dist/server"), new Set([".js", ".mjs"]));
const zaChunks = serverJs.filter((path) => path.includes("za-pricing-chunk.server"));
assert(zaChunks.length === 1, "the build emits one ZA pricing server chunk");
for (const path of serverJs) {
  if (zaChunks.includes(path)) continue;
  const found = spellingHits(readFileSync(path, "utf8"));
  assert(found.length === 0, `${relative(root, path)} contains ${found.join(", ")} outside the ZA server chunk`);
}

const usRoutes = ["/", "/for-accountants", "/for-owners", "/faq", "/about", "/try", "/privacy", "/terms"];
const rendered = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
import handler from "./dist/server/server.js";
const routes = ${JSON.stringify(usRoutes)};
const needles = ${JSON.stringify([...RAND_SPELLINGS])};
const report = [];
for (const path of routes) {
  const res = await handler.fetch(new Request("https://milonfinance.com" + path, {
    headers: { "x-vercel-ip-country": "US" },
  }));
  const html = await res.text();
  report.push({
    path,
    status: res.status,
    hits: needles.filter((needle) => html.includes(needle)),
    hasUsd: html.includes("$39"),
  });
}
console.log("US_HTML_REPORT " + JSON.stringify(report));
`,
  ],
  { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);
assert(rendered.status === 0, `US HTML render failed\n${rendered.stderr ?? ""}`);
const reportLine = rendered.stdout.split("\n").find((line) => line.startsWith("US_HTML_REPORT "));
assert(reportLine != null, "US HTML render did not report");
const pages = JSON.parse(reportLine.slice("US_HTML_REPORT ".length)) as Array<{
  path: string;
  status: number;
  hits: string[];
  hasUsd: boolean;
}>;
for (const page of pages) {
  assert(page.status === 200, `${page.path} did not render (${page.status})`);
  assert(page.hits.length === 0, `${page.path} US HTML contains ${page.hits.join(", ")}`);
}
assert(pages.some((page) => page.path === "/" && page.hasUsd), "the US homepage shows the dollar price");

const zaChunk = zaChunks[0]!;
const zaRendered = spawnSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `
import { loadSaPricingCopy } from ${JSON.stringify("./" + relative(root, zaChunk))};
const blob = JSON.stringify(loadSaPricingCopy());
console.log("ZA_CHUNK_REPORT " + JSON.stringify({
  spaced: blob.includes("R 299"),
  tight: blob.includes("R299"),
  nbsp: blob.includes("R\\u00a0299"),
}));
`,
  ],
  { cwd: root, encoding: "utf8" },
);
assert(zaRendered.status === 0, `ZA server chunk did not load\n${zaRendered.stderr ?? ""}`);
const zaLine = zaRendered.stdout.split("\n").find((line) => line.startsWith("ZA_CHUNK_REPORT "));
assert(zaLine != null, "ZA server chunk did not report");
const zaPrice = JSON.parse(zaLine.slice("ZA_CHUNK_REPORT ".length)) as {
  spaced: boolean;
  tight: boolean;
  nbsp: boolean;
};
assert(zaPrice.spaced, "the ZA server chunk is where R 299 is produced");
assert(!zaPrice.tight && !zaPrice.nbsp, "the ZA server chunk uses the spaced rand price");

console.log("trial-card-copy ok");
