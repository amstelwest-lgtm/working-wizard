/**
 * ITR12 local business and local rental schedules.
 *
 * Draft figures for a person to check. Milōn does not log into SARS, does not
 * file, and does not write a ledger. A blank schedule is not zero. A missing
 * figure stays blank.
 *
 * Wear-and-tear uses the ITR14 asset register. Home-office s23(b) conditions
 * and the s20A ring-fence are marks the accountant types. They are not worked
 * out here. A floor-area split, the local-interest exemption, the medical
 * credit, and the retirement deduction limit are not signed off.
 */
import {
  wearAssetsFrom,
  wearSchedule,
  type WearAsset,
  type WearSchedule,
} from "./itr14-allowances.ts";

export type Itr12BusinessDeduction = {
  id: string;
  label: string;
  amountCents: number | null;
};

export type Itr12HomeOffice = {
  amountCents: number | null;
  /** Part of the home is specifically equipped for the trade. */
  specificallyEquipped: boolean | null;
  /** That part is regularly and exclusively used for the trade. */
  regularlyAndExclusivelyUsed: boolean | null;
};

export type Itr12BusinessInput = {
  grossIncomeCents: number | null;
  deductions: readonly Itr12BusinessDeduction[];
  homeOffice: Itr12HomeOffice | null;
  assets: readonly WearAsset[];
  /** Used only when the asset register is empty. Null is blank, not zero. */
  wearAndTearCents: number | null;
  /** Typist mark only. Null means not marked. It does not change the net. */
  ringFenceS20A: boolean | null;
};

export type Itr12HomeOfficeResult = {
  amountCents: number | null;
  specificallyEquipped: boolean | null;
  regularlyAndExclusivelyUsed: boolean | null;
  /** Null while a mark or the amount is still blank. Zero when the marks refuse the claim. */
  deductedCents: number | null;
  note: string;
};

export type Itr12BusinessSchedule = {
  draft: true;
  grossIncomeCents: number | null;
  deductions: readonly Itr12BusinessDeduction[];
  homeOffice: Itr12HomeOfficeResult | null;
  wear: WearSchedule | null;
  wearAndTearCents: number | null;
  /** Null when the register is absent. A computed register can be zero. */
  recoupmentCents: number | null;
  ringFenceS20A: boolean | null;
  netProfitCents: number | null;
  notes: string[];
};

export type Itr12RentalProperty = {
  id: string;
  description: string;
  rentReceivedCents: number | null;
  ratesCents: number | null;
  interestCents: number | null;
  insuranceCents: number | null;
  repairsCents: number | null;
  leviesCents: number | null;
  agentFeesCents: number | null;
  wearAndTearCents: number | null;
  assets: readonly WearAsset[];
  /** Whole percent, 0 to 100. Null stays blank and blocks the net. */
  privateUsePercent: number | null;
};

export type Itr12RentalPropertyResult = {
  id: string;
  description: string;
  rentReceivedCents: number | null;
  ratesCents: number | null;
  interestCents: number | null;
  insuranceCents: number | null;
  repairsCents: number | null;
  leviesCents: number | null;
  agentFeesCents: number | null;
  wearAndTearCents: number | null;
  privateUsePercent: number | null;
  /** Expenses before private use. Null while any expense is blank. */
  expenseCents: number | null;
  allowableExpensesCents: number | null;
  netCents: number | null;
  note: string;
};

export type Itr12RentalSchedule = {
  draft: true;
  properties: readonly Itr12RentalPropertyResult[];
  totalNetCents: number | null;
  notes: string[];
};

export type Itr12TaxableTie = {
  employmentCents: number;
  /** Null when the business schedule replaces practice income and practice expenses. */
  practiceNetCents: number | null;
  businessNetCents: number | null;
  rentalNetCents: number | null;
  taxableIncomeCents: number;
};

const HOME_OFFICE_NOTE =
  "Home office is deducted only when both s23(b) marks are yes and an amount is typed. A floor-area split is not signed off, so the amount is not worked out here.";

const RING_FENCE_NOTE =
  "s20A ring-fence is not signed off. The mark is an indicator only and does not change the net.";

const SCRAPPING_NOTE = "A scrapping allowance is not calculated on this schedule.";

export const ITR12_TAXABLE_EXCLUSION_NOTE =
  "Local interest exemption, medical tax credit, and retirement deduction limit are not signed off, so they stay out of this total.";

