/**
 * After `pnpm run build:vercel`, fail if a US-reachable client asset
 * contains rand pricing copy. The allowlist is the isolated ZA chunk.
 *
 * Scanned: HTML, the client entry and its static imports (not import()),
 * plus index-*.js and onboarding-*.js and their static imports.
 *
 * Matching reads file content. A hashed chunk name such as
 * billing.cancel-C9FUdZAR.js, or ZAR inside a hash segment, is not a price.
 */
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Tax Specialist is ZA-only on /talk. IRP6, ITR14, SARS, and eFiling stay
// out of the non-ZA talk path. The server prompt may still name them.
const needles = [
  "R799",
  "R299",
  "rand ",
  "ZAR",
  "South Africa",
  "South African",
  "50%",
  "ITR14",
  "IRP6",
];
const allow = /za-pricing/;

const talkNeedles = [
  "SARS",
  "IRP6",
  "ITR14",
  "eFiling",
  "e-filing",
  "efiling",
  "rand ",
  "ZAR",
  "VAT",
  "R799",
  "R299",
  "R 299",
  "R 799",
];

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

/** "R299" inside a content hash (DR299tJa) is not the Starter price. */
function randPriceToken(text, at, needle) {
  if (needle !== "R299") return true;
  const before = at > 0 ? text[at - 1] : "";
  const after = text[at + needle.length] ?? "";
  return !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after);
}

/**
 * "ZAR" inside a hashed chunk name (billing.cancel-C9FUdZAR.js) or a hash
 * segment (C9FUdZAR) is not the currency word. A bare ZAR token is.
 */
function zarInAssetNameOrHash(text, at) {
  const needle = "ZAR";
  let start = at;
  let end = at + needle.length;
  while (start > 0 && /[A-Za-z0-9._-]/.test(text[start - 1])) start -= 1;
  while (end < text.length && /[A-Za-z0-9._-]/.test(text[end])) end += 1;
  const token = text.slice(start, end);
  if (token === needle) return false;
  if (/\.(?:js|mjs|cjs|css|html|map)$/i.test(token)) return true;
  return token.length > needle.length && /\d/.test(token);
}

/**
 * Rand ladder amounts, in cents, from the approved price table.
 * Bare copies of these in a US chunk are prices even without an R.
 * Dollar catalog amounts are not in this list: the US bundle is allowed to show them.
 */
export const ZAR_LADDER_CENTS = new Set([
  29900, 283700, 287040, 79900, 766700, 119900, 1150700, 199900, 1918700, 279900, 2686700, 399900,
  3838700, 529900, 5086700, 799900, 7678700,
]);

