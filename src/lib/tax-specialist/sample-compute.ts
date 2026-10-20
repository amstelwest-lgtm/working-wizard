/**
 * Deterministic SAMPLE company tax for one ZA year of assessment.
 * Whole cents in, whole cents out. No clock, no books, no network.
 * 27% is the standard resident-company rate for a year of assessment
 * ending on or after 31 March 2023. This sample is not an SBC and not
 * a gold miner.
 */

import { calendarDayLabel } from "../market/date-presets.ts";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const COMPANY_TAX_NUMERATOR = 27;
export const COMPANY_TAX_DENOMINATOR = 100;

export type CompanyTaxInput = {
  accountingProfitCents: number;
  depreciationAddBackCents: number;
  finesAddBackCents: number;
  wearAndTearCents: number;
  exemptDividendsCents: number;
  assessedLossBroughtForwardCents: number;
  donationCents: number;
  /** Full-year taxable-income estimate used on both IRP6 periods. */
  provisionalEstimateCents: number;
};

export type CompanyTaxResult = {
  taxableBeforeDonationCents: number;
  donationLimitCents: number;
  donationAllowedCents: number;
  donationDisallowedCents: number;
  taxableIncomeCents: number;
  assessedLossCarriedCents: number;
  taxCents: number;
  estimateTaxCents: number;
  period1Cents: number;
  period2Cents: number;
  balanceCents: number;
  topUpCents: number;
  eightyPercentCents: number;
  estimateClearsEightyPercent: boolean;
  /** Above this, the basic-amount safe harbour does not apply. */
  basicAmountHarbourCents: number;
  aboveBasicAmountHarbour: boolean;
};

export type TaxDeadlineId = "irp6-1" | "irp6-2" | "irp6-3" | "itr14";

export type TaxDeadline = {
  id: TaxDeadlineId;
  form: "IRP6" | "ITR14";
  label: string;
  due: string;
  weekday: (typeof WEEKDAYS)[number];
};

export type DeadlineStanding = "upcoming" | "due" | "passed";

type Parts = { y: number; m: number; d: number };

function assertCents(name: string, value: number, allowNegative: boolean): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be whole cents`);
  if (!allowNegative && value < 0) throw new Error(`${name} cannot be negative`);
}

function parseIso(iso: string): Parts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`bad date ${iso}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > lastDay(y, m)) throw new Error(`bad date ${iso}`);
  return { y, m, d };
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addYears(parts: Parts, years: number): Parts {
  const y = parts.y + years;
  const d = Math.min(parts.d, lastDay(y, parts.m));
  return { y, m: parts.m, d };
}

function addDays(parts: Parts, days: number): Parts {
  const utc = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
}

function endOfShiftedMonth(parts: Parts, monthsAhead: number): string {
  const index = parts.m - 1 + monthsAhead;
  const y = parts.y + Math.floor(index / 12);
  const m = (index % 12) + 1;
  return iso(y, m, lastDay(y, m));
}

export function formatSampleDate(value: string): string {
  const { y, m, d } = parseIso(value);
  return calendarDayLabel(y, m, d, "za") ?? value; // date-ok: ZA tax sample is a South Africa only surface
}

