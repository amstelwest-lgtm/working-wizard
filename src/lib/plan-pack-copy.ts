/**
 * Action Plan and Advisory pack answer-strip copy.
 * Counts and titles are the ones already on the page. Status words come from
 * `signoffStatusLine`. This file does not rank actions or rebuild a pack.
 */
import {
  PAGE_FIGURES_CHANGED_CLAUSE,
  signoffStatusLine,
  type SignoffStatusKind,
} from "@/lib/signoff-status";

export type PackAnswerStatus = "draft" | "in_review" | "signed" | "signed_stale";

export function packStatusKind(status: PackAnswerStatus): SignoffStatusKind {
  if (status === "signed_stale") return "stale";
  if (status === "signed") return "signed";
  if (status === "in_review") return "ready";
  return "draft";
}

function finish(line: string): string {
  const text = line.trim();
  if (!text) return text;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** "September 2026" stays "September". Anything else is used as written. */
function packTitle(periodLabel: string | null | undefined): string {
  const period = periodLabel?.trim() ?? "";
  if (!period) return "This pack";
  const month = period.match(/^([A-Za-z]+)\s+\d{4}$/);
  return month ? `${month[1]} pack` : `${period} pack`;
}

export function packAnswerSentence(input: {
  periodLabel?: string | null;
  sectionCount: number;
  status: PackAnswerStatus;
  signedBy?: string | null;
  /** Already formatted clock from the existing review date helper. */
  signedDate?: string | null;
}): string {
  const kind = packStatusKind(input.status);
  if (kind === "signed") {
    return finish(signoffStatusLine({ kind: "signed", name: input.signedBy, date: input.signedDate }));
  }
  if (kind === "stale") {
    const signed = finish(
      signoffStatusLine({ kind: "signed", name: input.signedBy, date: input.signedDate }),
    );
    const clause = `${PAGE_FIGURES_CHANGED_CLAUSE.charAt(0).toUpperCase()}${PAGE_FIGURES_CHANGED_CLAUSE.slice(1)}`;
    return `${signed} ${finish(clause)}`;
  }
  if (!input.periodLabel?.trim() && input.sectionCount <= 0) {
    return "No pack on file yet. Generate one from the figures already on this file.";
  }
  const count = Math.max(0, input.sectionCount);
  const drafted = count === 1 ? "1 section drafted" : `${count} sections drafted`;
  const title = packTitle(input.periodLabel);
  // Same kind as the pill. Ready and draft are the only open states.
  if (kind === "ready") return `${title}: ${drafted} and ready for your review.`;
  return `${title}: ${drafted}. Read it through, then sign off.`;
}

/** Drawer hint. The version left the Sign off button. */
export function packDrawerHint(version: number | null | undefined, includeRegenerate: boolean): string {
  const tail = includeRegenerate ? "sections, regenerate" : "sections";
  if (version != null && version > 0) return `Version ${version} · ${tail}`;
  return includeRegenerate ? "Sections, regenerate" : "Sections";
}

/** Status pill. The stale pill is the short shared line; the sentence keeps the long one. */
export function packStatusText(input: {
  status: PackAnswerStatus;
  signedBy?: string | null;
  signedDate?: string | null;
}): string {
  const kind = packStatusKind(input.status);
  return signoffStatusLine({
    kind,
    name: input.signedBy,
    date: kind === "signed" ? input.signedDate : null,
    variant: kind === "stale" ? "short" : "full",
  });
}

/** No pack on file is not a draft. The pill appears only once a pack exists. */
export function packStripStatus(
  hasPack: boolean,
  input: {
    status: PackAnswerStatus;
    signedBy?: string | null;
    signedDate?: string | null;
  },
): string | null {
  if (!hasPack) return null;
  return packStatusText(input);
}

const PLAN_EMPTY_SENTENCE = "No actions in the plan yet. Add the first one to get started.";

/** Same lead-in as Moves. The first title is the first action already in the list. */
export function planAnswerSentence(actions: readonly { title: string }[]): string {
  if (actions.length === 0) return PLAN_EMPTY_SENTENCE;
  const title = actions[0]?.title.trim() ?? "";
  const lead = actions.length === 1 ? "1 action in the plan" : `${actions.length} actions in the plan`;
  if (!title) return `${lead}.`;
  const shown = /^[A-Z][a-z]/.test(title)
    ? `${title.charAt(0).toLowerCase()}${title.slice(1)}`
    : title;
  return `${lead}. Start with: ${shown.endsWith(".") ? shown : `${shown}.`}`;
}
