/**
 * Copy for the Overview and Moves answer strips.
 * Sentences are assembled from strings and counts already on the page.
 */
import { healthHeadline } from "@/lib/client-briefing";

/** CoS order for the Overview jump cards. Pillars stay on the section tab list. */
export const OVERVIEW_CARD_ORDER = [
  "health",
  "cash",
  "profit",
  "collections",
  "payables",
  "budget",
  "moves",
  "books",
] as const;

export type OverviewCardId = (typeof OVERVIEW_CARD_ORDER)[number];

const OVERVIEW_CARD_LABELS: Record<OverviewCardId, string> = {
  health: "Health",
  cash: "Cash",
  profit: "Profit",
  collections: "Collections",
  payables: "Payables",
  budget: "Budget",
  moves: "Moves",
  books: "Books",
};

export function overviewAnswerSentence(input: {
  whatMatters: string | null | undefined;
  score: number | null | undefined;
  label: string;
}): string {
  const matter = input.whatMatters?.trim();
  if (matter) return matter;
  return healthHeadline(input.score, input.label);
}

export function overviewSectionCards(
  figures: Partial<Record<OverviewCardId, string | null | undefined>>,
  details?: Partial<Record<OverviewCardId, string | null | undefined>>,
): { id: OverviewCardId; label: string; figure: string | null; detail: string | null }[] {
  return OVERVIEW_CARD_ORDER.map((id) => {
    const figure = figures[id]?.trim() ?? "";
    const detail = details?.[id]?.trim() ?? "";
    return { id, label: OVERVIEW_CARD_LABELS[id], figure: figure || null, detail: detail || null };
  });
}

export function snapshotFigure(
  snapshot: readonly { key: string; value: string }[],
  key: string,
): string | null {
  const value = snapshot.find((row) => row.key === key)?.value?.trim() ?? "";
  return value || null;
}

/** A stored amount, formatted by the caller. Blank stays blank. */
export function storedAmountFigure(
  amount: number | null | undefined,
  money: (n: number) => string,
): string | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return money(amount);
}

export const MOVES_EMPTY_SENTENCE =
  "No moves yet. Add figures on Overview and this list fills from the ratios.";

/**
 * Top move plus a rand impact only when that impact string was already
 * computed. The move catalogue has no rand amount (`impact` is a rank weight
 * and `impactLine` is prose), so the accountant list uses the count and the
 * first title.
 */
/**
 * Every title uses "Start with:". A catalogue title that starts with a capital
 * and a lowercase letter drops that first letter. An acronym stays as written.
 */
function moveLeadIn(title: string): string {
  const shown = /^[A-Z][a-z]/.test(title)
    ? `${title.charAt(0).toLowerCase()}${title.slice(1)}`
    : title;
  return `Start with: ${shown.endsWith(".") ? shown : `${shown}.`}`;
}

export function movesAnswerSentence(
  moves: readonly { title: string }[],
  randImpact?: string | null,
): string {
  if (moves.length === 0) return MOVES_EMPTY_SENTENCE;
  const title = moves[0]?.title.trim() ?? "";
  const impact = randImpact?.trim() ?? "";
  if (impact) return title ? `${title}. ${impact}` : impact;
  const ready = moves.length === 1 ? "1 move ready" : `${moves.length} moves ready`;
  return title ? `${ready}. ${moveLeadIn(title)}` : `${ready}.`;
}
