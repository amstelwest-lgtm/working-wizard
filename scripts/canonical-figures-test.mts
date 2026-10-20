/**
 * One figure for Home drafts, the scorecard, and the 13-week tab and PDF.
 * Run: pnpm test:canonical-figures
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectStoredFigures } from "../src/lib/agent-analyst.ts";
import { draftMetricUnit, polishAgentCopy } from "../src/lib/agent-bus.ts";
import {
  cashEmptyPresentation,
  cashForecastWeeksFromOutlook,
  forecastLinesBlank,
  forecastWeeksAreEntered,
} from "../src/lib/cash-forecast-parity.ts";
import { resolveCashScreenForecast } from "../src/lib/client-metrics.ts";
import { marketForClient } from "../src/lib/market/scope.ts";
import { findingCardCopy, formatFindingProse } from "../src/lib/milon-team-activity.ts";
import { implausibleSampleNote } from "../src/lib/operating-profit-display.ts";
import { presentHomeDraftTitle } from "../src/lib/owner-needs.ts";
import { scorecardRatiosFromFinancials } from "../src/lib/scorecard-rows.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const US = { currency: "USD" as const, locale: "en-US" };
const qaBooks = {
  revenue: 700000,
  cogs: 280000,
  fixedCosts: 351000,
  ebit: 60000,
  ebitda: 69000,
  netIncome: 60000,
  cash: 128450,
  periodMonths: 12,
};
const scorecard = scorecardRatiosFromFinancials(qaBooks);
assert(Math.round(scorecard["Operating Margin"] * 1000) === 86, "QA US scorecard operating margin is 8.6%");

assert(draftMetricUnit("health", 69) === "count", "health has no unit");
assert(draftMetricUnit("overall", 69) === "count", "overall health has no unit");
assert(draftMetricUnit("stored_score", 69) === "count", "stored score has no unit");
assert(draftMetricUnit("Debtor Days", 44) === "days", "debtor days use days");
assert(draftMetricUnit("Creditor Days", 73) === "days", "creditor days use days");
assert(draftMetricUnit("Working Capital Days", 69) === "days", "working capital days use days");
assert(draftMetricUnit("Gross Margin", 0.6) === "percent", "gross margin is a percent");
assert(draftMetricUnit("Operating Margin", 0.086) === "percent", "operating margin is a percent");

const conflated = formatFindingProse(
  "Stored health 69 days vs live 67. Creditor days of 73 days days.",
  [
    { key: "Working Capital Days", value: 69 },
    { key: "Creditor Days", value: 73 },
    { key: "overall", value: 69 },
    { key: "live_overall", value: 67 },
  ],
  US,
);
assert(conflated.includes("health 67"), conflated);
assert(!conflated.includes("69 vs"), conflated);
assert(!/\bstored\s+health\b/i.test(conflated), conflated);
assert(!conflated.includes("health 69 days"), conflated);
assert(conflated.includes("73 days") && !conflated.includes("days days"), conflated);

const stored = collectStoredFigures(
  {
    ratios: { "Operating Margin": 0.086, "Gross Margin": 0.6 },
    stored_ratios: { "Operating Margin": 0.16, "Gross Margin": 0.6 },
  },
  { snapshotId: "snap", periodLabel: "Sep 2026" },
);
assert(stored?.figures["Operating Margin"] === 0.086, "live scorecard ratios win over the snapshot");

const home = presentHomeDraftTitle("Operating margin of 16.0% needs a look.", scorecard);
assert(home.text.includes("8.6%") && !home.text.includes("16.0%"), home.text);
assert(home.stale === true, "a stored 16.0% draft is flagged stale");
const stamped = presentHomeDraftTitle("Sep 2026 operating margin of 16.0% needs a look.", scorecard);
assert(
  stamped.text.includes("Full year on file") && stamped.text.includes("8.6%") && !stamped.text.includes("Sep 2026"),
  stamped.text,
);
const fresh = presentHomeDraftTitle("Operating margin of 8.6% needs a look.", scorecard);
assert(fresh.stale === false, "a draft that already quotes 8.6% is not stale");

const card = findingCardCopy(
  {
    kind: "data_request_draft",
    title: "Send the September debtors age analysis.",
    detail: "Operating margin of 16.0% is on the stored snapshot.",
    evidence: {
      figures: { "Operating Margin": 0.16, "Gross Margin": 0.6, "Debtor Days": 43.8 },
    },
  },
  US,
  scorecard,
);
assert(card.context?.includes("8.6%") && !card.context.includes("16%"), card.context ?? "missing context");
assert(card.lead.includes("8.6%") || !card.lead.includes("16"), card.lead);

const garbledPeriod = formatFindingProse(
  "Books cover Jan 100% – Sep 30, 2026.",
  [{ key: "Gross Margin", value: 1 }],
  US,
);
assert(garbledPeriod.includes("Jan 1 – Sep 30, 2026"), garbledPeriod);
assert(!garbledPeriod.includes("100% –"), garbledPeriod);
const sameMonth = formatFindingProse(
  "The file is Sep 100%–21, 2026.",
  [{ key: "Gross Margin", value: 1 }],
  US,
);
assert(sameMonth.includes("Sep 1–21, 2026"), sameMonth);
assert(!sameMonth.includes("100%"), sameMonth);

const quoted = polishAgentCopy({
  text: "Operating margin of 16.0% and working capital days of 69.",
  role: "detail",
  figures: { "Operating Margin": 0.16, "Working Capital Days": 69 },
  canonicalRatios: scorecard,
});
assert(quoted.ok === true && quoted.text.includes("8.6%") && quoted.text.includes("69 days"), quoted.ok ? quoted.text : "refused");
assert(quoted.ok === true && !quoted.text.includes("days days"), "the scorecard quote does not double days");

const monday = new Date(2026, 9, 5);
const derived = resolveCashScreenForecast({
  financials: qaBooks,
  cashflow: { openingBalance: "128450", revenue: [], expenses: [] },
  now: monday,
});
assert(derived.source === "derived", `blank QA US lines derive a sketch (${derived.source})`);
assert(
  derived.inflow.some((n) => Math.round(n) === 58333),
  `the sketch still lands $58,333 (${derived.inflow.map((n) => Math.round(n)).join(",")})`,
);
assert(!forecastWeeksAreEntered(derived), "a P&L sketch is not an entered forecast");
const derivedWeeks = cashForecastWeeksFromOutlook(derived);
assert(derivedWeeks == null, "the 13-week PDF does not print the sketch");
const derivedLines = [...derived.lines.revenue, ...derived.lines.expenses];
assert(forecastLinesBlank(derivedLines), "derived line ids do not open the chart");
assert(
  !forecastLinesBlank(derivedLines, { includeDerived: true }),
  "the public sample preview still counts its labelled P&L lines",
);
assert(
  cashEmptyPresentation({ opening: derived.opening, linesBlank: forecastLinesBlank(derivedLines) }).showChart === false,
  "the tab chart stays empty when the only lines are derived",
);

const storedForecast = resolveCashScreenForecast({
  financials: qaBooks,
  cashflow: {
    startDate: "2026-10-05",
    openingBalance: "128450",
    revenue: [{ id: "sales", name: "Receipts", amount: "1000", frequency: "recurring-weekly", startWeek: 1 }],
    expenses: [{ id: "rent", name: "Rent", amount: "400", frequency: "recurring-weekly", startWeek: 1 }],
  },
  now: monday,
});
assert(forecastWeeksAreEntered(storedForecast), "an entered weekly line is the forecast");
const storedWeeks = cashForecastWeeksFromOutlook(storedForecast);
assert(storedWeeks != null && storedWeeks[0]?.total_receipts === Math.round(storedForecast.inflow[0] ?? -1), "tab and PDF share the entered receipts");
assert(
  cashEmptyPresentation({
    opening: 128450,
    linesBlank: forecastLinesBlank(storedForecast.source === "stored" ? [{ id: "sales", amount: "1000" }] : []),
  }).showChart === true,
  "an entered line opens the chart",
);

const usNote = implausibleSampleNote(marketForClient({ market: { country: "US", regionCode: "NY" } }));
const zaNote = implausibleSampleNote(marketForClient({ market: { country: "ZA", regionCode: "GP" } }));
assert(usNote.includes("dollars") && !usNote.toLowerCase().includes("rand"), usNote);
assert(zaNote.includes("rands"), zaNote);

const execute = readFileSync(resolve("supabase/functions/agent-analyst/execute.ts"), "utf8");
const ratiosBranch = execute.slice(execute.indexOf('if (tool === "get_ratios")'));
assert(ratiosBranch.includes('quote_basis: "scorecard"'), "get_ratios names the scorecard as the quote");
assert(ratiosBranch.includes("overviewRatios"), "get_ratios computes the live scorecard ratios");
assert(ratiosBranch.includes('from("clients")'), "get_ratios reads the live books");
assert(execute.includes("canonicalQuoteRatios"), "a new finding is saved against the scorecard ratios");
const draft = readFileSync(resolve("src/lib/agent-draft.ts"), "utf8");
assert(draft.includes("canonicalQuoteRatios"), "advisor and FM drafts save the scorecard ratios");
const report = readFileSync(resolve("src/routes/_authenticated/reports-studio.tsx"), "utf8");
const tab = readFileSync(resolve("src/components/cash-forecast.tsx"), "utf8");
assert(report.includes("cashForecastWeeksFromOutlook"), "the PDF uses the shared week gate");
assert(report.includes("resolveCashScreenForecast"), "the PDF reads the cash-tab forecast");
assert(tab.includes("forecastLinesBlank"), "the tab chart uses the same entered-line gate");
assert(tab.includes("forecastWeeksAreEntered"), "the tab does not paint a derived sketch");

console.log("canonical figures ok");
