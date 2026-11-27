/**
 * Accountant confirmation that a blank money field is nil.
 * Only a null amount is filled. A typed figure, including a typed zero, stays.
 * Undo puts those filled fields back to blank.
 * Nothing is filed.
 */
import type { Itr12BusinessInput, Itr12RentalProperty } from "./itr12-schedules.ts";
import type { Itr14Inputs } from "./itr14.ts";

export const NIL_CONFIRMED_NOTE = "Nil confirmed by accountant";

const RENTAL_AMOUNTS = [
  "rentReceivedCents",
  "ratesCents",
  "interestCents",
  "insuranceCents",
  "repairsCents",
  "leviesCents",
  "agentFeesCents",
  "wearAndTearCents",
] as const;

type RentalAmount = (typeof RENTAL_AMOUNTS)[number];

const ITR14_ADJUSTMENT_AMOUNTS = [
  "depreciationAddBackCents",
  "finesAddBackCents",
  "wearAndTearCents",
  "exemptDividendsCents",
  "assessedLossBroughtForwardCents",
  "donationCents",
] as const;

type Itr14AdjustmentAmount = (typeof ITR14_ADJUSTMENT_AMOUNTS)[number];

function keysOf(value: readonly string[] | undefined): Set<string> {
  return new Set(value ?? []);
}

function assetRegisterStarted(input: Itr12BusinessInput): boolean {
  return input.assets.some(
    (asset) =>
      asset.description.trim() !== "" ||
      asset.costCents != null ||
      asset.broughtIntoUse.trim() !== "" ||
      asset.category.trim() !== "" ||
      asset.privateUsePercent != null,
  );
}

/** Fill blank business amounts with nil. Typed amounts stay. */
export function markBusinessNil(input: Itr12BusinessInput): Itr12BusinessInput {
  const filled = keysOf(input.nilConfirmed);
  const before = filled.size;
  let grossIncomeCents = input.grossIncomeCents;
  if (grossIncomeCents == null) {
    grossIncomeCents = 0;
    filled.add("grossIncomeCents");
  }
  const deductions = input.deductions.map((row) => {
    if (row.amountCents != null) return row;
    filled.add(`deduction:${row.id}`);
    return { ...row, amountCents: 0 };
  });
  let homeOffice = input.homeOffice;
  if (homeOffice && homeOffice.amountCents == null) {
    homeOffice = { ...homeOffice, amountCents: 0 };
    filled.add("homeOffice");
  }
  let wearAndTearCents = input.wearAndTearCents;
  if (!assetRegisterStarted(input) && wearAndTearCents == null) {
    wearAndTearCents = 0;
    filled.add("wearAndTearCents");
  }
  if (filled.size === before) return input;
  return {
    ...input,
    grossIncomeCents,
    deductions,
    homeOffice,
    wearAndTearCents,
    nilConfirmed: [...filled],
  };
}

/** Put amounts this confirmation filled back to blank. */
export function undoBusinessNil(input: Itr12BusinessInput): Itr12BusinessInput {
  const filled = keysOf(input.nilConfirmed);
  if (filled.size === 0) return input;
  return {
    ...input,
    grossIncomeCents: filled.has("grossIncomeCents") ? null : input.grossIncomeCents,
    wearAndTearCents: filled.has("wearAndTearCents") ? null : input.wearAndTearCents,
    deductions: input.deductions.map((row) =>
      filled.has(`deduction:${row.id}`) ? { ...row, amountCents: null } : row,
    ),
    homeOffice:
      input.homeOffice && filled.has("homeOffice")
        ? { ...input.homeOffice, amountCents: null }
        : input.homeOffice,
    nilConfirmed: [],
  };
}

/** Fill blank rental amounts with nil. Private use is left blank. */
export function markRentalNil(property: Itr12RentalProperty): Itr12RentalProperty {
  const filled = keysOf(property.nilConfirmed);
  const before = filled.size;
  const next: Itr12RentalProperty = { ...property };
  for (const key of RENTAL_AMOUNTS) {
    if (next[key] != null) continue;
    next[key] = 0;
    filled.add(key);
  }
  if (filled.size === before) return property;
  return { ...next, nilConfirmed: [...filled] };
}

export function undoRentalNil(property: Itr12RentalProperty): Itr12RentalProperty {
  const filled = keysOf(property.nilConfirmed);
  if (filled.size === 0) return property;
  const next: Itr12RentalProperty = { ...property, nilConfirmed: [] };
  for (const key of RENTAL_AMOUNTS) {
    if (filled.has(key)) next[key] = null;
  }
  return next;
}

/**
 * Fill a blank assessed capital loss brought forward with nil.
 * A typed balance is left as it was, and does not gain the note.
 */
export function markCapitalLossNil(
  cents: number | null,
  confirmed: boolean,
): { cents: number | null; confirmed: boolean } {
  if (cents != null) return { cents, confirmed };
  return { cents: 0, confirmed: true };
}

export function undoCapitalLossNil(
  cents: number | null,
  confirmed: boolean,
): { cents: number | null; confirmed: boolean } {
  if (!confirmed) return { cents, confirmed: false };
  return { cents: null, confirmed: false };
}

/** Fill blank ITR14 adjustment amounts. A figure supplied by the books or the register is skipped. */
export function markItr14AdjustmentsNil(
  inputs: Itr14Inputs,
  skip: { depreciation?: boolean; wear?: boolean } = {},
): Itr14Inputs {
  const filled = keysOf(inputs.nilConfirmed);
  const before = filled.size;
  const next: Itr14Inputs = { ...inputs };
  for (const key of ITR14_ADJUSTMENT_AMOUNTS) {
    if (key === "depreciationAddBackCents" && skip.depreciation) continue;
    if (key === "wearAndTearCents" && skip.wear) continue;
    if (next[key] != null) continue;
    next[key] = 0;
    filled.add(key);
  }
  const adjustments = inputs.adjustments.map((row) => {
    if (row.amountCents != null) return row;
    filled.add(`adjustment:${row.id}`);
    return { ...row, amountCents: 0 };
  });
  if (filled.size === before) return inputs;
  return { ...next, adjustments, nilConfirmed: [...filled] };
}

export function undoItr14AdjustmentsNil(inputs: Itr14Inputs): Itr14Inputs {
  const filled = keysOf(inputs.nilConfirmed);
  if (filled.size === 0) return inputs;
  const next: Itr14Inputs = { ...inputs, nilConfirmed: [] };
  for (const key of ITR14_ADJUSTMENT_AMOUNTS) {
    if (filled.has(key)) next[key] = null;
  }
  next.adjustments = inputs.adjustments.map((row) =>
    filled.has(`adjustment:${row.id}`) ? { ...row, amountCents: null } : row,
  );
  return next;
}

export function nilKeysFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}
