/**
 * A cached finding that cites a ratio the tiles reject is not rewritten.
 * Only the sentence that cites it is swapped for the live health paragraph.
 * The stored title and detail are not edited here.
 */
import { renderHealthNarrative, type HealthScoreSnapshot } from "./health-snapshot.ts";
import { cachedFindingRejected, findingSentences, sentenceCitesRejectedRatio } from "./ratios.ts";

export const REFRESHED_FROM_FIGURES = "Refreshed from current figures.";

function liveParagraph(live?: HealthScoreSnapshot | null): string {
  const paragraph = live ? renderHealthNarrative(live).trim() : "";
  return paragraph ? `${paragraph} ${REFRESHED_FROM_FIGURES}` : REFRESHED_FROM_FIGURES;
}

/**
 * Replace only the sentences that cite a ratio the tiles will not quote.
 * The rest of a document stays, including after rewriteDraftMonthStamp.
 */
export function presentCachedFinding(input: {
  text: string;
  figures?: unknown;
  ratios?: Record<string, number | null> | null;
  live?: HealthScoreSnapshot | null;
  /** Applied to a sentence that stays. The swapped sentence is not passed through it. */
  keep?: (sentence: string) => string;
}): { text: string; stale: boolean } {
  const stored = input.text.replace(/\s+/g, " ").trim();
  if (!stored) return { text: "", stale: false };
  const swap = liveParagraph(input.live);
  let stale = false;
  const out: string[] = [];
  for (const sentence of findingSentences(stored)) {
    if (!sentenceCitesRejectedRatio(sentence, input.figures, input.ratios)) {
      out.push(input.keep ? input.keep(sentence) : sentence);
      continue;
    }
    stale = true;
    if (out[out.length - 1] !== swap) out.push(swap);
  }
  return { text: out.join(" "), stale };
}

export { cachedFindingRejected };
