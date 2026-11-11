/**
 * Profit chart and P&L table.
 * Figures come from the statement already on the client and from
 * client_financial_snapshots. Nothing here fetches, and a multi-month
 * statement is not split into invented months.
 */
import { fiscalWaterfallFallback } from "./budget-period.ts";
import type { FiscalStatementSlice } from "./budget-period-types.ts";
import { MONTHS } from "./market/date-presets.ts";
import {
  costMagnitude,
  periodProfitBridge,
  statementGrossProfit,
  statementNetProfit,
} from "./period-profit.ts";
import { presentNumber, statementMonthKeys, statementPeriodBasis } from "./statement-cover.ts";
import { isMonthStampLabel } from "./statement-period.ts";

export type ProfitFlows = {
  income: number | null;
  sales: number | null;
  otherIncome: number | null;
  cogs: number | null;
  expenses: number | null;
  grossProfit: number | null;
  operatingProfit: number | null;
  netProfit: number | null;
  breakEven: number | null;
};

export type ProfitLineKind = "income" | "expense" | "profit" | "total";

export type ProfitPnlRow = {
  id: string;
  section: string | null;
  label: string;
  kind: ProfitLineKind;
  emphasis: boolean;
  current: number | null;
  prior: number | null;
  variance: number | null;
  /** Points, not a fraction. Null when prior is missing or zero. */
  variancePct: number | null;
  ytd: number | null;
  /** Null when the move is flat or missing. Expense down is favourable. */
  favourable: boolean | null;
};

export type ProfitSnapshot = {
  periodDate?: string | null;
  /** Column name on client_financial_snapshots. */
  period_date?: string | null;
  periodLabel?: string | null;
  period_label?: string | null;
  financials?: Record<string, unknown> | null;
};

export type ProfitSeriesPoint = {
  id: string;
  label: string;
  /** ISO day used for ordering and the start-date filter. */
  sort: string;
  span: "month" | "period" | "year";
} & ProfitFlows;

export type ProfitInterval = "week" | "month" | "year";

