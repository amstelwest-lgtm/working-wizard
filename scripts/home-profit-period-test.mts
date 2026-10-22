/**
 * Gate 1022 J4 ZA: the Home Analyst card quoted the full Jan–Sep statement
 * (R 241 000 / R 38 200) while the Waterfall and Budget quoted the March-year
 * slice (R 187 444 / R 29 711). Every clipped surface now quotes the same
 * slice and the same pro-rated label. An unclipped period is unchanged.
 *
 * Other side? Owner (`app.tsx` → `owner-door.tsx`) and accountant
 * (`clients.$clientId.tsx`) Home both pass the Waterfall's slice as
 * `profitPeriod`. The cash interest line (`cash-forecast.tsx`) uses the
 * same clip.
 *
 * Run: pnpm test:home-profit-period
 */
import { readFileSync } from "node:fs";
import {
  budgetHeadlineFigures,
  fiscalStatementSlice,
  fiscalWaterfallFallback,
} from "../src/lib/budget-period";
import { periodProfitBridge } from "../src/lib/period-profit";
import { interestOfRevenueSentence } from "../src/lib/cash-interest-note";
import {
  ownerAmount,
  ownerAnswerTiles,
  ownerCardStatuses,
  ownerHomeLines,
  type OwnerBooks,
} from "../src/lib/owner-answers";
import { resolveMarket, type ResolvedMarket } from "../src/lib/market";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const ZA = resolveMarket({ country: "ZA" });
const US = resolveMarket({ country: "US", regionCode: "CA" });
const NBSP = /\u00a0/g;
const plain = (s: string | undefined) => (s ?? "").replace(NBSP, " ");

/** The AQA J2 1020E/1020F statement: 1 Jan – 30 Sep 2026, nine months. */
const JAN_SEP: Record<string, string> = {
  revenue: "412000",
  cogs: "171000",
  fixedCosts: "189000",
  ebitda: "59500",
  ebit: "52000",
  ebt: "48400",
  netIncome: "38200",
  periodStart: "2026-01-01",
  periodEnd: "2026-09-30",
  periodMonths: "9",
};
const LABEL = "Mar\u2013Sep 2026, pro-rated from your Jan\u2013Sep 2026 statement";

