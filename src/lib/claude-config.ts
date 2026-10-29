/**
 * claude-config.ts
 * Anthropic Claude model for Node advisory AI features. Edge functions mirror
 * this default via supabase/functions/_shared/claude-model.ts.
 * The Financial Manager edge does not read this. It uses Opus 5.5.
 *
 * Override with CLAUDE_MODEL in host env / Vercel. An existing value wins
 * over the Sonnet 5.5 default. Do not set CLAUDE_MODEL to Opus.
 */

import { CLAUDE_SONNET_55 } from "./claude-request";

export const CLAUDE_MODEL: string =
  (typeof process !== "undefined" && process.env?.CLAUDE_MODEL) || CLAUDE_SONNET_55;
