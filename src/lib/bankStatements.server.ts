/**
 * bankStatements.server.ts
 * TanStack Start server function — sends one or more bank statements (PDF/CSV)
 * to Anthropic Claude (claude-sonnet-4-6) and returns a drafted basic income
 * statement built from the transaction activity. Server-side only; the API key
 * never reaches the browser.
 *
 * Product decision (annualisation): figures are ALWAYS returned for the actual
 * period the statements cover, with period_start/period_end/months_covered so
 * the UI can offer an annualised *view* as an option. Storing annualised
 * numbers as if they were actuals would silently distort ratios and reports.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callClaudeMessages, parseClaudeJson, type ClaudeContentPart } from "@/lib/claude-messages";
import { bankDraftPrompt, marketInputSchema, resolvePromptMarket } from "@/lib/market";

export interface BankDraftOpexLine {
  category: string;
  amount: number;
}

export interface BankDraftStatement {
  period_start: string | null; // ISO date of earliest transaction
  period_end: string | null; // ISO date of latest transaction
  months_covered: number | null; // e.g. 3 for a quarter of statements
  currency: string | null;
  revenue: number;
  cost_of_sales: number; // positive magnitude
  gross_profit: number;
  other_income: number;
  opex_breakdown: BankDraftOpexLine[]; // exactly 5 main deductible expense buckets
  total_opex: number; // positive magnitude, sum of breakdown
  interest_paid: number; // positive magnitude
  tax_paid: number; // positive magnitude
  net_profit: number;
  excluded_items: string[]; // transfers, loan drawdowns, owner drawings etc.
  notes: string | null; // judgement calls a human should check
}

const money = z.number().finite();
const magnitude = z.number().finite().nonnegative();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const draftSchema = z
  .object({
    period_start: isoDate.nullable(),
    period_end: isoDate.nullable(),
    months_covered: z.number().finite().positive().nullable(),
    currency: z.string().max(10).nullable(),
    revenue: magnitude,
    cost_of_sales: magnitude,
    gross_profit: money,
    other_income: magnitude,
    opex_breakdown: z
      .array(z.object({ category: z.string().min(1).max(80), amount: magnitude }).strict())
      .min(1)
      .max(5),
    total_opex: magnitude,
    interest_paid: magnitude,
    tax_paid: magnitude,
    net_profit: money,
    excluded_items: z.array(z.string().max(300)).max(100),
    notes: z.string().max(5000).nullable(),
  })
  .strict();

export const draftFinancialsFromBankStatements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        files: z
          .array(
            z.object({
              fileName: z.string(),
              accountLabel: z.string().max(80).optional(),
              // Exactly one of base64 (PDF) or text (CSV/TXT) must be provided.
              // 14M base64 chars ≈ 10 MB per file; aggregate is checked below too.
              base64: z.string().max(14_000_000).optional(),
              text: z.string().max(2_000_000).optional(),
            }),
          )
          .min(1)
          .max(12),
        market: marketInputSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const prompt = bankDraftPrompt(resolvePromptMarket(data.market));
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
        `Statements are too large (${(totalBytes / 1024 / 1024).toFixed(1)} MB total). Max 40 MB — try fewer files.`,
      );
    }
    content.push({ type: "text", text: prompt });

    const raw = await callClaudeMessages({
      content,
      maxTokens: 8192,
      timeoutMs: 150_000,
    });

    let parsed: unknown;
    try {
      parsed = parseClaudeJson(raw);
    } catch (err) {
      throw new Error("Failed to parse the AI response as JSON: " + (err as Error).message);
    }
    const draft = draftSchema.parse(parsed) as BankDraftStatement;

    // Server-side arithmetic sanity checks — surface, don't silently fix.
    const warnings: string[] = [];
    const sumOpex = draft.opex_breakdown.reduce((s, l) => s + l.amount, 0);
    if (Math.abs(sumOpex - draft.total_opex) > 1) {
      warnings.push(
        `Opex breakdown (${sumOpex.toFixed(0)}) doesn't sum to total opex (${draft.total_opex.toFixed(0)}).`,
      );
    }
    if (Math.abs(draft.revenue - draft.cost_of_sales - draft.gross_profit) > 1) {
      warnings.push("Gross profit doesn't equal revenue minus cost of sales.");
    }
    const expectedNet =
      draft.gross_profit +
      draft.other_income -
      draft.total_opex -
      draft.interest_paid -
      draft.tax_paid;
    if (Math.abs(expectedNet - draft.net_profit) > 1) {
      warnings.push(
        `Net profit (${draft.net_profit.toFixed(0)}) doesn't tie back to the components (expected ${expectedNet.toFixed(0)}).`,
      );
    }

    return { draft, warnings };
  });
