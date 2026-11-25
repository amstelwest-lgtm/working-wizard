/**
 * Implementation Manager model selection.
 *
 * Opus 5.5 Claude API id: `claude-opus-5-5`.
 * Source: https://platform.claude.com/docs/en/about-claude/models/overview
 * (Latest models table, Claude Opus 5.5, Claude API ID). The same id is
 * CLAUDE_OPUS_55 in src/lib/claude-request.ts.
 *
 * If Anthropic rejects that id, one retry uses the Opus id this call already
 * had. When that id is already 5.5, the retry is Claude Opus 5 (`claude-opus-5`),
 * the previous Opus still listed as active on the same page.
 */
import { CLAUDE_OPUS_55 } from "./claude-request.ts";

export const IM_OPUS_55_ID = CLAUDE_OPUS_55;

/** Previous active Opus. Claude API ID from the models overview, row Claude Opus 5. */
export const IM_OPUS_PREVIOUS_ID = "claude-opus-5";

/** 5.5 first, then one distinct fallback. Never the same id twice. */
export function imOpusAttemptModels(currentOpusId: string | null | undefined): readonly string[] {
  const current = (currentOpusId ?? "").trim();
  const fallback = current && current !== IM_OPUS_55_ID ? current : IM_OPUS_PREVIOUS_ID;
  if (fallback === IM_OPUS_55_ID) return [IM_OPUS_55_ID];
  return [IM_OPUS_55_ID, fallback];
}

/**
 * True only for a model-not-found or invalid-model rejection.
 * Other 400s (size, schema) and 429/5xx do not switch models.
 */
export function anthropicRejectedModel(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false;
  const text = body.slice(0, 500);
  if (status === 404) return /not_found_error|\bmodel\b/i.test(text) || text.trim() === "";
  if (/not_found_error/i.test(text) && /model/i.test(text)) return true;
  return /not a valid model|invalid model id|unknown model|model ['"`: ][^'"`\n]{0,80}(?:not found|does not exist|is invalid|is unknown)/i.test(
    text,
  );
}

/** The single retry id, or null when this failure should not switch models. */
export function imOpusFallbackModel(input: {
  attempted: string;
  currentOpusId: string | null | undefined;
  status: number;
  body: string;
}): string | null {
  if (!anthropicRejectedModel(input.status, input.body)) return null;
  const order = imOpusAttemptModels(input.currentOpusId);
  const at = order.indexOf(input.attempted);
  if (at < 0) return order[0] === input.attempted ? null : (order[0] ?? null);
  const next = order[at + 1];
  return next && next !== input.attempted ? next : null;
}

/** Parses the error callClaude throws. Null when the failure is not that shape. */
export function readClaudeFailure(err: unknown): { status: number; body: string } | null {
  if (!(err instanceof Error)) return null;
  const match = /^Claude error \((\d+)\): ([\s\S]*)$/.exec(err.message);
  if (!match) return null;
  const status = Number(match[1]);
  if (!Number.isFinite(status)) return null;
  return { status, body: match[2] ?? "" };
}