const EMPTY_FLOWS: ProfitFlows = {
  income: null,
  sales: null,
  otherIncome: null,
  cogs: null,
  expenses: null,
  grossProfit: null,
  operatingProfit: null,
  netProfit: null,
  breakEven: null,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function num(fin: Record<string, unknown>, key: string): number | null {
  const value = fin[key];
  if (typeof value !== "string" && typeof value !== "number" && value != null) return null;
  return presentNumber(value as string | number | null | undefined);
}

function day(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function breakEvenRevenue(
  income: number | null,
  expenses: number | null,
  cogs: number | null,
): number | null {
  if (income == null || !(income > 0) || expenses == null) return null;
  const gross = cogs == null ? null : income - cogs;
  if (gross == null || !(gross > 0)) return null;
  const margin = gross / income;
  if (!(margin > 0.02)) return null;
  return round2(expenses / margin);
}

/** Statement flows. A missing line stays null. A stored zero stays zero. */
export function profitFlows(fin: Record<string, unknown> | null | undefined): ProfitFlows | null {
  if (!fin) return null;
  const revenue = num(fin, "revenue");
  const other = num(fin, "otherIncome");
  const cogsRaw = num(fin, "cogs");
  const cogs = cogsRaw == null ? null : costMagnitude(cogsRaw);
  const hasOpex = num(fin, "fixedCosts") != null || num(fin, "ebit") != null;
  const bridge = hasOpex || revenue != null || cogs != null ? periodProfitBridge(fin) : null;
  const expenses =
    hasOpex && bridge ? round2(bridge.operatingExpenses + bridge.depreciation) : null;
  const sales = revenue == null ? null : other == null ? revenue : round2(revenue - other);
  const gross = statementGrossProfit(fin);
  const operating = num(fin, "ebit");
  const net = statementNetProfit(fin);
  const flows: ProfitFlows = {
    income: revenue,
    sales,
    otherIncome: other,
    cogs,
    expenses,
    grossProfit: gross,
    operatingProfit: operating,
    netProfit: net,
    breakEven: breakEvenRevenue(revenue, expenses, cogs),
  };
  if (Object.values(flows).every((value) => value == null)) return null;
  return flows;
}

function sliceFinancials(slice: FiscalStatementSlice): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (slice.revenue != null) out.revenue = slice.revenue;
  if (slice.cogs != null) out.cogs = slice.cogs;
  if (slice.grossProfit != null) out.grossProfit = slice.grossProfit;
  if (slice.operatingExpenses != null) out.fixedCosts = slice.operatingExpenses;
  if (slice.operatingProfit != null) out.ebit = slice.operatingProfit;
  if (slice.netProfit != null) out.netIncome = slice.netProfit;
  return out;
}

function ytdFinancials(
  current: Record<string, unknown> | null,
  _fyStartMonth: number | null | undefined,
): { financials: Record<string, unknown> | null; partial: boolean } {
  if (!current) return { financials: null, partial: false };
  const ytdRevenue = num(current, "ytdRevenue");
  const ytdNet = num(current, "ytdNetIncome");
  const start = day(current.periodStart);
  const end = day(current.periodEnd);
  const ytdStart = day(current.ytdPeriodStart);
  const ytdEnd = day(current.ytdPeriodEnd);
  const sameRange = Boolean(start && end && ytdStart === start && ytdEnd === end);
  if (sameRange) return { financials: current, partial: false };
  if (ytdRevenue == null && ytdNet == null) {
    const basis = statementPeriodBasis(current);
    const months =
      basis.kind === "dated" ? basis.keys.length : basis.kind === "stored" ? basis.months : null;
    if (months != null && months >= 2) return { financials: current, partial: false };
    return { financials: null, partial: false };
  }
  if (sameRange) return { financials: current, partial: false };
  const partial: Record<string, unknown> = {};
  if (ytdRevenue != null) partial.revenue = ytdRevenue;
  if (ytdNet != null) partial.netIncome = ytdNet;
  return { financials: partial, partial: true };
}

type PickLine = {
  id: string;
  section: string | null;
  label: string;
  kind: ProfitLineKind;
  emphasis: boolean;
  read: (flows: ProfitFlows, fin: Record<string, unknown> | null) => number | null;
};

/** P&L expense section lines. Operating is the residual after wages when both show. */
export function pnlExpenseParts(
  fin: Record<string, unknown> | null,
  expenses: number | null,
): {
  labor: number | null;
  depreciation: number | null;
  operating: number | null;
  total: number | null;
} {
  if (expenses == null) return { labor: null, depreciation: null, operating: null, total: null };
  let depreciation: number | null = null;
  if (fin && num(fin, "ebitda") != null && num(fin, "ebit") != null) {
    const amount = periodProfitBridge(fin).depreciation;
    if (amount > 0 && amount < expenses - 0.5) depreciation = round2(amount);
  }
  const afterDep = round2(expenses - (depreciation ?? 0));
  const laborRaw = fin ? (num(fin, "laborCost") ?? num(fin, "labourCost")) : null;
  const labor =
    laborRaw != null && laborRaw > 0 && laborRaw < afterDep - 1 ? round2(laborRaw) : null;
  return {
    labor,
    depreciation,
    operating: round2(afterDep - (labor ?? 0)),
    total: expenses,
  };
}

function lineDefs(): PickLine[] {
  return [
    {
      id: "sales",
      section: "Income",
      label: "Sales",
      kind: "income",
      emphasis: false,
      read: (flows) => flows.sales,
    },
    {
      id: "other-income",
      section: "Income",
      label: "Other income",
      kind: "income",
      emphasis: false,
      read: (flows) => flows.otherIncome,
    },
    {
      id: "total-income",
      section: "Income",
      label: "Total income",
      kind: "total",
      emphasis: true,
      read: (flows) => flows.income,
    },
    {
      id: "cogs",
      section: "Cost of goods sold",
      label: "Cost of goods sold",
      kind: "expense",
      emphasis: false,
      read: (flows) => flows.cogs,
    },
    {
      id: "total-cogs",
      section: "Cost of goods sold",
      label: "Total cost of goods sold",
      kind: "total",
      emphasis: true,
      read: (flows) => flows.cogs,
    },
    {
      id: "gross-profit",
      section: null,
      label: "Gross profit",
      kind: "profit",
      emphasis: true,
      read: (flows) => flows.grossProfit,
    },
    {
      id: "labor",
      section: "Expenses",
      label: "Wages and salaries",
      kind: "expense",
      emphasis: false,
      read: (flows, fin) => pnlExpenseParts(fin, flows.expenses).labor,
    },
    {
      id: "opex",
      section: "Expenses",
      label: "Operating expenses",
      kind: "expense",
      emphasis: false,
      read: (flows, fin) => pnlExpenseParts(fin, flows.expenses).operating,
    },
    {
      id: "depreciation",
      section: "Expenses",
      label: "Depreciation",
      kind: "expense",
      emphasis: false,
      read: (flows, fin) => pnlExpenseParts(fin, flows.expenses).depreciation,
    },
    {
      id: "total-expenses",
      section: "Expenses",
      label: "Total expenses",
      kind: "total",
      emphasis: true,
      read: (flows, fin) => pnlExpenseParts(fin, flows.expenses).total,
    },
    {
      id: "operating-profit",
      section: null,
      label: "Operating profit",
      kind: "profit",
      emphasis: true,
      read: (flows) => flows.operatingProfit,
    },
    {
      id: "interest",
      section: null,
      label: "Interest",
      kind: "expense",
      emphasis: false,
      read: (_flows, fin) => {
        if (!fin) return null;
        const stated = num(fin, "interestExpense") ?? num(fin, "interest");
        if (stated == null) return null;
        const bridge = periodProfitBridge(fin);
        return bridge.interestIsFact ? costMagnitude(stated) : null;
      },
    },
    {
      id: "tax",
      section: null,
      label: "Tax",
      kind: "expense",
      emphasis: false,
      read: (_flows, fin) => {
        if (!fin || num(fin, "tax") == null) return null;
        const bridge = periodProfitBridge(fin);
        return bridge.taxIsFact ? costMagnitude(bridge.tax) : null;
      },
    },
    {
      id: "net-profit",
      section: null,
      label: "Net profit",
      kind: "profit",
      emphasis: true,
      read: (flows) => flows.netProfit,
    },
  ];
}

function favourable(kind: ProfitLineKind, delta: number): boolean | null {
  if (Math.abs(delta) < 0.5) return null;
  const up = delta > 0;
  if (kind === "expense") return !up;
  return up;
}

export function buildProfitPnl(input: {
  current: Record<string, unknown> | null | undefined;
  prior?: Record<string, unknown> | null;
  /** Firm-year clip. When it is prorated, prior stays blank. */
  quoted?: FiscalStatementSlice | null;
  fyStartMonth?: number | null;
}): { rows: ProfitPnlRow[]; prorated: boolean } {
  const raw = input.current ?? null;
  const firmYear =
    raw && input.fyStartMonth != null
      ? fiscalWaterfallFallback(raw, input.fyStartMonth)
      : null;
  const prorated = Boolean(firmYear?.slice.prorated ?? input.quoted?.prorated);
  // Same scaled blob the waterfall bridge reads. A thin slice drops interest,
  // tax, and depreciation, so the sheet and the waterfall would disagree.
  const currentFin =
    prorated && firmYear
      ? firmYear.financials
      : prorated && input.quoted
        ? sliceFinancials(input.quoted)
        : raw;
  const priorFin = prorated ? null : (input.prior ?? null);
  const ytd = ytdFinancials(prorated ? raw : currentFin, input.fyStartMonth);
  const currentFlows = profitFlows(currentFin) ?? EMPTY_FLOWS;
  const priorFlows = profitFlows(priorFin) ?? EMPTY_FLOWS;
  const ytdFlows = profitFlows(ytd.financials) ?? EMPTY_FLOWS;
  const rows: ProfitPnlRow[] = [];
  for (const line of lineDefs()) {
    const current = line.read(currentFlows, currentFin);
    const prior = line.read(priorFlows, priorFin);
    const year = line.read(ytdFlows, ytd.financials);
    if (current == null && prior == null && year == null) continue;
    const variance = current != null && prior != null ? round2(current - prior) : null;
    const variancePct =
      variance != null && prior != null && Math.abs(prior) >= 0.5
        ? round2((variance / Math.abs(prior)) * 100)
        : null;
    rows.push({
      id: line.id,
      section: line.section,
      label: line.label,
      kind: line.kind,
      emphasis: line.emphasis,
      current,
      prior,
      variance,
      variancePct,
      ytd: year,
      favourable: variance == null ? null : favourable(line.kind, variance),
    });
  }
  return { rows, prorated };
}

function monthLabel(ym: string): string {
  const month = Number(ym.slice(5, 7));
  return MONTHS[month - 1] ?? ym;
}

function withBreakEven(flows: ProfitFlows): ProfitFlows {
  return { ...flows, breakEven: breakEvenRevenue(flows.income, flows.expenses, flows.cogs) };
}

function subtractFlows(later: ProfitFlows, earlier: ProfitFlows): ProfitFlows {
  const sub = (a: number | null, b: number | null) =>
    a == null || b == null ? null : round2(a - b);
  return withBreakEven({
    income: sub(later.income, earlier.income),
    sales: sub(later.sales, earlier.sales),
    otherIncome: sub(later.otherIncome, earlier.otherIncome),
    cogs: sub(later.cogs, earlier.cogs),
    expenses: sub(later.expenses, earlier.expenses),
    grossProfit: sub(later.grossProfit, earlier.grossProfit),
    operatingProfit: sub(later.operatingProfit, earlier.operatingProfit),
    netProfit: sub(later.netProfit, earlier.netProfit),
    breakEven: null,
  });
}

type Candidate = {
  end: string;
  start: string | null;
  keys: string[] | null;
  label: string;
  flows: ProfitFlows;
};

function candidateFrom(
  fin: Record<string, unknown> | null | undefined,
  end: string | null,
  label: string | null,
): Candidate | null {
  if (!fin || !end) return null;
  const flows = profitFlows(fin);
  if (!flows) return null;
  const start = day(fin.periodStart);
  const keys = statementMonthKeys(start, day(fin.periodEnd) ?? end);
  return { end, start, keys, label: label?.trim() || monthLabel(end.slice(0, 7)), flows };
}

function pointFrom(
  id: string,
  sort: string,
  label: string,
  span: ProfitSeriesPoint["span"],
  flows: ProfitFlows,
): ProfitSeriesPoint {
  return { id, sort, label, span, ...flows };
}

/**
 * One point per statement.
 * A one-month statement is that month. A later cumulative statement that
 * adds exactly one month becomes that month (later minus earlier). Any
 * wider span stays one point.
 */
/** Net, then operating, then gross. Revenue alone is not profit. */
export function profitChartValue(flows: {
  netProfit: number | null;
  operatingProfit: number | null;
  grossProfit: number | null;
}): number | null {
  return flows.netProfit ?? flows.operatingProfit ?? flows.grossProfit;
}

/**
 * Dated statements when they carry a profit figure.
 * A P&L on file with no period end still charts as one point.
 */
export function profitChartPoints(input: {
  snapshots?: readonly ProfitSnapshot[] | null;
  current?: Record<string, unknown> | null;
  currentPeriodEnd?: string | null;
  currentLabel?: string | null;
}): ProfitSeriesPoint[] {
  const dated = profitSeriesPoints(input);
  if (dated.some((point) => profitChartValue(point) != null)) return dated;
  const flows = profitFlows(input.current);
  if (!flows || profitChartValue(flows) == null) return dated;
  const sort = dated[dated.length - 1]?.sort ?? "0001-01-01";
  const label = input.currentLabel?.trim() || "This period";
  return [pointFrom("current", sort, label, "period", flows)];
}

export function profitSeriesPoints(input: {
  snapshots?: readonly ProfitSnapshot[] | null;
  current?: Record<string, unknown> | null;
  currentPeriodEnd?: string | null;
  currentLabel?: string | null;
}): ProfitSeriesPoint[] {
  const candidates: Candidate[] = [];
  for (const row of input.snapshots ?? []) {
    const end = day(row.periodDate) ?? day(row.period_date) ?? day(row.financials?.periodEnd);
    const built = candidateFrom(row.financials, end, null);
    if (built) candidates.push(built);
  }
  const currentEnd = day(input.currentPeriodEnd) ?? day(input.current?.periodEnd);
  const current = candidateFrom(input.current, currentEnd, input.currentLabel ?? null);
  if (current && !candidates.some((row) => row.end === current.end)) candidates.push(current);
  candidates.sort((a, b) => a.end.localeCompare(b.end) || a.label.localeCompare(b.label));

  const points: ProfitSeriesPoint[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const cur = candidates[index]!;
    const keys = cur.keys;
    const oneMonth = keys?.length === 1 || (keys == null && isMonthStampLabel(cur.label));
    if (oneMonth) {
      const id = keys?.[0] ?? cur.end.slice(0, 7);
      points.push(pointFrom(id, `${id}-01`, monthLabel(id), "month", cur.flows));
      continue;
    }
    let earlier: Candidate | null = null;
    for (let back = index - 1; back >= 0; back -= 1) {
      const older = candidates[back]!;
      if (!cur.start || older.start !== cur.start || !keys || !older.keys) continue;
      if (older.end >= cur.end || older.keys.length >= keys.length) continue;
      const prefix = older.keys.every((key, keyIndex) => keys[keyIndex] === key);
      if (prefix) {
        earlier = older;
        break;
      }
    }
    if (earlier?.keys && keys && keys.length === earlier.keys.length + 1) {
      const id = keys[keys.length - 1]!;
      points.push(
        pointFrom(id, `${id}-01`, monthLabel(id), "month", subtractFlows(cur.flows, earlier.flows)),
      );
      continue;
    }
    const range =
      keys && keys.length > 1
        ? `${monthLabel(keys[0]!)}–${monthLabel(keys[keys.length - 1]!)}`
        : cur.label;
    points.push(pointFrom(`span:${cur.end}`, cur.end, range, "period", cur.flows));
  }

  const byId = new Map<string, ProfitSeriesPoint>();
  for (const point of points) byId.set(point.id, point);
  return [...byId.values()].sort(
    (a, b) => a.sort.localeCompare(b.sort) || a.id.localeCompare(b.id),
  );
}

function sumNullable(values: Array<number | null>): number | null {
  const present = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  if (!present.length) return null;
  return round2(present.reduce((sum, value) => sum + value, 0));
}

export function presentProfitSeries(
  points: readonly ProfitSeriesPoint[],
  opts: { interval?: ProfitInterval; startDate?: string | null } = {},
): { points: ProfitSeriesPoint[]; note: string | null } {
  const interval = opts.interval ?? "month";
  const start = day(opts.startDate);
  const filtered = points.filter((point) => !start || point.sort >= start);
  if (interval === "year") {
    const groups = new Map<string, ProfitSeriesPoint[]>();
    for (const point of filtered) {
      const year = point.sort.slice(0, 4);
      const list = groups.get(year) ?? [];
      list.push(point);
      groups.set(year, list);
    }
    const rolled: ProfitSeriesPoint[] = [];
    for (const [year, list] of groups) {
      const flows = withBreakEven({
        income: sumNullable(list.map((point) => point.income)),
        sales: sumNullable(list.map((point) => point.sales)),
        otherIncome: sumNullable(list.map((point) => point.otherIncome)),
        cogs: sumNullable(list.map((point) => point.cogs)),
        expenses: sumNullable(list.map((point) => point.expenses)),
        grossProfit: sumNullable(list.map((point) => point.grossProfit)),
        operatingProfit: sumNullable(list.map((point) => point.operatingProfit)),
        netProfit: sumNullable(list.map((point) => point.netProfit)),
        breakEven: null,
      });
      rolled.push(pointFrom(year, `${year}-01-01`, year, "year", flows));
    }
    return { points: rolled, note: null };
  }
  let note: string | null = null;
  if (interval === "week") {
    note = "Weekly profit is not on the statement. Showing each month on file.";
  } else if (filtered.length > 0 && filtered.every((point) => point.span === "period")) {
    note = "This statement is one span. Monthly amounts appear when each month is on file.";
  }
  return { points: filtered, note };
}
