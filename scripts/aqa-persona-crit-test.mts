/**
 * CRIT + HIGH checks from the accountant persona walk.
 * Run: pnpm test:aqa-persona-crit
 */
import { readFileSync } from "node:fs";
import { periodProfitBridge } from "../src/lib/period-profit";
import { computeRatios } from "../src/lib/ratios";
import { stripMilonProjection } from "../src/lib/milon-projection";
import { groundInterventionStep, groundPlaybookSteps } from "../src/lib/intervention-grounding";
import { clientIndustryDisplay } from "../src/lib/profile-signals";
import { decideFirmClientCreate } from "../src/lib/firm-client-cap";
import { firmUsageLimit } from "../src/lib/firm-band-upgrade";
import { formatMoney } from "../src/lib/market/format";
import { ZA_MARKET } from "../src/lib/market";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const money = (amount: number) => formatMoney(amount, ZA_MARKET);

const thin = groundInterventionStep({
  ratioKey: "netMargin",
  ratioName: "Net Margin",
  tier: "critical",
  value: 0.022,
  formattedValue: "2.2%",
  title: "Identify whether loss is operating or financing driven",
  description: "If both are negative, you have a fundamental trading problem.",
  revenue: 1_200_000,
  netProfit: 26_400,
  formatMoney: money,
});
assert(thin.tier === "at_risk", `a 2.2% net margin is at risk, got ${thin.tier}`);
assert(thin.description.includes("2.2%"), thin.description);
assert(thin.description.includes(money(1_200_000)), thin.description);
assert(thin.description.includes(money(26_400)), thin.description);
assert(/that is a profit/i.test(thin.description), thin.description);
assert(!/insolvency|operating or financing/i.test(thin.description), thin.description);

const loss = groundInterventionStep({
  ratioKey: "net_margin",
  ratioName: "Net Margin",
  tier: "at_risk",
  value: -0.04,
  title: "Watch margin",
  description: "Compare operating margin to net margin.",
  revenue: 80_000,
  netProfit: -3_200,
  formatMoney: money,
});
assert(loss.tier === "critical", "a negative net margin stays critical");
assert(/loss/i.test(loss.description), loss.description);
assert(loss.description.includes(money(80_000)), loss.description);

const pack = groundPlaybookSteps(
  [
    {
      ratio_key: "netMargin",
      ratio_name: "Net Margin",
      health_tier: "critical",
      step_number: 1,
      step_title: "Identify whether loss is operating or financing driven",
      step_description: "Discretionary spending at a critical net margin accelerates insolvency.",
    },
    {
      ratio_key: "netMargin",
      ratio_name: "Net Margin",
      health_tier: "critical",
      step_number: 2,
      step_title: "Stop all cash outflows not essential to revenue generation",
      step_description: "Issue an immediate spending freeze.",
    },
  ],
  {
    ratioKey: "netMargin",
    ratioName: "Net Margin",
    tier: "critical",
    value: 0.022,
    revenue: 1_200_000,
    netProfit: 26_400,
    formatMoney: money,
  },
);
assert(pack.tier === "at_risk", "the plan drops the critical loss pack");
assert(pack.steps.length === 1, "one grounded step replaces the loss pack");
assert(pack.steps[0]?.step_number === 1, "sign-off still attaches to step 1");
assert(!/insolvency|spending freeze/i.test(pack.steps[0]?.step_description ?? ""), pack.steps[0]?.step_description ?? "");

const leaked =
  "Chase the overdue invoice @@milon-projection@@{\"cash\":44880} before Friday.";
assert(
  stripMilonProjection(leaked) === "Chase the overdue invoice before Friday.",
  stripMilonProjection(leaked),
);

assert(
  clientIndustryDisplay("Karoo Lodge", { templateId: "day_labour" }, null) === "Hotels & accommodation",
  "a hotel name is not labelled labour",
);
assert(
  clientIndustryDisplay("Cedar Woodwork", { templateId: "hospitality_rooms" }, null) === "Manufacturing",
  "a woodwork name is not labelled hotels",
);

const bridge = periodProfitBridge({ revenue: 100, cogs: -40, grossProfit: 60 });
assert(bridge.grossProfit === 60, `gross profit stays 60, got ${bridge.grossProfit}`);
assert(bridge.cogs === 40, `negative COGS is a cost of 40, got ${bridge.cogs}`);
const ratios = computeRatios({
  revenue: "100",
  cogs: "-40",
  netIncome: "22",
  ebit: "30",
  ebt: "25",
  periodMonths: "12",
});
assert(Math.abs((ratios["Gross Margin"] ?? 0) - 0.6) < 0.001, `analyst GM is 60%, got ${ratios["Gross Margin"]}`);

assert(firmUsageLimit("trialing", "starter", 0) === 5, "Starter trial usage limit is 5");
assert(firmUsageLimit("active", "starter", 0) === 5, "Starter usage limit is 5");
assert(firmUsageLimit("trialing", "solo") === 3, "Solo trial stays at 3");
assert(
  decideFirmClientCreate({
    stripeConfigured: true,
    phase: "trialing",
    band: "starter",
    clientCount: 4,
  }).allowed,
  "Starter trial allows the 5th client",
);

const app = readFileSync("src/routes/app.tsx", "utf8");
assert(app.includes('navigate({ to: "/practice" })'), "a firm session on /app opens /practice");
const menu = readFileSync("src/components/settings-menu.tsx", "utf8");
assert(menu.includes("My practice"), "the account menu includes My practice");

console.log("aqa-persona-crit ok");
