/**
 * Freeze a score-loop projection onto an Action Plan item without a new column.
 * Encoded after a sentinel in `outcome_why` so this PR is abortable
 * (no schema to roll back). UI must always display the stripped why.
 */

import type { FrozenScoreProjection } from "@/lib/score-projection";

export const PROJECTION_OPEN = "@@milon-projection@@";
export const PROJECTION_CLOSE = "@@/milon-projection@@";

export function encodeOutcomeWhy(
  why: string | null | undefined,
  projection: FrozenScoreProjection | null | undefined,
): string | null {
  const text = (why ?? "").trim();
  if (!projection) return text || null;
  return `${text}\n\n${PROJECTION_OPEN}${JSON.stringify(projection)}${PROJECTION_CLOSE}`;
}

export function stripProjectionFromWhy(raw: string | null | undefined): string {
  if (!raw) return "";
  const i = raw.indexOf(PROJECTION_OPEN);
  if (i === -1) return raw.trim();
  return raw.slice(0, i).trim();
}

export function decodeFrozenProjection(
  raw: string | null | undefined,
): FrozenScoreProjection | null {
  if (!raw) return null;
  const start = raw.indexOf(PROJECTION_OPEN);
  const end = raw.indexOf(PROJECTION_CLOSE);
  if (start === -1 || end === -1 || end <= start) return null;
  const json = raw.slice(start + PROJECTION_OPEN.length, end);
  try {
    const parsed = JSON.parse(json) as FrozenScoreProjection;
    if (!parsed || parsed.v !== 1 || !parsed.driverKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function displayOutcomeWhy(raw: string | null | undefined): string {
  return stripProjectionFromWhy(raw);
}