function books(fin: Record<string, string>, market: ResolvedMarket, fy: number): OwnerBooks {
  const n = (k: string) => (fin[k] != null && fin[k] !== "" ? Number(fin[k]) : null);
  return {
    hasBooks: true,
    ledger: null,
    revenue: n("revenue"),
    priorRevenue: null,
    cogs: n("cogs"),
    priorCogs: null,
    netIncome: n("netIncome"),
    operatingProfit: periodProfitBridge(fin).ebit,
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

// ── ZA March year: Home Analyst = Waterfall = Budget, labelled pro-rated ──
const zaBooks = books(JAN_SEP, ZA, ZA.fyStartMonthDefault);
const zaLine = analystLine(zaBooks);
assert(
  zaLine.startsWith("Gross profit is R 187 444. Net profit is R 29 711."),
  `ZA Home Analyst quotes the firm-year slice, got: ${zaLine}`,
);
assert(
  !zaLine.includes("241 000") && !zaLine.includes("38 200"),
  `ZA card is not the raw statement: ${zaLine}`,
);
assert(
  zaLine === `Gross profit is R 187 444. Net profit is R 29 711. ${LABEL}.`,
  `ZA card carries the label: ${zaLine}`,
);

const zaWaterfall = fiscalWaterfallFallback(JAN_SEP, ZA.fyStartMonthDefault);
assert(zaWaterfall, "ZA waterfall slice");
const wfGross = periodProfitBridge(
  zaWaterfall.fallback as unknown as Record<string, unknown>,
).grossProfit;
const money = (v: number) => plain(ownerAmount(v, ZA));
assert(
  zaLine.includes(`Gross profit is ${money(wfGross)}.`),
  `card gross = waterfall gross ${money(wfGross)}`,
);
assert(
  zaWaterfall.slice.netProfit != null &&
    zaLine.includes(`Net profit is ${money(zaWaterfall.slice.netProfit)}.`),
  "card net = waterfall net",
);
assert(zaWaterfall.slice.label === LABEL, `Waterfall label: ${zaWaterfall.slice.label}`);
assert(budgetHeadlineFigures(zaWaterfall.slice).label === LABEL, "Budget This year label");

// The hold-screen tile says the same thing.
const zaTile = ownerAnswerTiles(zaBooks).find((t) => t.id === "profit");
assert(plain(zaTile?.sentence).endsWith(`${LABEL}.`), `profit tile label: ${zaTile?.sentence}`);

// A pro-rated 7-month slice is not compared with a 9-month prior statement.
const zaWithPrior: OwnerBooks = { ...zaBooks, priorRevenue: 412000, priorCogs: 171000 };
const zaPriorLine = analystLine(zaWithPrior);
assert(!/last period/.test(zaPriorLine), `no 7-vs-9 comparison: ${zaPriorLine}`);
assert(
  ownerCardStatuses(zaWithPrior).analyst == null,
  "no 'down on last period' chip from a pro-rated slice",
);

// ── US calendar year: unchanged, no pro-rated label ──
const usBooks = books(JAN_SEP, US, US.fyStartMonthDefault);
const usLine = analystLine(usBooks);
assert(usLine === "Gross profit is $241,000. Net profit is $38,200.", `US unchanged: ${usLine}`);
const usSlice = fiscalStatementSlice(JAN_SEP, US.fyStartMonthDefault);
assert(usSlice && !usSlice.prorated, "US slice not clipped");
assert(!(usSlice.label ?? "").includes("pro-rated from"), `US label unchanged: ${usSlice.label}`);
assert(
  usSlice.label === "Jan 2026 \u2013 Sep 2026, prorated",
  `US waterfall label unchanged: ${usSlice.label}`,
);
// US prior comparison still works.
const usPrior = analystLine({ ...usBooks, priorRevenue: 500000, priorCogs: 200000 });
assert(
  usPrior === "Gross profit is $241,000, down on last period. Net profit is $38,200.",
  usPrior,
);

// ── 12-month ZA statement inside the firm year: not clipped ──
const MAR_FEB = {
  ...JAN_SEP,
  periodStart: "2026-03-01",
  periodEnd: "2027-02-28",
  periodMonths: "12",
};
const fullLine = analystLine(books(MAR_FEB, ZA, ZA.fyStartMonthDefault));
assert(
  fullLine === "Gross profit is R 241 000. Net profit is R 38 200.",
  `ZA full year unchanged: ${fullLine}`,
);

// ── Undated stored cover: not clipped ──
const UNDATED: Record<string, string> = { ...JAN_SEP };
delete UNDATED.periodStart;
delete UNDATED.periodEnd;
const undatedSlice = fiscalStatementSlice(UNDATED, ZA.fyStartMonthDefault);
assert(!undatedSlice?.prorated, "undated cover not prorated");
const undatedLine = analystLine(books(UNDATED, ZA, ZA.fyStartMonthDefault));
assert(
  undatedLine === "Gross profit is R 241 000. Net profit is R 38 200.",
  `undated unchanged: ${undatedLine}`,
);

// ── Cash interest line: same clip and label as the Waterfall ──
const { firmYearInterestClip } = await import("../src/lib/firm-year-interest");
const zaClip = firmYearInterestClip(JAN_SEP, ZA.fyStartMonthDefault);
const zaInterest = plain(interestOfRevenueSentence(JAN_SEP, money, zaClip) ?? "");
const wfInterest = periodProfitBridge(
  zaWaterfall.fallback as unknown as Record<string, unknown>,
).interest;
assert(
  zaInterest === `Interest on the P&L is 0.9% of revenue (${money(wfInterest)}). ${LABEL}.`,
  `ZA interest clipped to the waterfall (${money(wfInterest)}): ${zaInterest}`,
);
assert(!zaInterest.includes("R 3 600"), "ZA interest is not the raw 3 600");
const usMoney = (v: number) => plain(ownerAmount(v, US));
const usInterest = interestOfRevenueSentence(
  JAN_SEP,
  usMoney,
  firmYearInterestClip(JAN_SEP, US.fyStartMonthDefault),
);
assert(
  usInterest === "Interest on the P&L is 0.9% of revenue ($3,600).",
  `US interest unchanged: ${usInterest}`,
);
assert(
  firmYearInterestClip(UNDATED, ZA.fyStartMonthDefault) == null,
  "undated interest not clipped",
);

// ── Both Home sides and the cash screen pass the clip ──
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const accountant = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(
  /fiscalStatementSlice\(financials, fyStartMonth\)/.test(accountant),
  "accountant Home uses the Waterfall's year start",
);
assert(
  /profitPeriod: homeProfitPeriod/.test(accountant),
  "accountant Home books carry profitPeriod",
);
assert(
  /profitPeriod=\{ownerProfitPeriod\?\.slice \?\? null\}/.test(read("src/routes/app.tsx")),
  "owner app passes the Waterfall slice",
);
assert(
  /profitPeriod,/.test(read("src/components/owner-door/owner-door.tsx")),
  "owner door books carry profitPeriod",
);
assert(
  /firmYearInterestClip\(/.test(read("src/components/cash-forecast.tsx")),
  "cash screen clips interest",
);

console.log("home-profit-period: ok");
