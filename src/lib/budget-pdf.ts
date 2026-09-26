/**
 * View model for the Budget & variance PDF.
 *
 * Figures come from the saved BudgetDocument (`clients.budget`) via
 * computeBudgetMonths, and from uploaded month actuals via computeMonthVariance
 * / varianceLine. This file does not introduce a second budget model or a
 * new variance formula.
 */

import type { BudgetDocument, BudgetMonthResult, BudgetOverheadLine } from "@/lib/budget.types";
import {
  budgetWindowLabel,
  createBudgetDocument,
  formatMonthLabel,
  fyMonths,
} from "@/lib/budget.months";
import { computeBudgetMonths, normalizeBudgetDocument } from "@/lib/budget.compute";
import {
  computeMonthVariance,
  emptyTaxonomyTotals,
  formatVariancePct,
  isMaterialVariance,
  normalizeTaxonomyTotals,
  varianceLine,
  type ActualsStatus,
  type TaxonomyTotals,
  type VarianceLine,
  type VarianceSignal,
  type VarianceTaxonomyKey,
} from "@/lib/budget.variance";
import { formatMoney, ZA_MARKET, type ResolvedMarket } from "@/lib/market";

export type BudgetPdfActual = {
  month: string;
  status: ActualsStatus;
  totals: Partial<TaxonomyTotals>;
};

export type BudgetPdfRow = {
  label: string;
  budget: number;
  actual: number | null;
  delta: number | null;
  deltaPct: number | null;
  signal: VarianceSignal | null;
  /** Material and adverse — the row the PDF tints. */
  material: boolean;
  emphasis: boolean;
};

export type BudgetPdfSection = {
  title: string;
  note?: string;
  rows: BudgetPdfRow[];
};

export type BudgetPdfNote = {
  at: string;
  by: string;
  text: string;
};

export type BudgetPdfModel = {
  periodLabel: string;
  scenarioLabel: string;
  currency: string;
  comparedLabel: string;
  hasActuals: boolean;
  includesDraftActuals: boolean;
  fullYearNote: string;
  headline: string;
  summary: BudgetPdfRow[];
  sections: BudgetPdfSection[];
  notes: BudgetPdfNote[];
  openingCash: number;
};

const SUMMARY_KEYS: VarianceTaxonomyKey[] = ["revenue", "cogs", "overheads_total", "ebit"];

const DISPLAY_LABEL: Partial<Record<VarianceTaxonomyKey, string>> = {
  revenue: "Revenue",
  cogs: "COGS",
  gross_profit: "Gross profit",
  overheads_total: "Operating expenses",
  depreciation: "Depreciation",
  ebit: "Profit",
};

const BUCKET_ORDER: BudgetOverheadLine["bucket"][] = [
  "people",
  "premises",
  "ops",
  "sales",
  "other",
];

const BUCKET_LABEL: Record<BudgetOverheadLine["bucket"], string> = {
  people: "People",
  premises: "Premises",
  ops: "Operations",
  sales: "Sales",
  other: "Other",
};

const BUCKET_ACTUAL: Record<BudgetOverheadLine["bucket"], keyof TaxonomyTotals> = {
  people: "overheadsPeople",
  premises: "overheadsPremises",
  ops: "overheadsOps",
  sales: "overheadsSales",
  other: "overheadsOther",
};

type MoneyMarket = Pick<ResolvedMarket, "currency" | "locale">;

function money(n: number, market: MoneyMarket): string {
  return formatMoney(Math.round(n), market);
}

export function parseBudgetDocument(raw: unknown): BudgetDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as BudgetDocument;
  if (doc.version !== 1 || typeof doc.fyStart !== "string" || !/^\d{4}-\d{2}$/.test(doc.fyStart)) {
    return null;
  }
  try {
    return normalizeBudgetDocument(doc);
  } catch {
    return null;
  }
}

function sumBudget(rows: BudgetMonthResult[]): BudgetMonthResult {
  const z = {
    revenue: 0,
    cogs: 0,
    grossProfit: 0,
    overheads: 0,
    depreciation: 0,
    ebitda: 0,
    ebit: 0,
  };
  for (const r of rows) {
    z.revenue += r.revenue;
    z.cogs += r.cogs;
    z.grossProfit += r.grossProfit;
    z.overheads += r.overheads;
    z.depreciation += r.depreciation;
    z.ebitda += r.ebitda;
    z.ebit += r.ebit;
  }
  return {
    month: "ytd",
    ...z,
    gpPct: z.revenue > 0 ? (z.grossProfit / z.revenue) * 100 : 0,
    capexCash: 0,
    inventoryBuild: 0,
    vatNet: 0,
    cashIn: 0,
    cashOut: 0,
    netCash: 0,
    closingCash: rows.length ? rows[rows.length - 1].closingCash : 0,
  };
}

