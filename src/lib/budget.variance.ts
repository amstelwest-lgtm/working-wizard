/**
 * Budget vs actuals — taxonomy, ingest mapping, and variance engine.
 * All sources (PDF / QBO / Xero / manual) normalize into TaxonomyTotals first.
 */

import type { BudgetMonthResult } from "@/lib/budget.types";
import type { MergedExtractionResult } from "@/lib/extraction-types";

export type ActualsSource = "pdf" | "qbo" | "xero" | "manual";
export type ActualsStatus = "draft" | "confirmed";

export type VarianceTaxonomyKey =
  | "revenue"
  | "cogs"
  | "gross_profit"
  | "overheads_people"
  | "overheads_premises"
  | "overheads_ops"
  | "overheads_sales"
  | "overheads_other"
  | "overheads_total"
  | "depreciation"
  | "ebit"
  | "unmapped";

export type TaxonomyTotals = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  overheadsPeople: number;
  overheadsPremises: number;
  overheadsOps: number;
  overheadsSales: number;
  overheadsOther: number;
  overheadsTotal: number;
  depreciation: number;
  ebit: number;
};

export type MappedActualLine = {
  taxonomyKey: VarianceTaxonomyKey;
  amount: number;
  rawLabel?: string;
};

export type BudgetMonthActualRow = {
  id: string;
  clientId: string;
  month: string;
  source: ActualsSource;
  sourceRef: string | null;
  status: ActualsStatus;
  totals: TaxonomyTotals;
  lines: MappedActualLine[];
  periodStart: string | null;
  periodEnd: string | null;
  confidence: number | null;
  warnings: string[];
  confirmedAt: string | null;
  updatedAt: string;
};

export type VarianceSignal = "favourable" | "adverse" | "inline";

export type VarianceLine = {
  key: VarianceTaxonomyKey;
  label: string;
  budget: number;
  actual: number;
  delta: number;
  deltaPct: number | null;
  /** For cost lines, higher actual is adverse; for revenue, higher is favourable. */
  higherIsBetter: boolean;
  signal: VarianceSignal;
};

export type MonthVarianceReport = {
  month: string;
  lines: VarianceLine[];
  headline: string;
  topAdverse: VarianceLine[];
  hasMaterialVariance: boolean;
};

const EMPTY_TOTALS: TaxonomyTotals = {
  revenue: 0,
  cogs: 0,
  grossProfit: 0,
  overheadsPeople: 0,
  overheadsPremises: 0,
  overheadsOps: 0,
  overheadsSales: 0,
  overheadsOther: 0,
  overheadsTotal: 0,
  depreciation: 0,
  ebit: 0,
};

export function emptyTaxonomyTotals(): TaxonomyTotals {
  return { ...EMPTY_TOTALS };
}

export function normalizeTaxonomyTotals(
  partial: Partial<TaxonomyTotals> | null | undefined,
): TaxonomyTotals {
  const t = { ...EMPTY_TOTALS, ...(partial ?? {}) };
  for (const k of Object.keys(t) as (keyof TaxonomyTotals)[]) {
    const n = Number(t[k]);
    t[k] = Number.isFinite(n) ? n : 0;
  }
  if (!t.grossProfit && (t.revenue || t.cogs)) {
    t.grossProfit = t.revenue - t.cogs;
  }
  const bucketSum =
    t.overheadsPeople +
    t.overheadsPremises +
    t.overheadsOps +
    t.overheadsSales +
    t.overheadsOther;
  if (!t.overheadsTotal && bucketSum) t.overheadsTotal = bucketSum;
  return t;
}

/** Material if |Δ| ≥ R5,000 and |Δ%| ≥ 5% (when budget ≠ 0). */
export function isMaterialVariance(line: Pick<VarianceLine, "budget" | "delta" | "deltaPct">): boolean {
  if (Math.abs(line.delta) < 5_000) return false;
  if (line.budget === 0) return Math.abs(line.delta) >= 5_000;
  return line.deltaPct != null && Math.abs(line.deltaPct) >= 5;
}

function signalFor(delta: number, higherIsBetter: boolean): VarianceSignal {
  if (Math.abs(delta) < 1) return "inline";
  const favourable = higherIsBetter ? delta > 0 : delta < 0;
  return favourable ? "favourable" : "adverse";
}

function line(
  key: VarianceTaxonomyKey,
  label: string,
  budget: number,
  actual: number,
  higherIsBetter: boolean,
): VarianceLine {
  const delta = actual - budget;
  const deltaPct = budget !== 0 ? (delta / Math.abs(budget)) * 100 : null;
  return {
    key,
    label,
    budget,
    actual,
    delta,
    deltaPct,
    higherIsBetter,
    signal: signalFor(delta, higherIsBetter),
  };
}