export function formatSampleCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("amount must be whole cents");
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100);
  const rem = abs % 100;
  const body = rands.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}R ${body}.${String(rem).padStart(2, "0")}`;
}

export function taxAtCompanyRate(taxableIncomeCents: number): number {
  assertCents("taxableIncomeCents", taxableIncomeCents, false);
  return Math.round((taxableIncomeCents * COMPANY_TAX_NUMERATOR) / COMPANY_TAX_DENOMINATOR);
}

export function computeCompanyTax(input: CompanyTaxInput): CompanyTaxResult {
  assertCents("accountingProfitCents", input.accountingProfitCents, true);
  assertCents("depreciationAddBackCents", input.depreciationAddBackCents, false);
  assertCents("finesAddBackCents", input.finesAddBackCents, false);
  assertCents("wearAndTearCents", input.wearAndTearCents, false);
  assertCents("exemptDividendsCents", input.exemptDividendsCents, false);
  assertCents("assessedLossBroughtForwardCents", input.assessedLossBroughtForwardCents, false);
  assertCents("donationCents", input.donationCents, false);
  assertCents("provisionalEstimateCents", input.provisionalEstimateCents, false);

  const taxableBeforeDonationCents =
    input.accountingProfitCents +
    input.depreciationAddBackCents +
    input.finesAddBackCents -
    input.wearAndTearCents -
    input.exemptDividendsCents -
    input.assessedLossBroughtForwardCents;

  const profitBeforeDonation = taxableBeforeDonationCents > 0;
  const donationLimitCents = profitBeforeDonation
    ? Math.floor((taxableBeforeDonationCents * 10) / 100)
    : 0;
  const donationAllowedCents = Math.min(input.donationCents, donationLimitCents);
  const donationDisallowedCents = input.donationCents - donationAllowedCents;
  const afterDonation = taxableBeforeDonationCents - donationAllowedCents;
  const taxableIncomeCents = afterDonation > 0 ? afterDonation : 0;
  const assessedLossCarriedCents = afterDonation < 0 ? -afterDonation : 0;
  const taxCents = taxAtCompanyRate(taxableIncomeCents);
  const estimateTaxCents = taxAtCompanyRate(input.provisionalEstimateCents);
  const period1Cents = Math.floor(estimateTaxCents / 2);
  const period2Cents = estimateTaxCents - period1Cents;
  const balanceCents = taxCents - period1Cents - period2Cents;
  const topUpCents = balanceCents > 0 ? balanceCents : 0;
  const eightyPercentCents = Math.floor((taxableIncomeCents * 80) / 100);
  const basicAmountHarbourCents = 100_000_000;

  return {
    taxableBeforeDonationCents,
    donationLimitCents,
    donationAllowedCents,
    donationDisallowedCents,
    taxableIncomeCents,
    assessedLossCarriedCents,
    taxCents,
    estimateTaxCents,
    period1Cents,
    period2Cents,
    balanceCents,
    topUpCents,
    eightyPercentCents,
    estimateClearsEightyPercent: input.provisionalEstimateCents >= eightyPercentCents,
    basicAmountHarbourCents,
    aboveBasicAmountHarbour: taxableIncomeCents > basicAmountHarbourCents,
  };
}

/** Day after the previous year end. 28 Feb 2026 starts 1 Mar 2025. */
export function yearOfAssessmentStart(yearEnd: string): string {
  const start = addDays(addYears(parseIso(yearEnd), -1), 1);
  return iso(start.y, start.m, start.d);
}

function februaryYearEnd(yearEnd: string): boolean {
  const { y, m, d } = parseIso(yearEnd);
  return m === 2 && d === lastDay(y, 2);
}

/**
 * Statutory last days, before a weekend or public-holiday shift.
 * First IRP6: last day of the sixth month of the year.
 * Second IRP6: the year end.
 * Third top-up: 30 September when the year ends on the last day of February,
 * otherwise the last day of the sixth month after year end.
 * ITR14: twelve months after year end.
 */
export function companyTaxDeadlines(yearEnd: string): TaxDeadline[] {
  const end = parseIso(yearEnd);
  const start = parseIso(yearOfAssessmentStart(yearEnd));
  const first = endOfShiftedMonth(start, 5);
  const third = februaryYearEnd(yearEnd) ? iso(end.y, 9, 30) : endOfShiftedMonth(end, 6);
  const itr = addYears(end, 1);
  const rows: Array<Omit<TaxDeadline, "weekday">> = [
    { id: "irp6-1", form: "IRP6", label: "First provisional", due: first },
    { id: "irp6-2", form: "IRP6", label: "Second provisional", due: yearEnd },
    { id: "irp6-3", form: "IRP6", label: "Optional third top-up", due: third },
    {
      id: "itr14",
      form: "ITR14",
      label: "Company income tax return",
      due: iso(itr.y, itr.m, itr.d),
    },
  ];
  return rows.map((row) => {
    const { y, m, d } = parseIso(row.due);
    const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    return { ...row, weekday };
  });
}

export function deadlineStanding(due: string, asOf: string): DeadlineStanding {
  parseIso(due);
  parseIso(asOf);
  if (due > asOf) return "upcoming";
  if (due < asOf) return "passed";
  return "due";
}

export const SAMPLE_AS_OF = "2026-10-19";
export const SAMPLE_YEAR_END = "2026-02-28";

export const SAMPLE_COMPANY = {
  legalName: "Harbour & Co (Pty) Ltd",
  registration: "2020/123456/07",
  yearEnd: SAMPLE_YEAR_END,
  asOf: SAMPLE_AS_OF,
  priorAssessedTaxableCents: 160_000_000,
  input: {
    accountingProfitCents: 185_000_000,
    depreciationAddBackCents: 12_000_000,
    finesAddBackCents: 850_000,
    wearAndTearCents: 9_500_000,
    exemptDividendsCents: 4_000_000,
    assessedLossBroughtForwardCents: 0,
    donationCents: 1_500_000,
    provisionalEstimateCents: 170_000_000,
  } satisfies CompanyTaxInput,
} as const;

export function sampleCompanyTax(): CompanyTaxResult {
  return computeCompanyTax(SAMPLE_COMPANY.input);
}