function sumTotals(rows: TaxonomyTotals[]): TaxonomyTotals {
  const s = emptyTaxonomyTotals();
  for (const t of rows) {
    (Object.keys(s) as (keyof TaxonomyTotals)[]).forEach((k) => {
      s[k] += t[k] || 0;
    });
  }
  return normalizeTaxonomyTotals(s);
}

function budgetOnlyRow(label: string, budget: number, emphasis = false): BudgetPdfRow {
  return {
    label,
    budget,
    actual: null,
    delta: null,
    deltaPct: null,
    signal: null,
    material: false,
    emphasis,
  };
}

function fromVariance(v: VarianceLine, label: string, emphasis = false): BudgetPdfRow {
  return {
    label,
    budget: v.budget,
    actual: v.actual,
    delta: v.delta,
    deltaPct: v.deltaPct,
    signal: v.signal,
    material: v.signal === "adverse" && isMaterialVariance(v),
    emphasis,
  };
}

function contiguousLabel(months: string[], market: Pick<ResolvedMarket, "locale">): string {
  if (months.length === 0) return "No month actuals uploaded";
  if (months.length === 1) return formatMonthLabel(months[0], market);
  const first = formatMonthLabel(months[0], market);
  const last = formatMonthLabel(months[months.length - 1], market);
  return `${first} – ${last} · ${months.length} months`;
}

function monthsAreContiguous(fy: string[], picked: string[]): boolean {
  if (picked.length <= 1) return true;
  const indexes = picked.map((m) => fy.indexOf(m)).filter((i) => i >= 0);
  if (indexes.length !== picked.length) return false;
  for (let i = 1; i < indexes.length; i++) {
    if (indexes[i] !== indexes[i - 1] + 1) return false;
  }
  return true;
}

function overheadBudget(
  doc: BudgetDocument,
  months: string[],
  bucket: BudgetOverheadLine["bucket"],
): number {
  const factor = doc.scenarios[doc.activeScenario]?.overheadFactor ?? 1;
  let sum = 0;
  for (const line of doc.overheads) {
    if (line.bucket !== bucket) continue;
    for (const m of months) sum += (line.months[m] || 0) * factor;
  }
  return sum;
}

function revenueDriverBudget(doc: BudgetDocument, months: string[], lineId: string): number {
  const line = doc.revenueLines.find((l) => l.id === lineId);
  if (!line) return 0;
  const f = doc.scenarios[doc.activeScenario];
  const volumeFactor = f?.volumeFactor ?? 1;
  const priceFactor = f?.priceFactor ?? 1;
  let entered = 0;
  for (const m of months) {
    const cell = line.months[m] ?? { volume: 0, price: 0 };
    entered += (cell.volume || 0) * volumeFactor * ((cell.price || 0) * priceFactor);
  }
  return entered;
}

function headlineFor(
  summary: BudgetPdfRow[],
  hasActuals: boolean,
  includesDraft: boolean,
  market: MoneyMarket,
): string {
  const draftBit = includesDraft ? "Some compared months are still unconfirmed drafts. " : "";
  if (!hasActuals) {
    return "No month actuals are on file for this financial year. The figures are the saved budget. Variance fills in after management accounts are uploaded on the Budget tab.";
  }
  const adverse = summary
    .filter((r) => r.signal === "adverse" && r.delta != null)
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
  if (adverse.length === 0) {
    return `${draftBit}Trading is broadly in line with budget for the months compared.`;
  }
  const top = adverse[0];
  const dir = (top.delta ?? 0) > 0 ? "over" : "under";
  const pct = formatVariancePct(top.deltaPct);
  return `${draftBit}${top.label} is ${dir} budget by ${money(Math.abs(top.delta ?? 0), market)} (${pct}).`;
}

