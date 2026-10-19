import {
  computedDaysInventory,
  ratiosStatementFigures,
} from "@/lib/deliverable-input-config";

/** Drivers whose row currently prints a 0–100 score under a days name. */
export const DAY_SCORE_DRIVER_KEYS = [
  "debtorDays",
  "creditorDays",
  "inventoryDays",
  "workingCapitalDays",
] as const;

export type DayScoreDriverKey = (typeof DAY_SCORE_DRIVER_KEYS)[number];

export function isDayScoreDriver(key: string): key is DayScoreDriverKey {
  return (DAY_SCORE_DRIVER_KEYS as readonly string[]).includes(key);
}

/**
 * Health > Cash (and stock) driver label.
 * Known days: "Debtor Days · 6 days · score 93".
 * Unknown days: "Debtor Days · score 93".
 * The score stays the rounded 0–100 figure. It is named so it is not read as days.
 */
export function dayScoreDriverLabel(
  name: string,
  days: number | null | undefined,
  score: number,
): string {
  const title = name.trim();
  const knownDays = typeof days === "number" && Number.isFinite(days);
  const knownScore = Number.isFinite(score);
  const dayPart = knownDays ? `${Math.round(days)} days` : null;
  const scorePart = knownScore ? `score ${Math.round(score)}` : null;
  if (dayPart && scorePart) return `${title} · ${dayPart} · ${scorePart}`;
  if (scorePart) return `${title} · ${scorePart}`;
  if (dayPart) return `${title} · ${dayPart}`;
  return title;
}

type DayFigures = Parameters<typeof ratiosStatementFigures>[0];

/**
 * Day counts for the cash and stock driver rows.
 * Debtor and creditor days are `ratiosStatementFigures`. Stock days use the
 * same annualised-COGS rule; a blank stock figure stays unknown.
 * Working-capital days need all three. Unknown stays null.
 */
export function cashDriverDayFigures(financials: DayFigures): Record<DayScoreDriverKey, number | null> {
  const statement = ratiosStatementFigures(financials);
  const inventoryDays = computedDaysInventory(financials);
  const workingCapitalDays =
    statement.debtorDays != null && statement.creditorDays != null && inventoryDays != null
      ? Math.round(statement.debtorDays + inventoryDays - statement.creditorDays)
      : null;
  return {
    debtorDays: statement.debtorDays,
    creditorDays: statement.creditorDays,
    inventoryDays,
    workingCapitalDays,
  };
}
