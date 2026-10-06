/**
 * Contra-asset netting for a text layer that still has labels beside amounts.
 *
 * A mid-year trial balance prints equipment at cost and accumulated
 * depreciation on separate lines. The carrying amount is cost minus that
 * contra. Equity stays the printed equity total. A scrambled extract (amounts
 * detached from labels) returns nothing so the caller keeps the model figures
 * and can still send the original document.
 *
 * Deno-safe: no Node APIs.
 */
import type { ExtractionResult } from "./financialSchema.ts";

/** Shared instruction for every financial-statement prompt. */
export const CONTRA_ASSET_EXTRACTION_RULE =
  "Accumulated depreciation and other contra-asset balances reduce the related asset. Report property, plant and equipment and total assets at carrying amount (cost minus accumulated depreciation), not at gross cost. Do not add that contra-asset credit into equity. When a total equity line is printed, use that figure as equity.";

const MONEY_RE =
  /\((?:\d{1,3}(?:[ \u00a0,]\d{3})+|\d+)(?:\.\d+)?\)|-?(?:\d{1,3}(?:[ \u00a0,]\d{3})+|\d+)(?:\.\d+)?/g;

export type StatementLine = {
  label: string;
  amount: number;
};

export type ContraAssetPair = {
  gross: number;
  accumulatedDepreciation: number;
  net: number;
};

export type ReconciledTotals = {
  totalAssets: number | null;
  equity: number | null;
  netPpe: number | null;
  gross: number | null;
  adjusted: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nearly(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);
}

function moneyTokens(line: string): number[] {
  const out: number[] = [];
  for (const match of line.matchAll(MONEY_RE)) {
    const raw = match[0];
    const bare =
      !raw.includes(",") && !raw.includes(" ") && !raw.includes(".") && !raw.includes("(");
    const n = Number(raw.replace(/[(),\s-]/g, ""));
    if (!Number.isFinite(n)) continue;
    if (bare && n >= 1900 && n <= 2100) continue;
    const negative = raw.startsWith("(") || raw.startsWith("-");
    out.push(negative ? -Math.abs(n) : n);
  }
  return out;
}

/** Current-year column is first when a comparative amount is also on the line. */
export function statementLines(text: string): StatementLine[] {
  const lines: StatementLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tokens = moneyTokens(line);
    if (!tokens.length) continue;
    const label = line.replace(MONEY_RE, " ").replace(/\s+/g, " ").trim();
    if (!/[A-Za-z]{2,}/.test(label)) continue;
    lines.push({ label, amount: tokens[0] });
  }
  return lines;
}

function isContraLabel(label: string): boolean {
  return /\b(?:accum(?:ulated)?\.?\s+dep(?:reciation)?|accum\.?\s*dep\.?|provision\s+for\s+depreciation|less:?\s+accumulated\s+depreciation)\b/i.test(
    label,
  );
}

function isGrossPpeLabel(label: string): boolean {
  if (isContraLabel(label)) return false;
  if (/\b(?:depreciation|amortisation|amortization)\s+expense\b/i.test(label)) return false;
  return /\b(?:equipment|plant\s+and\s+(?:machinery|equipment)|property,?\s+plant|machinery|furniture(?:\s+and\s+fittings)?|motor\s+vehicles|vehicles)\b/i.test(
    label,
  );
}

function isOtherAssetLabel(label: string): boolean {
  if (isContraLabel(label) || isGrossPpeLabel(label)) return false;
  if (
    /\b(?:payable|creditor|revenue|turnover|sales|expense|cost of|equity|capital|loan|overdraft|depreciation)\b/i.test(
      label,
    )
  ) {
    return false;
  }
  return /\b(?:trade\s+and\s+other\s+receivables|trade\s+receivables|accounts\s+receivable|other\s+receivables|debtors|inventory|inventories|cash(?:\s+and\s+cash\s+equivalents)?|cash\s+at\s+bank|bank\s+and\s+cash|petty\s+cash|prepayments)\b/i.test(
    label,
  );
}

