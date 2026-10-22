/**
 * AQA US 1020E: client home and the Analyst header say "Gross profit is $241,000"
 * (revenue 412,000 minus cost of sales 171,000, margin 58.5%). The Bot context
 * listed only the margin. Owner and accountant prompts, and the milon-bot
 * snapshot, quote that same dollar figure. A ZA March year quotes the
 * firm-year slice as R 187 444. A file with neither a stored gross profit nor
 * revenue and cost of sales still omits the line.
 *
 * Other side? ask-ai (owner and accountant audiences) and milon-bot both read
 * statementGrossProfit through the overview brief and the snapshot tool.
 *
 * Run: pnpm test:bot-gross-profit
 */
import { fiscalStatementSlice } from "../src/lib/budget-period.ts";
import { resolveMarket } from "../src/lib/market/resolve.ts";
import {
  ownerAnswerTiles,
  ownerHomeLines,
  type OwnerBooks,
} from "../src/lib/owner-answers.ts";
import { buildPrompt } from "../supabase/functions/ask-ai/prompt.ts";
import type { AskAiContext } from "../supabase/functions/ask-ai/types.ts";
import {
  buildOverviewBrief,
  formatOverviewForPrompt,
} from "../supabase/functions/ask-ai/overview-brief.ts";
import { shapeSnapshot } from "../supabase/functions/milon-bot/tools.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const NBSP = /\u00a0/g;
const plain = (s: string | undefined) => (s ?? "").replace(NBSP, " ");

/** 1020E / 1020F statement. Gross profit is not stored. */
const JAN_SEP: Record<string, string> = {
  revenue: "412000",
  cogs: "171000",
  fixedCosts: "189000",
  ebit: "52000",
  ebt: "48400",
  netIncome: "38200",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
  periodMonths: "9",
};

const US = resolveMarket({ country: "US", regionCode: "CA" });
const ZA = resolveMarket({ country: "ZA" });

function books(fin: Record<string, string>, market: typeof US, fy: number): OwnerBooks {
  const n = (k: string) => (fin[k] != null && fin[k] !== "" ? Number(fin[k]) : null);
  return {
    hasBooks: true,
    ledger: null,
    revenue: n("revenue"),
    priorRevenue: null,
    cogs: n("cogs"),
    priorCogs: null,
    grossProfit: n("grossProfit"),
    netIncome: n("netIncome"),
    operatingProfit: n("ebit"),
    profitPeriod: fiscalStatementSlice(fin, fy),
    receivables: null,
    cashflow: null,
    openAction: null,
    actionsReady: true,
    signedBy: null,
    signedOn: null,
    market,
  };
}

function analystLine(b: OwnerBooks): string {
  return plain(ownerHomeLines(ownerAnswerTiles(b), null).analyst[0]);
}

function ctx(overview: AskAiContext["overview"], copyPack: "za" | "us"): AskAiContext {
  return {
    profile: null,
    profileQuestions: [],
    scores: null,
    ratios: [],
    playbook: [],
    copyPack,
    waterfall: null,
    cashForecast: null,
    productLines: [],
    nextSteps: [],
    actionPlan: null,
    deliverables: [],
    overview,
  };
}

const usHome = analystLine(books(JAN_SEP, US, 1));
assert(usHome === "Gross profit is $241,000. Net profit is $38,200.", `US home: ${usHome}`);

const usBrief = buildOverviewBrief({
  financials: JAN_SEP,
  copyPack: "us",
  fyStartMonth: 1,
  clientName: "1020E",
});
assert(usBrief.grossProfit === 241_000, `US brief gross ${usBrief.grossProfit}`);
assert(
  usBrief.grossMargin != null && Math.abs(usBrief.grossMargin - 241_000 / 412_000) < 1e-9,
  `US margin ${usBrief.grossMargin}`,
);

const usOwner = formatOverviewForPrompt(usBrief, "owner");
const usAccountant = formatOverviewForPrompt(usBrief, "accountant");
for (const text of [usOwner, usAccountant]) {
  assert(text.includes("Gross profit: $241,000"), text);
  assert(text.includes("Gross margin: 58.5%"), text);
}
const usOwnerAsk = buildPrompt("What is gross profit?", ctx(usBrief, "us"), "full", "owner");
const usAccountantAsk = buildPrompt("What is gross profit?", ctx(usBrief, "us"), "full", "accountant");
assert(usOwnerAsk.user.includes("Gross profit: $241,000"), usOwnerAsk.user);
assert(usAccountantAsk.user.includes("Gross profit: $241,000"), usAccountantAsk.user);

const usSnap = shapeSnapshot({
  periodLabel: "Jan 1 – Sep 30, 2026",
  periodDate: "2026-09-30",
  ratios: {},
  financials: JAN_SEP,
  cashRunwayWeeks: null,
  fyStartMonth: 1,
});
const usTotals = usSnap.statement_totals as { grossProfit?: number };
assert(usTotals.grossProfit === 241_000, `US snapshot gross ${usTotals.grossProfit}`);

const zaHome = analystLine(books(JAN_SEP, ZA, 3));
assert(plain(zaHome).includes("Gross profit is R 187 444."), `ZA home: ${zaHome}`);

const zaBrief = buildOverviewBrief({
  financials: JAN_SEP,
  copyPack: "za",
  fyStartMonth: 3,
  clientName: "1020F",
});
const zaOwner = formatOverviewForPrompt(zaBrief, "owner");
const zaAccountant = formatOverviewForPrompt(zaBrief, "accountant");
for (const text of [zaOwner, zaAccountant]) {
  assert(text.includes("Gross profit: R 187 444"), text);
  assert(!text.includes("$241,000"), text);
}
const zaAsk = buildPrompt("What is gross profit?", ctx(zaBrief, "za"), "full", "accountant");
assert(zaAsk.user.includes("Gross profit: R 187 444"), zaAsk.user);
const zaSnap = shapeSnapshot({
  periodLabel: "1 Jan 2026 – 30 Sep 2026",
  periodDate: "2026-09-30",
  ratios: {},
  financials: JAN_SEP,
  cashRunwayWeeks: null,
  fyStartMonth: 3,
});
const zaTotals = zaSnap.statement_totals as { grossProfit?: number };
assert(
  zaTotals.grossProfit != null && Math.abs(zaTotals.grossProfit - (241_000 * 7) / 9) < 0.02,
  `ZA snapshot gross ${zaTotals.grossProfit}`,
);

const bare = buildOverviewBrief({
  financials: { revenue: "412000" },
  copyPack: "us",
  fyStartMonth: 1,
});
assert(bare.grossProfit == null, `blank cost invented gross ${bare.grossProfit}`);
assert(!formatOverviewForPrompt(bare, "owner").includes("Gross profit:"), "owner still omits an unavailable gross profit");
assert(
  !formatOverviewForPrompt(bare, "accountant").includes("Gross profit:"),
  "accountant still omits an unavailable gross profit",
);

const storedOnly = buildOverviewBrief({
  financials: { revenue: "412000", grossProfit: "241000" },
  copyPack: "us",
  fyStartMonth: 1,
});
assert(storedOnly.grossProfit === 241_000, `stored-only gross ${storedOnly.grossProfit}`);
assert(
  formatOverviewForPrompt(storedOnly, "owner").includes("Gross profit: $241,000"),
  "a stored gross profit with no cost of sales is still quoted",
);

console.log("bot-gross-profit: ok");
