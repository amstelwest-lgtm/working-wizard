/**
 * Owner ratio money briefing — ZA rand vs US dollar, plus both click paths.
 * Run: pnpm test:ratio-briefing
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveMarket } from "../src/lib/market";
import { playbookKeyForRatioName, playbookKeyForUiKey } from "../src/lib/playbook-key";
import {
  relatedTabForRatio,
  ratioBriefingTitle,
  soWhatInMoney,
  type BriefingFigures,
} from "../src/lib/ratio-briefing";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const za = resolveMarket({ country: "ZA", regionCode: null });
const us = resolveMarket({ country: "US", regionCode: "TX" });

const n: BriefingFigures = {
  revenue: 3_650_000,
  cogs: 1_825_000,
  ebit: 400_000,
  receivables: 600_000,
  inventory: 250_000,
  payables: 150_000,
  currentAssets: 900_000,
  currentLiabilities: 200_000,
};

assert(playbookKeyForUiKey("debtorDays") === "debtorDays", "UI key debtorDays stays camelCase");
assert(playbookKeyForUiKey("inventoryDays") === "wipDays", "inventoryDays aliases to wipDays");
assert(
  playbookKeyForUiKey("workingCapitalDays") === "workingCapitalFunding",
  "workingCapitalDays aliases to workingCapitalFunding",
);
assert(playbookKeyForRatioName("debtorDays") === "debtordays", "display-name helper lowercases camelCase");
assert(playbookKeyForUiKey("debtorDays") === "debtorDays", "UI helper preserves camelCase for JSON packs");
assert(playbookKeyForUiKey("grossMargin") === "grossMargin", "grossMargin playbook key");

assert(relatedTabForRatio("debtorDays")?.tab === "cash", "debtor days jump to Cash");
assert(relatedTabForRatio("grossMargin")?.tab === "waterfall", "gross margin jumps to Profit");
assert(relatedTabForRatio("revenueGrowth")?.tab === "budget", "growth jumps to Budget");
assert(relatedTabForRatio("salesPerEmployee") === null, "unmapped ratios have no tab jump");

assert(ratioBriefingTitle() === "What this means in money", "title is money-terms, not a currency word");
assert(!/rand|dollar/i.test(ratioBriefingTitle()), "title does not name a currency");

const zaDebtor = soWhatInMoney({
  key: "debtorDays",
  value: 60,
  n,
  market: za,
  p50: 45,
});
assert(zaDebtor != null, "ZA debtor so-what");
assert(zaDebtor!.line.includes("R"), `ZA money uses R: ${zaDebtor!.line}`);
assert(!/rand/i.test(`${zaDebtor!.line} ${zaDebtor!.detail}`), "ZA so-what does not say rands");
assert(!zaDebtor!.line.includes("$"), "ZA debtor line has no $");
assert(!zaDebtor!.detail?.includes("$"), "ZA debtor detail has no $");

const usDebtor = soWhatInMoney({
  key: "debtorDays",
  value: 60,
  n,
  market: us,
  p50: 45,
});
assert(usDebtor != null, "US debtor so-what");
assert(usDebtor!.line.includes("$"), `US money uses $: ${usDebtor!.line}`);
assert(!/dollar/i.test(`${usDebtor!.line} ${usDebtor!.detail}`), "US so-what does not say dollars");
assert(!/rand/i.test(usDebtor!.line + usDebtor!.detail), "US debtor copy has no rand");
assert(!usDebtor!.line.includes("R\u00a0") && !usDebtor!.line.startsWith("R"), "US line is not rand-prefixed");

const zaMargin = soWhatInMoney({
  key: "grossMargin",
  value: 0.32,
  n,
  market: za,
  p50: 0.4,
  higherIsBetter: true,
});
assert(zaMargin?.kind === "profit-gap", `ZA margin gap: ${zaMargin?.kind}`);
assert(zaMargin!.detail?.includes("R") === true, `ZA margin money: ${zaMargin!.detail}`);

const usMargin = soWhatInMoney({
  key: "grossMargin",
  value: 0.32,
  n,
  market: us,
  p50: 0.4,
  higherIsBetter: true,
});
assert(usMargin?.kind === "profit-gap", "US margin gap");
assert(usMargin!.detail?.includes("$") === true, `US margin money: ${usMargin!.detail}`);
assert(!/rand/i.test(`${usMargin!.line} ${usMargin!.detail}`), "US margin has no rand");

const zaDol = soWhatInMoney({ key: "dol", value: 2.5, n, market: za });
assert(zaDol?.line.includes("R") === true, `ZA DOL uses R: ${zaDol?.line}`);
const usDol = soWhatInMoney({ key: "dol", value: 2.5, n, market: us });
assert(usDol?.line.includes("$") === true, `US DOL uses $: ${usDol?.line}`);
assert(!/rand|dollar/i.test(usDol!.detail ?? ""), `US DOL does not name a currency: ${usDol!.detail}`);

const lib = readFileSync(resolve("src/lib/ratio-briefing.ts"), "utf8");
assert(!lib.includes('"rand"'), "briefing lib does not hardcode rand");
assert(!lib.includes('"R"'), "briefing lib does not hardcode R");
assert(lib.includes("formatMoneyCompact"), "briefing uses market money formatter");
assert(!lib.includes("currencyWordPlural"), "briefing does not name rands/dollars in copy");
assert(!lib.includes("In your"), "briefing does not use In your {currency}");

const briefing = readFileSync(resolve("src/components/owner-ratio-briefing.tsx"), "utf8");
assert(briefing.includes("One move this week"), "briefing has one-move beat");
assert(briefing.includes("Ask your accountant"), "briefing has pin exit");
assert(briefing.includes("In money terms"), "so-what kicker is In money terms");
assert(!briefing.includes("In your"), "briefing UI does not say In your rands/dollars");
assert(briefing.includes("AddToPlanButton"), "briefing can add the move to the plan");
assert(briefing.includes("getPlaybookSteps"), "briefing loads the real playbook pack");
assert(!briefing.includes("Explanation Video"), "no video CTA in the owner briefing");

const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(app.includes("OwnerRatioBriefing"), "complex Health opens the money briefing");
assert(app.includes("onDriverClick"), "simplified orb drivers open the same briefing");
assert(!app.includes("openVideo"), "stale video dialog state is gone");
assert(!app.includes("Explanation Video"), "stale video CTA is gone");
assert(!app.includes("Video Coming Soon"), "placeholder video dialog is gone");

const hero = readFileSync(resolve("src/components/sphere-hero.tsx"), "utf8");
assert(hero.includes("onDriverClick"), "SphereHero accepts a driver click");
assert(hero.includes("open money briefing"), "driver rows are labelled as the briefing");

const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(!studio.includes("onDriverClick"), "accountant SphereHero does not open the owner briefing");
assert(!studio.includes("OwnerRatioBriefing"), "accountant board keeps PlaybookDrawer");

console.log("ratio-briefing-test: all assertions passed");
