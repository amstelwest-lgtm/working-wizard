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
 * Missing days stay the title. A score is not printed without a day count,
 * so a blank receivable does not read as "0 days" or "score 100".
 */
export function dayScoreDriverLabel(
  name: string,
  days: number | null | undefined,
  score: number,
): string {
  const title = name.trim();
  const knownDays = typeof days === "number" && Number.isFinite(days);
  if (!knownDays) return title;
  const dayPart = `${Math.round(days)} days`;
  const scorePart = Number.isFinite(score) ? `score ${Math.round(score)}` : null;
  return scorePart ? `${title} · ${dayPart} · ${scorePart}` : `${title} · ${dayPart}`;
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
  const debtorDays = statement.debtorDays;
  const creditorDays = statement.creditorDays;
  const workingCapitalDays =
    debtorDays == null || creditorDays == null || inventoryDays == null
      ? null
      : [debtorDays, inventoryDays, creditorDays].every((days) => Number.isFinite(days))
        ? Math.round(debtorDays + inventoryDays - creditorDays)
        : Number.NaN;
  return {
    debtorDays: statement.debtorDays,
    creditorDays: statement.creditorDays,
    inventoryDays,
    workingCapitalDays,
  };
}