function nonNegative(cents: number | null): cents is number {
  return cents != null && Number.isSafeInteger(cents) && cents >= 0;
}

function homeStarted(home: Itr12HomeOffice | null | undefined): boolean {
  if (!home) return false;
  return (
    home.amountCents != null ||
    home.specificallyEquipped != null ||
    home.regularlyAndExclusivelyUsed != null
  );
}

function homeOfficeResult(home: Itr12HomeOffice | null | undefined): Itr12HomeOfficeResult | null {
  if (!homeStarted(home) || !home) return null;
  const refused = home.specificallyEquipped === false || home.regularlyAndExclusivelyUsed === false;
  if (refused) {
    return {
      amountCents: nonNegative(home.amountCents) ? home.amountCents : home.amountCents,
      specificallyEquipped: home.specificallyEquipped,
      regularlyAndExclusivelyUsed: home.regularlyAndExclusivelyUsed,
      deductedCents: 0,
      note: "s23(b) marks are not both yes, so the home office amount is not deducted.",
    };
  }
  if (
    home.specificallyEquipped !== true ||
    home.regularlyAndExclusivelyUsed !== true ||
    !nonNegative(home.amountCents)
  ) {
    return {
      amountCents: home.amountCents,
      specificallyEquipped: home.specificallyEquipped,
      regularlyAndExclusivelyUsed: home.regularlyAndExclusivelyUsed,
      deductedCents: null,
      note: "A s23(b) mark or the amount is blank, so the home office deduction stays blank.",
    };
  }
  return {
    amountCents: home.amountCents,
    specificallyEquipped: true,
    regularlyAndExclusivelyUsed: true,
    deductedCents: home.amountCents,
    note: "Both s23(b) marks are yes. The typed amount is deducted.",
  };
}

function businessStarted(input: Itr12BusinessInput): boolean {
  return (
    input.grossIncomeCents != null ||
    input.deductions.length > 0 ||
    input.assets.length > 0 ||
    input.wearAndTearCents != null ||
    input.ringFenceS20A != null ||
    homeStarted(input.homeOffice)
  );
}

function deductionTotal(
  rows: readonly Itr12BusinessDeduction[],
): { cents: number } | { open: true } {
  let cents = 0;
  for (const row of rows) {
    if (!row.label.trim() || !nonNegative(row.amountCents)) return { open: true };
    cents += row.amountCents;
  }
  return { cents };
}

type WearEffect = {
  wear: WearSchedule | null;
  cents: number | null;
  recoupmentCents: number | null;
  open: boolean;
};

function wearEffect(
  assets: readonly WearAsset[],
  typedCents: number | null,
  yearStart: string,
  yearEnd: string,
): WearEffect {
  if (assets.length > 0) {
    const wear = wearSchedule(assets, yearStart, yearEnd);
    if (wear?.wearAndTearCents == null) {
      return { wear, cents: null, recoupmentCents: null, open: true };
    }
    return {
      wear,
      cents: wear.wearAndTearCents,
      recoupmentCents: wear.recoupmentCents,
      open: false,
    };
  }
  if (nonNegative(typedCents)) {
    return { wear: null, cents: typedCents, recoupmentCents: null, open: false };
  }
  return { wear: null, cents: null, recoupmentCents: null, open: true };
}

/** Null when the accountant has not started a local business schedule. */
export function businessSchedule(
  input: Itr12BusinessInput | null | undefined,
  yearStart: string,
  yearEnd: string,
): Itr12BusinessSchedule | null {
  if (!input || !businessStarted(input)) return null;
  const home = homeOfficeResult(input.homeOffice);
  const deductions = deductionTotal(input.deductions);
  const wear = wearEffect(input.assets, input.wearAndTearCents, yearStart, yearEnd);
  const grossOpen = !nonNegative(input.grossIncomeCents);
  const homeOpen = home?.deductedCents == null && home != null;
  const open = grossOpen || "open" in deductions || wear.open || homeOpen;
  const notes = [HOME_OFFICE_NOTE, RING_FENCE_NOTE, SCRAPPING_NOTE];
  if (wear.open) {
    notes.push("Wear-and-tear is blank. A blank register is not zero, so the net stays blank.");
  } else if (wear.recoupmentCents == null) {
    notes.push(
      "Recoupment is blank because there is no asset register, so it is left out of the net.",
    );
  }
  const netProfitCents =
    open || !nonNegative(input.grossIncomeCents) || "open" in deductions || wear.cents == null
      ? null
      : input.grossIncomeCents +
        (wear.recoupmentCents ?? 0) -
        deductions.cents -
        (home?.deductedCents ?? 0) -
        wear.cents;
  return {
    draft: true,
    grossIncomeCents: nonNegative(input.grossIncomeCents) ? input.grossIncomeCents : null,
    deductions: input.deductions,
    homeOffice: home,
    wear: wear.wear,
    wearAndTearCents: wear.cents,
    recoupmentCents: wear.recoupmentCents,
    ringFenceS20A: input.ringFenceS20A,
    netProfitCents,
    notes,
  };
}