function isEquityTotalLabel(label: string): boolean {
  return /^(?:total\s+equity|equity|members'?\s+funds|shareholders'?\s+funds|owners'?\s+equity|capital\s+and\s+reserves)$/i.test(
    label.trim(),
  );
}

function isAssetTotalLabel(label: string): boolean {
  return /^total\s+assets$/i.test(label.trim());
}

function isLiabilityTotalLabel(label: string): boolean {
  return /^total\s+liabilities$/i.test(label.trim());
}

function isLiabilityLabel(label: string): boolean {
  if (isContraLabel(label) || isEquityTotalLabel(label) || isAssetTotalLabel(label)) return false;
  if (/\b(?:receivable|debtor|asset|equipment|inventory|cash)\b/i.test(label)) return false;
  return /\b(?:trade\s+payables|accounts\s+payable|other\s+payables|creditors|borrowings|loan|overdraft|accruals|income\s+tax\s+payable|vat\s+payable|tax\s+payable)\b/i.test(
    label,
  );
}

/**
 * Equipment (or other PPE) at cost minus accumulated depreciation.
 * Null when those labels are not on the same lines as their amounts.
 */
export function readContraAssets(text: string): ContraAssetPair | null {
  let gross = 0;
  let accum = 0;
  let grossCount = 0;
  let accumCount = 0;
  for (const line of statementLines(text)) {
    if (isContraLabel(line.label)) {
      accum += Math.abs(line.amount);
      accumCount += 1;
    } else if (isGrossPpeLabel(line.label)) {
      gross += Math.abs(line.amount);
      grossCount += 1;
    }
  }
  if (!grossCount || !accumCount) return null;
  if (accum - gross > 1) return null;
  return {
    gross: round2(gross),
    accumulatedDepreciation: round2(accum),
    net: round2(gross - accum),
  };
}

function printedAmount(lines: StatementLine[], kind: "assets" | "equity"): number | null {
  const hit = lines.find((line) =>
    kind === "assets" ? isAssetTotalLabel(line.label) : isEquityTotalLabel(line.label),
  );
  return hit ? round2(Math.abs(hit.amount)) : null;
}

function liabilityTotal(lines: StatementLine[]): number | null {
  const printed = lines.find((line) => isLiabilityTotalLabel(line.label));
  if (printed) return round2(Math.abs(printed.amount));
  let sum = 0;
  let count = 0;
  for (const line of lines) {
    if (!isLiabilityLabel(line.label)) continue;
    sum += Math.abs(line.amount);
    count += 1;
  }
  return count ? round2(sum) : null;
}

function grossAssetSum(lines: StatementLine[]): number | null {
  let sum = 0;
  let count = 0;
  for (const line of lines) {
    if (isGrossPpeLabel(line.label) || isOtherAssetLabel(line.label)) {
      sum += Math.abs(line.amount);
      count += 1;
    }
  }
  return count ? round2(sum) : null;
}

/**
 * Replace a gross-cost asset total with the net carrying amount, and prefer a
 * printed equity total over a figure that absorbed the contra credit.
 */
