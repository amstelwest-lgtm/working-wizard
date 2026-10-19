/**
 * Retest of #560 on prod 1c5157ad.
 * Run: pnpm test:aqa-retest-560
 */
import { findingMetricContext } from "../src/lib/milon-team-activity";
import { stripMilonProjection } from "../src/lib/milon-projection";
import { ownerAmount, ownerAnswerTiles, ownerHomeLines, type OwnerBooks } from "../src/lib/owner-answers";
import { computeRatios, operatingCycleDays } from "../src/lib/ratios";
import { ratioActualLine } from "../src/lib/ratio-actuals";
import { formatFirmOverLimitNote } from "../src/lib/firm-band-upgrade";
import { forecastRunwayHeadlineShared } from "../src/lib/cash-forecast-parity";
import { ZA_MARKET } from "../src/lib/market";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const leaked =
  'Get customers to pay faster @@milon-projection@@{"v":1,"driverKey":"workingCapitalDays","current":161.6}@@/milon-projection@@';
const stripped = stripMilonProjection(leaked);
assert(stripped === "Get customers to pay faster", stripped);
assert(!stripped.includes("@@"), stripped);
assert(!stripped.includes("161.6"), stripped);
assert(
  stripMilonProjection('Chase the overdue invoice @@milon-projection@@{"cash":44880} before Friday.') ===
    "Chase the overdue invoice before Friday.",
  "a token without a closer still strips",
);

const books: OwnerBooks = {
  hasBooks: true,
  ledger: "Xero",
  revenue: 1_215_000,
  priorRevenue: null,
  cogs: -56_000,
  priorCogs: null,
  grossProfit: 1_159_000,
  netIncome: 27_010,
  receivables: null,
  cashflow: null,
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: ZA_MARKET,
};
const analyst = ownerHomeLines(ownerAnswerTiles(books), null).analyst[0] ?? "";
assert(analyst.includes("Gross profit"), analyst);
assert(analyst.includes("Net profit"), analyst);
assert(analyst.includes(ownerAmount(1_159_000, ZA_MARKET)), analyst);
assert(analyst.includes(ownerAmount(27_010, ZA_MARKET)), analyst);
assert(!analyst.includes("Profit is"), analyst);
assert(!analyst.includes(ownerAmount(1_271_000, ZA_MARKET)), analyst);

const flags = findingMetricContext({
  figures: {
    grossMargin: 1.046,
    creditorDays: -248,
    inventoryDays: -93,
    debtorDays: 6.6,
    workingCapitalDays: 161.6,
  },
});
assert(flags != null, "flags line exists");
assert(flags!.includes("95.4%"), flags!);
assert(!flags!.includes("104.6"), flags!);
assert(!flags!.includes("-248"), flags!);
assert(!flags!.includes("-93"), flags!);
assert(flags!.includes("248"), flags!);
assert(flags!.includes("93"), flags!);
assert(!flags!.includes("161.6"), flags!);

const cycle = operatingCycleDays({
  revenue: 1_215_000,
  cogs: -56_000,
  receivables: (6.6 * 1_215_000) / 365,
  inventory: (93 * 56_000) / 365,
  payables: (248 * 56_000) / 365,
});
assert(Number.isFinite(cycle.debtorDays), `debtor days stay ${cycle.debtorDays}`);
assert(Number.isNaN(cycle.inventoryDays), `inventory days are not meaningful (${cycle.inventoryDays})`);
assert(Number.isNaN(cycle.creditorDays), `creditor days are not meaningful (${cycle.creditorDays})`);
assert(Number.isNaN(cycle.workingCapitalDays), `working-capital days are not meaningful (${cycle.workingCapitalDays})`);
const ratios = computeRatios({
  revenue: "1215000",
  cogs: "-56000",
  ebit: "",
  ebt: "",
  netIncome: "27010",
  ebitda: "",
  operatingCashflow: "",
  totalAssets: "",
  equity: "",
  receivables: String((6.6 * 1_215_000) / 365),
  inventory: String((93 * 56_000) / 365),
  payables: String((248 * 56_000) / 365),
  fixedCosts: "",
  variableCosts: "",
  top5Revenue: "",
  laborCost: "",
  employees: "",
  founderHours: "",
  periodMonths: "12",
});
assert(
  Number.isNaN(ratios["Working Capital Days"]) && Number.isNaN(cycle.workingCapitalDays),
  "ratios and the cycle both leave working-capital days not meaningful",
);
assert(Math.abs((ratios["Gross Margin"] ?? 0) - 1_159_000 / 1_215_000) < 0.002, "GM matches the waterfall");
const actual = ratioActualLine(
  "Working Capital Days",
  {
    revenue: "1215000",
    cogs: "-56000",
    ebit: "",
    ebt: "",
    netIncome: "",
    ebitda: "",
    operatingCashflow: "",
    totalAssets: "",
    equity: "",
    receivables: String((6.6 * 1_215_000) / 365),
    inventory: String((93 * 56_000) / 365),
    payables: String((248 * 56_000) / 365),
    fixedCosts: "",
    variableCosts: "",
    top5Revenue: "",
    laborCost: "",
    employees: "",
    founderHours: "",
    periodMonths: "12",
  },
  (n) => String(Math.round(n)),
);
assert(actual.calculation === "not meaningful", actual.calculation ?? "");
assert(!actual.calculation?.includes("161.6"), actual.calculation ?? "");

const note = formatFirmOverLimitNote({ count: 8, limit: 5, planName: "Starter" });
assert(note != null && note.includes("8") && note.includes("5") && /upgrade/i.test(note), note ?? "");
assert(formatFirmOverLimitNote({ count: 4, limit: 5, planName: "Starter" }) == null, "under the limit stays quiet");

const closings = Array.from({ length: 13 }, (_, week) => (week < 6 ? 10_000 : 80_000));
const runway = forecastRunwayHeadlineShared({
  opening: 80_000,
  closings,
  floor: 50_000,
  runwayLabel: "Cash generative",
  cashGenerative: true,
});
assert(runway.headline === "6 weeks below", runway.headline);
assert(runway.headline !== "Cash generative", runway.headline);

console.log("aqa retest 560 ok");
