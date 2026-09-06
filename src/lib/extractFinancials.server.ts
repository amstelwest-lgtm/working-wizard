/**
 * extractFinancials.server.ts
 * TanStack Start server function — sends a PDF to Claude Sonnet 4.6 and returns
 * structured financial data. Server-side only; the API key never reaches the browser.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type ExtractionResult } from "@/lib/financialSchema";
import { validateFigures, isClean } from "@/lib/validateFinancials";
import { callClaudeMessages, parseClaudeJson } from "@/lib/claude-messages";
import { isUsCopy, marketInputSchema, resolvePromptMarket } from "@/lib/market";
import { assessPortalFigures, assertUsable } from "@/lib/upload-quality";

const EXTRACTION_PROMPT = `
You are extracting figures from a South African financial statement PDF for an
accounting platform. Follow these rules exactly:

1. Transcribe ONLY numbers that are physically printed in the document.
   Never calculate, estimate, or infer a value. If a line item is not present,
   return null for it. Do not fill gaps with 0.
2. Amounts shown in brackets ( ) or with a trailing "-" are NEGATIVE.
3. For "expense" style lines (cost of sales, operating expenses, finance costs,
   income tax) return them as POSITIVE magnitudes unless the statement itself
   shows them as negative in a subtotal column.
4. Report the presentation scale in "units" (actual / thousands / millions).
   Do NOT rescale the numbers yourself — leave them exactly as printed.
5. Map each printed line to the closest field in the schema. If several small
   lines roll into one schema field, sum only the lines that clearly belong
   there; otherwise put the remainder in the relevant "other" field.
6. Capture the comparative (prior year) column too when it is present.
7. If anything is ambiguous or you had to make a judgement call, say so briefly
   in extraction_notes so a human can check it.

Return ONLY valid JSON matching this shape (no markdown, no prose):
{
  "entity_name": string|null,
  "registration_number": string|null,
  "currency": string|null,
  "units": "actual"|"thousands"|"millions"|null,
  "statement_basis": "audited"|"independently_reviewed"|"compiled"|"management_accounts"|"unknown"|null,
  "current_period": {
    "period_end": "YYYY-MM-DD"|null,
    "figures": {
      "income_statement": {
        "revenue": number|null,
        "cost_of_sales": number|null,
        "gross_profit": number|null,
        "other_income": number|null,
        "operating_expenses": number|null,
        "depreciation_amortisation": number|null,
        "operating_profit": number|null,
        "finance_income": number|null,
        "finance_costs": number|null,
        "profit_before_tax": number|null,
        "income_tax": number|null,
        "profit_after_tax": number|null
      },
      "balance_sheet": {
        "non_current_assets": {
          "property_plant_equipment": number|null,
          "intangible_assets": number|null,
          "investments": number|null,
          "deferred_tax_asset": number|null,
          "other": number|null,
          "total": number|null
        },
        "current_assets": {
          "inventories": number|null,
          "trade_and_other_receivables": number|null,
          "cash_and_cash_equivalents": number|null,
          "other": number|null,
          "total": number|null
        },
        "total_assets": number|null,
        "equity": {
          "share_capital": number|null,
          "retained_earnings": number|null,
          "other_reserves": number|null,
          "total": number|null
        },
        "non_current_liabilities": {
          "borrowings": number|null,
          "deferred_tax_liability": number|null,
          "other": number|null,
          "total": number|null
        },
        "current_liabilities": {
          "trade_and_other_payables": number|null,
          "borrowings": number|null,
          "current_tax": number|null,
          "bank_overdraft": number|null,
          "other": number|null,
          "total": number|null
        },
        "total_liabilities": number|null,
        "total_equity_and_liabilities": number|null
      },
      "cash_flow": {
        "cash_from_operating": number|null,
        "cash_from_investing": number|null,
        "cash_from_financing": number|null,
        "net_change_in_cash": number|null,
        "cash_at_end": number|null
      } | null
    }
  },
  "comparative_period": null | {
    "period_end": "YYYY-MM-DD"|null,
    "figures": { /* same shape as current_period.figures */ }
  },
  "extraction_notes": string|null
}
`.trim();

/** Plain-text statements (spreadsheet → CSV) are capped well below Claude's context. */
const MAX_TEXT_CHARS = 1_500_000;

/**
 * Accepts either a PDF (base64) or the text of a spreadsheet / CSV export.
 * Exactly one of `pdfBase64` / `text` must be present.
 */
export const extractFinancialsFromPDF = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        pdfBase64: z.string().max(45_000_000).optional(),
        mimeType: z.string().optional(),
        text: z.string().max(MAX_TEXT_CHARS).optional(),
        fileName: z.string().max(300).optional(),
        market: marketInputSchema,
      })
      .refine((v) => Boolean(v.pdfBase64) !== Boolean(v.text), {
        message: "Send either pdfBase64 or text, not both.",
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { pdfBase64, mimeType = "application/pdf", text, fileName } = data;
    const market = resolvePromptMarket(data.market);
    const region = isUsCopy(market) ? "United States" : "South African";
    const source = text
      ? "financial statement exported from a spreadsheet (CSV text, one block per sheet)"
      : "financial statement PDF";
    const prompt = EXTRACTION_PROMPT.replace(
      "South African financial statement PDF",
      `${region} ${source}`,
    );

    if (pdfBase64) {
      // Size check: base64 inflates ~33%, so actual bytes ≈ base64.length × 0.75
      const approxBytes = Math.ceil((pdfBase64.length * 3) / 4);
      if (approxBytes > 32 * 1024 * 1024) {
        throw new Error(
          `PDF is too large (${(approxBytes / 1024 / 1024).toFixed(1)} MB). Max 32 MB.`,
        );
      }
    } else if (!text || text.trim().length < 40) {
      throw new Error("That file has no readable figures in it.");
    }

    const raw = await callClaudeMessages({
      content: pdfBase64
        ? [
            {
              type: "document",
              source: { type: "base64", media_type: mimeType, data: pdfBase64 },
            },
            { type: "text", text: prompt },
          ]
        : [
            {
              type: "text",
              text: `<statement file="${(fileName ?? "statement").replace(/"/g, "'")}">\n${text}\n</statement>`,
            },
            { type: "text", text: prompt },
          ],
      maxTokens: 8192,
      timeoutMs: 90_000,
    });

    let extracted: ExtractionResult;
    try {
      extracted = parseClaudeJson<ExtractionResult>(raw);
    } catch (err) {
      throw new Error("Failed to parse Claude response as JSON: " + (err as Error).message);
    }

    const issues = validateFigures(extracted.current_period.figures);
    assertUsable(assessPortalFigures(extracted.current_period.figures));

    return {
      data: extracted,
      issues,
      autoImportSafe: isClean(issues),
    };
  });
