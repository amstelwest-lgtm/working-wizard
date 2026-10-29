/**
 * Deno-side model ids. Node advisory paths use src/lib/claude-config.ts.
 * Supabase secret CLAUDE_MODEL overrides the Sonnet 5.5 default for every
 * path except the Financial Manager. CLAUDE_MODEL_FM overrides only that
 * agent. Do not point CLAUDE_MODEL at Opus.
 */
import {
  CLAUDE_OPUS_55,
  CLAUDE_SONNET_55,
  modelForAgent,
} from "../../../src/lib/claude-request.ts";

export const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") || CLAUDE_SONNET_55;

/** Financial Manager only. Unset stays on Opus 5.5. */
export const CLAUDE_MODEL_FM = Deno.env.get("CLAUDE_MODEL_FM") || CLAUDE_OPUS_55;

export function edgeModelForAgent(agent: string): string {
  return modelForAgent(agent, {
    standard: CLAUDE_MODEL,
    financialManager: CLAUDE_MODEL_FM,
  });
}
