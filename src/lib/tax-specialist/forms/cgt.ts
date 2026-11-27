/**
 * Eighth Schedule disposal register for the ITR12 and ITR14 draft sheets.
 *
 * Draft figures for a person to check. Milōn does not log into SARS, does not
 * file, and does not write a ledger. A blank register is not zero.
 *
 * Inclusion rates and exclusions live in a dated year table. A year is used
 * only when docs/sars/README.md signs that year off. Signed-off years are
 * 2026 and 2027. Any other year leaves the taxable capital gain blank.
 * A finished net capital loss is carried forward and is not included in
 * taxable income. The death-year exclusion is not applied.
 */
import { NIL_CONFIRMED_NOTE } from "./nil-confirm.ts";

export const CGT_BLANK_SCHEDULE = "A blank schedule is not zero";

export const CGT_UNSIGNED_NOTE =
  "Inclusion rates and exclusions are not signed off in docs/sars for this year, so the taxable capital gain stays blank.";

export const CGT_LOSS_NOTE =
  "A net capital loss is carried forward and is not included in taxable income.";

export const CGT_INCOMPLETE_NOTE =
  "A disposal is missing a figure, so the totals stay blank. A blank is not zero.";

export type CgtPerson = "individual" | "company";

/** One year of assessment. Amounts stay null until that year is signed off. */
export type CgtYear = {
  year: number;
  /** Natural-person annual exclusion, in cents. Companies do not use it. */
  annualExclusionCents: number | null;
  /** Cap on the gain disregarded for one primary residence, in cents. */
  primaryResidenceExclusionCents: number | null;
  /** Individual inclusion, numerator over 100. */
  individualInclusionPercent: number | null;
  /** Company inclusion, numerator over 100. */
  companyInclusionPercent: number | null;
};

/**
 * Signed off in docs/sars/README.md. Amounts are cents. Do not add a year
 * that is not written there.
 * 2026: annual exclusion R40 000, primary residence R2 000 000, inclusion 40/80.
 * 2027: annual exclusion R50 000, primary residence R3 000 000, inclusion 40/80.
 */
export const CGT_YEAR_TABLE: readonly CgtYear[] = [
  {
    year: 2026,
    annualExclusionCents: 4_000_000,
    primaryResidenceExclusionCents: 200_000_000,
    individualInclusionPercent: 40,
    companyInclusionPercent: 80,
  },
  {
    year: 2027,
    annualExclusionCents: 5_000_000,
    primaryResidenceExclusionCents: 300_000_000,
    individualInclusionPercent: 40,
    companyInclusionPercent: 80,
  },
];

/** Shown next to the taxable capital gain when this year is signed off. */
export function cgtRatesNote(year: number): string | null {
  if (!cgtYear(year)) return null;
  return `Rates from SARS published tables YA${year}; accountant to confirm`;
}

export function cgtYear(year: number): CgtYear | null {
  return CGT_YEAR_TABLE.find((row) => row.year === year) ?? null;
}

export type CgtDisposal = {
  id: string;
  description: string;
  /** YYYY-MM-DD, or empty while the accountant has not typed it. */
  dateAcquired: string;
  dateDisposed: string;
  proceedsCents: number | null;
  costCents: number | null;
  improvementsCents: number | null;
  sellingCostsCents: number | null;
  /** Individuals only. Null is blank. Companies ignore it. */
  primaryResidence: boolean | null;
};

export type CgtRow = {
  id: string;
  description: string;
  dateAcquired: string;
  dateDisposed: string;
  proceedsCents: number | null;
  costCents: number | null;
  improvementsCents: number | null;
  sellingCostsCents: number | null;
  /** Cost plus improvements plus selling costs. Null while any part is blank. */
  baseCostCents: number | null;
  primaryResidence: boolean | null;
  /** Proceeds minus base cost. Negative is a loss. Null while an amount is blank. */
  gainCents: number | null;
};

export type CgtSchedule = {
  draft: true;
  person: CgtPerson;
  yearOfAssessment: number;
  rows: readonly CgtRow[];
  /** Sum of row gains. Null while a row is incomplete. */
  aggregateCents: number | null;
  /** False for a company: the exclusion does not apply, and the line is not zero. */
  annualExclusionApplies: boolean;
  annualExclusionCents: number | null;
  primaryResidenceApplies: boolean;
  /** Amount disregarded. Null when it does not apply, or when the cap is not signed off. */
  primaryResidenceExclusionCents: number | null;
  assessedCapitalLossBroughtForwardCents: number | null;
  netCapitalGainCents: number | null;
  inclusionPercent: number | null;
  /** Null when it is not included. A blank register never reaches this object. */
  taxableCapitalGainCents: number | null;
  /** Positive loss carried forward. Null when there is no finished loss. */
  carriedForwardCents: number | null;
  lossCarriedForward: boolean;
  /** True only when taxableCapitalGainCents is added to taxable income. */
  includedInTaxableIncome: boolean;
  incomplete: boolean;
  /** Null when this year is not signed off, or the register is incomplete. */
  ratesNote: string | null;
  notes: readonly string[];
};

