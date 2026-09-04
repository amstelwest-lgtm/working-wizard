/**
 * Bank statement → movements trial balance + balance-check helpers.
 * Pure functions — safe for client and server.
 */

import type {
  CashBankExtract,
  CashBucket,
  CashStatementTransaction,
} from "@/lib/cash-from-banks.types";
import { formatMoney, ZA_MARKET } from "@/lib/market";

export type BankAccountBalance = {
  accountLabel: string;
  openingBalance: number | null;
  closingBalance: number | null;
  fileNames: string[];
};

export type BalanceCheckResult = {
  ok: boolean;
  scope: string;
  opening: number | null;
  statedClosing: number | null;
  expectedClosing: number | null;
  difference: number | null;
  inflowTotal: number;
  outflowTotal: number;
  notes: string | null;
};

export type MovementLine = {
  key: string;
  label: string;
  /** Debit (uses of funds / outflows / closing cash) */
  debit: number;
  /** Credit (sources of funds / inflows / opening cash) */
  credit: number;
};

export type MovementsTrialBalance = {
  periodStart: string | null;
  periodEnd: string | null;
  currency: string | null;
  openingCash: number;
  closingCash: number;
  lines: MovementLine[];
  balanceChecks: BalanceCheckResult[];
  /** True when all checks that have enough data pass within tolerance. */
  allOk: boolean;
};

const BUCKET_LABELS: Record<CashBucket, string> = {
  trading: "Trading receipts / sales",
  cos: "Cost of sales / suppliers",
  opex: "Operating expenses",
  payroll: "Payroll & wages",
  rent: "Rent & premises",
  loan: "Loan principal",
  interest: "Interest",
  tax: "Tax (income / provisional)",
  vat: "VAT",
  owner: "Owner drawings / injections",
  capex: "Capital expenditure",
  transfer: "Inter-account transfers",
  other: "Other movements",
};

const TOLERANCE = 2; // ZAR cents-ish rounding

function sumDirection(
  txns: CashStatementTransaction[],
  direction: "in" | "out",
  opts?: { includeExcluded?: boolean; account?: string | null },
): number {
  return txns
    .filter((t) => t.direction === direction)
    .filter((t) => (opts?.includeExcluded ? true : !t.excluded))
    .filter((t) =>
      opts?.account == null
        ? true
        : (t as CashStatementTransaction & { account_label?: string | null }).account_label ===
          opts.account,
    )
    .reduce((s, t) => s + t.amount, 0);
}

/** Opening + inflows − outflows (including transfers for bank tie-out). */
export function checkBankBalanceTieOut(
  opening: number | null,
  closing: number | null,
  txns: CashStatementTransaction[],
  scope: string,
): BalanceCheckResult {
  const inflowTotal = sumDirection(txns, "in", { includeExcluded: true });
  const outflowTotal = sumDirection(txns, "out", { includeExcluded: true });

  if (opening == null || closing == null) {
    return {
      ok: false,
      scope,
      opening,
      statedClosing: closing,
      expectedClosing: null,
      difference: null,
      inflowTotal,
      outflowTotal,
      notes:
        opening == null && closing == null
          ? "No opening/closing balance printed — cannot tie out."
          : "Missing opening or closing balance — cannot fully tie out.",
    };
  }

  const expectedClosing = opening + inflowTotal - outflowTotal;
  const difference = expectedClosing - closing;
  const ok = Math.abs(difference) <= TOLERANCE;

  return {
    ok,
    scope,
    opening,
    statedClosing: closing,
    expectedClosing,
    difference,
    inflowTotal,
    outflowTotal,
    notes: ok
      ? "Opening + movements tie to closing balance."
      : `Does not tie: expected closing ${expectedClosing.toFixed(0)} vs stated ${closing.toFixed(0)} (Δ ${difference.toFixed(0)}).`,
  };
}

/**
 * Build a simple movements trial balance the client can read:
 * opening cash → inflows/outflows by bucket → closing cash.
 */
