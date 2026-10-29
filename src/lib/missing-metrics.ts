/**
 * What a report or tab should print when a figure was not on the file.
 *
 * The numbers engine can still send 0 for a blank receivable or payable.
 * Renderers ask this helper so a later engine fix, which sends null instead,
 * only makes the source check redundant.
 */
import { benchmarkEmptyCopy } from "./benchmark-empty.ts";

export const NOT_ENOUGH_DATA = "Not enough data";
export const MISSING_FIGURE = "—";

export const CYCLE_REPORT_NEEDS =
  "Cash flow cycle needs a balance sheet — receivables, inventory, or payables.";

/** A stored figure, including "0". Blank, null, and a missing key are absent. */
export function inputPresent(value: unknown): boolean {
  if (value == null) return false;
  return String(value).trim() !== "";
}

/**
 * No receivables, inventory, or payables on the file.
 * A missing financials object is "not provided", not an empty balance sheet.
 */
export function balanceSheetDayInputsMissing(financials: object | null | undefined): boolean {
  if (financials == null) return false;
  const record = financials as Record<string, unknown>;
  return (
    !inputPresent(record.receivables) &&
    !inputPresent(record.inventory) &&
    !inputPresent(record.payables)
  );
}

export function headcountInputMissing(financials: object | null | undefined): boolean {
  if (financials == null) return false;
  return !inputPresent((financials as Record<string, unknown>).employees);
}

const DAY_METRIC_NAMES = new Set([
  "debtor days",
  "creditor days",
  "inventory days",
  "working capital days",
  "days sales outstanding",
  "days payable outstanding",
  "days inventory outstanding",
  "cash conversion cycle",
  "funding gap",
]);

export function isDayMetricName(name: string | null | undefined): boolean {
  if (!name) return false;
  const key = name.trim().toLowerCase();
  if (DAY_METRIC_NAMES.has(key)) return true;
  return key.includes("funding gap");
}

/** null, undefined, or a non-finite number. A real 0 is present. */
export function valueMissing(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  return false;
}

/**
 * Hide the figure. Null, undefined, and NaN are missing.
 * A day metric is also missing when the file has no AR, inventory, or payables,
 * even if the engine sent 0.
 */
export function renderedMetricMissing(input: {
  value?: unknown;
  name?: string | null;
  financials?: object | null;
}): boolean {
  if (valueMissing(input.value)) return true;
  if (isDayMetricName(input.name) && balanceSheetDayInputsMissing(input.financials)) return true;
  return false;
}

/** Disabled-card note when the sector has no benchmark rows. Null when rows exist. */
export function benchmarkCardNote(input: {
  rows: readonly unknown[];
  profileSectorName?: string | null;
  studioSectorName?: string | null;
}): string | null {
  if (input.rows.length > 0) return null;
  return benchmarkEmptyCopy({
    profileSectorName: input.profileSectorName,
    studioSectorName: input.studioSectorName,
  }).message;
}
