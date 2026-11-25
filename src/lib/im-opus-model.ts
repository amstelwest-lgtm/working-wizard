/**
 * Implementation Manager model selection.
 * Opus 5.5 first, then CLAUDE_OPUS_FALLBACK. CLAUDE_MODEL_FM is not a retry.
 */
import { CLAUDE_OPUS_55, CLAUDE_OPUS_FALLBACK } from "./claude-request.ts";

export const IM_OPUS_55_ID = CLAUDE_OPUS_55;

/** Always Opus 5.5, then the shared fallback. The argument is ignored. */
export function imOpusAttemptModels(_currentOpusId?: string | null): readonly [string, string] {
  return [CLAUDE_OPUS_55, CLAUDE_OPUS_FALLBACK];
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
