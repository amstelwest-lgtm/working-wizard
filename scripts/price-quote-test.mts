/**
 * Approved price table and the quote API.
 * Run: pnpm test:price-quote
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { OWNER_LOOKUP_KEYS } from "../src/lib/owner-price.ts";
import { ownerAnnualCents } from "../src/lib/stripe-checkout.core.ts";
import {
  FIRM_BAND_CATALOG,
  FIRM_CHECKOUT_BANDS,
  firmLookupKey,
  firmUsdPublicLine,
  type FirmCheckoutBand,
} from "../src/lib/stripe-plans.ts";
import { quotePrice, resolveQuoteMarket } from "../src/lib/pricing/price-quote.server.ts";
import { APPROVED_PRICES, approvedPrice } from "../src/lib/pricing/price-table.server.ts";
import { withVisitorMarketHint } from "../src/lib/pricing/visitor-market-hint.ts";
import { zaLookupKey } from "../src/lib/pricing/za-lookup.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const MONTHLY_RANDS: Record<FirmCheckoutBand, number> = {
  starter: 299,
  solo: 799,
  small: 1199,
  growing: 1999,
  established: 2799,
  larger: 3999,
  advanced: 5299,
  scale: 7999,
};

for (const band of FIRM_CHECKOUT_BANDS) {
  const catalog = FIRM_BAND_CATALOG[band];
  const usdMonth = approvedPrice(band, "month", "USD");
  const usdYear = approvedPrice(band, "year", "USD");
  const zarMonth = approvedPrice(band, "month", "ZAR");
  const zarYear = approvedPrice(band, "year", "ZAR");
  assert(usdMonth?.lookupKey === firmLookupKey(band, "month"), `${band} USD monthly lookup key`);
  assert(usdYear?.lookupKey === firmLookupKey(band, "year"), `${band} USD annual lookup key`);
  assert(zarMonth?.lookupKey === zaLookupKey(band, "month"), `${band} ZAR monthly lookup key`);
  assert(zarYear?.lookupKey === zaLookupKey(band, "year"), `${band} ZAR annual lookup key`);
  assert(usdMonth?.unitAmount === catalog.monthlyUsdCents, `${band} USD monthly cents`);
  assert(usdYear?.unitAmount === catalog.yearlyUsdCents, `${band} USD annual cents`);
  assert(zarMonth?.unitAmount === MONTHLY_RANDS[band] * 100, `${band} approved monthly rand`);
  assert(usdMonth?.clientLimit === catalog.clientLimit, `${band} client cap`);
}

assert(approvedPrice("starter", "year", "ZAR")?.unitAmount === 283_700, "starter annual rand stays R2837");
assert(approvedPrice("owner", "month", "USD")?.unitAmount === 3_900, "owner monthly USD is 3900");
assert(approvedPrice("owner", "month", "ZAR")?.unitAmount === 29_900, "owner monthly ZAR is 29900");
assert(approvedPrice("owner", "month", "USD")?.lookupKey === OWNER_LOOKUP_KEYS.us.month, "owner USD monthly key");
assert(approvedPrice("owner", "year", "USD")?.lookupKey === OWNER_LOOKUP_KEYS.us.year, "owner USD annual key");
assert(approvedPrice("owner", "month", "ZAR")?.lookupKey === OWNER_LOOKUP_KEYS.za.month, "owner ZAR monthly key");
assert(approvedPrice("owner", "year", "ZAR")?.lookupKey === OWNER_LOOKUP_KEYS.za.year, "owner ZAR annual key");
assert(
  approvedPrice("owner", "year", "USD")?.unitAmount === ownerAnnualCents(3_900),
  "owner USD annual uses the existing rule",
);
assert(
  approvedPrice("owner", "year", "ZAR")?.unitAmount === ownerAnnualCents(29_900),
  "owner ZAR annual uses the existing rule",
);
assert(APPROVED_PRICES.length === FIRM_CHECKOUT_BANDS.length * 4 + 4, "firm currencies and the owner plan");
assert(new Set(APPROVED_PRICES.map((row) => row.lookupKey)).size === APPROVED_PRICES.length, "lookup keys are unique");

const zaVisitor = quotePrice({ market: "za", plan: "solo", interval: "month", surface: "visitor" });
const usVisitor = quotePrice({ market: "us", plan: "starter", interval: "month", surface: "visitor" });
assert(zaVisitor?.label === "R799/mo · about R53 per client", `ZA visitor solo label, saw ${zaVisitor?.label}`);
assert(zaVisitor?.currency === "ZAR" && zaVisitor.label.startsWith("R"), "a ZA visitor gets R");
assert(usVisitor?.currency === "USD" && usVisitor.label.startsWith("$"), "a US visitor gets $");
assert(usVisitor?.label === firmUsdPublicLine("starter", "month"), "US visitor Starter matches the catalog line");
assert(!zaVisitor?.label.toLowerCase().includes("vat"), "ZA labels have no VAT wording");
assert(!usVisitor?.label.toLowerCase().includes("vat"), "US labels have no VAT wording");

assert(
  quotePrice({ market: "za", plan: "starter", interval: "month", surface: "signup" })?.label === "R299/mo",
  "signup Starter is R299/mo without the per-client hint",
);
const usWall = quotePrice({ market: "us", plan: "starter", interval: "month", surface: "wall" });
assert(
  Boolean(usWall?.label) && usWall.label === usVisitor?.label,
  `the US wall uses the same server quote as the landing, saw ${usWall?.label}`,
);
assert(usWall.label.includes("per client"), "the US wall quote includes the per-client hint");
assert(usWall.label === firmUsdPublicLine("starter", "month"), "the US wall quote matches the landing catalog line");

assert(resolveQuoteMarket({ surface: "firm", storedMarket: null }) === "us", "a missing firm market is USD");
assert(resolveQuoteMarket({ surface: "firm", storedMarket: {} }) === "us", "a firm with no country is USD");
assert(
  resolveQuoteMarket({ surface: "firm", storedMarket: { currency: "ZAR" } }) === "us",
  "currency without a country is not a ZA firm",
);
assert(
  resolveQuoteMarket({ surface: "owner", storedMarket: {}, geoCountry: "ZA" }) === "za",
  "an owner with no stored country uses ZA geo",
);
assert(
  resolveQuoteMarket({ surface: "owner", storedMarket: { country: "  " }, geoCountry: "za" }) === "za",
  "a blank stored country falls through to geo",
);
assert(
  resolveQuoteMarket({ surface: "owner", storedMarket: { country: "GB" }, geoCountry: "ZA" }) === "us",
  "a stored non-ZA country wins over geo",
);

const staleUs = resolveQuoteMarket({
  surface: "visitor",
  geoCountry: "ZA",
  savedChoice: "US",
  choiceFromThisVisit: false,
});
assert(staleUs === "za", "a stale saved US choice does not override ZA geo");
assert(
  quotePrice({ market: staleUs, plan: "starter", interval: "month", surface: "signup" })?.currency === "ZAR",
  "that visitor is still quoted in rand",
);
const thisVisitUs = resolveQuoteMarket({
  surface: "visitor",
  geoCountry: "ZA",
  savedChoice: "US",
  choiceFromThisVisit: true,
});
assert(thisVisitUs === "us", "a this-visit US choice opts a ZA visitor out");
assert(
  quotePrice({ market: thisVisitUs, plan: "starter", interval: "month", surface: "visitor" })?.currency === "USD",
  "that this-visit choice is quoted in dollars",
);
const staleZa = resolveQuoteMarket({
  surface: "visitor",
  geoCountry: "US",
  savedChoice: "ZA",
  choiceFromThisVisit: false,
});
assert(staleZa === "us", "a stale saved ZA choice does not override US geo");

const hintedFirm = resolveQuoteMarket({
  surface: "checkout",
  storedMarket: { country: "ZA" },
  billingCountry: null,
  geoCountry: "US",
  savedChoice: "US",
  choiceFromThisVisit: true,
});
assert(hintedFirm === "za", "a ?market= hint does not override a stored ZA firm");
assert(
  quotePrice({ market: hintedFirm, plan: "starter", interval: "month", surface: "checkout" })?.currency === "ZAR",
  "the stored ZA firm stays on rand",
);
const hintedUsFirm = resolveQuoteMarket({
  surface: "wall",
  storedMarket: { country: "US" },
  billingCountry: null,
  geoCountry: "ZA",
  savedChoice: "ZA",
  choiceFromThisVisit: true,
});
assert(hintedUsFirm === "us", "a ?market= hint does not override a stored US firm");

const hinted = withVisitorMarketHint("/auth?signup=true&plan=starter", "za");
assert(hinted === "/auth?signup=true&plan=starter&market=ZA", `visitor hint, saw ${hinted}`);
assert(!hinted.includes("country="), "the hint is not a country override");
assert(
  withVisitorMarketHint("/?signup=owner#register", "US") === "/?signup=owner&market=US#register",
  "the owner CTA keeps its hash",
);
assert(!withVisitorMarketHint("/auth?signup=true&country=ZA", "US").includes("country="), "country is dropped");

const root = resolve(import.meta.dirname, "..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}
const clientLeaks = walk(resolve(root, "src")).filter((path) => {
  if (path.includes(".server.") || path.endsWith(".functions.ts")) return false;
  if (path.includes(`${join("src", "lib", "pricing")}`)) return false;
  const text = readFileSync(path, "utf8");
  return text.includes("price-quote.server") || text.includes("price-table.server");
});
assert(clientLeaks.length === 0, `client modules import the price table: ${clientLeaks.join(", ")}`);

const geo = readFileSync(resolve(root, "src/lib/geo-country.functions.ts"), "utf8");
assert(geo.includes(".toUpperCase()"), "the geo country is uppercased");
assert(!geo.includes('country === "za"'), "geo comparisons use the uppercased country");

const auth = readFileSync(resolve(root, "src/routes/auth.tsx"), "utf8");
const authSearch = readFileSync(resolve(root, "src/lib/auth-search.ts"), "utf8");
assert(auth.includes("parseAuthSearch"), "auth uses the shared search parser");
assert(authSearch.includes('marketRaw === "ZA"'), "auth keeps a ZA or US market hint");
assert(!auth.includes("search.country"), "auth does not accept a country override");
assert(!authSearch.includes("search.country"), "auth search does not accept a country override");

console.log("price-quote-test: ok");
