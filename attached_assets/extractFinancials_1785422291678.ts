// extractFinancials.ts
// Sends a PDF straight to Gemini and gets back structured financial data.
// This runs SERVER-SIDE ONLY. The API key must never reach the browser.

import { GoogleGenAI } from "@google/genai";
import { financialResponseSchema, type ExtractionResult } from "./financialSchema";

// Current-generation, cheap extraction model (as of mid-2026).
// gemini-3.5-flash-lite: cheapest current tier, native PDF input, structured output.
// If you want a bit more accuracy on messy scans, bump to "gemini-3.6-flash".
const MODEL = "gemini-3.5-flash-lite";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

export interface ExtractInput {
  /** Base64-encoded PDF bytes (no data: prefix). */
  pdfBase64: string;
  /** Usually "application/pdf". */
  mimeType?: string;
}

export async function extractFinancials(
  input: ExtractInput
): Promise<ExtractionResult> {
  const { pdfBase64, mimeType = "application/pdf" } = input;

  const response = await ai.models.generateContent({
    model: MODEL,
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
  if (!raw) {
    throw new Error("Gemini returned an empty response.");
  }

  try {
    return JSON.parse(raw) as ExtractionResult;
  } catch (err) {
    // Structured output should always be valid JSON, but guard anyway.
    throw new Error(
      "Failed to parse Gemini response as JSON: " + (err as Error).message
    );
  }
}