export function reconcileModelTotals(input: {
  text: string;
  totalAssets: number | null;
  equity: number | null;
  ppe: number | null;
}): ReconciledTotals {
  const lines = statementLines(input.text);
  const contra = readContraAssets(input.text);
  const printedAssets = printedAmount(lines, "assets");
  const printedEquity = printedAmount(lines, "equity");
  const grossAssets = grossAssetSum(lines);
  const liabilities = liabilityTotal(lines);

  let totalAssets = input.totalAssets;
  let equity = input.equity;
  let adjusted = false;

  if (printedAssets != null) {
    if (totalAssets == null || !nearly(totalAssets, printedAssets)) adjusted = true;
    totalAssets = printedAssets;
  } else if (contra) {
    const netFromModel =
      totalAssets != null ? round2(totalAssets - contra.accumulatedDepreciation) : null;
    const netBalances =
      netFromModel != null &&
      printedEquity != null &&
      liabilities != null &&
      nearly(netFromModel, round2(printedEquity + liabilities)) &&
      !nearly(totalAssets ?? netFromModel, round2(printedEquity + liabilities));
    const netAssets =
      grossAssets != null ? round2(grossAssets - contra.accumulatedDepreciation) : null;
    const modelUsedGross =
      totalAssets != null && grossAssets != null && nearly(totalAssets, grossAssets);
    const modelUsedGrossPpe =
      input.ppe != null && nearly(input.ppe, contra.gross) && !nearly(input.ppe, contra.net);
    if (netBalances && netFromModel != null) {
      totalAssets = netFromModel;
      adjusted = true;
    } else if (netAssets != null && (totalAssets == null || modelUsedGross)) {
      if (totalAssets == null || !nearly(totalAssets, netAssets)) adjusted = true;
      totalAssets = netAssets;
    } else if (modelUsedGrossPpe && totalAssets != null) {
      totalAssets = round2(totalAssets - contra.accumulatedDepreciation);
      adjusted = true;
    }
  }

  if (printedEquity != null) {
    if (equity == null || !nearly(equity, printedEquity)) adjusted = true;
    equity = printedEquity;
  }

  const netPpe =
    contra &&
    (input.ppe == null || nearly(input.ppe, contra.gross) || nearly(input.ppe, contra.net))
      ? contra.net
      : null;
  if (contra && input.ppe != null && netPpe != null && !nearly(input.ppe, netPpe)) adjusted = true;

  return {
    totalAssets,
    equity,
    netPpe,
    gross: contra?.gross ?? null,
    adjusted,
  };
}

function formatFigure(n: number): string {
  return String(round2(n));
}

/** Edge extract-financials map. Only totalAssets and equity are rewritten. */
export function reconcileFlatFinancials(
  out: Record<string, string>,
  text: string,
): Record<string, string> {
  const totalAssets =
    out.totalAssets != null && out.totalAssets !== "" ? Number(out.totalAssets) : null;
  const equity = out.equity != null && out.equity !== "" ? Number(out.equity) : null;
  const totals = reconcileModelTotals({
    text,
    totalAssets: totalAssets != null && Number.isFinite(totalAssets) ? totalAssets : null,
    equity: equity != null && Number.isFinite(equity) ? equity : null,
    ppe: null,
  });
  if (!totals.adjusted) return out;
  const next = { ...out };
  if (totals.totalAssets != null) next.totalAssets = formatFigure(totals.totalAssets);
  if (totals.equity != null) next.equity = formatFigure(totals.equity);
  return next;
}

/** Portal statement schema. Runs before balance-sheet fill so equity is not plugged from a gross total. */
export function reconcileExtractionResult(
  result: ExtractionResult,
  text: string,
): ExtractionResult {
  const bs = result.current_period.figures.balance_sheet;
  const ppe = bs.non_current_assets.property_plant_equipment;
  const assets = bs.total_assets;
  const equity = bs.equity.total;
  const totals = reconcileModelTotals({
    text,
    totalAssets: typeof assets === "number" ? assets : null,
    equity: typeof equity === "number" ? equity : null,
    ppe: typeof ppe === "number" ? ppe : null,
  });
  if (!totals.adjusted) return result;
  const nonCurrent = { ...bs.non_current_assets };
  if (totals.netPpe != null) {
    if (
      typeof nonCurrent.total === "number" &&
      typeof ppe === "number" &&
      nearly(nonCurrent.total, ppe)
    ) {
      nonCurrent.total = totals.netPpe;
    } else if (
      typeof nonCurrent.total === "number" &&
      totals.gross != null &&
      nearly(nonCurrent.total, totals.gross)
    ) {
      nonCurrent.total = totals.netPpe;
    }
    nonCurrent.property_plant_equipment = totals.netPpe;
  }
  return {
    ...result,
    current_period: {
      ...result.current_period,
      figures: {
        ...result.current_period.figures,
        balance_sheet: {
          ...bs,
          non_current_assets: nonCurrent,
          total_assets: totals.totalAssets ?? bs.total_assets,
          equity: { ...bs.equity, total: totals.equity ?? bs.equity.total },
        },
      },
    },
  };
}
