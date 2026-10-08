/**
 * One reading of the 13-week forecast for the cash tab, Overview, the PDF,
 * and the Bot. The maths stay in client-metrics. This module only decides
 * which point is the low, whether cash is under the floor, and the sentence
 * those surfaces share.
 */
import { forecastMinimumCash } from "./client-metrics.ts";

export function canonicalForecastFloor(input: {
  configured?: number | null;
  weeklyOutflows?: Array<number | null | undefined> | null;
}): number {
  return forecastMinimumCash(input);
}

/**
 * Empty cash tab. No lines means there is nothing to chart. A zero opening
 * is not a trough under the floor — the lowest-point tile stays blank until
 * an opening balance is entered.
 */
export function cashEmptyPresentation(input: {
  opening: number;
  linesBlank: boolean;
}): { showChart: boolean; lowestBlank: boolean } {
  const hasOpening = Number.isFinite(input.opening) && input.opening !== 0;
  return {
    showChart: !input.linesBlank,
    lowestBlank: input.linesBlank && !hasOpening,
  };
}

export function forecastLowestPoint(
  opening: number,
  closings: readonly number[],
): { amount: number; week: number; isOpening: boolean } {
  let amount = Number.isFinite(opening) ? opening : Number.POSITIVE_INFINITY;
  let week = 0;
  let isOpening = true;
  closings.forEach((raw, i) => {
    if (!Number.isFinite(raw)) return;
    if (raw < amount) {
      amount = raw;
      week = i + 1;
      isOpening = false;
    }
  });
  if (!Number.isFinite(amount)) return { amount: 0, week: 0, isOpening: true };
  return { amount, week, isOpening };
}

export function forecastFloorPosition(input: {
  opening: number;
  closings: readonly number[];
  floor: number;
}): {
  opensBelow: boolean;
  firstDipWeek: number | null;
  weeksBelow: number;
  staysAbove: boolean;
} {
  const opensBelow = Number.isFinite(input.opening) && input.opening < input.floor;
  let firstDipWeek: number | null = null;
  let weeksBelow = 0;
  input.closings.forEach((raw, i) => {
    if (!Number.isFinite(raw)) return;
    if (raw < input.floor) {
      weeksBelow += 1;
      if (firstDipWeek == null) firstDipWeek = i + 1;
    }
  });
  return {
    opensBelow,
    firstDipWeek,
    weeksBelow,
    staysAbove: !opensBelow && firstDipWeek == null,
  };
}

/** Position clause shared by Overview and the cash tab. */
export function forecastPositionPhrase(input: {
  opening: number;
  closings: readonly number[];
  floor: number;
}): string {
  const pos = forecastFloorPosition(input);
  if (pos.staysAbove) return "stays above floor";
  if (pos.opensBelow && pos.firstDipWeek == null) return "opens below floor";
  if (pos.opensBelow && pos.firstDipWeek != null) {
    return `opens below floor; dips below floor in week ${pos.firstDipWeek}`;
  }
  return `dips below floor in week ${pos.firstDipWeek}`;
}

/**
 * Runway tile. Under the floor, every surface says how many weeks sit below
 * it. Above the floor, they use the shared burn / cash-generative label.
 * A floor dip does not replace that label with "weeks until the first dip".
 */
export function forecastRunwayHeadlineShared(input: {
  opening: number;
  closings: readonly number[];
  floor: number;
  runwayLabel?: string | null;
  cashGenerative?: boolean;
}): { headline: string; note: string } {
  const pos = forecastFloorPosition(input);
  if (!pos.staysAbove) {
    if (pos.firstDipWeek != null) {
      const n = pos.weeksBelow;
      const headline = n === 1 ? "1 week below" : `${n} weeks below`;
      const note = pos.opensBelow
        ? `opens below the floor; first closing dip week ${pos.firstDipWeek}`
        : `first dip week ${pos.firstDipWeek}`;
      return { headline, note };
    }
    return { headline: "Below floor", note: "opening is under the floor" };
  }
  if (input.cashGenerative) return { headline: "Cash generative", note: "above the floor" };
  const label = input.runwayLabel?.trim();
  if (label && label !== "—") return { headline: label, note: "above the floor" };
  const horizon = input.closings.length > 0 ? input.closings.length : 13;
  return { headline: `${horizon}+ wks`, note: "above the floor" };
}

/**
 * The sentence under the cash-tab tiles. The pack uses the same words so a
 * regenerated forecast cannot disagree with the screen.
 */
export function forecastStatusSentence(input: {
  opening: number;
  closings: readonly number[];
  floor: number;
  floorText: string;
  runwayLabel?: string | null;
  cashGenerative?: boolean;
}): string {
  const story = forecastRunwayHeadlineShared(input);
  const weeks = input.closings.length > 0 ? input.closings.length : 13;
  if (story.note === "above the floor") {
    return `Cash stays above the ${input.floorText} floor across these ${weeks} weeks.`;
  }
  const phrase = forecastPositionPhrase(input);
  return `Cash ${phrase} (floor ${input.floorText}). ${story.headline} — action needed.`;
}

export type OpeningSourceChip = "Statement" | "Bank" | "Sync" | "Manual" | "Estimate";

/** Chip for the opening field. Unknown sources stay blank rather than guessed. */
export function openingSourceLabel(
  cf: Record<string, unknown> | null | undefined,
): OpeningSourceChip | null {
  if (!cf) return null;
  const lines = typeof cf.forecastLinesSource === "string" ? cf.forecastLinesSource : "";
  const opening = typeof cf.openingBalanceSource === "string" ? cf.openingBalanceSource : "";
  if (lines === "pl-estimate") return "Estimate";
  if (typeof cf.seededFromBanksAt === "string" && cf.seededFromBanksAt.length > 0) return "Bank";
  if (
    opening === "xero" ||
    opening === "qbo" ||
    lines === "xero-bank-summary" ||
    lines === "qbo-bank-activity"
  ) {
    return "Sync";
  }
  if (opening === "statement") return "Statement";
  if (opening === "manual" || opening === "accountant") return "Manual";
  return null;
}
