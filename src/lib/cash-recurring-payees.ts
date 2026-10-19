/**
 * Recurring bank payees. The same payee, at roughly the same amount, on a
 * monthly or weekly cadence already in the bank history, is projected through
 * the 13-week horizon. A single hit stays in its one week. Amounts stay the
 * stored line amount.
 */
import { buildDraftLinesFromExtract, payeeGroupKey } from "./cash-from-banks.pattern.ts";
import type { CashBankExtract } from "./cash-from-banks.types.ts";
import { displayForecastFrequency } from "./cash-forecast-rows.ts";

export type RecurringFrequency = "recurring-monthly" | "recurring-weekly";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function recurringFrequency(cadence: string | null | undefined): RecurringFrequency | null {
  if (cadence === "weekly" || cadence === "recurring-weekly") return "recurring-weekly";
  if (cadence === "monthly" || cadence === "annual" || cadence === "recurring-monthly") {
    return "recurring-monthly";
  }
  return null;
}

function remember(map: Map<string, RecurringFrequency>, name: string, frequency: RecurringFrequency): void {
  const key = payeeGroupKey(name);
  if (!key) return;
  const prev = map.get(key);
  if (!prev || frequency === "recurring-weekly") map.set(key, frequency);
}

function considerLine(map: Map<string, RecurringFrequency>, value: unknown): void {
  if (!isRecord(value)) return;
  if (value.status === "excluded") return;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return;
  const frequency =
    recurringFrequency(typeof value.cadence === "string" ? value.cadence : null) ??
    recurringFrequency(typeof value.frequency === "string" ? value.frequency : null);
  if (!frequency) return;
  remember(map, name, frequency);
}

/** Payee key → cadence already detected in the bank draft or its extract. */
export function recurringPayeeFrequency(bankDraft: unknown): Map<string, RecurringFrequency> {
  const map = new Map<string, RecurringFrequency>();
  if (!isRecord(bankDraft)) return map;
  if (Array.isArray(bankDraft.lines)) {
    for (const line of bankDraft.lines) considerLine(map, line);
  }
  const extract = bankDraft.extract;
  if (isRecord(extract) && Array.isArray(extract.transactions)) {
    for (const line of buildDraftLinesFromExtract(extract as CashBankExtract)) {
      if (line.status === "excluded") continue;
      const frequency = recurringFrequency(line.cadence);
      if (!frequency) continue;
      remember(map, line.name, frequency);
    }
  }
  return map;
}

export function isRecurringPayee(
  name: string,
  recurring: ReadonlyMap<string, RecurringFrequency> | null | undefined,
): boolean {
  if (!recurring || recurring.size === 0) return false;
  const key = payeeGroupKey(name);
  return Boolean(key && recurring.has(key));
}

/**
 * Display cadence. A stored once-off repeats only when history already says
 * that payee is monthly or weekly. Otherwise the name rule (rent, payroll) stands.
 */
export function projectForecastFrequency(
  name: string,
  frequency: string | null | undefined,
  recurring?: ReadonlyMap<string, RecurringFrequency> | null,
): string {
  const stored = frequency ?? "recurring-monthly";
  if ((stored === "once-off" || stored === "once") && isRecurringPayee(name, recurring)) {
    return recurring!.get(payeeGroupKey(name)) ?? stored;
  }
  return displayForecastFrequency(name, frequency);
}

export function isProjectedOnceOff(
  name: string,
  frequency: string | null | undefined,
  recurring?: ReadonlyMap<string, RecurringFrequency> | null,
): boolean {
  const freq = projectForecastFrequency(name, frequency, recurring);
  return freq === "once-off" || freq === "once";
}
