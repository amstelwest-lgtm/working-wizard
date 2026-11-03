/**
 * Draftworx-oriented working-paper helpers for ZA accountant dirty work.
 *
 * v1 maps Milōn's aggregated period financials to a summary trial balance
 * (lead-schedule level), not a full general ledger. The CSV is shaped for
 * Draftworx Excel import (Account Number, Account Name, Debit, Credit).
 */

import { coherentEquity, equityCrossCheck, explicitLiabilityTotal } from "./equity-coherence.ts";
import { readStatementMeta } from "./statement-period.ts";
import { ZA_MARKET } from "./market/resolve.ts";
import type { ResolvedMarket } from "./market/types.ts";
import type { ClientReviewSignoff } from "./review-signoffs.functions.ts";

export type WorkingPaperCheckStatus = "pass" | "warn" | "fail" | "todo";

export type WorkingPaperCheckItem = {
  id: string;
  label: string;
  status: WorkingPaperCheckStatus;
  detail: string;
};

export type DraftworxSummaryRow = {
  accountNumber: string;
  accountName: string;
  debit: number;
  credit: number;
  note?: string;
};

export const DRAFTWORX_TB_CSV_HEADER = "Account Number,Account Name,Debit,Credit,Milōn note";

function finite(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.replace(/[,\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasMoney(fin: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => {
    const n = finite(fin[key]);
    return n != null && Math.abs(n) > 0.005;
  });
}

function pushBalanceRow(
  rows: DraftworxSummaryRow[],
  accountNumber: string,
  accountName: string,
  amount: number,
  note?: string,
): void {
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return;
  if (amount > 0) {
    rows.push({ accountNumber, accountName, debit: round2(amount), credit: 0, note });
  } else {
    rows.push({ accountNumber, accountName, debit: 0, credit: round2(-amount), note });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** True when this client market should see Draftworx dirty-work surfaces. */
export function draftworxDirtyWorkEnabled(market: Pick<ResolvedMarket, "country">): boolean {
  return market.country === "ZA";
}

export function buildDraftworxWorkingPaperChecklist(input: {
  financials: Record<string, unknown> | null | undefined;
  market: ResolvedMarket;
  financialsSignoff?: ClientReviewSignoff | null;
  signoffStale?: boolean;
  needsTrialBalanceRefresh?: boolean;
}): WorkingPaperCheckItem[] {
  const fin = input.financials ?? {};
  const meta = readStatementMeta(fin, input.market);
  const equityResolved = coherentEquity(fin);
  const assets = finite(fin.totalAssets);
  const liabilities = explicitLiabilityTotal(fin);
  const profit = finite(fin.netIncome) ?? finite(fin.ebit);
  const cross = equityCrossCheck({
    equity: finite(equityResolved.equity || fin.equity),
    totalAssets: assets,
    totalLiabilities: liabilities,
    profit,
    derived: equityResolved.derived,
  });

  const hasFigures =
    hasMoney(fin, ["revenue", "cogs", "netIncome", "ebit"]) ||
    hasMoney(fin, ["totalAssets", "cash", "receivables", "payables"]);

  const items: WorkingPaperCheckItem[] = [];

  items.push({
    id: "figures_on_file",
    label: "Trial balance / figures on this client file",
    status: hasFigures ? "pass" : "fail",
    detail: hasFigures
      ? "Milōn has period figures to work from."
      : "Upload or sync a trial balance or financial statements before lead sheets.",
  });

  items.push({
    id: "period_documented",
    label: "Period end documented",
    status: meta.periodEnd ? "pass" : meta.periodLabel ? "warn" : "todo",
    detail: meta.periodLabel
      ? `Figures cover ${meta.periodLabel}.`
      : "Add period dates on upload or set Figures cover on Health.",
  });

  const equationOk =
    assets != null &&
    liabilities != null &&
    cross.equity != null &&
    Math.abs(assets - liabilities - cross.equity) <= Math.max(Math.abs(assets) * 0.01, 1);
  items.push({
    id: "balance_equation",
    label: "Assets = liabilities + equity (summary level)",
    status:
      assets == null || liabilities == null || cross.equity == null
        ? "todo"
        : equationOk
          ? "pass"
          : "warn",
    detail:
      assets == null || liabilities == null
        ? "Need total assets and liabilities (or payables total) on the balance sheet."
        : equationOk
          ? "Summary totals tie within 1%."
          : "Totals do not tie within 1% — reconcile before sign-off in Draftworx.",
  });

  items.push({
    id: "equity_crosscheck",
    label: "Equity cross-check",
    status: cross.warning ? "warn" : cross.equity != null ? "pass" : "todo",
    detail: cross.warning ?? "Equity and the balance-sheet plug are aligned at summary level.",
  });

  items.push({
    id: "derived_equity",
    label: "Derived equity flagged for partner review",
    status: equityResolved.derived ? "warn" : equityResolved.equity ? "pass" : "todo",
    detail: equityResolved.derived
      ? "Equity was plugged from assets − liabilities. Confirm in Draftworx before final sign-off."
      : equityResolved.equity
        ? "Equity is typed or reported, not plugged."
        : "Equity is blank — import or type balance-sheet lines.",
  });

  const signed = Boolean(input.financialsSignoff?.signed_off_at);
  items.push({
    id: "financials_signoff",
    label: "Health / financials sign-off on Milōn",
    status: signed ? "pass" : "todo",
    detail: signed
      ? `Signed off by ${input.financialsSignoff?.signed_off_by_name ?? "accountant"}.`
      : "Sign off Health on Milōn when the summary TB is ready for the file.",
  });

  items.push({
    id: "signoff_fresh",
    label: "Sign-off matches current figures",
    status: !signed ? "todo" : input.signoffStale ? "warn" : "pass",
    detail: !signed
      ? "No sign-off yet."
      : input.signoffStale
        ? "Figures changed after sign-off — re-review before exporting to Draftworx."
        : "Sign-off is current for the figures on file.",
  });

  items.push({
    id: "cash_line",
    label: "Bank / cash line for lead sheet",
    status: hasMoney(fin, ["cash"]) ? "pass" : hasFigures ? "warn" : "todo",
    detail: hasMoney(fin, ["cash"])
      ? "Cash is on file for the bank lead schedule."
      : "Cash is missing — re-import the trial balance or type the bank balance.",
  });

  items.push({
    id: "tb_refresh",
    label: "Trial balance import complete (no stale gaps)",
    status: input.needsTrialBalanceRefresh ? "warn" : hasFigures ? "pass" : "todo",
    detail: input.needsTrialBalanceRefresh
      ? "Operating expenses or cash were blank on the last TB import — re-import before Draftworx."
      : "No known stale trial-balance gaps on this file.",
  });

  return items;
}

/** Summary TB rows from aggregated Milōn financials (not GL detail). */
export function draftworxSummaryTrialBalanceRows(
  financials: Record<string, unknown> | null | undefined,
): DraftworxSummaryRow[] {
  const fin = financials ?? {};
  const rows: DraftworxSummaryRow[] = [];
  const equityResolved = coherentEquity(fin);
  const equityAmount = finite(equityResolved.equity);

  pushBalanceRow(rows, "1000", "Cash and cash equivalents", finite(fin.cash) ?? 0);
  pushBalanceRow(rows, "1100", "Trade and other receivables", finite(fin.receivables) ?? 0);
  pushBalanceRow(rows, "1200", "Inventories", finite(fin.inventory) ?? 0);

  const assets = finite(fin.totalAssets);
  if (assets != null) {
    pushBalanceRow(rows, "1999", "Total assets (summary)", assets, "Milōn total — not a Draftworx control total");
  }

  pushBalanceRow(rows, "2000", "Trade and other payables", -(finite(fin.payables) ?? 0));
  const liabilities = explicitLiabilityTotal(fin);
  if (liabilities != null) {
    pushBalanceRow(rows, "2999", "Total liabilities (summary)", -liabilities);
  }

  if (equityAmount != null) {
    pushBalanceRow(
      rows,
      "3000",
      equityResolved.derived ? "Equity (derived on Milōn)" : "Equity",
      -equityAmount,
      equityResolved.derived ? "Derived — confirm in working papers" : undefined,
    );
  }

  pushBalanceRow(rows, "4000", "Revenue", -(finite(fin.revenue) ?? 0));
  pushBalanceRow(rows, "5000", "Cost of sales", finite(fin.cogs) ?? 0);
  pushBalanceRow(rows, "6000", "Operating expenses", finite(fin.fixedCosts) ?? 0);
  const profit = finite(fin.netIncome) ?? finite(fin.ebit);
  if (profit != null) {
    pushBalanceRow(rows, "7000", "Profit for the period (summary)", -profit);
  }

  return rows;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function draftworxTrialBalanceCsv(
  financials: Record<string, unknown> | null | undefined,
  clientName: string,
  market: ResolvedMarket = ZA_MARKET,
): string {
  const rows = draftworxSummaryTrialBalanceRows(financials);
  const meta = readStatementMeta(financials ?? {}, market);
  const banner = `# Milōn summary trial balance for Draftworx Excel import — ${clientName.trim() || "Client"} — ${meta.periodLabel ?? "period not set"} — not a full GL`;
  const lines = [
    banner,
    DRAFTWORX_TB_CSV_HEADER,
    ...rows.map((row) =>
      [
        csvEscape(row.accountNumber),
        csvEscape(row.accountName),
        row.debit ? String(row.debit) : "",
        row.credit ? String(row.credit) : "",
        csvEscape(row.note ?? ""),
      ].join(","),
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export function draftworxExportFileName(clientName: string, periodEnd: string | null): string {
  const slug = (clientName.trim() || "client")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const date = (periodEnd ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  return `milon-draftworx-summary-tb-${slug}-${date}.csv`;
}
