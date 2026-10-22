/**
 * Fail when a price literal shows up in src outside the quote module and tests.
 * Amounts are the approved table (rands, dollars, and the annual forms).
 * Run: pnpm test:price-literal
 *
 * A currency mark or a /mo /yr suffix is required, so a bare 39 in unrelated
 * code is not a price. `R 187 444` is not an approved amount and stays allowed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { APPROVED_PRICES } from "../src/lib/pricing/price-table.server.ts";
import { ZAR_LADDER_CENTS, bareLadderLeakHits } from "./za-bundle-leak.mjs";

const ROOT = resolve(import.meta.dirname, "..");

/** The quote API and the price table. The only production allowlist. */
const QUOTE_MODULE = [
  "src/lib/pricing/price-table.server.ts",
  "src/lib/pricing/price-quote.server.ts",
];

const APPROVED_CENTS = new Set(APPROVED_PRICES.map((row) => row.unitAmount));

export type PriceLiteralHit = {
  index: number;
  line: number;
  raw: string;
  excerpt: string;
};

function amountCents(intPart: string, frac: string | undefined): number | null {
  const digits = intPart.replace(/[ \u00a0\u202f,]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const whole = Number(digits);
  if (!Number.isSafeInteger(whole)) return null;
  if (!frac) return whole * 100;
  return whole * 100 + Number(`${frac}00`.slice(0, 2));
}

/** Currency-marked amounts, and bare amounts with /mo or /yr. */
export function findPriceLiterals(text: string): PriceLiteralHit[] {
  const hits: PriceLiteralHit[] = [];
  const re =
    /(?<![A-Za-z0-9])(?:(ZAR|R|\$)\s*)?(\d{1,3}(?:[ \u00a0\u202f,]\d{3})+|\d+)(?:\.(\d{1,2}))?(?!\d)(\s*\/\s*(?:mo|month|yr|year)\b)?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const currency = match[1];
    const suffix = match[4];
    if (!currency && !suffix) continue;
    const cents = amountCents(match[2], match[3]);
    if (cents == null || !APPROVED_CENTS.has(cents)) continue;
    const index = match.index;
    const line = text.slice(0, index).split("\n").length;
    const excerpt = text.slice(Math.max(0, index - 30), index + match[0].length + 30).replace(/\s+/g, " ");
    hits.push({ index, line, raw: match[0], excerpt });
  }
  return hits;
}

/** Quote module, plus test files. Nothing else in src. */
export function isPriceLiteralAllowlisted(path: string): boolean {
  const norm = path.replace(/\\/g, "/");
  if (QUOTE_MODULE.some((file) => norm === file || norm.endsWith(`/${file}`))) return true;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(norm)) return true;
  if (norm.includes("/__tests__/")) return true;
  return false;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(?:[cm]?[jt]sx?)$/.test(name)) out.push(path);
  }
  return out;
}

export function scanPriceLiterals(root = ROOT): Array<PriceLiteralHit & { path: string }> {
  const hits = [];
  for (const path of walk(join(root, "src"))) {
    const rel = relative(root, path).replace(/\\/g, "/");
    if (isPriceLiteralAllowlisted(rel)) continue;
    const text = readFileSync(path, "utf8");
    for (const hit of findPriceLiterals(text)) hits.push({ ...hit, path: rel });
  }
  return hits;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function prove() {
  const plantedR = `export function Card(){ return <p>R799</p> }\n`;
  const plantedBare = `export function Card(){ return <p>1,999/mo</p> }\n`;
  const rHits = findPriceLiterals(plantedR);
  const bareHits = findPriceLiterals(plantedBare);
  assert(rHits.length === 1 && rHits[0].raw.includes("R799"), "a planted R799 in a component fails");
  assert(bareHits.length === 1 && bareHits[0].raw.includes("1,999/mo"), "a planted 1,999/mo in a component fails");
  assert(!isPriceLiteralAllowlisted("src/components/Planted.tsx"), "a component is not allowlisted");

  for (const file of QUOTE_MODULE) {
    assert(isPriceLiteralAllowlisted(file), `${file} is the quote module`);
    const text = readFileSync(join(ROOT, file), "utf8");
    assert(text.length > 0, `${file} is readable`);
  }
  const quoteText = readFileSync(join(ROOT, "src/lib/pricing/price-quote.server.ts"), "utf8");
  assert(findPriceLiterals(quoteText).length > 0, "the quote module still contains its own examples");
  const scanned = scanPriceLiterals(ROOT);
  assert(
    scanned.every((hit) => !QUOTE_MODULE.some((file) => hit.path === file)),
    "the quote module passes the guard",
  );

  const bot = "Write amounts as R 187 444: a space after R, a space as the thousands separator.";
  assert(findPriceLiterals(bot).length === 0, "R 187 444 is not a price literal");
  assert(bareLadderLeakHits(bot).length === 0, "the bundle scan leaves R 187 444 alone");
  const prompt = readFileSync(join(ROOT, "src/lib/prompt-money.ts"), "utf8");
  assert(findPriceLiterals(prompt).length === 0, "prompt money keeps R 187 444");
  assert(prompt.includes("R 187 444"), "the bot amount is still in the prompt");

  const zarFromTable = new Set(
    APPROVED_PRICES.filter((row) => row.currency === "ZAR").map((row) => row.unitAmount),
  );
  assert(zarFromTable.size === ZAR_LADDER_CENTS.size, "bundle ladder list matches the table size");
  for (const cents of zarFromTable) {
    assert(ZAR_LADDER_CENTS.has(cents), `bundle ladder list is missing ${cents} cents`);
  }
}

function main() {
  prove();
  const hits = scanPriceLiterals(ROOT);
  if (hits.length) {
    for (const hit of hits) {
      console.error(`${hit.path}:${hit.line}: ${JSON.stringify(hit.raw)} ${hit.excerpt}`);
    }
    console.error(`price-literal-guard: ${hits.length} price literal(s) outside the quote module`);
    process.exit(1);
  }
  console.log("price-literal-guard: ok");
}

main();
