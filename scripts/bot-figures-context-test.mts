/**
 * Bot stored-figures context: inventory days match Overview, and a
 * year-to-date period is named on the revenue line.
 *
 * Run: pnpm test:bot-figures-context
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { overviewRatios } from "../src/lib/health-score.ts";
import { periodMonthsOf } from "../src/lib/ratios.ts";
import { figuresPeriodLabelFrom, storedYearToDateEnd } from "../src/lib/statement-period.ts";
import { buildPrompt } from "../supabase/functions/ask-ai/prompt.ts";
import type { AskAiContext } from "../supabase/functions/ask-ai/types.ts";
import {
  buildOverviewBrief,
  formatOverviewForPrompt,
} from "../supabase/functions/ask-ai/overview-brief.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ytdFinancials = {
  revenue: "450000",
  cogs: "90000",
  inventory: "15453",
  receivables: "20000",
  payables: "15000",
  currentAssets: "80000",
  currentLiabilities: "40000",
  periodMonths: "9",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
  statementSource: "upload",
};

const deskRatios = overviewRatios(ytdFinancials, {
  fyStartMonth: 1,
  periodMonths: periodMonthsOf(ytdFinancials),
});
assert(deskRatios["Inventory Days"] === 47, `Overview inventory days 47, got ${deskRatios["Inventory Days"]}`);
assert(Number.isFinite(deskRatios["Debtor Days"]), "Overview has debtor days");
assert(Number.isFinite(deskRatios["Creditor Days"]), "Overview has creditor days");
assert(Number.isFinite(deskRatios["Working Capital Days"]), "Overview has working capital days");

const brief = buildOverviewBrief({
  financials: ytdFinancials,
  copyPack: "us",
  fyStartMonth: 1,
  clientName: "Inventory Days Co",
  periodLabel: "Sep 2026",
});

assert(brief.inventory === 15453, `stored inventory ${brief.inventory}`);
assert(
  brief.inventoryDays === deskRatios["Inventory Days"],
  `brief inventory days ${brief.inventoryDays} must match Overview`,
);
assert(brief.debtorDays === deskRatios["Debtor Days"], "debtor days match Overview");
assert(brief.creditorDays === deskRatios["Creditor Days"], "creditor days match Overview");
assert(
  brief.workingCapitalDays === deskRatios["Working Capital Days"],
  "working capital days match Overview",
);
assert(brief.currentRatio === 2, `current ratio ${brief.currentRatio}`);
assert(
  brief.periodLabel === "1 Jan 2026 – 30 Sep 2026",
  `dated statement label wins, got ${brief.periodLabel}`,
);
assert(
  brief.periodLabel === figuresPeriodLabelFrom(ytdFinancials, "Sep 2026"),
  "brief uses the Overview period helper",
);
assert(brief.periodStart === "2026-01-01" && brief.periodEnd === "2026-09-30", "ISO range is stored");
assert(brief.figuresSource === "uploaded statement", `source ${brief.figuresSource}`);
assert(brief.yearToDateEnd === "30 Sep 2026", `ytd end ${brief.yearToDateEnd}`);

const prompt = formatOverviewForPrompt(brief, "accountant");
assert(prompt.includes("Inventory: $15,453 (stored balance)"), prompt);
assert(
  prompt.includes("Inventory days: 47 days (period 1 Jan 2026 – 30 Sep 2026, uploaded statement)"),
  prompt,
);
assert(prompt.includes(`Debtor days: ${Math.round(deskRatios["Debtor Days"])} days`), prompt);
assert(prompt.includes(`Creditor days: ${Math.round(deskRatios["Creditor Days"])} days`), prompt);
assert(prompt.includes(`Working Capital Days: ${Math.round(deskRatios["Working Capital Days"])} days`), prompt);
assert(prompt.includes("Current Ratio: 2.00×"), prompt);
assert(prompt.includes("Figures period: 1 Jan 2026 – 30 Sep 2026 (2026-01-01 to 2026-09-30)"), prompt);
assert(prompt.includes("Figures source: uploaded statement"), prompt);
assert(prompt.includes("Revenue for the period on file: $450,000 (year to date to 30 Sep 2026)"), prompt);
assert(
  prompt.includes(
    'The stored period is year to date. When asked for revenue YTD, answer with the revenue figure above and say "year to date to 30 Sep 2026".',
  ),
  prompt,
);
assert(prompt.includes("Do not say the inventory balance is not stored"), prompt);
assert(prompt.includes("Do not say that no year-to-date split is stored."), prompt);
assert(prompt.includes("do not recalculate the days with a different formula"), prompt);

const month = buildOverviewBrief({
  financials: {
    ...ytdFinancials,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
    periodMonths: "1",
  },
  copyPack: "us",
  fyStartMonth: 1,
});
const monthPrompt = formatOverviewForPrompt(month, "accountant");
assert(month.yearToDateEnd == null, "a single September is not year to date");
assert(!monthPrompt.includes("year to date to"), monthPrompt);
assert(month.inventoryDays === overviewRatios(
  { ...ytdFinancials, periodStart: "2026-09-01", periodEnd: "2026-09-30", periodMonths: "1" },
  { fyStartMonth: 1, periodMonths: 1 },
)["Inventory Days"], "one-month inventory days still match Overview");

const fullYear = buildOverviewBrief({
  financials: {
    ...ytdFinancials,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    periodMonths: "12",
  },
  copyPack: "us",
  fyStartMonth: 1,
});
assert(fullYear.yearToDateEnd == null, "a finished calendar year is not year to date");
assert(!formatOverviewForPrompt(fullYear, "owner").includes("year to date to"), "full year omits the YTD phrase");

assert(storedYearToDateEnd(ytdFinancials, 1) === "30 Sep 2026", "January open is year to date");
assert(
  storedYearToDateEnd(
    { periodStart: "2026-03-01", periodEnd: "2026-09-30" },
    3,
  ) === "30 Sep 2026",
  "a financial year that opens in March is year to date",
);
assert(
  storedYearToDateEnd({ periodStart: "2026-09-01", periodEnd: "2026-09-30" }, 1) == null,
  "September alone is not year to date",
);
assert(
  storedYearToDateEnd({ periodStart: "2026-01-01", periodEnd: "2026-12-31" }, 1) == null,
  "1 Jan–31 Dec is a complete year",
);
assert(
  storedYearToDateEnd(
    {
      periodStart: "2026-04-01",
      periodEnd: "2026-09-30",
      ytdBasis: "calendar",
      ytdPeriodStart: "2026-04-01",
      ytdPeriodEnd: "2026-09-30",
    },
    1,
  ) === "30 Sep 2026",
  "an explicit year-to-date companion still names the end date",
);
assert(figuresPeriodLabelFrom({}, "Q3 2026") === "Q3 2026", "snapshot label is the fallback");
assert(
  figuresPeriodLabelFrom(ytdFinancials, "Q3 2026") === "1 Jan 2026 – 30 Sep 2026",
  "statement dates replace the snapshot label",
);

const ctx: AskAiContext = {
  profile: null,
  profileQuestions: [],
  scores: null,
  ratios: [],
  playbook: [],
  copyPack: "us",
  waterfall: null,
  cashForecast: null,
  productLines: [],
  nextSteps: [],
  actionPlan: null,
  deliverables: [],
  overview: brief,
  clientName: null,
};
const asked = buildPrompt("What are inventory days?", ctx, "focused", "accountant");
assert(asked.user.includes("Inventory days: 47 days"), asked.user);
assert(asked.user.includes("year to date to 30 Sep 2026"), asked.user);
const ytdAsk = buildPrompt("Revenue YTD?", ctx, "focused", "accountant");
assert(ytdAsk.user.includes('say "year to date to 30 Sep 2026"'), ytdAsk.user);
assert(ytdAsk.system.includes("year to date to <end date>"), ytdAsk.system);

const askSystem = readFileSync(resolve("supabase/functions/ask-ai/prompt.ts"), "utf8");
const botSystem = readFileSync(resolve("supabase/functions/milon-bot/logic.ts"), "utf8");
assert(askSystem.includes("year to date to <end date>"), "ask-ai tells the model to use the period phrase");
assert(botSystem.includes("year to date to <end date>"), "milon-bot tells the model to use the period phrase");
assert(askSystem.includes("inventory days"), "ask-ai names inventory days");
assert(botSystem.includes("Do not say the inventory balance is not stored"), "milon-bot quotes the stored balance");
assert(!askSystem.includes("Dana") && !botSystem.includes("Dana"), "no Dana in the bot copy");
assert(!/claude/i.test(askSystem) && !/claude/i.test(botSystem), "no model-vendor branding");
