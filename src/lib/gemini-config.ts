/**
 * gemini-config.ts
 * Single source of truth for Gemini model names.
 *
 * Set GEMINI_MODEL in your Replit Secrets to override at runtime.
 *
 * Two formats are needed because different callers use different APIs:
 *   GEMINI_MODEL         — for the @google/genai SDK and direct REST calls
 *   GEMINI_MODEL_GATEWAY — for the Lovable AI gateway (OpenAI-compat, needs "google/" prefix)
 */

export const GEMINI_MODEL: string =
  (typeof process !== "undefined" && process.env?.GEMINI_MODEL) || "gemini-3.6-flash";

/** Same model, prefixed for the Lovable AI gateway. */
export const GEMINI_MODEL_GATEWAY: string = `google/${GEMINI_MODEL}`;
