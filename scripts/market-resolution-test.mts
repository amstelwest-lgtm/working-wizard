/**
 * One resolver per surface. ZA/US/unknown geo × ZA/US/null stored market ×
 * saved-choice mismatch, plus J1: ZA geo and a stale saved US stay on ZA prices.
 * Run: pnpm test:market-resolution
 */
import { readFileSync } from "node:fs";
import { entitlementFromStoredPlan } from "../src/lib/firm-billing-open.server";
import { firmSignupOwnerPayLine, firmSignupStarterMonthly } from "../src/lib/firm-signup-copy";
import {
  resolveCheckoutPriceMarket,
  resolveFirmBootMarket,
  resolveFirmMarket,
  resolveFirmPriceCurrency,
  resolveOwnerMarket,
  resolveVisitorDraft,
  resolveVisitorMarket,
  type SurfaceMarket,
} from "../src/lib/pricing/market-resolution";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const geos = ["ZA", "US", "GB", "", null, "za"] as const;
const choices = ["ZA", "US", null] as const;

for (const geo of geos) {
  for (const choice of choices) {
    for (const visit of [false, true]) {
      const market = resolveVisitorMarket({
        geoCountry: geo,
        savedChoice: choice,
        choiceFromThisVisit: visit,
      });
      const expected: SurfaceMarket = geo === "ZA" && !(visit && choice === "US") ? "za" : "us";
      assert(
        market === expected,
        `visitor geo=${String(geo)} choice=${String(choice)} visit=${visit} => ${market}, expected ${expected}`,
      );
    }
  }
}

const j1 = resolveVisitorDraft({
  geoCountry: "ZA",
  saved: { country: "US", regionCode: "NY" },
  choiceFromThisVisit: false,
});
assert(j1.country === "ZA", "J1: stale saved US does not override ZA geo");
const starter = firmSignupStarterMonthly(j1.country);
assert(starter !== "$39/mo" && !starter.startsWith("$"), `J1 signup price stays rand, saw ${starter}`);
const ownerLine = firmSignupOwnerPayLine(j1.country);
assert(!ownerLine.includes("$39"), `J1 owner signup line stays rand, saw ${ownerLine}`);

const auth = readFileSync("src/routes/auth.tsx", "utf8");
const signup = readFileSync("src/routes/index.tsx", "utf8");
assert(auth.includes("resolveVisitorDraft"), "/auth prices through the visitor resolver");
assert(signup.includes("resolveVisitorDraft"), "signup prices through the visitor resolver");
assert(!auth.includes("allowed.country"), "/auth does not apply a stale saved country over geo");

const opted = resolveVisitorDraft({
  geoCountry: "ZA",
  saved: { country: "US", regionCode: "CA" },
  choiceFromThisVisit: true,
});
assert(opted.country === "US" && opted.regionCode === "CA", "a this-visit US choice opts a ZA visitor out");

const staleZa = resolveVisitorDraft({
  geoCountry: "US",
  saved: { country: "ZA", regionCode: null },
  choiceFromThisVisit: false,
});
assert(staleZa.country === "US", "a stale saved ZA does not override US geo");

const storedCases: unknown[] = [
  { country: "ZA" },
  { country: "US", regionCode: "NY" },
  null,
  undefined,
  "za",
  { country: "za" },
  { country: "  za " },
  { currency: "ZAR" },
  { locale: "en-ZA" },
  { country: "US", currency: "ZAR", locale: "en-ZA" },
];
for (const stored of storedCases) {
  const market = resolveFirmMarket(stored);
  const country =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? String((stored as { country?: unknown }).country ?? "")
      : "";
  const expected: SurfaceMarket = country.trim().toUpperCase() === "ZA" ? "za" : "us";
  assert(market === expected, `firm ${JSON.stringify(stored)} => ${market}, expected ${expected}`);
}

for (const geo of ["ZA", "US", null, "GB", "za"] as const) {
  for (const stored of [null, { country: "ZA" }, { country: "US" }] as const) {
    const market = resolveOwnerMarket({ storedMarket: stored, geoCountry: geo });
    const expected: SurfaceMarket =
      stored == null ? (geo === "ZA" ? "za" : "us") : stored.country === "ZA" ? "za" : "us";
    assert(
      market === expected,
      `owner stored=${JSON.stringify(stored)} geo=${String(geo)} => ${market}, expected ${expected}`,
    );
  }
}

for (const firm of ["ZA", "US", null] as const) {
  for (const bill of ["ZA", "US", null, ""] as const) {
    for (const list of [false, true]) {
      const stored = firm ? { country: firm } : null;
      const price = resolveCheckoutPriceMarket({
        storedFirmMarket: stored,
        billingCountry: bill,
        practiceListZar: list,
      });
      const country = (bill ?? "").trim().toUpperCase();
      let expected: SurfaceMarket = "us";
      if (firm === "ZA") expected = country && country !== "ZA" ? "us" : "za";
      else if (list && country === "ZA") expected = "za";
      assert(
        price === expected,
        `checkout firm=${String(firm)} bill=${String(bill)} list=${list} => ${price}, expected ${expected}`,
      );
    }
  }
}

assert(resolveFirmBootMarket({ country: "ZA" }) === "za", "boot reads stored ZA");
assert(resolveFirmBootMarket({ country: "US" }) === "us", "boot reads stored US");
assert(resolveFirmBootMarket(null) === "unknown", "boot waits when the firm market has not loaded");
assert(resolveFirmBootMarket({ country: "za" }) === "unknown", "boot does not treat a loose country as a price");
assert(resolveFirmPriceCurrency({ country: "ZA" }) === "zar", "ZA firm price currency is zar");
assert(resolveFirmPriceCurrency(null) === "USD", "a missing firm price currency is USD");
assert(resolveFirmPriceCurrency({ country: "US" }) === "USD", "US firm price currency is USD");

const openFacts = {
  starterTrialEnforced: false,
  createdAt: null,
  trialClockStartOverride: null,
  clientCount: 0,
};
assert(
  entitlementFromStoredPlan("entitled", { ...openFacts, market: { country: "ZA" } }).plan?.priceCurrency ===
    "zar",
  "the open path uses the firm resolver for a ZA firm",
);
assert(
  entitlementFromStoredPlan("entitled", openFacts).plan?.priceCurrency === "USD",
  "the open path treats a missing market as not ZA",
);

console.log("market-resolution-test: ok");
