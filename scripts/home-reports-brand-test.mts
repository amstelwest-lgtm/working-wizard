/**
 * Home reports count, landing gold CTAs, and the marketing trial label.
 * Run: pnpm test:home-reports-brand
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reportInputsFromFinancials } from "../src/lib/equity-coherence";
import { FIRM_TRIAL_CTA_LABEL } from "../src/lib/firm-signup-copy";
import {
  REPORT_CATALOGUE_KEYS,
  reportReady,
  reportsAnswerSentence,
  reportsHomeReadyLine,
  reportsReadyCount,
} from "../src/lib/reports-drafter-copy";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const ready = { figuresOnFile: true, leverageReady: true, assetReady: true };
assert(reportsReadyCount(ready) === REPORT_CATALOGUE_KEYS.length, "every catalogue report counts");
assert(reportsReadyCount(ready) === 11, "the full catalogue is 11 reports");
assert(
  reportsReadyCount({ figuresOnFile: true, leverageReady: false, assetReady: false }) === 9,
  "leverage and assets drop out of the same count",
);
assert(reportsReadyCount({ ...ready, figuresOnFile: false }) === 0, "no figures means no ready reports");
assert(reportsHomeReadyLine(11) === "11 ready to send", "Home names the ready count");
assert(reportsHomeReadyLine(1) === "1 ready to send", "one report stays singular");
assert(reportsHomeReadyLine(0) === null, "zero ready reports has no count line");

const names = REPORT_CATALOGUE_KEYS.filter((key) =>
  reportReady(key, { leverageReady: true, assetReady: false }),
).map((key) => key);
const tab = reportsAnswerSentence({ readyNames: names, periodLabel: "October" });
assert(
  tab.startsWith(`${names.length} reports ready`),
  "the Reports tab uses the same ready count",
);
assert(
  reportsHomeReadyLine(names.length) === `${names.length} ready to send`,
  "Home wording uses that count",
);

const inputs = reportInputsFromFinancials({
  revenue: "100",
  cogs: "40",
  netIncome: "10",
  equity: "50",
  totalAssets: "80",
});
assert(inputs.leverageReady && inputs.assetReady, "complete figures make both optional reports ready");
assert(
  reportsReadyCount({
    figuresOnFile: true,
    leverageReady: inputs.leverageReady,
    assetReady: inputs.assetReady,
  }) === 11,
  "Home and the Reports tab share this readiness count",
);

const studio = read("src/routes/_authenticated/reports-studio.tsx");
for (const key of REPORT_CATALOGUE_KEYS) {
  assert(studio.includes(`key: "${key}"`), `Reports tab catalogue includes ${key}`);
}
assert(studio.includes("reportReady("), "the Reports tab filters with the shared ready check");

const home = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(home.includes("reportsHomeReadyLine"), "Home uses the shared reports line");
assert(home.includes("reportsReadyCount"), "Home uses the Reports tab count");
assert(!home.includes("Ready to send."), "Home no longer says Ready to send without a count");
assert(!home.includes("Nothing ready to send."), "a zero count does not invent a line");

const landing = read("src/routes/index.tsx");
const goldCtas = landing.match(/btn btn-gold/g) ?? [];
assert(goldCtas.length === 2, `landing keeps two gold CTAs, found ${goldCtas.length}`);
assert(landing.includes('className="btn btn-gold"'), "the hero trial button stays gold");
assert(landing.includes('className={trialBarOn ? "trial-sticky is-on" : "trial-sticky"}'), "the mobile bar is the sticky trial");
const sticky = landing.slice(landing.indexOf("trial-sticky"));
assert(sticky.includes('className="btn btn-gold"'), "the mobile sticky trial stays gold");
assert(landing.includes('className="btn btn-cobalt nav-trial"'), "the header trial button is cobalt");

const pricing = read("src/components/firm-band-pricing.tsx");
assert(!pricing.includes("btn btn-gold"), "Start Solo is not a gold CTA");
assert(
  pricing.includes('band.id === "solo" ? "btn btn-cobalt"'),
  "the pricing table Start Solo button is cobalt",
);
assert(pricing.includes('solo ? "btn btn-cobalt"'), "the pricing card Start Solo button is cobalt");

const marketingRoutes = [
  "src/routes/index.tsx",
  "src/routes/terms.tsx",
  "src/routes/privacy.tsx",
  "src/routes/about.tsx",
  "src/routes/faq.tsx",
  "src/routes/ai.tsx",
  "src/routes/for-accountants.tsx",
  "src/routes/for-owners.tsx",
  "src/components/marketing-shell.tsx",
];
for (const path of marketingRoutes) {
  assert(!read(path).includes("Start free"), `${path} does not say Start free`);
}
const terms = read("src/routes/terms.tsx");
const privacy = read("src/routes/privacy.tsx");
assert(terms.includes("MarketingShell"), "terms uses the marketing nav");
assert(privacy.includes("MarketingShell"), "privacy uses the marketing nav");
assert(terms.includes("navCtaLabel={FIRM_TRIAL_CTA_LABEL}"), "terms uses the landing trial CTA");
assert(privacy.includes("navCtaLabel={FIRM_TRIAL_CTA_LABEL}"), "privacy uses the landing trial CTA");
assert(FIRM_TRIAL_CTA_LABEL === "Start 14-day trial", "the shared CTA is Start 14-day trial");
const shell = read("src/components/marketing-shell.tsx");
assert(shell.includes("navCtaLabel = FIRM_TRIAL_CTA_LABEL"), "other marketing pages default to the same CTA");

console.log("home-reports-brand: ok");
