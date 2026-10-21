/**
 * The card is asked for after the first result. These promises must not return.
 * The US production build must not carry the Starter rand price. That price is
 * produced only by the ZA server chunk.
 * Run: pnpm test:trial-card-copy
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrecardCapCard } from "../src/components/precard-cap-card.tsx";
import { TrialCardSentence } from "../src/components/trial-card-sentence.tsx";
import { PRECARD_CAP_MESSAGE } from "../src/lib/precard-cap.ts";
import { CARD_FREE_TRIAL_LINE, FIRM_TRIAL_CARD_LINE } from "../src/lib/starter-trial-constants.ts";
import { starterMonthlyFromQuote } from "../src/lib/trial-card-price.ts";

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

assert(PRECARD_CAP_MESSAGE === CARD_FREE_TRIAL_LINE, "the cap card uses the card-free sentence");
assert(!PRECARD_CAP_MESSAGE.includes(FIRM_TRIAL_CARD_LINE), "the cap card does not use the Starter card line");
assert(starterMonthlyFromQuote({ market: "us", priceLabel: null }) === "$39/mo", "a US quote is $39/mo");
assert(
  starterMonthlyFromQuote({ market: "za", priceLabel: "R 299/mo · about R 60 per client" }) === "R 299/mo",
  "a ZA quote keeps the server's monthly rand label",
);
assert(starterMonthlyFromQuote(null) === "$39/mo", "an unknown quote stays on the USD catalog");

const capSrc = readFileSync(join(root, "src/components/precard-cap-card.tsx"), "utf8");
const healthSrc = readFileSync(join(root, "src/components/checkout-after-insight.tsx"), "utf8");
const widgetSrc = readFileSync(join(root, "src/lib/ask-ai.js"), "utf8");
for (const [path, text] of [
  ["src/components/precard-cap-card.tsx", capSrc],
  ["src/components/checkout-after-insight.tsx", healthSrc],
  ["src/lib/ask-ai.js", widgetSrc],
] as const) {
  assert(text.includes("TrialCardSentence") || text.includes("PRECARD_CAP_MESSAGE"), `${path} uses the trial sentence`);
  assert(!text.toLowerCase().includes("card is required at signup"), `${path} still promises a card at signup`);
  assert(!text.includes("R299") && !text.includes("R 299") && !text.includes("R\u00a0299"), `${path} hardcodes a rand price`);
}
assert(capSrc.includes("TrialCardSentence"), "the cap card renders the shared sentence");
assert(healthSrc.includes("TrialCardSentence"), "Health renders the shared sentence");
assert(widgetSrc.includes("oneCapCard"), "the Bot keeps one cap card in the thread");
assert(widgetSrc.includes("loadStarterMonthlyLabel"), "the Bot price comes from the firm quote");

function priceCount(html: string, price: string): number {
  return html.split(price).length - 1;
}
const usCard = renderToStaticMarkup(createElement(PrecardCapCard, { priceLabel: "$39/mo" }));
assert(usCard.includes(CARD_FREE_TRIAL_LINE), "the cap card shows the card-free sentence");
assert(!usCard.includes("on Starter"), "the cap card does not say on Starter");
assert(!usCard.toLowerCase().includes("vat"), "the cap card has no VAT wording");
assert(priceCount(usCard, "$39/mo") === 1, "the cap card shows the US price once");
assert(!usCard.includes("R 299") && !usCard.includes("R299"), "the US cap card has no rand price");
const zaSentence = renderToStaticMarkup(createElement(TrialCardSentence, { priceLabel: "R 299/mo" }));
assert(zaSentence.includes(CARD_FREE_TRIAL_LINE), "Health and the cap card share the card-free sentence");
assert(!zaSentence.includes("on Starter"), "the ZA sentence does not say on Starter");
assert(priceCount(zaSentence, "R 299/mo") === 1, "the ZA price is shown once");
assert(!zaSentence.includes("$39"), "the ZA sentence does not also show the dollar price");

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

/** "R299" inside a content hash (DR299tJa) is not the Starter price. */
function hasPriceSpelling(text: string, spelling: string): boolean {
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(spelling, from);
    if (at === -1) return false;
    from = at + spelling.length;
    if (spelling !== "R299") return true;
    const before = at > 0 ? text[at - 1] : "";
    const after = text[at + spelling.length] ?? "";
    if (!/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) return true;
  }
  return false;
}

function spellingHits(text: string): string[] {
  return RAND_SPELLINGS.filter((spelling) => hasPriceSpelling(text, spelling));
}
assert(!hasPriceSpelling("assets/ratio-queries-DR299tJa.js", "R299"), "a chunk hash is not the rand price");
assert(hasPriceSpelling("Then R299/mo.", "R299"), "a tight rand price is still a hit");
assert(hasPriceSpelling("Then R 299/mo.", "R 299"), "the spaced rand price is still a hit");

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
function hasPrice(text, spelling) {
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(spelling, from);
    if (at === -1) return false;
    from = at + spelling.length;
    if (spelling !== "R299") return true;
    const before = at > 0 ? text[at - 1] : "";
    const after = text[at + spelling.length] ?? "";
    if (!/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)) return true;
  }
  return false;
}
const report = [];
for (const path of routes) {
  const res = await handler.fetch(new Request("https://milonfinance.com" + path, {
    headers: { "x-vercel-ip-country": "US" },
  }));
  const html = await res.text();
  report.push({
    path,
    status: res.status,
    hits: needles.filter((needle) => hasPrice(html, needle)),
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
