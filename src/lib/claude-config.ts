/**
 * claude-config.ts
 * Single source of truth for the Anthropic Claude model name used by the
 * Node advisory AI features. Edge functions mirror this default via
 * supabase/functions/_shared/claude-model.ts.
 *
 * Override with CLAUDE_MODEL in host env / Vercel. An existing value wins
 * over the Sonnet 5.5 default.
 */

import { CLAUDE_SONNET_55 } from "./claude-request";

export const CLAUDE_MODEL: string =
  (typeof process !== "undefined" && process.env?.CLAUDE_MODEL) || CLAUDE_SONNET_55;
