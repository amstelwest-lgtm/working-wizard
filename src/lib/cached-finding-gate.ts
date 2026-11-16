/**
 * A cached finding that cites a ratio the tiles reject is not rewritten.
 * Only the sentence that cites it is swapped for the live health paragraph.
 * The stored title and detail are not edited here.
 */
import { renderHealthNarrative, type HealthScoreSnapshot } from "./health-snapshot.ts";
import { cachedFindingRejected, sentenceCitesRejectedRatio } from "./ratios.ts";

export const REFRESHED_FROM_FIGURES = "Refreshed from current figures.";

function liveParagraph(live?: HealthScoreSnapshot | null): string {
  const paragraph = live ? renderHealthNarrative(live).trim() : "";
  return paragraph ? `${paragraph} ${REFRESHED_FROM_FIGURES}` : REFRESHED_FROM_FIGURES;
}

type SentenceSpan = { start: number; end: number };

/** Sentence ends, keeping a decimal point and the original gaps. */
function sentenceSpans(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i] ?? "")) i += 1;
    const start = i;
    if (start >= text.length) break;
    let end = text.length;
    for (let j = start; j < text.length; j += 1) {
      const ch = text[j] ?? "";
      const decimal = ch === "." && /\d/.test(text[j - 1] ?? "") && /\d/.test(text[j + 1] ?? "");
      const boundary = ch === "!" || ch === "?" || (ch === "." && !decimal);
      if (!boundary) continue;
      end = j + 1;
      break;
    }
    if (text.slice(start, end).trim()) spans.push({ start, end });
    i = end;
  }
  return spans;
}

/**
 * Replace only the sentences that cite a ratio the tiles will not quote.
 * Kept sentences stay where they were, including paragraph and line breaks.
 */
export function presentCachedFinding(input: {
  text: string;
  figures?: unknown;
  ratios?: Record<string, number | null> | null;
  live?: HealthScoreSnapshot | null;
  /** Applied to a sentence that stays. The swapped sentence is not passed through it. */
  keep?: (sentence: string) => string;
}): { text: string; stale: boolean } {
  const text = input.text;
  if (!text.trim()) return { text, stale: false };
  const spans = sentenceSpans(text);
  if (!spans.length) return { text, stale: false };
  const swap = liveParagraph(input.live);
  let stale = false;
  let out = "";
  let cursor = 0;
  let swapped = false;
  for (const span of spans) {
    const gap = text.slice(cursor, span.start);
    const raw = text.slice(span.start, span.end);
    cursor = span.end;
    if (!sentenceCitesRejectedRatio(raw.trim(), input.figures, input.ratios)) {
      out += gap + (input.keep ? input.keep(raw.trim()) : raw);
      swapped = false;
      continue;
    }
    stale = true;
    if (!swapped) {
      out += gap + swap;
      swapped = true;
    }
  }
  if (!swapped) out += text.slice(cursor);
  return { text: out, stale };
}

export { cachedFindingRejected };
