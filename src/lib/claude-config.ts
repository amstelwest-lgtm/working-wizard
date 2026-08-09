/**
 * claude-config.ts
 * Single source of truth for the Anthropic Claude model name used by the
 * advisory-facing AI features (Ask AI edge function mirrors this default
 * via its own CLAUDE_MODEL env var in Supabase).
 *
 * Override with CLAUDE_MODEL in host env / Vercel / Supabase secrets.
 */

export const CLAUDE_MODEL: string =
  (typeof process !== "undefined" && process.env?.CLAUDE_MODEL) || "claude-sonnet-4-6";
