/**
 * Premises in the budget follows a rent payment already in the 13-week
 * forecast. A blank premises line is filled. A different amount is flagged.
 */
import { bankHistoryIsSingleMonth, displayForecastFrequency, forecastLineRule } from "./cash-forecast-rows.ts";
import { fyMonths } from "./budget.months.ts";
import type { BudgetDocument } from "./budget.types.ts";

export type ForecastRent = {
  name: string;
  monthly: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function forecastRentPayment(cashflow: unknown): ForecastRent | null {
  const cf = asRecord(cashflow);
  if (!cf) return null;
  const singleMonth = bankHistoryIsSingleMonth({
    seededFromBanksAt: cf.seededFromBanksAt,
    bankDraft: cf.bankDraft ?? cf.cashflow_bank_draft,
  });
  let best: ForecastRent | null = null;
  for (const side of ["expenses", "other"] as const) {
    const rows = Array.isArray(cf[side]) ? cf[side] : [];
    for (const row of rows) {
      const line = asRecord(row);
      if (!line) continue;
      const name = typeof line.name === "string" ? line.name.trim() : "";
      if (!name) continue;
      const frequency = typeof line.frequency === "string" ? line.frequency : null;
      const amount = typeof line.amount === "number" ? line.amount : parseFloat(String(line.amount ?? ""));
      if (!Number.isFinite(amount) || amount < 1) continue;
      if (forecastLineRule(name, "once-off", { side, singleMonth }) !== "rent") continue;
      const shown = displayForecastFrequency(name, frequency, { side, singleMonth });
      if (shown !== "recurring-monthly" && shown !== "monthly") continue;
      if (!best || amount > best.monthly) best = { name, monthly: amount };
    }
  }
  return best;
}

function premisesAmounts(doc: BudgetDocument): number[] {
  const line = doc.overheads.find((row) => row.bucket === "premises");
  if (!line) return [];
  return Object.values(line.months).map((amount) => Number(amount) || 0);
}

/** Typical premises month. Blank when the line is missing. */
export function premisesMonthlyAmount(doc: BudgetDocument): number | null {
  const line = doc.overheads.find((row) => row.bucket === "premises");
  if (!line) return null;
  const amounts = premisesAmounts(doc);
  if (amounts.length === 0) return 0;
  return amounts[0] ?? 0;
}

/**
 * Fill every premises month when the line is blank and the forecast has rent.
 * A typed premises amount is left alone.
 */
export function applyForecastRent(doc: BudgetDocument, cashflow: unknown): BudgetDocument {
  const rent = forecastRentPayment(cashflow);
  if (!rent) return doc;
  const amounts = premisesAmounts(doc);
  if (amounts.length > 0 && amounts.some((amount) => Math.abs(amount) >= 0.5)) return doc;
  const line = doc.overheads.find((row) => row.bucket === "premises");
  if (!line) return doc;
  const keys = Object.keys(line.months);
  const targets = keys.length > 0 ? keys : fyMonths(doc.fyStart);
  return {
    ...doc,
    overheads: doc.overheads.map((row) => {
      if (row.bucket !== "premises") return row;
      return {
        ...row,
        months: Object.fromEntries(targets.map((month) => [month, rent.monthly])),
      };
    }),
  };
}

export function budgetRentHint(
  doc: BudgetDocument,
  rent: ForecastRent | null,
  money: (n: number) => string,
  statementAligned: boolean,
): string | null {
  if (!rent) {
    return statementAligned
      ? "Operating expenses from the statement. Rent is not on the statement."
      : null;
  }
  const premises = premisesMonthlyAmount(doc);
  if (premises == null || Math.abs(premises - rent.monthly) < 1) {
    return `Rent follows ${rent.name} in the 13-week forecast.`;
  }
  return `The 13-week forecast pays ${rent.name} ${money(rent.monthly)} a month. Premises in this budget is ${money(premises)}.`;
}