const RENTAL_NOTE =
  "Private-use percent applies to the expenses, including wear-and-tear. Rent received is the amount received. The percent is typed, not worked out.";

function propertyResult(
  property: Itr12RentalProperty,
  yearStart: string,
  yearEnd: string,
): Itr12RentalPropertyResult {
  const wear = wearEffect(property.assets, property.wearAndTearCents, yearStart, yearEnd);
  const parts = [
    property.ratesCents,
    property.interestCents,
    property.insuranceCents,
    property.repairsCents,
    property.leviesCents,
    property.agentFeesCents,
    wear.cents,
  ];
  const percent = property.privateUsePercent;
  const percentOk = percent != null && Number.isInteger(percent) && percent >= 0 && percent <= 100;
  const usePercent = percentOk ? percent : null;
  const expensesOpen = parts.some((cents) => !nonNegative(cents));
  const expenseCents = expensesOpen
    ? null
    : parts.reduce<number>((sum, cents) => sum + (cents ?? 0), 0);
  const allowableExpensesCents =
    expenseCents == null || usePercent == null
      ? null
      : Math.round((expenseCents * (100 - usePercent)) / 100);
  const netCents =
    allowableExpensesCents == null || !nonNegative(property.rentReceivedCents)
      ? null
      : property.rentReceivedCents - allowableExpensesCents;
  const note =
    netCents == null || usePercent == null
      ? "A figure is blank, so this net stays blank."
      : `Private use ${usePercent}%. Allowable expenses are ${100 - usePercent}% of the expenses.`;
  return {
    id: property.id,
    description: property.description.trim() || "Property",
    rentReceivedCents: nonNegative(property.rentReceivedCents) ? property.rentReceivedCents : null,
    ratesCents: nonNegative(property.ratesCents) ? property.ratesCents : null,
    interestCents: nonNegative(property.interestCents) ? property.interestCents : null,
    insuranceCents: nonNegative(property.insuranceCents) ? property.insuranceCents : null,
    repairsCents: nonNegative(property.repairsCents) ? property.repairsCents : null,
    leviesCents: nonNegative(property.leviesCents) ? property.leviesCents : null,
    agentFeesCents: nonNegative(property.agentFeesCents) ? property.agentFeesCents : null,
    wearAndTearCents: wear.cents,
    privateUsePercent: percentOk ? percent : null,
    expenseCents,
    allowableExpensesCents,
    netCents,
    note,
  };
}

/** Null when there are no properties. An empty list is a blank schedule. */
export function rentalSchedule(
  properties: readonly Itr12RentalProperty[] | null | undefined,
  yearStart: string,
  yearEnd: string,
): Itr12RentalSchedule | null {
  if (!properties || properties.length === 0) return null;
  const rows = properties.map((property) => propertyResult(property, yearStart, yearEnd));
  const complete = rows.every((row) => row.netCents != null);
  const notes = [RENTAL_NOTE];
  if (!complete) notes.push("A property is missing a figure, so the total stays blank.");
  return {
    draft: true,
    properties: rows,
    totalNetCents: complete ? rows.reduce((sum, row) => sum + (row.netCents ?? 0), 0) : null,
    notes,
  };
}

