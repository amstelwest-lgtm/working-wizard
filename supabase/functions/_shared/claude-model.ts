/**
 * Deno-side model id. Node uses src/lib/claude-config.ts.
 * Supabase secret CLAUDE_MODEL overrides the Sonnet 5.5 default.
 */
import { CLAUDE_SONNET_55 } from "../../../src/lib/claude-request.ts";

export const CLAUDE_MODEL = Deno.env.get("CLAUDE_MODEL") || CLAUDE_SONNET_55;