export function buildBudgetPdfModel(
  doc: BudgetDocument,
  actuals: BudgetPdfActual[],
  market: ResolvedMarket = ZA_MARKET,
): BudgetPdfModel {
  const fy = fyMonths(doc.fyStart);
  const results = computeBudgetMonths(doc, doc.activeScenario);
  const byMonth = new Map(results.map((r) => [r.month, r]));

  const actualByMonth = new Map<string, BudgetPdfActual>();
  for (const row of actuals) {
    if (!fy.includes(row.month)) continue;
    actualByMonth.set(row.month, row);
  }
  const comparedMonths = fy.filter((m) => actualByMonth.has(m));
  const hasActuals = comparedMonths.length > 0;
  const includesDraftActuals = comparedMonths.some((m) => actualByMonth.get(m)?.status === "draft");

  const budgetWindow = hasActuals
    ? comparedMonths.map((m) => byMonth.get(m)).filter((r): r is BudgetMonthResult => Boolean(r))
    : results;
  const budgetSum = sumBudget(budgetWindow);
  const actualSum = hasActuals
    ? sumTotals(comparedMonths.map((m) => normalizeTaxonomyTotals(actualByMonth.get(m)?.totals)))
    : null;

  const variance = actualSum ? computeMonthVariance(budgetSum, actualSum, "ytd") : null;

  const pnlRows: BudgetPdfRow[] = variance
    ? variance.lines.map((v) =>
        fromVariance(v, DISPLAY_LABEL[v.key] ?? v.label, SUMMARY_KEYS.includes(v.key)),
      )
    : (["revenue", "cogs", "gross_profit", "overheads_total", "depreciation", "ebit"] as const).map(
        (key) => {
          const budget =
            key === "revenue"
              ? budgetSum.revenue
              : key === "cogs"
                ? budgetSum.cogs
                : key === "gross_profit"
                  ? budgetSum.grossProfit
                  : key === "overheads_total"
                    ? budgetSum.overheads
                    : key === "depreciation"
                      ? budgetSum.depreciation
                      : budgetSum.ebit;
          return budgetOnlyRow(DISPLAY_LABEL[key] ?? key, budget, SUMMARY_KEYS.includes(key));
        },
      );

  const summary = SUMMARY_KEYS.map(
    (key) =>
      pnlRows.find((r) => r.label === DISPLAY_LABEL[key]) ??
      budgetOnlyRow(DISPLAY_LABEL[key] ?? key, 0, true),
  );

  const driverMonths = hasActuals ? comparedMonths : fy;
  const driverRows = doc.revenueLines
    .map((line) =>
      budgetOnlyRow(line.name || "Revenue line", revenueDriverBudget(doc, driverMonths, line.id)),
    )
    .filter((r) => Math.abs(r.budget) >= 1);

  const bucketActualSum = actualSum
    ? actualSum.overheadsPeople +
      actualSum.overheadsPremises +
      actualSum.overheadsOps +
      actualSum.overheadsSales +
      actualSum.overheadsOther
    : 0;
  const bucketsSplit = bucketActualSum >= 1;

  const bucketRows: BudgetPdfRow[] = BUCKET_ORDER.map((bucket) => {
    const budget = overheadBudget(doc, driverMonths, bucket);
    if (!hasActuals || !actualSum || !bucketsSplit) {
      return budgetOnlyRow(BUCKET_LABEL[bucket], budget);
    }
    const actual = actualSum[BUCKET_ACTUAL[bucket]] || 0;
    const v = varianceLine(
      bucket === "people"
        ? "overheads_people"
        : bucket === "premises"
          ? "overheads_premises"
          : bucket === "ops"
            ? "overheads_ops"
            : bucket === "sales"
              ? "overheads_sales"
              : "overheads_other",
      BUCKET_LABEL[bucket],
      budget,
      actual,
      false,
    );
    return fromVariance(v, BUCKET_LABEL[bucket]);
  }).filter((r) => Math.abs(r.budget) >= 1 || (r.actual != null && Math.abs(r.actual) >= 1));

  const inclusiveVat =
    doc.tax?.regime === "vat" ? doc.tax.vatMode === "inclusive" : doc.vatMode === "inclusive";

  const sections: BudgetPdfSection[] = [
    {
      title: "Profit and loss",
      note: hasActuals
        ? "Budget and actual are summed over the months that have an uploaded actual."
        : "Full-year budget. Actual and variance stay blank until a month is uploaded.",
      rows: pnlRows,
    },
  ];
  if (driverRows.length) {
    sections.push({
      title: "Revenue drivers",
      note: inclusiveVat
        ? "Entered amounts for the active scenario, same months as the P&L. P&L revenue above is ex-VAT."
        : "Entered amounts for the active scenario, same months as the P&L. Actuals stay at P&L totals.",
      rows: driverRows,
    });
  }
  if (bucketRows.length) {
    sections.push({
      title: "Overheads",
      note:
        hasActuals && !bucketsSplit
          ? "Uploaded actuals were not split into overhead groups, so this section is the budget plan only. Operating expenses in the P&L include the total."
          : "Grouped the same way month actuals are stored. Higher actual cost is adverse.",
      rows: bucketRows,
    });
  }

  const comparedLabel = hasActuals
    ? monthsAreContiguous(fy, comparedMonths)
      ? contiguousLabel(comparedMonths, market)
      : `${comparedMonths.length} months with actuals (not consecutive)`
    : "No month actuals uploaded";

  const fySum = sumBudget(results);
  const fullYearNote = hasActuals
    ? comparedMonths.length < fy.length
      ? `Full-year budget revenue ${money(fySum.revenue, market)}, profit ${money(fySum.ebit, market)}. Variance covers ${comparedLabel} only. Opening cash ${money(doc.openingCash || 0, market)}.`
      : `Variance covers the full budget year. Opening cash ${money(doc.openingCash || 0, market)}.`
    : `Full-year budget. Opening cash ${money(doc.openingCash || 0, market)}.`;

  const notes = [...(doc.notes ?? [])]
    .filter((n) => n.text?.trim())
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 4)
    .map((n) => ({ at: n.at, by: n.by || "Partner", text: n.text.trim() }));

  const scenarioLabel = doc.scenarios[doc.activeScenario]?.label || doc.activeScenario;

  const modelBase: BudgetPdfModel = {
    periodLabel: budgetWindowLabel(doc, market),
    scenarioLabel,
    currency: market.currency,
    comparedLabel,
    hasActuals,
    includesDraftActuals,
    fullYearNote,
    headline: "",
    summary,
    sections,
    notes,
    openingCash: doc.openingCash || 0,
  };

  return {
    ...modelBase,
    headline: headlineFor(summary, hasActuals, includesDraftActuals, market),
  };
}

