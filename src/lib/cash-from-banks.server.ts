/**
 * cash-from-banks.server.ts
 * Phase 1–3: extract bank txns via Claude → pattern draft → return for preview/publish.
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
});

const extractSchema = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  opening_balance: z.number().finite().nullable().optional(),
  closing_balance: z.number().finite().nullable().optional(),
  currency: z.string().max(10).nullable().optional(),
  transactions: z.array(txnSchema).max(250),
  notes: z.string().max(4000).nullable().optional(),
});

const EXTRACT_PROMPT = `
You are a cash-flow analyst for South African SMEs. You are given one or more
BANK STATEMENTS. Extract a transaction-level cash view (NOT an income statement).

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
6. opening_balance / closing_balance = printed statement balances when shown
   (closing is preferred for forecasting). currency usually ZAR.
7. period_start / period_end = earliest and latest transaction dates (YYYY-MM-DD).
8. Do NOT annualise. Do NOT invent transactions. If unsure of bucket, use "other"
   and mention it in notes.

Return ONLY JSON (no markdown) matching:
{
  "period_start": "YYYY-MM-DD"|null,
  "period_end": "YYYY-MM-DD"|null,
  "opening_balance": number|null,
  "closing_balance": number|null,
  "currency": "ZAR"|null,
  "transactions": [
    {
      "txn_date": "YYYY-MM-DD",
      "amount": number,
      "direction": "in"|"out",
      "description": string,
      "counterparty": string|null,
      "ai_bucket": "trading"|...,
      "excluded": boolean
    }
  ],
  "notes": string|null
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
    }));

  return {
    period_start: raw.period_start ?? null,
    period_end: raw.period_end ?? null,
    opening_balance: raw.opening_balance ?? null,
    closing_balance: raw.closing_balance ?? null,
    currency: raw.currency ?? "ZAR",
    transactions,
    notes: raw.notes ?? null,
  };
}

export const draftCashForecastFromBankStatements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        files: z
          .array(
            z.object({
              fileName: z.string(),
              base64: z.string().max(14_000_000).optional(),
              text: z.string().max(2_000_000).optional(),
            }),
          )
          .min(1)
          .max(6),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<CashFromBanksDraftResult> => {
    let totalBytes = 0;
    const content: ClaudeContentPart[] = [];
    for (const f of data.files) {
      if (f.base64) {
        totalBytes += Math.ceil((f.base64.length * 3) / 4);
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: f.base64 },
        });
      } else if (f.text) {
        totalBytes += f.text.length;
        content.push({
          type: "text",
          text: `--- Bank statement file: ${f.fileName} ---\n${f.text}`,
        });
      } else {
        throw new Error(`File "${f.fileName}" had no readable content.`);
      }
    }
    if (totalBytes > 25 * 1024 * 1024) {
      throw new Error(
        `Statements are too large (${(totalBytes / 1024 / 1024).toFixed(1)} MB total). Max 25 MB.`,
      );
    }
    content.push({ type: "text", text: EXTRACT_PROMPT });

    const rawText = await callClaudeMessages({
      content,
      maxTokens: 8192,
      timeoutMs: 120_000,
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

    const lines = buildDraftLinesFromExtract(extract);
    const warnings: string[] = [];
    if (extract.closing_balance == null && extract.opening_balance == null) {
      warnings.push("No opening/closing balance found on the statements — set opening cash manually after publish.");
    }
    if (lines.filter((l) => l.status !== "excluded").length === 0) {
      warnings.push("All detected lines look like transfers/exclusions — review before publishing.");
    }
    if (extract.notes) warnings.push(extract.notes);

    return {
      extract,
      lines,
      startDate: nextForecastStartDate(extract.period_end),
      openingBalance: resolveOpeningBalance(extract),
      warnings,
    };
  });