export function buildMovementsTrialBalance(
  extract: CashBankExtract,
  accounts?: BankAccountBalance[],
): MovementsTrialBalance {
  const txns = extract.transactions ?? [];
  const openingCash =
    accounts && accounts.length > 0
      ? accounts.reduce((s, a) => s + (a.openingBalance ?? 0), 0)
      : (extract.opening_balance ?? 0);
  const closingCash =
    accounts && accounts.length > 0
      ? accounts.reduce((s, a) => s + (a.closingBalance ?? 0), 0)
      : (extract.closing_balance ?? 0);

  const byBucket = new Map<CashBucket, { in: number; out: number }>();
  for (const t of txns) {
    if (t.excluded && t.ai_bucket === "transfer") {
      // Still show transfers as their own line
    }
    const cur = byBucket.get(t.ai_bucket) ?? { in: 0, out: 0 };
    if (t.direction === "in") cur.in += t.amount;
    else cur.out += t.amount;
    byBucket.set(t.ai_bucket, cur);
  }

  const lines: MovementLine[] = [
    {
      key: "opening",
      label: "Opening bank balances",
      debit: 0,
      credit: openingCash,
    },
  ];

  const bucketOrder: CashBucket[] = [
    "trading",
    "other",
    "owner",
    "loan",
    "cos",
    "payroll",
    "rent",
    "opex",
    "interest",
    "tax",
    "vat",
    "capex",
    "transfer",
  ];

  for (const b of bucketOrder) {
    const v = byBucket.get(b);
    if (!v || (v.in === 0 && v.out === 0)) continue;
    lines.push({
      key: b,
      label: BUCKET_LABELS[b],
      debit: v.out,
      credit: v.in,
    });
  }

  lines.push({
    key: "closing",
    label: "Closing bank balances",
    debit: closingCash,
    credit: 0,
  });

  const balanceChecks: BalanceCheckResult[] = [];

  if (accounts && accounts.length > 0) {
    for (const a of accounts) {
      const accountTxns = txns.filter(
        (t) =>
          (t as CashStatementTransaction & { account_label?: string | null }).account_label ===
            a.accountLabel || accounts.length === 1,
      );
      // If txns lack account labels, run consolidated only once below
      if (
        txns.some(
          (t) =>
            (t as CashStatementTransaction & { account_label?: string | null }).account_label !=
            null,
        )
      ) {
        balanceChecks.push(
          checkBankBalanceTieOut(a.openingBalance, a.closingBalance, accountTxns, a.accountLabel),
        );
      }
    }
  }

  // Always include consolidated check
  balanceChecks.push(
    checkBankBalanceTieOut(
      extract.opening_balance ??
        (accounts?.every((a) => a.openingBalance != null) ? openingCash : extract.opening_balance),
      extract.closing_balance ??
        (accounts?.every((a) => a.closingBalance != null) ? closingCash : extract.closing_balance),
      txns,
      accounts && accounts.length > 1 ? "All accounts (consolidated)" : "Bank statement",
    ),
  );

  // Dedupe if we accidentally doubled single-account
  const seen = new Set<string>();
  const uniqueChecks = balanceChecks.filter((c) => {
    if (seen.has(c.scope)) return false;
    seen.add(c.scope);
    return true;
  });

  const checkable = uniqueChecks.filter((c) => c.expectedClosing != null);
  const allOk = checkable.length > 0 && checkable.every((c) => c.ok);

  return {
    periodStart: extract.period_start,
    periodEnd: extract.period_end,
    currency: extract.currency,
    openingCash,
    closingCash,
    lines,
    balanceChecks: uniqueChecks,
    allOk,
  };
}

export function fmtMoney(n: number, currency: string | null = "R"): string {
  const usd = currency === "USD" || currency === "$";
  return formatMoney(n, usd ? { currency: "USD", locale: "en-US" } : ZA_MARKET);
}
