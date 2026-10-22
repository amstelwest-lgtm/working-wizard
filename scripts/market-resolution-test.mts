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
  resolveStoredOwnerClientMarket,
  resolveVisitorDraft,
  resolveVisitorMarket,
  type SurfaceMarket,
} from "../src/lib/pricing/market-resolution";
import { googlePracticePickerDraft } from "../src/lib/google-practice-market";

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
      const zaGeo = (geo ?? "").trim().toUpperCase() === "ZA";
      const expected: SurfaceMarket = zaGeo && !(visit && choice === "US") ? "za" : "us";
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
    const zaGeo = (geo ?? "").trim().toUpperCase() === "ZA";
    const expected: SurfaceMarket =
      stored == null ? (zaGeo ? "za" : "us") : stored.country === "ZA" ? "za" : "us";
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
assert(resolveFirmBootMarket({ country: "za" }) === "za", "boot uppercases a stored za");
assert(resolveFirmBootMarket({ country: "  us " }) === "us", "boot trims a stored us");
assert(resolveFirmBootMarket({ country: "US" }) === "us", "boot reads stored US");
assert(resolveFirmBootMarket(null) === "unknown", "boot waits when the firm market has not loaded");
assert(resolveFirmBootMarket({ country: "GB" }) === "unknown", "boot waits on a country that is not ZA or US");
assert(resolveFirmBootMarket("ZA") === "unknown", "boot does not treat a bare string as a loaded market");
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

assert(resolveVisitorMarket({ geoCountry: " za " }) === "za", "visitor geo is trimmed and uppercased");
assert(
  resolveOwnerMarket({ storedMarket: null, geoCountry: " za " }) === "za",
  "owner geo is trimmed and uppercased",
);
assert(
  resolveOwnerMarket({ storedMarket: null, geoCountry: "us" }) === "us",
  "a lowercase us geo is not South Africa",
);

const usBusiness = { country: "US", regionCode: "NY" };
const zaBusiness = { country: "ZA", regionCode: null };
assert(
  resolveStoredOwnerClientMarket([{ market: zaBusiness }, { market: usBusiness }]) === usBusiness,
  "an explicit US business wins over a ZA business",
);
assert(
  resolveStoredOwnerClientMarket([{ market: zaBusiness }]) === zaBusiness,
  "ZA is the stored owner market only when every business is ZA",
);
assert(resolveStoredOwnerClientMarket([]) === null, "no explicit business leaves the owner market unset");

function googleSeed(
  geo: string,
  saved: { country: "ZA" | "US" | null; regionCode: "NY" | "CA" | null },
  visit: boolean,
) {
  return googlePracticePickerDraft({
    visitorDraft: saved,
    geoCountry: geo,
    choiceFromThisVisit: visit,
  });
}
assert(googleSeed("ZA", { country: "US", regionCode: "NY" }, false).country === "ZA", "stale US on ZA geo seeds ZA");
assert(googleSeed("US", { country: "ZA", regionCode: null }, false).country === "US", "stale ZA on US geo seeds US");
const thisVisit = googleSeed("ZA", { country: "US", regionCode: "CA" }, true);
assert(
  thisVisit.country === "US" && thisVisit.regionCode === "CA",
  "a this-visit US choice still wins on ZA geo",
);
assert(
  googlePracticePickerDraft({
    visitorDraft: { country: "US", regionCode: "NY" },
    geoCountry: "GB",
  }).country === null,
  "an unknown edge does not take a stale saved country",
);

const callback = readFileSync("src/routes/auth_.callback.tsx", "utf8");
assert(callback.includes("readVisitorChoice()"), "the Google doorway reads this-visit choice");
assert(callback.includes("googlePracticePickerDraft"), "the Google doorway seeds the picker");
assert(!callback.includes("readVisitorDraft()"), "the Google doorway does not pass a stale draft");
assert(readFileSync("src/lib/google-practice-market.ts", "utf8").includes("resolveVisitorDraft"), "the picker seed uses the visitor resolver");

console.log("market-resolution-test: ok");
