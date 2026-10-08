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
import { presentBudgetRebuildNote } from "@/lib/budget.bridges";
import { periodProfitBridge } from "@/lib/period-profit";
import { periodMonthsOf } from "@/lib/ratios";
import { inAppAccountantSignoffLine } from "@/lib/review-signoff-stamp";
import { readStatementMeta } from "@/lib/statement-period";

export type BudgetPdfActual = {
  month: string;
  status: ActualsStatus;
  totals: Partial<TaxonomyTotals>;
  /**
   * Set when this row is the whole statement, not one uploaded month.
   * Budget is summed over this many months of the plan. The actual is the
   * statement total once.
   */
  statementCoverMonths?: number;
  /** Interest between EBIT and profit before tax. Zero when the statement has none. */
  interest?: number;
  /** Tax between profit before tax and net profit. */
  tax?: number;
  /**
   * The statement gave one operating-expense total and no People / Premises /
   * Operations / Sales split. Do not book that total as Other.
   */
  overheadsUnsplit?: boolean;
  /** Statement period label, used when the month key is outside the plan. */
  periodLabel?: string | null;
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

/** Drop keyboard-mash placeholders such as "fddff" so they cannot print on the PDF. */
export function scrubPlaceholderText(text: string): string {
  return text
    .replace(/\bfddff\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
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
  if (months.length === 0) return "No monthly management accounts uploaded yet";
  if (months.length === 1) return formatMonthLabel(months[0], market);
  const first = formatMonthLabel(months[0], market);
  const last = formatMonthLabel(months[months.length - 1], market);
  return `${first} – ${last} · ${months.length} months`;
}

/**
 * FY months the statement covers. A 12-month cover is the whole plan, even
 * when the statement is dated in September. A shorter cover is that many
 * months ending on the statement month.
 */
export function budgetMonthsForCover(fy: string[], endMonth: string, periodMonths: number): string[] {
  const n = Math.max(1, Math.min(fy.length, Math.round(periodMonths)));
  if (n >= fy.length) return fy.slice();
  const endIdx = fy.indexOf(endMonth);
  if (endIdx < 0) return fy.slice(0, n);
  const startIdx = endIdx - n + 1;
  if (startIdx >= 0) return fy.slice(startIdx, endIdx + 1);
  return fy.slice(0, n);
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
    return "No monthly management accounts uploaded yet. The figures are the saved budget. Variance fills in after management accounts are uploaded on the Budget tab.";
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

function finiteField(fin: Record<string, unknown>, key: string): number | null {
  const v = fin[key];
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * One month of actuals from the same statement figures the other reports use.
 * Used when `budget_month_actuals` is empty so #11 does not say "No month actuals"
 * while the scorecard is full of that period's revenue and costs.
 */
export type BudgetReviewWorkflow = "draft" | "ready_for_review" | "signed_off";

/**
 * The line the Budget PDF prints under the title. It matches the tab:
 * a named sign-off, the same line marked stale after an input change,
 * ready for review, or draft.
 */
export function budgetReviewLine(input: {
  name?: string | null;
  firmName?: string | null;
  signedOffAt?: string | null;
  isStale: boolean;
  workflowStatus?: BudgetReviewWorkflow | null;
  market?: Pick<ResolvedMarket, "locale" | "timezone">;
}): { text: string; unsigned: boolean } {
  const signed = inAppAccountantSignoffLine({
    name: input.name,
    firmName: input.firmName,
    signedOffAt: input.signedOffAt,
    market: input.market,
  });
  if (signed && !input.isStale) return { text: signed, unsigned: false };
  if (signed && input.isStale) {
    return { text: `${signed} · then changed`, unsigned: true };
  }
  if (input.workflowStatus === "ready_for_review") {
    return { text: "Ready for review", unsigned: true };
  }
  return { text: "Draft", unsigned: true };
}

/** Footer mark for an unsigned Budget PDF. Matches the tab status, not a generic draft. */
export function budgetDraftMark(reviewText: string): string {
  if (reviewText.startsWith("Ready for review")) return "READY FOR REVIEW";
  if (/then changed/i.test(reviewText)) return "SIGNED OFF, THEN CHANGED";
  return "DRAFT";
}

export function budgetActualFromFinancials(
  fin: Record<string, unknown> | null | undefined,
): BudgetPdfActual | null {
  if (!fin) return null;
  const meta = readStatementMeta(fin);
  const month = meta.periodEnd?.slice(0, 7) ?? "";
  const monthOk = /^\d{4}-\d{2}$/.test(month);
  const revenue = finiteField(fin, "revenue");
  const cogs = finiteField(fin, "cogs");
  const ebit = finiteField(fin, "ebit");
  if (revenue == null && cogs == null && ebit == null) return null;
  const bridge = periodProfitBridge(fin);
  if (!(bridge.revenue || bridge.cogs || bridge.operatingExpenses || bridge.ebit)) return null;
  return {
    month: monthOk ? month : "",
    periodLabel: meta.periodLabel,
    status: "confirmed",
    totals: {
      revenue: bridge.revenue,
      cogs: bridge.cogs,
      grossProfit: bridge.grossProfit,
      // A single operating-expense total is not the Other bucket.
      overheadsPeople: 0,
      overheadsPremises: 0,
      overheadsOps: 0,
      overheadsSales: 0,
      overheadsOther: 0,
      overheadsTotal: bridge.operatingExpenses,
      depreciation: bridge.depreciation,
      ebit: bridge.ebit,
    },
    interest: bridge.interest,
    tax: bridge.tax,
    overheadsUnsplit: true,
    statementCoverMonths: periodMonthsOf(fin),
  };
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
  const statementCandidate =
    actuals.find((row) => row.statementCoverMonths != null) ??
    (actuals.length === 1 ? actuals[0] : undefined);
  let comparedMonths = fy.filter((m) => actualByMonth.has(m));
  // A statement with revenue but no month inside this financial year is still
  // an actual. Pin it on the cover window instead of saying none exist.
  if (comparedMonths.length === 0 && statementCandidate?.statementCoverMonths != null && fy[0]) {
    const cover = Math.max(1, Math.round(statementCandidate.statementCoverMonths));
    const anchor = fy[Math.min(fy.length, cover) - 1];
    actualByMonth.set(anchor, { ...statementCandidate, month: anchor });
    comparedMonths = [anchor];
  }
  const hasActuals = comparedMonths.length > 0;
  const includesDraftActuals = comparedMonths.some((m) => actualByMonth.get(m)?.status === "draft");
  const statementRow = statementCandidate;
  const statementCover =
    hasActuals && statementRow?.statementCoverMonths != null
      ? statementRow.statementCoverMonths
      : null;
  const budgetAnchor = fy.includes(statementRow?.month ?? "")
    ? (statementRow?.month ?? comparedMonths[0])
    : comparedMonths[0];
  const budgetMonthKeys =
    statementCover != null
      ? budgetMonthsForCover(fy, budgetAnchor, statementCover)
      : comparedMonths;

  const budgetWindow = hasActuals
    ? budgetMonthKeys.map((m) => byMonth.get(m)).filter((r): r is BudgetMonthResult => Boolean(r))
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

  const driverMonths = hasActuals ? budgetMonthKeys : fy;
  const pricedDrivers = doc.revenueLines
    .map((line) => ({
      label: scrubPlaceholderText(line.name || "") || "Revenue line",
      budget: revenueDriverBudget(doc, driverMonths, line.id),
    }))
    .filter((row) => Math.abs(row.budget) >= 1);
  // One driver has no split to recover from the statement, so its actual is
  // the P&L revenue total. Several drivers stay blank rather than inventing a split.
  const singleDriverRevenue =
    pricedDrivers.length === 1 && hasActuals && actualSum ? actualSum.revenue : null;
  const driverRows: BudgetPdfRow[] = pricedDrivers.map((row) =>
    singleDriverRevenue != null
      ? fromVariance(
          varianceLine("revenue", row.label, row.budget, singleDriverRevenue, true),
          row.label,
        )
      : budgetOnlyRow(row.label, row.budget),
  );
  const singleDriver = singleDriverRevenue != null;

  const bucketActualSum = actualSum
    ? actualSum.overheadsPeople +
      actualSum.overheadsPremises +
      actualSum.overheadsOps +
      actualSum.overheadsSales +
      actualSum.overheadsOther
    : 0;
  const overheadsUnsplit =
    hasActuals && comparedMonths.some((m) => actualByMonth.get(m)?.overheadsUnsplit);
  const bucketsSplit = !overheadsUnsplit && bucketActualSum >= 1;

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
        ? statementCover != null
          ? "Budget is prorated to the same period the statement actuals cover."
          : "Budget and actual are summed over the months that have an uploaded actual."
        : "Full-year budget. Actual and variance stay blank until a month is uploaded.",
      rows: pnlRows,
    },
  ];
  if (driverRows.length) {
    sections.push({
      title: "Revenue drivers",
      note: singleDriver
        ? "One revenue driver, so the actual is the P&L revenue total for the same period."
        : inclusiveVat
          ? "Entered amounts for the active scenario, same months as the P&L. P&L revenue above is ex-VAT."
          : "Entered amounts for the active scenario, same months as the P&L.",
      rows: driverRows,
    });
  }
  if (hasActuals && actualSum) {
    let interest = 0;
    let tax = 0;
    for (const month of comparedMonths) {
      const row = actualByMonth.get(month);
      interest += row?.interest ?? 0;
      tax += row?.tax ?? 0;
    }
    if (Math.abs(interest) >= 1 || Math.abs(tax) >= 1) {
      const profit = pnlRows.find((row) => row.label === DISPLAY_LABEL.ebit);
      const profitBudget = profit?.budget ?? budgetSum.ebit;
      const profitActual = profit?.actual ?? actualSum.ebit;
      if (Math.abs(interest) >= 1) {
        pnlRows.push(
          fromVariance(varianceLine("unmapped", "Interest", 0, interest, false), "Interest"),
        );
      }
      if (Math.abs(tax) >= 1) {
        pnlRows.push(fromVariance(varianceLine("unmapped", "Tax", 0, tax, false), "Tax"));
      }
      pnlRows.push(
        fromVariance(
          varianceLine(
            "ebit",
            "Net profit",
            profitBudget,
            profitActual - interest - tax,
            true,
          ),
          "Net profit",
          true,
        ),
      );
    }
  }

  if (bucketRows.length) {
    sections.push({
      title: "Overheads",
      note: overheadsUnsplit
        ? "The statement does not split operating expenses into People, Premises, Operations, or Sales, so this section is the budget plan only."
        : hasActuals && !bucketsSplit
          ? "Uploaded actuals were not split into overhead groups, so this section is the budget plan only. Operating expenses in the P&L include the total."
          : "Grouped the same way month actuals are stored. Higher actual cost is adverse.",
      rows: bucketRows,
    });
  }

  const labelMonths = hasActuals ? budgetMonthKeys : comparedMonths;
  const pinnedStatementLabel =
    hasActuals && statementRow && !fy.includes(statementRow.month) ? statementRow.periodLabel : null;
  const comparedLabel = pinnedStatementLabel
    ? pinnedStatementLabel
    : hasActuals
      ? monthsAreContiguous(fy, labelMonths)
        ? contiguousLabel(labelMonths, market)
        : `${labelMonths.length} months with actuals (not consecutive)`
      : "No monthly management accounts uploaded yet";

  const fySum = sumBudget(results);
  const fullYearNote = hasActuals
    ? labelMonths.length < fy.length
      ? `Full-year budget revenue ${money(fySum.revenue, market)}, profit ${money(fySum.ebit, market)}. Variance covers ${comparedLabel} only. Opening cash ${money(doc.openingCash || 0, market)}.`
      : `Variance covers the full budget year. Opening cash ${money(doc.openingCash || 0, market)}.`
    : `Full-year budget. Opening cash ${money(doc.openingCash || 0, market)}.`;

  const notes = [...(doc.notes ?? [])]
    .map((n) => ({ ...n, text: scrubPlaceholderText(n.text ?? "") }))
    .filter((n) => n.text)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 4)
    .map((n) => ({
      at: n.at,
      by: n.by || "Partner",
      text: presentBudgetRebuildNote(n.text),
    }));

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