function cents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nonNegative(value: number | null): value is number {
  return value != null && value >= 0;
}

function rowStarted(row: CgtDisposal): boolean {
  return Boolean(
    row.description.trim() ||
      row.dateAcquired ||
      row.dateDisposed ||
      row.proceedsCents != null ||
      row.costCents != null ||
      row.improvementsCents != null ||
      row.sellingCostsCents != null ||
      row.primaryResidence != null,
  );
}

function toRow(row: CgtDisposal, person: CgtPerson): CgtRow {
  const proceeds = row.proceedsCents;
  const cost = row.costCents;
  const improvements = row.improvementsCents;
  const selling = row.sellingCostsCents;
  const partsReady = nonNegative(cost) && nonNegative(improvements) && nonNegative(selling);
  const baseCostCents = partsReady ? cost + improvements + selling : null;
  const gainCents =
    baseCostCents != null && nonNegative(proceeds) ? proceeds - baseCostCents : null;
  return {
    id: row.id,
    description: row.description,
    dateAcquired: row.dateAcquired,
    dateDisposed: row.dateDisposed,
    proceedsCents: proceeds,
    costCents: cost,
    improvementsCents: improvements,
    sellingCostsCents: selling,
    baseCostCents,
    primaryResidence: person === "individual" ? row.primaryResidence : null,
    gainCents,
  };
}

function rowIncomplete(row: CgtRow, person: CgtPerson): boolean {
  if (row.gainCents == null) return true;
  if (person === "individual" && row.primaryResidence == null) return true;
  return false;
}

/**
 * Blank when nothing has been typed. A started row with a missing amount
 * stays on the schedule and blocks the totals.
 */
export function capitalGainsSchedule(input: {
  person: CgtPerson;
  yearOfAssessment: number;
  disposals: readonly CgtDisposal[];
  assessedCapitalLossBroughtForwardCents: number | null;
  /** The brought-forward loss was blank and the accountant confirmed nil. */
  broughtForwardNilConfirmed?: boolean;
}): CgtSchedule | null {
  const started = input.disposals.filter(rowStarted);
  if (started.length === 0) return null;
  const person = input.person;
  const rows = started.map((row) => toRow(row, person));
  const brought = input.assessedCapitalLossBroughtForwardCents;
  const base: CgtSchedule = {
    draft: true,
    person,
    yearOfAssessment: input.yearOfAssessment,
    rows,
    aggregateCents: null,
    annualExclusionApplies: person === "individual",
    annualExclusionCents: null,
    primaryResidenceApplies: person === "individual",
    primaryResidenceExclusionCents: null,
    assessedCapitalLossBroughtForwardCents: brought,
    netCapitalGainCents: null,
    inclusionPercent: null,
    taxableCapitalGainCents: null,
    carriedForwardCents: null,
    lossCarriedForward: false,
    includedInTaxableIncome: false,
    incomplete: false,
    ratesNote: null,
    notes: [],
  };
  const nilNote = input.broughtForwardNilConfirmed ? [NIL_CONFIRMED_NOTE] : [];
  if (rows.some((row) => rowIncomplete(row, person)) || (brought != null && brought < 0)) {
    return { ...base, incomplete: true, notes: [CGT_INCOMPLETE_NOTE, ...nilNote] };
  }

  const aggregate = rows.reduce((sum, row) => sum + (row.gainCents ?? 0), 0);
  const table = cgtYear(input.yearOfAssessment);
  const notes: string[] = [];
  let working: number | null = aggregate;
  let residenceExcluded: number | null = null;

  if (person === "individual") {
    const homeGains = rows.filter((row) => row.primaryResidence === true && (row.gainCents ?? 0) > 0);
    if (homeGains.length > 0) {
      const cap = table?.primaryResidenceExclusionCents ?? null;
      if (cap == null) {
        working = null;
      } else {
        residenceExcluded = homeGains.reduce(
          (sum, row) => sum + Math.min(cap, row.gainCents ?? 0),
          0,
        );
        working = aggregate - residenceExcluded;
      }
    }
    const annual = table?.annualExclusionCents ?? null;
    if (annual == null) working = null;
    else if (working != null) {
      working = working >= 0 ? Math.max(0, working - annual) : -Math.max(0, -working - annual);
    }
    if (table == null || annual == null || (homeGains.length > 0 && residenceExcluded == null)) {
      notes.push(CGT_UNSIGNED_NOTE);
    }
  }

  let net: number | null = null;
  if (brought == null) {
    notes.push("Assessed capital loss brought forward is blank, so the net stays blank.");
  } else if (working != null) {
    net = working - brought;
  }

  let inclusionPercent: number | null = null;
  let taxableCapitalGainCents: number | null = null;
  let carriedForwardCents: number | null = null;
  let lossCarriedForward = false;
  let includedInTaxableIncome = false;

  if (net != null && net > 0) {
    inclusionPercent =
      person === "individual"
        ? (table?.individualInclusionPercent ?? null)
        : (table?.companyInclusionPercent ?? null);
    if (inclusionPercent == null) {
      if (!notes.includes(CGT_UNSIGNED_NOTE)) notes.push(CGT_UNSIGNED_NOTE);
    } else {
      taxableCapitalGainCents = Math.round((net * inclusionPercent) / 100);
      includedInTaxableIncome = true;
    }
  } else if (net != null && net < 0) {
    carriedForwardCents = -net;
    lossCarriedForward = true;
    notes.push(CGT_LOSS_NOTE);
  }

  return {
    ...base,
    aggregateCents: aggregate,
    annualExclusionCents: person === "individual" ? (table?.annualExclusionCents ?? null) : null,
    primaryResidenceExclusionCents: residenceExcluded,
    netCapitalGainCents: net,
    inclusionPercent,
    taxableCapitalGainCents,
    carriedForwardCents,
    lossCarriedForward,
    includedInTaxableIncome,
    incomplete: false,
    ratesNote: cgtRatesNote(input.yearOfAssessment),
    notes: [...notes, ...nilNote],
  };
}

