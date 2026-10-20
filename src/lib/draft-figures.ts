/**
 * A stored draft quotes the figures it was written against. Home re-reads the
 * live margins and the live health score, and a figures hash on the draft
 * says when those inputs have moved. The stored row is not rewritten.
 */
import { groundAdvisoryNarrative } from "./advisory-narrative.ts";
import {
  presentHealthNarrative,
  readStoredHealthSnapshot,
  type HealthScoreSnapshot,
} from "./health-snapshot.ts";

export const DRAFT_OUT_OF_DATE = "Out of date, refresh";

const HASH_RATIOS: readonly [string, string][] = [
  ["Gross Margin", "gm"],
  ["Operating Margin", "om"],
  ["Net Margin", "nm"],
];

export type DraftLiveFigures = {
  ratios?: Record<string, number> | null;
  overall?: number | null;
  storedHash?: string | null;
  /** Live pillars, overall, weakest, and statement period. */
  health?: HealthScoreSnapshot | null;
  /** Snapshot stored on the draft when it was written. */
  storedHealth?: HealthScoreSnapshot | null;
};

/** Stable hash of the live margins and, when known, the live overall. */
export function draftFiguresHash(input: {
  ratios?: Record<string, number> | null;
  overall?: number | null;
}): string {
  const parts: string[] = [];
  const ratios = input.ratios ?? null;
  if (ratios) {
    for (const [name, key] of HASH_RATIOS) {
      const value = ratios[name];
      if (typeof value === "number" && Number.isFinite(value)) parts.push(`${key}:${(value * 100).toFixed(1)}`);
    }
  }
  if (input.overall != null && Number.isFinite(input.overall)) parts.push(`h:${Math.round(input.overall)}`);
  return parts.join("|");
}

function hashParts(hash: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of hash.split("|")) {
    const split = part.indexOf(":");
    if (split <= 0) continue;
    out.set(part.slice(0, split), part.slice(split + 1));
  }
  return out;
}

/**
 * True when a stored hash names a margin or overall the live books no longer
 * match. A key the live side does not have is ignored, so a draft that never
 * read health does not go stale only because the screen now has a score.
 */
export function draftFiguresDrift(
  storedHash: string | null | undefined,
  live: { ratios?: Record<string, number> | null; overall?: number | null },
): boolean {
  if (!storedHash?.trim()) return false;
  const stored = hashParts(storedHash);
  if (stored.size === 0) return false;
  const current = hashParts(draftFiguresHash(live));
  for (const [key, value] of stored) {
    const now = current.get(key);
    if (now != null && now !== value) return true;
  }
  return false;
}

export function draftStoredHealth(evidence: unknown): HealthScoreSnapshot | null {
  return readStoredHealthSnapshot(evidence);
}

export function draftStoredFiguresHash(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object") return null;
  const hash = (evidence as { figures_hash?: unknown }).figures_hash;
  return typeof hash === "string" && hash.trim() ? hash.trim() : null;
}

function liveOverallInBag(figures: Record<string, unknown>): number | null {
  for (const [key, value] of Object.entries(figures)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const compact = key.toLowerCase().replace(/[\s_:-]+/g, "");
    if (compact === "liveoverall" || compact === "livehealth") return Math.round(value);
  }
  return null;
}

/** live_overall wins. A bare overall can be the stored snapshot, so it is not used. */
export function liveOverallFromRecord(figures: Record<string, unknown> | null | undefined): number | null {
  if (!figures) return null;
  const top = liveOverallInBag(figures);
  if (top != null) return top;
  for (const value of Object.values(figures)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const nested = liveOverallInBag(value as Record<string, unknown>);
    if (nested != null) return nested;
  }
  return null;
}

export function liveOverallFromPool(pool: readonly { figures: Record<string, number> }[]): number | null {
  let found: number | null = null;
  for (const row of pool) {
    const next = liveOverallFromRecord(row.figures);
    if (next != null) found = next;
  }
  return found;
}

const STORED_VS_LIVE =
  /\bstored\s+(?:(?:health|score)\s+)?\d{1,3}\s+vs\.?\s+live\s+(\d{1,3})\b/gi;

/**
 * "stored health 69 vs live 67" becomes the live score only. When the books
 * have moved past the number the sentence called live, that live score wins.
 */
export function quoteLiveScoreOnly(text: string, overall?: number | null): string {
  const live = overall != null && Number.isFinite(overall) ? String(Math.round(overall)) : null;
  let next = text.replace(STORED_VS_LIVE, (_full, cited: string) => `health ${live ?? cited}`);
  next = live
    ? next.replace(/\bstored\s+(?:health|score)\s+\d{1,3}\b/gi, `health ${live}`)
    : next.replace(/\bstored\s+(?:health|score)\s+\d{1,3}\b/gi, "health");
  return next.replace(/[ \t]{2,}/g, " ");
}

export function quoteLiveDraftProse(
  text: string,
  live: { ratios?: Record<string, number> | null; overall?: number | null },
): string {
  const grounded = live.ratios ? groundAdvisoryNarrative(text, live.ratios) : text;
  return quoteLiveScoreOnly(grounded, live.overall);
}

const UNGROUNDED_FIGURE = /\d+(?:\.\d+)?%|\bstored\s+health\b|\bvs\s+live\b|\bhealth\s+\d{1,3}\b/i;

export type PresentedDraft = {
  text: string;
  stale: boolean;
  refresh: boolean;
  regenerate?: boolean;
};

/**
 * Re-render a stored draft from the live ratios and overall. A hash mismatch,
 * or a sentence that had to change, is the refresh state. When the live
 * figures are missing, a sentence that still quotes a number is not shown.
 */
export function presentLiveDraft(base: string, live?: DraftLiveFigures | null): PresentedDraft {
  const trimmed = base.trim();
  if (!trimmed) return { text: "", stale: false, refresh: false };
  const ratios = live?.ratios ?? null;
  const overall = live?.overall ?? null;
  const hasRatios = Boolean(
    ratios && Object.values(ratios).some((value) => typeof value === "number" && Number.isFinite(value)),
  );
  const hasOverall = overall != null && Number.isFinite(overall);
  if (!hasRatios && !hasOverall && UNGROUNDED_FIGURE.test(trimmed)) {
    return { text: DRAFT_OUT_OF_DATE, stale: true, refresh: true };
  }
  const grounded = quoteLiveDraftProse(trimmed, { ratios, overall });
  const health = presentHealthNarrative(grounded, live?.health, live?.storedHealth ?? null);
  if (health.regenerate) {
    return { text: health.text, stale: true, refresh: true, regenerate: true };
  }
  const changed = grounded !== trimmed;
  const drifted = draftFiguresDrift(live?.storedHash, { ratios, overall });
  const refresh = changed || drifted;
  if (/\bstored\s+health\b|\bvs\s+live\b/i.test(grounded)) {
    return { text: DRAFT_OUT_OF_DATE, stale: true, refresh: true };
  }
  if (refresh && grounded === trimmed && UNGROUNDED_FIGURE.test(grounded) && !hasRatios && !hasOverall) {
    return { text: DRAFT_OUT_OF_DATE, stale: true, refresh: true };
  }
  return { text: grounded, stale: refresh, refresh };
}
