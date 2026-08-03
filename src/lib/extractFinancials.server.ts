/**
 * extractFinancials.server.ts
 * TanStack Start server function — sends a PDF to Gemini and returns structured
 * financial data using forced schema output. Server-side only; the API key
 * never reaches the browser.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { financialResponseSchema, type ExtractionResult } from "@/lib/financialSchema";
import { validateFigures, isClean } from "@/lib/validateFinancials";

import { GEMINI_MODEL } from "@/lib/gemini-config";

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

Return your answer as JSON that matches the provided schema. No prose, no
markdown, JSON only.
`.trim();

export const extractFinancialsFromPDF = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      pdfBase64: z.string().max(45_000_000),
      mimeType: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured. Please add it in your project secrets.");
    }

    const { pdfBase64, mimeType = "application/pdf" } = data;

    // Size check: base64 inflates ~33%, so actual bytes ≈ base64.length × 0.75
    const approxBytes = Math.ceil((pdfBase64.length * 3) / 4);
    if (approxBytes > 32 * 1024 * 1024) {
      throw new Error(`PDF is too large (${(approxBytes / 1024 / 1024).toFixed(1)} MB). Max 32 MB.`);
    }

    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: pdfBase64 } },
            { text: EXTRACTION_PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: financialResponseSchema,
      },
    });

    const raw = response.text;
    if (!raw) throw new Error("Gemini returned an empty response.");

    let extracted: ExtractionResult;
    try {
      extracted = JSON.parse(raw) as ExtractionResult;
    } catch (err) {
      throw new Error("Failed to parse Gemini response as JSON: " + (err as Error).message);
    }

    const issues = validateFigures(extracted.current_period.figures);

    return {
      data: extracted,
      issues,
      autoImportSafe: isClean(issues),
    };
  });