/** Studio preview only — never shipped under a live client name. */
export function illustrativeBudgetPack(fyStart = "2026-01"): {
  doc: BudgetDocument;
  actuals: BudgetPdfActual[];
} {
  const doc = createBudgetDocument({
    templateId: "services_hours",
    fyStart,
    fyStartMonth: 1,
    qualification: {
      payMotion: "time_delivery",
      volumeUnit: "billable_hours",
      driverKind: "hours_rate",
      costShape: "payroll_heavy",
      debtorDaysDefault: 30,
      capexMode: "none",
      confirmedAt: "2026-01-15T00:00:00.000Z",
    },
  });
  const months = fyMonths(fyStart);
  if (doc.revenueLines[0]) {
    const filled: BudgetDocument["revenueLines"][0]["months"] = {};
    for (const m of months) filled[m] = { volume: 80, price: 1500 };
    doc.revenueLines[0] = { ...doc.revenueLines[0], months: filled };
  }
  doc.overheads = doc.overheads.map((line) => {
    if (line.bucket !== "people") return line;
    const filled: Record<string, number> = {};
    for (const m of months) filled[m] = 40_000;
    return { ...line, months: filled };
  });
  doc.openingCash = 250_000;
  doc.notes = [
    {
      id: "note_demo",
      at: "2026-03-02T10:00:00.000Z",
      by: "Partner",
      text: "March revenue is light of plan — confirm whether hours slipped or rate did.",
      kind: "note",
    },
  ];

  const actualMonth = months[2] ?? months[0];
  return {
    doc,
    actuals: [
      {
        month: actualMonth,
        status: "confirmed",
        totals: {
          revenue: 100_000,
          cogs: 50_000,
          grossProfit: 50_000,
          overheadsPeople: 48_000,
          overheadsPremises: 0,
          overheadsOps: 0,
          overheadsSales: 0,
          overheadsOther: 0,
          overheadsTotal: 48_000,
          depreciation: 0,
          ebit: 2_000,
        },
      },
    ],
  };
}