/** Build month variance from computed budget month + taxonomy actuals. */
export function computeMonthVariance(
  budget: BudgetMonthResult,
  actual: TaxonomyTotals,
  month = budget.month,
): MonthVarianceReport {
  const a = normalizeTaxonomyTotals(actual);
  const lines: VarianceLine[] = [
    line("revenue", "Revenue", budget.revenue, a.revenue, true),
    line("cogs", "COGS", budget.cogs, a.cogs, false),
    line("gross_profit", "Gross profit", budget.grossProfit, a.grossProfit, true),
    line("overheads_total", "Overheads", budget.overheads, a.overheadsTotal, false),
    line("depreciation", "Depreciation", budget.depreciation, a.depreciation, false),
    line("ebit", "EBIT", budget.ebit, a.ebit, true),
  ];

  const material = lines.filter(isMaterialVariance);
  const topAdverse = material
    .filter((l) => l.signal === "adverse")
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    .slice(0, 3);

  const rev = lines.find((l) => l.key === "revenue")!;
  const oh = lines.find((l) => l.key === "overheads_total")!;
  let headline: string;
  if (topAdverse.length === 0) {
    headline = "Trading is broadly in line with budget this month.";
  } else if (rev.signal === "adverse" && isMaterialVariance(rev)) {
    headline = `Revenue missed budget by ${fmtDelta(rev.delta)} — the main variance driver.`;
  } else if (oh.signal === "adverse" && isMaterialVariance(oh)) {
    headline = `Overheads ran ${fmtDelta(Math.abs(oh.delta))} over budget.`;
  } else {
    headline = `${topAdverse[0].label} is the largest adverse variance (${fmtDelta(topAdverse[0].delta)}).`;
  }

  return {
    month,
    lines,
    headline,
    topAdverse,
    hasMaterialVariance: material.some((l) => l.signal === "adverse"),
  };
}

function fmtDelta(n: number): string {
  const abs = Math.abs(n);
  const formatted =
    abs >= 1_000_000
      ? `R${(abs / 1_000_000).toFixed(1)}m`
      : abs >= 1_000
        ? `R${Math.round(abs / 1_000)}k`
        : `R${Math.round(abs)}`;
  return n < 0 ? `−${formatted}` : formatted;
}

/** Infer YYYY-MM from period end (preferred) or start. */
export function monthFromPeriod(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
): string | null {
  const end = periodEnd?.slice(0, 10);
  const start = periodStart?.slice(0, 10);
  const pick = end || start;
  if (!pick || !/^\d{4}-\d{2}-\d{2}/.test(pick)) return null;
  return pick.slice(0, 7);
}

/**
 * Map a management-accounts / P&L extraction into monthly taxonomy totals.
 * Labor → people overhead; remaining fixed costs → other (until finer mapping exists).
 */
export function actualsFromExtraction(
  result: MergedExtractionResult,
  monthOverride?: string | null,
): {
  month: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totals: TaxonomyTotals;
  lines: MappedActualLine[];
  confidence: number;
  warnings: string[];
} {
  const is = result.current_period?.income_statement;
  const meta = result.document_metadata;
  const periodStart = meta?.period_start_date ?? null;
  const periodEnd = meta?.period_end_date ?? null;
  const month = monthOverride || monthFromPeriod(periodStart, periodEnd);

  const revenue = num(is?.revenue);
  const cogs = num(is?.cogs);
  const grossProfit = num(is?.gross_profit) || revenue - cogs;
  const labor = num(is?.labor_cost);
  const fixed = num(is?.fixed_costs);
  const depreciation =
    num(is?.depreciation_amortisation_total) ||
    num(is?.depreciation) + num(is?.amortisation);
  const ebit = num(is?.ebit);

  // Split fixed costs: labor → people; remainder → other (ops/premises unknown from flat extract).
  const overheadsPeople = labor > 0 ? labor : 0;
  const overheadsOther =
    fixed > 0 ? Math.max(0, fixed - (labor > 0 ? labor : 0)) : labor > 0 ? 0 : 0;
  const overheadsTotal =
    overheadsPeople + overheadsOther || fixed || labor;

  const totals = normalizeTaxonomyTotals({
    revenue,
    cogs,
    grossProfit,
    overheadsPeople,
    overheadsPremises: 0,
    overheadsOps: 0,
    overheadsSales: 0,
    overheadsOther,
    overheadsTotal,
    depreciation,
    ebit: ebit || grossProfit - overheadsTotal - depreciation,
  });

  const lines: MappedActualLine[] = [];
  if (revenue) lines.push({ taxonomyKey: "revenue", amount: revenue, rawLabel: "Revenue" });
  if (cogs) lines.push({ taxonomyKey: "cogs", amount: cogs, rawLabel: "COGS" });
  if (overheadsPeople)
    lines.push({ taxonomyKey: "overheads_people", amount: overheadsPeople, rawLabel: "Labor / staff costs" });
  if (overheadsOther)
    lines.push({ taxonomyKey: "overheads_other", amount: overheadsOther, rawLabel: "Other fixed costs" });
  if (depreciation)
    lines.push({ taxonomyKey: "depreciation", amount: depreciation, rawLabel: "Depreciation" });

  const warnings: string[] = [];
  if (!month) warnings.push("Could not detect the month — please confirm YYYY-MM.");
  if (!revenue && !cogs && !fixed)
    warnings.push("No P&L totals found — check you uploaded management accounts for one month.");
  if (meta?.period_months && meta.period_months > 1) {
    warnings.push(
      `Document looks like a ${meta.period_months}-month period, not a single month — confirm before saving.`,
    );
  }
  const note = result.data_quality?.extraction_notes?.trim();
  if (note) warnings.push(note);

  const confLabel = result.data_quality?.overall_confidence;
  const confidence =
    confLabel === "high" ? 0.85 : confLabel === "medium" ? 0.6 : confLabel === "low" ? 0.35 : revenue || cogs ? 0.7 : 0.3;

  return {
    month,
    periodStart,
    periodEnd,
    totals,
    lines,
    confidence,
    warnings: [...new Set(warnings)].slice(0, 12),
  };
}

function num(v: number | null | undefined): number {
  if (v == null || !Number.isFinite(v)) return 0;
  return v;
}

export function formatVariancePct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