export function cgtDisposalsFrom(value: unknown): CgtDisposal[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const primary = row.primaryResidence;
    return [
      {
        id: text(row.id) || `cgt-${index + 1}`,
        description: text(row.description),
        dateAcquired: text(row.dateAcquired),
        dateDisposed: text(row.dateDisposed),
        proceedsCents: cents(row.proceedsCents),
        costCents: cents(row.costCents),
        improvementsCents: cents(row.improvementsCents),
        sellingCostsCents: cents(row.sellingCostsCents),
        primaryResidence: primary === true || primary === false ? primary : null,
      },
    ];
  });
}

function plain(centsValue: number | null): string {
  if (centsValue == null) return "";
  const sign = centsValue < 0 ? "-" : "";
  const abs = Math.abs(centsValue);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** CSV rows for the capture sheet. A blank register is an empty value. */
export function cgtCsvRows(schedule: CgtSchedule | null): string[][] {
  if (!schedule) {
    return [["Capital gains schedule", "", "Blank", CGT_BLANK_SCHEDULE]];
  }
  const rows: string[][] = [];
  for (const row of schedule.rows) {
    rows.push([
      `Capital gain, ${row.description || "Disposal"}`,
      plain(row.gainCents),
      "Disposal register",
      row.primaryResidence == null ? "" : row.primaryResidence ? "Primary residence" : "",
    ]);
  }
  rows.push([
    "Aggregate capital gain or loss",
    plain(schedule.aggregateCents),
    "Disposal register",
    schedule.incomplete ? CGT_INCOMPLETE_NOTE : "",
  ]);
  rows.push([
    "Taxable capital gain",
    plain(schedule.taxableCapitalGainCents),
    schedule.includedInTaxableIncome ? "Included in taxable income" : "Not included",
    schedule.notes[0] ?? "",
  ]);
  if (schedule.lossCarriedForward) {
    rows.push([
      "Capital loss carried forward",
      plain(schedule.carriedForwardCents),
      "Carried forward",
      CGT_LOSS_NOTE,
    ]);
  }
  if (schedule.notes.includes(NIL_CONFIRMED_NOTE)) {
    rows.push([
      "Assessed capital loss brought forward",
      plain(schedule.assessedCapitalLossBroughtForwardCents),
      "Accountant",
      NIL_CONFIRMED_NOTE,
    ]);
  }
  return rows;
}
