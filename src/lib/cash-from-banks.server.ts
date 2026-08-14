/**
 * cash-from-banks.server.ts
 * Phase 1–3: extract bank txns via Claude → pattern draft → return for preview/publish.
 * Supports multi-account statement packs and bank balance tie-out checks.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callClaudeMessages, parseClaudeJson, type ClaudeContentPart } from "@/lib/claude-messages";
import {
  buildDraftLinesFromExtract,
  nextForecastStartDate,
  resolveOpeningBalance,
} from "@/lib/cash-from-banks.pattern";
import type {
  CashBankExtract,
  CashFromBanksDraftResult,
  CashStatementTransaction,
} from "@/lib/cash-from-banks.types";
import { buildMovementsTrialBalance, type BankAccountBalance } from "@/lib/bank-movements";
import { MAX_BANK_FILES } from "@/lib/bank-files";

const BUCKETS = [
  "trading",
  "cos",
  "opex",
  "payroll",
  "rent",
  "loan",
  "interest",
  "tax",
  "vat",
  "owner",
  "capex",
  "transfer",
  "other",
] as const;

const txnSchema = z.object({
  txn_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  amount: z.number().finite(),
  direction: z.enum(["in", "out"]),
  description: z.string().max(300).optional().nullable(),
  counterparty: z.string().max(120).optional().nullable(),
  ai_bucket: z.enum(BUCKETS),
  excluded: z.boolean().optional(),
  account_label: z.string().max(80).optional().nullable(),
});

const accountSchema = z.object({
  account_label: z.string().min(1).max(80),
  opening_balance: z.number().finite().nullable().optional(),
  closing_balance: z.number().finite().nullable().optional(),
  file_names: z.array(z.string().max(200)).max(12).optional(),
});

const extractSchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  opening_balance: z.number().finite().nullable().optional(),
  closing_balance: z.number().finite().nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
  transactions: z.array(txnSchema).max(250),
  accounts: z.array(accountSchema).max(12).optional(),
  notes: z.string().max(4000).nullable().optional(),
  balance_check_notes: z.string().max(2000).nullable().optional(),
});

const EXTRACT_PROMPT = `
You are a cash-flow analyst for South African SMEs. You are given one or more
BANK STATEMENTS that may cover MULTIPLE bank accounts (cheque, credit card,
savings, etc.). Each file may be labelled with an account name. Extract a
transaction-level cash view (NOT an income statement).

Rules:
1. List individual transactions (or tightly grouped same-day same-counterparty
   movements). Prefer the most material lines — up to 200 transactions.
2. amount is always a POSITIVE number. direction is "in" (money received) or
   "out" (money paid).
3. ai_bucket must be one of:
   trading, cos, opex, payroll, rent, loan, interest, tax, vat, owner, capex,
   transfer, other
4. Mark excluded=true for pure inter-account transfers that are not business
   cash movement. Still include them in the list with ai_bucket "transfer".
5. counterparty = merchant / payee / payer name when clear, else null.
6. For EACH distinct bank account, fill accounts[] with account_label,
   opening_balance, closing_balance (printed statement balances), and the
   file_names that belong to that account. Also set consolidated
   opening_balance / closing_balance as the SUM across accounts.
7. Tag every transaction with account_label matching accounts[].
8. period_start / period_end = earliest and latest transaction dates (YYYY-MM-DD).
9. BALANCE CHECK (required): For each account, mentally verify
   opening + sum(in) - sum(out) ≈ closing (including transfers). If it does
   not tie, explain the gap in balance_check_notes (missing pages, uncleared
   items, OCR uncertainty). Never invent transactions to force a tie.
10. Do NOT annualise. Do NOT invent transactions. If unsure of bucket, use
    "other" and mention it in notes.

Return ONLY JSON (no markdown) matching:
{
  "period_start": "YYYY-MM-DD"|null,
  "period_end": "YYYY-MM-DD"|null,
  "opening_balance": number|null,
  "closing_balance": number|null,
  "currency": "ZAR"|null,
  "accounts": [
    {
      "account_label": string,
      "opening_balance": number|null,
      "closing_balance": number|null,
      "file_names": string[]
    }
  ],
  "transactions": [
    {
      "txn_date": "YYYY-MM-DD",
      "amount": number,
      "direction": "in"|"out",
      "description": string,
      "counterparty": string|null,
      "ai_bucket": "trading"|...,
      "excluded": boolean,
      "account_label": string|null
    }
  ],
  "notes": string|null,
  "balance_check_notes": string|null
}
`.trim();

function normalizeExtract(raw: z.infer<typeof extractSchema>): CashBankExtract {
  const transactions: CashStatementTransaction[] = raw.transactions
    .filter((t) => Number.isFinite(t.amount) && t.amount > 0)
    .map((t) => ({
      txn_date: t.txn_date ?? raw.period_end ?? new Date().toISOString().slice(0, 10),
      amount: Math.abs(t.amount),
      direction: t.direction,
      description: (t.description ?? "").trim() || "Transaction",
      counterparty: t.counterparty?.trim() || null,
      ai_bucket: t.ai_bucket,
      excluded: Boolean(t.excluded) || t.ai_bucket === "transfer",
      account_label: t.account_label?.trim() || null,
    }));

  const accounts =
    raw.accounts?.map((a) => ({
      account_label: a.account_label.trim(),
      opening_balance: a.opening_balance ?? null,
      closing_balance: a.closing_balance ?? null,
      file_names: a.file_names ?? [],
    })) ?? undefined;

  let opening = raw.opening_balance ?? null;
  let closing = raw.closing_balance ?? null;
  if ((opening == null || closing == null) && accounts && accounts.length > 0) {
    if (opening == null && accounts.every((a) => a.opening_balance != null)) {
      opening = accounts.reduce((s, a) => s + (a.opening_balance as number), 0);
    }
    if (closing == null && accounts.every((a) => a.closing_balance != null)) {
      closing = accounts.reduce((s, a) => s + (a.closing_balance as number), 0);
    }
  }

  return {
    period_start: raw.period_start ?? null,
    period_end: raw.period_end ?? null,
    opening_balance: opening,
    closing_balance: closing,
    currency: raw.currency ?? "ZAR",
    transactions,
    notes: raw.notes ?? null,
    accounts,
  };
}

const fileInputSchema = z.object({
  fileName: z.string(),
  accountLabel: z.string().max(80).optional(),
  base64: z.string().max(14_000_000).optional(),
  text: z.string().max(2_000_000).optional(),
});

export const draftCashForecastFromBankStatements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        files: z.array(fileInputSchema).min(1).max(MAX_BANK_FILES),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<CashFromBanksDraftResult> => {
    let totalBytes = 0;
    const content: ClaudeContentPart[] = [];
    for (const f of data.files) {
      const label = f.accountLabel?.trim() || "Bank account";
      if (f.base64) {
        totalBytes += Math.ceil((f.base64.length * 3) / 4);
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: f.base64 },
        });
        content.push({
          type: "text",
          text: `The previous PDF is bank statement file "${f.fileName}" for account "${label}".`,
        });
      } else if (f.text) {
        totalBytes += f.text.length;
        content.push({
          type: "text",
          text: `--- Bank statement file: ${f.fileName} | account: ${label} ---\n${f.text}`,
        });
      } else {
        throw new Error(`File "${f.fileName}" had no readable content.`);
      }
    }
    if (totalBytes > 40 * 1024 * 1024) {
      throw new Error(
        `Statements are too large (${(totalBytes / 1024 / 1024).toFixed(1)} MB total). Max 40 MB.`,
      );
    }
    content.push({ type: "text", text: EXTRACT_PROMPT });

    const rawText = await callClaudeMessages({
      content,
      maxTokens: 8192,
      timeoutMs: 150_000,
    });

    let parsed: unknown;
    try {
      parsed = parseClaudeJson(rawText);
    } catch (err) {
      throw new Error("Failed to parse cash extract as JSON: " + (err as Error).message);
    }

    const validated = extractSchema.parse(parsed);
    const extract = normalizeExtract(validated);
    if (extract.transactions.length === 0) {
      throw new Error("No transactions could be extracted from these statements.");
    }

    const accountBalances: BankAccountBalance[] | undefined = extract.accounts?.map((a) => ({
      accountLabel: a.account_label,
      openingBalance: a.opening_balance,
      closingBalance: a.closing_balance,
      fileNames: a.file_names,
    }));

    const movements = buildMovementsTrialBalance(extract, accountBalances);

    const lines = buildDraftLinesFromExtract(extract);
    const warnings: string[] = [];
    if (extract.closing_balance == null && extract.opening_balance == null) {
      warnings.push(
        "No opening/closing balance found on the statements — set opening cash manually after publish.",
      );
    }
    for (const check of movements.balanceChecks) {
      if (check.expectedClosing != null && !check.ok) {
        warnings.push(`Balance check (${check.scope}): ${check.notes}`);
      }
    }
    if (validated.balance_check_notes) {
      warnings.push(`AI balance notes: ${validated.balance_check_notes}`);
    }
    if (lines.filter((l) => l.status !== "excluded").length === 0) {
      warnings.push("All detected lines look like transfers/exclusions — review before publishing.");
    }
    if (extract.notes) warnings.push(extract.notes);
    if (extract.accounts && extract.accounts.length > 1) {
      warnings.push(
        `Multi-account pack: ${extract.accounts.map((a) => a.account_label).join(", ")}.`,
      );
    }

    return {
      extract,
      lines,
      startDate: nextForecastStartDate(extract.period_end),
      openingBalance: resolveOpeningBalance(extract),
      warnings,
      movements,
    };
  });