function amountCents(intPart, frac) {
  const digits = intPart.replace(/[ \u00a0\u202f,]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const whole = Number(digits);
  if (!Number.isSafeInteger(whole)) return null;
  if (!frac) return whole * 100;
  const padded = `${frac}00`.slice(0, 2);
  return whole * 100 + Number(padded);
}

/** A hashed filename or identifier (C9FUd799, billing.cancel-C9FUd799.js) is not a price. */
function insideHashOrFilename(text, start, end) {
  let from = start;
  let to = end;
  while (from > 0 && /[A-Za-z0-9._-]/.test(text[from - 1])) from -= 1;
  while (to < text.length && /[A-Za-z0-9._-]/.test(text[to])) to += 1;
  return /[A-Za-z]/.test(text.slice(from, to));
}

function nearPriceContext(text, start, end) {
  const window = text.slice(Math.max(0, start - 24), Math.min(text.length, end + 24));
  return /\/(?:mo|month|yr|year)\b|\bprice\b|\bpriced\b/i.test(window);
}

/**
 * Bare ladder amounts near a price or /mo. `799`, `1 199`, and `7,999` count.
 * `R 187 444` does not: it is not a ladder amount. Digits inside a hash do not.
 */
export function bareLadderLeakHits(text) {
  const hits = [];
  const re = /(?<![A-Za-z0-9])(\d{1,3}(?:[ \u00a0\u202f,]\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)/g;
  let match;
  while ((match = re.exec(text))) {
    const cents = amountCents(match[1], match[2]);
    if (cents == null || !ZAR_LADDER_CENTS.has(cents)) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (insideHashOrFilename(text, start, end)) continue;
    if (!nearPriceContext(text, start, end)) continue;
    const line = text.slice(0, start).split("\n").length;
    const excerpt = text
      .slice(Math.max(0, start - 40), end + 40)
      .replace(/\s+/g, " ");
    hits.push({ needle: match[0], line, excerpt });
  }
  return hits;
}

function ignoreLeakHit(text, at, needle) {
  if (needle === "50%" && cssPercent(text, at)) return true;
  if (needle === "rand " && randInsideWord(text, at)) return true;
  if (!randPriceToken(text, at, needle)) return true;
  if (needle === "ZAR" && zarInAssetNameOrHash(text, at)) return true;
  return false;
}

/**
 * Content hits only. Asset file names and hash segments are not prices.
 * `caseFoldLower` matches the /talk scan, which folds needles that are
 * already lowercase (`efiling`, `rand `) and leaves `ZAR` exact.
 */
export function contentLeakHits(text, activeNeedles = needles, caseFoldLower = false) {
  const hits = [];
  for (const needle of activeNeedles) {
    const fold = caseFoldLower && needle === needle.toLowerCase();
    const haystack = fold ? text.toLowerCase() : text;
    const look = fold ? needle.toLowerCase() : needle;
    let from = 0;
    while (from < haystack.length) {
      const at = haystack.indexOf(look, from);
      if (at === -1) break;
      from = at + look.length;
      if (ignoreLeakHit(text, at, needle)) continue;
      const line = text.slice(0, at).split("\n").length;
      const excerpt = text
        .slice(Math.max(0, at - 40), at + needle.length + 40)
        .replace(/\s+/g, " ");
      hits.push({ needle, line, excerpt });
    }
  }
  return hits;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

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

function resolveSpec(js, fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  if (js.includes(base)) return base;
  if (js.includes(`${base}.js`)) return `${base}.js`;
  return null;
}

function entryFromHtml(byName, path) {
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

/**
 * Minified bundles omit the space after `import`, so the pricing walk
 * above does not follow them. Follow those imports only to prove the
 * tax chunk is not a static dependency of a US entry. Dynamic import()
 * is not a static dependency.
 */
function minifiedStaticImports(code) {
  const specs = [];
  const re = /\b(?:import|export)(?!\()(?:[\s\S]*?\bfrom\s*)?["'](\.[^"']+)["']/g;
  let match;
  while ((match = re.exec(code))) {
    if (match[1]) specs.push(match[1]);
  }
  return specs;
}

function runningAsScript() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

function main() {
  const root = resolve("dist/client");
  const files = walk(root);
  const html = files.filter((path) => path.endsWith(".html"));
  const js = files.filter((path) => path.endsWith(".js"));

  const byName = new Map(js.map((path) => [path.split("/").pop(), path]));

  const seeds = new Set();
  for (const path of html) {
    for (const entry of entryFromHtml(byName, path)) seeds.add(entry);
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
      const next = resolveSpec(js, path, spec);
      if (next && !reachable.has(next)) queue.push(next);
    }
  }

  const scanned = [...html, ...reachable];
  const hits = [];
  for (const path of scanned) {
    if (allow.test(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const hit of contentLeakHits(text)) {
      hits.push(`${path}:${hit.line}: ${JSON.stringify(hit.needle)} ${hit.excerpt}`);
    }
    for (const hit of bareLadderLeakHits(text)) {
      hits.push(`${path}:${hit.line}: bare ladder ${JSON.stringify(hit.needle)} ${hit.excerpt}`);
    }
  }

  console.log(
    `za-bundle-leak: scanned ${scanned.length} assets (${reachable.size} js, ${html.length} html)`,
  );
  if (hits.length) {
    console.log(hits.join("\n"));
    console.error(`za-bundle-leak: ${hits.length} hit(s) outside /za-pricing/`);
    process.exit(1);
  }

  const taxChunks = js.filter((path) =>
    (path.split("/").pop() ?? "").includes("za-tax-specialist"),
  );
  const taxNames = new Set(taxChunks.map((path) => path.split("/").pop()));
  const staticReach = new Set();
  const staticQueue = [...seeds];
  while (staticQueue.length) {
    const path = staticQueue.pop();
    if (!path || staticReach.has(path)) continue;
    staticReach.add(path);
    let code = "";
    try {
      code = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const spec of minifiedStaticImports(code)) {
      const next = resolveSpec(js, path, spec);
      if (next && !staticReach.has(next)) staticQueue.push(next);
    }
  }
  const taxReachable = taxChunks.filter((path) => reachable.has(path) || staticReach.has(path));
  const htmlTax = html.filter((path) => readFileSync(path, "utf8").includes("za-tax-specialist"));
  const entryStatic = [];
  for (const path of seeds) {
    let code = "";
    try {
      code = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const spec of minifiedStaticImports(code)) {
      const base = spec.split("/").pop() ?? "";
      if ([...taxNames].some((name) => name && base === name))
        entryStatic.push(`${path} -> ${spec}`);
    }
  }
  if (taxChunks.length === 0) {
    console.error("za-bundle-leak: expected a za-tax-specialist chunk");
    process.exit(1);
  }
  if (taxReachable.length || htmlTax.length || entryStatic.length) {
    console.error("za-bundle-leak: tax specialist chunk is US-reachable");
    console.error([...taxReachable, ...htmlTax, ...entryStatic].join("\n"));
    process.exit(1);
  }
  console.log(`za-bundle-leak: tax specialist chunk isolated (${taxChunks.length} file(s))`);

  /**
   * Non-ZA /talk ships in the route chunks that render data-talk-view.
   * Those chunks must not carry rand amounts or SARS terms. The ZA card
   * is a separate dynamic import and does not render that marker.
   */
  const talkHits = [];
  let talkChunks = 0;
  for (const path of js) {
    const base = path.split("/").pop() ?? "";
    const named =
      base.startsWith("talk.") || base.startsWith("prospect-talk-") || base.startsWith("talk-");
    const text = readFileSync(path, "utf8");
    if (!named && !text.includes("data-talk-view")) continue;
    talkChunks += 1;
    for (const hit of contentLeakHits(text, talkNeedles, true)) {
      talkHits.push(`${path}: ${JSON.stringify(hit.needle)} ${hit.excerpt}`);
    }
    for (const hit of bareLadderLeakHits(text)) {
      talkHits.push(`${path}: bare ladder ${JSON.stringify(hit.needle)} ${hit.excerpt}`);
    }
  }
  if (talkChunks === 0) {
    console.error("za-bundle-leak: expected a non-ZA /talk chunk");
    process.exit(1);
  }
  if (talkHits.length) {
    console.log(talkHits.join("\n"));
    console.error(
      `za-bundle-leak: ${talkHits.length} SARS or rand hit(s) on the non-ZA /talk path`,
    );
    process.exit(1);
  }
  console.log(`za-bundle-leak: non-ZA /talk path has no SARS terms (${talkChunks} chunk(s))`);
  console.log("za-bundle-leak: no SA pricing strings in US-reachable assets");
}

if (runningAsScript()) main();
