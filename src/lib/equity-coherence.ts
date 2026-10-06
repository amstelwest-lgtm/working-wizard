/**
 * One equity figure for trial-balance import, ratios, and PDF reports.
 *
 * A pre-close trial balance keeps current-period profit on the P&L. Total
 * equity for reporting is the equity lines plus that profit — not the lines
 * alone, and not a second addition when the sheet is already closed or the
 * equity total was plugged from assets − liabilities.
 */

import { PERIOD_MONTHS_KEY, periodMonthsOf } from "@/lib/ratios";
import { defaultPeriodCoverage } from "@/lib/statement-period";

export const EQUITY_CROSSCHECK_WARNING =
  "Equity lines plus current-period profit differ from assets minus liabilities by more than 1%.";

export const LEVERAGE_REPORT_NEEDS = "Leverage report needs equity and total assets.";
export const ASSET_REPORT_NEEDS =
  "Asset productivity needs asset turnover, equity multiplier, and net margin.";

const RELATIVE_GAP = 0.01;

function finiteField(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.replace(/[,\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function relativeGap(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1);
}

/** Printed total, else current plus non-current. Payables are not a total. */
export function explicitLiabilityTotal(fields: Record<string, unknown> | null | undefined): number | null {
  const source = fields ?? {};
  const total = finiteField(source.totalLiabilities);
  if (total != null) return total;
  const current = finiteField(source.currentLiabilities);
  const nonCurrent = finiteField(source.nonCurrentLiabilities);
  if (current != null || nonCurrent != null) return round2((current ?? 0) + (nonCurrent ?? 0));
  return null;
}

export type EquityCrossCheck = {
  /** Reporting equity after a pre-close adjustment. Null when equity was blank. */
  equity: number | null;
  /** Assets − liabilities when both sides exist. */
  plug: number | null;
  profitIncluded: number;
  preClose: boolean;
  warning: string | null;
};

/**
 * Lines + unclosed profit when that moves the sheet closer to
 * Assets = Liabilities + Equity. A derived plug and a sheet that already
 * balances are left alone so profit is not added twice.
 */
export function equityCrossCheck(input: {
  equity: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  profit: number | null;
  derived?: boolean;
}): EquityCrossCheck {
  const equity = finiteField(input.equity);
  const assets = finiteField(input.totalAssets);
  const liab = finiteField(input.totalLiabilities);
  const profit = finiteField(input.profit);
  const plug = assets != null && liab != null ? round2(assets - liab) : null;
  let reporting = equity;
  let profitIncluded = 0;
  let preClose = false;
  if (
    input.derived !== true &&
    equity != null &&
    liab != null &&
    assets != null &&
    profit != null &&
    Math.abs(profit) > 0.005
  ) {
    const tol = Math.max(Math.abs(assets) * 0.005, 1);
    const raw = equity + liab - assets;
    const adjusted = raw + profit;
    if (Math.abs(raw) > tol && Math.abs(adjusted) < Math.abs(raw)) {
      reporting = round2(equity + profit);
      profitIncluded = round2(profit);
      preClose = true;
    }
  }
  const warning =
    reporting != null && plug != null && relativeGap(reporting, plug) > RELATIVE_GAP
      ? EQUITY_CROSSCHECK_WARNING
      : null;
  return { equity: reporting, plug, profitIncluded, preClose, warning };
}

export type CoherentEquity = {
  equity: string;
  derived: boolean;
  preClose: boolean;
  warning: string | null;
  profitIncluded: number;
};

function derivedFlag(fields: Record<string, unknown>): boolean {
  return String(fields.equityDerived ?? "") === "1" || fields.equity_derived === true;
}

/**
 * Equity a ratio or report should use.
 * Blank equity plugs assets − liabilities (payables count only for that blank).
 * A typed figure is increased by net income only when an explicit liability
 * total exists and the sheet is pre-close. Calling this twice is a no-op
 * once equity + liabilities already equals assets.
 */
export function coherentEquity(fields: Record<string, unknown> | null | undefined): CoherentEquity {
  const source = fields ?? {};
  const equityRaw = source.equity == null ? "" : String(source.equity).trim();
  const alreadyDerived = derivedFlag(source);
  const assets = finiteField(source.totalAssets);
  const profit = finiteField(source.netIncome);
  const explicit = explicitLiabilityTotal(source);

  if (equityRaw === "") {
    const liabilities = explicit ?? finiteField(source.payables);
    if (assets == null || liabilities == null) {
      return { equity: "", derived: false, preClose: false, warning: null, profitIncluded: 0 };
    }
    return {
      equity: String(round2(assets - liabilities)),
      derived: true,
      preClose: false,
      warning: null,
      profitIncluded: 0,
    };
  }

  const equity = finiteField(equityRaw);
  if (equity == null || alreadyDerived || explicit == null) {
    const plug = assets != null && explicit != null ? round2(assets - explicit) : null;
    const warning =
      equity != null && plug != null && relativeGap(equity, plug) > RELATIVE_GAP
        ? EQUITY_CROSSCHECK_WARNING
        : null;
    return { equity: equityRaw, derived: alreadyDerived, preClose: false, warning, profitIncluded: 0 };
  }

  const check = equityCrossCheck({
    equity,
    totalAssets: assets,
    totalLiabilities: explicit,
    profit,
    derived: false,
  });
  return {
    equity: check.preClose && check.equity != null ? String(check.equity) : equityRaw,
    derived: false,
    preClose: check.preClose,
    warning: check.warning,
    profitIncluded: check.profitIncluded,
  };
}

/** True when a cash-flow statement supplied operating cash flow, including a genuine zero. */
export function cashFlowKnown(fields: Record<string, unknown> | null | undefined): boolean {
  return String(fields?.hasCashFlow ?? "") === "1";
}

function blobIsPreClose(fields: Record<string, unknown>): boolean {
  const flag = fields.periodProfitInEquity;
  if (flag != null && String(flag).trim() !== "" && String(flag) !== "0") return true;
  return equityCrossCheck({
    equity: finiteField(fields.equity),
    totalAssets: finiteField(fields.totalAssets),
    totalLiabilities: explicitLiabilityTotal(fields),
    profit: finiteField(fields.netIncome),
    derived: derivedFlag(fields),
  }).preClose;
}

/**
 * Months the P&L covers. A stored periodMonths wins. Otherwise a dated
 * statement supplies the span: month-end pre-close is calendar YTD, a
 * part-month is 1, and anything else stays on the historical 12-month default.
 */
export function effectivePeriodMonths(fin: Record<string, unknown> | null | undefined): number {
  const raw = fin?.[PERIOD_MONTHS_KEY];
  if (raw != null && String(raw).trim() !== "") return periodMonthsOf(fin);
  const start = fin?.periodStart != null ? String(fin.periodStart) : "";
  const end = fin?.periodEnd != null ? String(fin.periodEnd) : "";
  if (start.trim() || end.trim()) {
    return defaultPeriodCoverage({
      periodStart: start,
      periodEnd: end,
      preClose: fin ? blobIsPreClose(fin) : false,
    }).months;
  }
  return 12;
}

function blankUnstatedCashFlow(scalars: Record<string, string>): void {
  if (cashFlowKnown(scalars)) return;
  const ocf = String(scalars.operatingCashflow ?? "").trim();
  if (ocf === "0" || ocf === "0.0" || ocf === "0.00") scalars.operatingCashflow = "";
}

/** Flat financials with coherent equity, explicit liabilities, and a blank fake OCF. */
export function reportScalarInputs(
  financials: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const scalars: Record<string, string> = {};
  for (const [key, value] of Object.entries(financials ?? {})) {
    if (value == null || typeof value === "object") continue;
    scalars[key] = String(value);
  }
  if (!scalars.totalLiabilities?.trim()) {
    const summed = explicitLiabilityTotal(scalars);
    if (summed != null) scalars.totalLiabilities = String(summed);
  }
  const months = effectivePeriodMonths(scalars);
  const coherent = coherentEquity(scalars);
  if (coherent.equity !== "") scalars.equity = coherent.equity;
  if (coherent.derived) scalars.equityDerived = "1";
  if (coherent.preClose) scalars.periodProfitInEquity = String(coherent.profitIncluded);
  if (!scalars.periodMonths?.trim()) scalars.periodMonths = String(months);
  blankUnstatedCashFlow(scalars);
  return scalars;
}

export type ReportInputReadiness = {
  scalars: Record<string, string>;
  equity: number;
  totalAssets: number;
  leverageReady: boolean;
  assetReady: boolean;
  unavailable: { leverage: string | null; assets: string | null };
};

/** Whether Asset Productivity and Leverage & Solvency have the figures they require. */
export function reportInputsFromFinancials(
  financials: Record<string, unknown> | null | undefined,
): ReportInputReadiness {
  const scalars = reportScalarInputs(financials);
  const num = (key: string) => {
    const raw = scalars[key];
    if (raw == null || raw.trim() === "") return Number.NaN;
    const n = Number(raw);
    return Number.isFinite(n) ? n : Number.NaN;
  };
  const equity = num("equity");
  const totalAssets = num("totalAssets");
  const revenue = num("revenue");
  const netIncome = num("netIncome");
  const netMargin =
    Number.isFinite(revenue) && revenue !== 0 && Number.isFinite(netIncome) ? netIncome / revenue : Number.NaN;
  const assetTurnover =
    Number.isFinite(revenue) && Number.isFinite(totalAssets) && totalAssets !== 0
      ? revenue / totalAssets
      : Number.NaN;
  const equityMultiplier =
    Number.isFinite(totalAssets) && Number.isFinite(equity) && equity !== 0 ? totalAssets / equity : Number.NaN;
  const leverageReady = Number.isFinite(equity) && Number.isFinite(totalAssets);
  const assetReady =
    Number.isFinite(assetTurnover) && Number.isFinite(equityMultiplier) && Number.isFinite(netMargin);
  return {
    scalars,
    equity,
    totalAssets,
    leverageReady,
    assetReady,
    unavailable: {
      leverage: leverageReady ? null : LEVERAGE_REPORT_NEEDS,
      assets: assetReady ? null : ASSET_REPORT_NEEDS,
    },
  };
}
