/**
 * A cached finding that cites a ratio the tiles reject is not rewritten.
 * The screen shows the live health paragraph instead, and the row stays stale
 * for the next Analyst run. The stored title and detail are not edited here.
 */
import { renderHealthNarrative, type HealthScoreSnapshot } from "./health-snapshot.ts";
import { cachedFindingRejected } from "./ratios.ts";

export const REFRESHED_FROM_FIGURES = "Refreshed from current figures.";

export type CachedFindingSurface = "home" | "analyst" | "handoff" | "email";

export function presentCachedFinding(input: {
  text: string;
  figures?: unknown;
  live?: HealthScoreSnapshot | null;
}): { text: string; stale: boolean } {
  const stored = input.text.replace(/\s+/g, " ").trim();
  if (!cachedFindingRejected(stored, input.figures)) return { text: stored, stale: false };
  const paragraph = input.live ? renderHealthNarrative(input.live).trim() : "";
  const text = paragraph ? `${paragraph} ${REFRESHED_FROM_FIGURES}` : REFRESHED_FROM_FIGURES;
  return { text, stale: true };
}

export function presentHomeFinding(
  text: string,
  figures?: unknown,
  live?: HealthScoreSnapshot | null,
): { text: string; stale: boolean } {
  return presentCachedFinding({ text, figures, live });
}

export function presentAnalystFinding(
  text: string,
  figures?: unknown,
  live?: HealthScoreSnapshot | null,
): { text: string; stale: boolean } {
  return presentCachedFinding({ text, figures, live });
}

export function presentHandoffFinding(
  text: string,
  figures?: unknown,
  live?: HealthScoreSnapshot | null,
): { text: string; stale: boolean } {
  return presentCachedFinding({ text, figures, live });
}

export function presentEmailFinding(
  text: string,
  figures?: unknown,
  live?: HealthScoreSnapshot | null,
): { text: string; stale: boolean } {
  return presentCachedFinding({ text, figures, live });
}