export function itr12DraftTaxableIncome(input: {
  employmentCents: number | null;
  practiceIncomeCents: number | null;
  practiceExpensesCents: number | null;
  business: Itr12BusinessSchedule | null;
  rentals: Itr12RentalSchedule | null;
}): { cents: number | null; note: string; tie: Itr12TaxableTie | null } {
  const tail = ITR12_TAXABLE_EXCLUSION_NOTE;
  if (input.business && input.business.netProfitCents == null) {
    return {
      cents: null,
      tie: null,
      note: `The local business schedule is incomplete, so this stays blank. ${tail}`,
    };
  }
  if (input.rentals && input.rentals.totalNetCents == null) {
    return {
      cents: null,
      tie: null,
      note: `The local rental schedule is incomplete, so this stays blank. ${tail}`,
    };
  }
  if (input.employmentCents == null) {
    return {
      cents: null,
      tie: null,
      note: `Employment income is blank, so this stays blank. A blank is not zero. ${tail}`,
    };
  }
  let practiceNet: number | null = null;
  if (!input.business) {
    if (input.practiceIncomeCents == null || input.practiceExpensesCents == null) {
      return {
        cents: null,
        tie: null,
        note: `Practice income or practice expenses are blank, so this stays blank. ${tail}`,
      };
    }
    practiceNet = input.practiceIncomeCents - input.practiceExpensesCents;
  }
  const businessNet = input.business ? input.business.netProfitCents : null;
  const rentalNet = input.rentals ? input.rentals.totalNetCents : null;
  const cents =
    input.employmentCents +
    (input.business ? (businessNet ?? 0) : (practiceNet ?? 0)) +
    (input.rentals ? (rentalNet ?? 0) : 0);
  const rentalSentence = input.rentals
    ? "Local rental net is included."
    : "No rental schedule, so rental is not in this total.";
  const practiceSentence = input.business
    ? "Local business net replaces practice income and practice expenses."
    : "Practice income minus practice expenses is included.";
  return {
    cents,
    tie: {
      employmentCents: input.employmentCents,
      practiceNetCents: input.business ? null : practiceNet,
      businessNetCents: businessNet,
      rentalNetCents: rentalNet,
      taxableIncomeCents: cents,
    },
    note: `${practiceSentence} ${rentalSentence} ${tail} s20A is an indicator only and is not applied.`,
  };
}

function centsField(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function markField(value: unknown): boolean | null {
  return value === true || value === false ? value : null;
}

function textField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function homeFrom(value: unknown): Itr12HomeOffice | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const home = {
    amountCents: centsField(row.amountCents),
    specificallyEquipped: markField(row.specificallyEquipped),
    regularlyAndExclusivelyUsed: markField(row.regularlyAndExclusivelyUsed),
  };
  return homeStarted(home) ? home : null;
}

function deductionsFrom(value: unknown): Itr12BusinessDeduction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const label = textField(row.label);
    const amountCents = centsField(row.amountCents);
    if (!label.trim() && amountCents == null) return [];
    return [
      {
        id: textField(row.id) || `deduction-${index + 1}`,
        label,
        amountCents,
      },
    ];
  });
}

export function businessInputFrom(value: unknown): Itr12BusinessInput | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const input: Itr12BusinessInput = {
    grossIncomeCents: centsField(record.grossIncomeCents),
    deductions: deductionsFrom(record.deductions),
    homeOffice: homeFrom(record.homeOffice),
    assets: wearAssetsFrom(record.assets),
    wearAndTearCents: centsField(record.wearAndTearCents),
    ringFenceS20A: markField(record.ringFenceS20A),
  };
  return businessStarted(input) ? input : null;
}

function propertyFrom(value: unknown, index: number): Itr12RentalProperty | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const percent = row.privateUsePercent;
  return {
    id: textField(row.id) || `property-${index + 1}`,
    description: textField(row.description),
    rentReceivedCents: centsField(row.rentReceivedCents),
    ratesCents: centsField(row.ratesCents),
    interestCents: centsField(row.interestCents),
    insuranceCents: centsField(row.insuranceCents),
    repairsCents: centsField(row.repairsCents),
    leviesCents: centsField(row.leviesCents),
    agentFeesCents: centsField(row.agentFeesCents),
    wearAndTearCents: centsField(row.wearAndTearCents),
    assets: wearAssetsFrom(row.assets),
    privateUsePercent:
      typeof percent === "number" && Number.isInteger(percent) && percent >= 0 && percent <= 100
        ? percent
        : null,
  };
}

export function rentalInputsFrom(value: unknown): Itr12RentalProperty[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row, index) => {
    const property = propertyFrom(row, index);
    return property ? [property] : [];
  });
}
