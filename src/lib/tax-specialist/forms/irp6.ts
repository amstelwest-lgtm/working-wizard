/**
 * Milōn IRP6 preparation sheet for a standard resident company.
 * Our own layout, checked by the accountant, then captured on SARS eFiling.
 * v1 limits: 27% for a year of assessment ending on or after 31 March 2023,
 * no small business corporation rates, no penalty or interest amounts.
 * Sources: docs/sars/README.md.
 */
import { effectivePeriodMonths } from "../../equity-coherence.ts";
import { calendarDateInTimeZone } from "../../statement-period.ts";
import {
  companyTaxDeadlines,
  computeCompanyTax,
  formatSampleCents,
  formatSampleDate,
  taxAtCompanyRate,
  yearOfAssessmentStart,
} from "../sample-compute.ts";

export const IRP6_FOOTER =
  "Prepared by Milōn for checking. Not a SARS return. Capture and submit on SARS eFiling.";

/** v1 rate applies from this year end. */
export const IRP6_FIRST_SUPPORTED_YEAR_END = "2023-03-31";
/** Basic amount applies when the estimate is at or under R1 million. */
export const IRP6_BASIC_AMOUNT_LIMIT_CENTS = 100_000_000;

export type Irp6Period = 1 | 2 | 3;
export const IRP6_PERIODS: readonly Irp6Period[] = [1, 2, 3];

export type Irp6SectionId = "taxpayer" | "estimate" | "adjustments" | "credits" | "result";
export const IRP6_SECTIONS: ReadonlyArray<{ id: Irp6SectionId; title: string; purpose: string }> = [
  {
    id: "taxpayer",
    title: "Taxpayer",
    purpose: "Who the return is for and which period it covers.",
  },
  {
    id: "estimate",
    title: "Estimate",
    purpose: "The taxable income the company expects for the full year, and the tax on it.",
  },
  {
    id: "adjustments",
    title: "Adjustments",
    purpose: "Items that make taxable income differ from profit before tax.",
  },
  {
    id: "credits",
    title: "Credits",
    purpose: "Tax already paid or withheld that comes off this period.",
  },
  { id: "result", title: "Result", purpose: "What the company pays SARS for this period." },
];

/**
 * books: clients.financials. client: the client row or the year and period picked
 * on the sheet. input: typed by the accountant. worked: worked out on the sheet.
 * nil: fixed at nil in v1.
 */
export type Irp6SourceKind = "books" | "client" | "input" | "worked" | "nil";
export type Irp6FieldType =
  | "text"
  | "tax-reference"
  | "year"
  | "period"
  | "date"
  | "amount"
  | "percent";
/** true, false, or the condition that makes the field required. */
export type Irp6Required = boolean | "estimate-under-r1m" | "after-period-1";

export type Irp6FieldId =
  | "registeredName"
  | "taxReference"
  | "yearOfAssessment"
  | "period"
  | "periodEnd"
  | "grossIncome"
  | "profitBeforeTax"
  | "fullYearProfit"
  | "netAdjustments"
  | "estimatedTaxableIncome"
  | "basicAmount"
  | "estimatedTax"
  | "employeesTax"
  | "foreignTaxCredits"
  | "provisionalPaid"
  | "taxForPeriod"
  | "taxPayable"
  | "estimateAgainstActual";

export type Irp6Field = {
  id: Irp6FieldId;
  section: Irp6SectionId;
  label: string;
  /** The IRP6 field on eFiling. null when the line is a working that eFiling does not ask for. */
  efiling: string | null;
  type: Irp6FieldType;
  required: Irp6Required;
  source: Irp6SourceKind;
  /** Only shown for some periods. */
  periods?: readonly Irp6Period[];
};

export const IRP6_FIELDS: readonly Irp6Field[] = [
  {
    id: "registeredName",
    section: "taxpayer",
    label: "Registered name",
    efiling: "Registered name",
    type: "text",
    required: true,
    source: "client",
  },
  {
    id: "taxReference",
    section: "taxpayer",
    label: "Income tax reference number",
    efiling: "Taxpayer reference number",
    type: "tax-reference",
    required: true,
    source: "input",
  },
  {
    id: "yearOfAssessment",
    section: "taxpayer",
    label: "Year of assessment",
    efiling: "Year of assessment",
    type: "year",
    required: true,
    source: "client",
  },
  {
    id: "period",
    section: "taxpayer",
    label: "Period",
    efiling: "Period",
    type: "period",
    required: true,
    source: "client",
  },
  {
    id: "periodEnd",
    section: "taxpayer",
    label: "Period end date",
    efiling: null,
    type: "date",
    required: true,
    source: "client",
  },
  {
    id: "grossIncome",
    section: "estimate",
    label: "Gross income for the full year",
    efiling: "Gross Income (Turnover/Sales/Other Income)",
    type: "amount",
    required: false,
    source: "books",
  },
  {
    id: "profitBeforeTax",
    section: "estimate",
    label: "Profit before tax in the books",
    efiling: null,
    type: "amount",
    required: true,
    source: "books",
  },
  {
    id: "fullYearProfit",
    section: "estimate",
    label: "Profit before tax for the full year",
    efiling: null,
    type: "amount",
    required: true,
    source: "worked",
  },
  {
    id: "netAdjustments",
    section: "estimate",
    label: "Adjustments, net",
    efiling: null,
    type: "amount",
    required: false,
    source: "worked",
  },
  {
    id: "estimatedTaxableIncome",
    section: "estimate",
    label: "Estimated taxable income for the full year",
    efiling: "Estimated taxable income",
    type: "amount",
    required: true,
    source: "worked",
  },
  {
    id: "basicAmount",
    section: "estimate",
    label: "Basic amount, from the latest assessment",
    efiling: null,
    type: "amount",
    required: "estimate-under-r1m",
    source: "input",
  },
  {
    id: "estimatedTax",
    section: "estimate",
    label: "Tax on estimated taxable income at 27%",
    efiling: "Tax on estimated taxable income",
    type: "amount",
    required: true,
    source: "worked",
  },
  {
    id: "employeesTax",
    section: "credits",
    label: "Employees' tax",
    efiling: "Employees' tax for this period",
    type: "amount",
    required: true,
    source: "input",
  },
  {
    id: "foreignTaxCredits",
    section: "credits",
    label: "Foreign tax credits",
    efiling: "Foreign tax credits for this period",
    type: "amount",
    required: false,
    source: "nil",
  },
  {
    id: "provisionalPaid",
    section: "credits",
    label: "Provisional tax already paid this year",
    efiling: "Provisional tax paid for the first period",
    type: "amount",
    required: "after-period-1",
    source: "input",
    periods: [2, 3],
  },
  {
    id: "taxForPeriod",
    section: "result",
    label: "Tax for this period",
    efiling: "Tax for this period",
    type: "amount",
    required: true,
    source: "worked",
  },
  {
    id: "taxPayable",
    section: "result",
    label: "Provisional tax payable for this period",
    efiling: "Tax payable for this period",
    type: "amount",
    required: true,
    source: "worked",
  },
  {
    id: "estimateAgainstActual",
    section: "result",
    label: "Estimate against the actual figure so far",
    efiling: null,
    type: "percent",
    required: false,
    source: "worked",
    periods: [2],
  },
];

export type Irp6Adjustment = {
  id: string;
  description: string;
  amountCents: number | null;
  direction: "add" | "deduct";
};

export type Irp6Inputs = {
  taxReference: string;
  /** Typed only when the books have no profit before tax. Treated as the full year. */
  profitBeforeTaxCents: number | null;
  adjustments: Irp6Adjustment[];
  /** A different full-year estimate to file. Empty uses the worked figure. */
  estimateOverrideCents: number | null;
  basicAmountCents: number | null;
  employeesTaxCents: number | null;
  provisionalPaidCents: number | null;
};

export const IRP6_EMPTY_INPUTS: Irp6Inputs = {
  taxReference: "",
  profitBeforeTaxCents: null,
  adjustments: [],
  estimateOverrideCents: null,
  basicAmountCents: null,
  employeesTaxCents: 0,
  provisionalPaidCents: null,
};

export type Irp6Client = {
  name: string;
  /** 1–12. March for a February year end. */
  fyStartMonth: number;
  financials: Record<string, unknown> | null;
  /** clients.financials_updated_at. */
  financialsAsOf: string | null;
};

export type Irp6CheckLevel = "error" | "warning" | "ok";
export type Irp6Check = { id: string; level: Irp6CheckLevel; text: string };

export type Irp6Line = {
  id: Irp6FieldId;
  section: Irp6SectionId;
  label: string;
  efiling: string | null;
  /** Shown on the sheet and the PDF. Empty when it needs input. */
  display: string;
  /** Plain value for the CSV. Amounts are rands with two decimals. */
  plain: string;
  source: Irp6SourceKind;
  sourceLabel: string;
  required: boolean;
  missing: boolean;
  note?: string;
};

export type Irp6Sheet = {
  yearOfAssessment: number;
  period: Irp6Period;
  yearStart: string;
  yearEnd: string;
  periodEnd: string;
  statutoryDue: string;
  due: string;
  supported: boolean;
  booksMethod: string;
  booksInYear: boolean;
  grossIncomeCents: number | null;
  profitBeforeTaxCents: number | null;
  fullYearProfitCents: number | null;
  addedCents: number;
  deductedCents: number;
  netAdjustmentsCents: number;
  workedEstimateCents: number | null;
  estimateCents: number | null;
  basicAmountRequired: boolean;
  estimatedTaxCents: number | null;
  taxForPeriodCents: number | null;
  creditsCents: number;
  taxPayableCents: number | null;
  /** Period 2 only. Estimate as a whole percent of the worked figure. */
  estimatePercentOfActual: number | null;
  lines: Irp6Line[];
  missing: Irp6Line[];
  checks: Irp6Check[];
};

type Parts = { y: number; m: number; d: number };

function parts(iso: string): Parts {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function isoOf(p: Parts): string {
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function shiftDays(iso: string, days: number): string {
  const { y, m, d } = parts(iso);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return isoOf({ y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() });
}

function weekday(iso: string): number {
  const { y, m, d } = parts(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Gregorian Easter Sunday (anonymous algorithm). */
function easterSunday(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoOf({ y, m: month, d: day });
}

const FIXED_HOLIDAYS = [
  "01-01",
  "03-21",
  "04-27",
  "05-01",
  "06-16",
  "08-09",
  "09-24",
  "12-16",
  "12-25",
  "12-26",
];

/** South African public holidays, with a Sunday holiday observed on the Monday. */
export function zaPublicHolidays(y: number): Set<string> {
  const out = new Set<string>();
  for (const md of FIXED_HOLIDAYS) {
    const iso = `${y}-${md}`;
    out.add(iso);
    if (weekday(iso) === 0) out.add(shiftDays(iso, 1));
  }
  const easter = easterSunday(y);
  out.add(shiftDays(easter, -2));
  out.add(shiftDays(easter, 1));
  return out;
}

/** SARS G01: a weekend or public-holiday due date moves to the last working day before it. */
export function lastWorkingDayOnOrBefore(iso: string): string {
  let day = iso;
  for (let guard = 0; guard < 10; guard += 1) {
    const dow = weekday(day);
    const holiday = zaPublicHolidays(parts(day).y).has(day);
    if (dow !== 0 && dow !== 6 && !holiday) return day;
    day = shiftDays(day, -1);
  }
  return day;
}

/** Year end for a year of assessment. A March start ends on the last day of February. */
export function irp6YearEnd(yearOfAssessment: number, fyStartMonth: number): string {
  const start =
    Number.isInteger(fyStartMonth) && fyStartMonth >= 1 && fyStartMonth <= 12 ? fyStartMonth : 3;
  const m = start === 1 ? 12 : start - 1;
  return isoOf({ y: yearOfAssessment, m, d: lastDay(yearOfAssessment, m) });
}

export function irp6Supported(yearEnd: string): boolean {
  return yearEnd >= IRP6_FIRST_SUPPORTED_YEAR_END;
}

/** Period end and statutory due date, then the working-day due date. */
export function irp6PeriodDates(
  yearEnd: string,
  period: Irp6Period,
): { periodEnd: string; statutoryDue: string; due: string } {
  const rows = companyTaxDeadlines(yearEnd);
  const id = period === 1 ? "irp6-1" : period === 2 ? "irp6-2" : "irp6-3";
  const statutoryDue = rows.find((row) => row.id === id)!.due;
  const periodEnd = period === 1 ? statutoryDue : yearEnd;
  return { periodEnd, statutoryDue, due: lastWorkingDayOnOrBefore(statutoryDue) };
}

/** The year of assessment and period whose due date is next on or after today. */
export function irp6DefaultPick(
  todayIso: string,
  fyStartMonth: number,
): { yearOfAssessment: number; period: Irp6Period } {
  const y = parts(todayIso).y;
  for (const year of [y - 1, y, y + 1, y + 2]) {
    const yearEnd = irp6YearEnd(year, fyStartMonth);
    for (const period of [1, 2] as const) {
      if (irp6PeriodDates(yearEnd, period).due >= todayIso)
        return { yearOfAssessment: year, period };
    }
  }
  return { yearOfAssessment: y + 1, period: 1 };
}

/** Years shown in the picker: last year, this year, next year, within the v1 limit. */
export function irp6YearOptions(todayIso: string, fyStartMonth: number): number[] {
  const pick = irp6DefaultPick(todayIso, fyStartMonth).yearOfAssessment;
  return [pick - 1, pick, pick + 1].filter((year) =>
    irp6Supported(irp6YearEnd(year, fyStartMonth)),
  );
}

export function irp6PeriodLabel(period: Irp6Period): string {
  if (period === 1) return "Period 1, first";
  if (period === 2) return "Period 2, second";
  return "Period 3, top-up";
}

/** SARS income tax reference numbers are ten digits. */
export function validTaxReference(value: string): boolean {
  return /^\d{10}$/.test(value.replace(/\s+/g, ""));
}

export function normaliseTaxReference(value: string): string {
  return value.replace(/\s+/g, "");
}

/** "R 12 500.50", "12500,5" or "12,500.50" to whole cents. Empty or unreadable is null. */
export function parseRandsToCents(text: string): number | null {
  const raw = text.replace(/[R\s\u00a0]/gi, "");
  if (!raw) return null;
  let body = raw;
  if (/^-?\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(body)) body = body.replace(/,/g, "");
  else if (/^-?\d+,\d{1,2}$/.test(body)) body = body.replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(body)) return null;
  const negative = body.startsWith("-");
  const [whole, frac = ""] = body.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function plainRands(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function finCents(fin: Record<string, unknown> | null, key: string): number | null {
  const raw = fin?.[key];
  if (raw == null || String(raw).trim() === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[\s,]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function isoDay(raw: unknown): string | null {
  const text = raw == null ? "" : String(raw);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match ? match[1] : null;
}

function monthLabel(iso: string): string {
  return formatSampleDate(iso).replace(/^\d+\s+/, "");
}

/** Full-year figure from the books, and how it was reached. */
export function irp6BooksFullYear(
  client: Irp6Client,
  yearStart: string,
  yearEnd: string,
): {
  profitCents: number | null;
  fullYearProfitCents: number | null;
  grossIncomeCents: number | null;
  months: number;
  periodEnd: string | null;
  inYear: boolean;
  method: string;
} {
  const fin = client.financials;
  const profitCents = finCents(fin, "ebt");
  const revenueCents = finCents(fin, "revenue");
  const months = effectivePeriodMonths(fin, { fyStartMonth: client.fyStartMonth });
  const periodEnd = isoDay(fin?.periodEnd);
  const inYear = periodEnd != null && periodEnd >= yearStart && periodEnd <= yearEnd;
  const scale = (cents: number | null) =>
    cents == null ? null : inYear && months < 12 ? Math.round((cents * 12) / months) : cents;
  const fullYearProfitCents = scale(profitCents);
  const grossIncomeCents = scale(revenueCents);
  let method: string;
  if (profitCents == null) {
    method = "The books have no profit before tax. Type the full-year figure.";
  } else if (inYear && months < 12) {
    const end = parts(periodEnd!);
    const first = new Date(Date.UTC(end.y, end.m - months, 1));
    const from = monthLabel(isoOf({ y: first.getUTCFullYear(), m: first.getUTCMonth() + 1, d: 1 }));
    const to = monthLabel(isoOf({ ...end, d: 1 }));
    method = `${formatSampleCents(profitCents)} for ${months} months, ${from} to ${to}, × 12 ÷ ${months}.`;
  } else if (inYear) {
    method = `The books cover the full year to ${formatSampleDate(periodEnd!)}. Used as they are.`;
  } else if (periodEnd) {
    method = `The books run to ${formatSampleDate(periodEnd)}, outside this year. Used as they are.`;
  } else {
    method = "The books have no period end. Used as they are.";
  }
  return { profitCents, fullYearProfitCents, grossIncomeCents, months, periodEnd, inYear, method };
}

function sourceLabel(kind: Irp6SourceKind, filled: boolean, asOf: string | null): string {
  if (kind === "books") {
    const day = isoDay(asOf);
    // date-ok: formatSampleDate prints the ZA calendar day
    return day ? `From books sync, as of ${formatSampleDate(day)}` : "From books sync";
  }
  if (kind === "client") return "From client record";
  if (kind === "input") return filled ? "Typed in" : "Needs input";
  if (kind === "nil") return "Nil in this version";
  return "Worked out on this sheet";
}

function money(cents: number | null): string {
  return cents == null ? "" : formatSampleCents(cents);
}

export function computeIrp6(input: {
  client: Irp6Client;
  yearOfAssessment: number;
  period: Irp6Period;
  inputs: Irp6Inputs;
}): Irp6Sheet {
  const { client, yearOfAssessment, period, inputs } = input;
  const yearEnd = irp6YearEnd(yearOfAssessment, client.fyStartMonth);
  const yearStart = yearOfAssessmentStart(yearEnd);
  const supported = irp6Supported(yearEnd);
  const dates = irp6PeriodDates(yearEnd, period);
  const books = irp6BooksFullYear(client, yearStart, yearEnd);

  const typedProfit = books.profitCents == null ? inputs.profitBeforeTaxCents : null;
  const profitBeforeTaxCents = books.profitCents ?? typedProfit;
  const fullYearProfitCents = books.fullYearProfitCents ?? typedProfit;

  let addedCents = 0;
  let deductedCents = 0;
  for (const row of inputs.adjustments) {
    const amount = Math.abs(row.amountCents ?? 0);
    if (row.direction === "add") addedCents += amount;
    else deductedCents += amount;
  }
  const netAdjustmentsCents = addedCents - deductedCents;
  const workedEstimateCents =
    fullYearProfitCents == null ? null : Math.max(0, fullYearProfitCents + netAdjustmentsCents);
  const estimateCents =
    inputs.estimateOverrideCents != null
      ? Math.max(0, inputs.estimateOverrideCents)
      : workedEstimateCents;

  const company =
    estimateCents == null
      ? null
      : computeCompanyTax({
          accountingProfitCents: estimateCents,
          depreciationAddBackCents: 0,
          finesAddBackCents: 0,
          wearAndTearCents: 0,
          exemptDividendsCents: 0,
          assessedLossBroughtForwardCents: 0,
          donationCents: 0,
          provisionalEstimateCents: estimateCents,
        });
  const estimatedTaxCents = company?.estimateTaxCents ?? null;
  const taxForPeriodCents =
    company == null ? null : period === 1 ? company.period1Cents : company.estimateTaxCents;
  const employeesTaxCents = inputs.employeesTaxCents ?? 0;
  const paidCents = period === 1 ? 0 : (inputs.provisionalPaidCents ?? 0);
  const creditsCents = employeesTaxCents + paidCents;
  const taxPayableCents =
    taxForPeriodCents == null ? null : Math.max(0, taxForPeriodCents - creditsCents);

  const basicAmountRequired =
    estimateCents != null && estimateCents <= IRP6_BASIC_AMOUNT_LIMIT_CENTS;
  const estimatePercentOfActual =
    period === 2 && estimateCents != null && workedEstimateCents != null && workedEstimateCents > 0
      ? Math.floor((estimateCents * 100) / workedEstimateCents)
      : null;

  const fullYearNote =
    books.profitCents == null
      ? typedProfit == null
        ? undefined
        : "Typed as the full-year figure."
      : books.method;

  const values: Record<
    Irp6FieldId,
    { cents?: number | null; text?: string; filled: boolean; note?: string }
  > = {
    registeredName: { text: client.name.trim(), filled: Boolean(client.name.trim()) },
    taxReference: {
      text: normaliseTaxReference(inputs.taxReference),
      filled: Boolean(inputs.taxReference.trim()),
    },
    yearOfAssessment: { text: String(yearOfAssessment), filled: true },
    period: { text: irp6PeriodLabel(period), filled: true },
    periodEnd: { text: formatSampleDate(dates.periodEnd), filled: true },
    grossIncome: { cents: books.grossIncomeCents, filled: books.grossIncomeCents != null },
    profitBeforeTax: { cents: profitBeforeTaxCents, filled: profitBeforeTaxCents != null },
    fullYearProfit: {
      cents: fullYearProfitCents,
      filled: fullYearProfitCents != null,
      note: fullYearNote,
    },
    netAdjustments: { cents: netAdjustmentsCents, filled: true },
    estimatedTaxableIncome: {
      cents: estimateCents,
      filled: estimateCents != null,
      note:
        inputs.estimateOverrideCents != null && workedEstimateCents != null
          ? `Typed in. The books and adjustments give ${formatSampleCents(workedEstimateCents)}.`
          : undefined,
    },
    basicAmount: {
      cents: inputs.basicAmountCents,
      filled: inputs.basicAmountCents != null,
      note: basicAmountRequired
        ? "Taxable income on the latest assessment, less any taxable capital gain. Needed because the estimate is R 1 000 000.00 or less."
        : undefined,
    },
    estimatedTax: { cents: estimatedTaxCents, filled: estimatedTaxCents != null },
    employeesTax: {
      cents: inputs.employeesTaxCents,
      filled: inputs.employeesTaxCents != null,
      note: `Normally nil. eFiling needs 0.00 when there is none. ${period === 1 ? "Six" : "Twelve"} months.`,
    },
    foreignTaxCredits: { cents: 0, filled: true },
    provisionalPaid: {
      cents: inputs.provisionalPaidCents,
      filled: inputs.provisionalPaidCents != null,
      note: period === 2 ? "Period 1 payment." : "Periods 1 and 2 payments.",
    },
    taxForPeriod: {
      cents: taxForPeriodCents,
      filled: taxForPeriodCents != null,
      note:
        period === 1
          ? "Half the tax on the estimate."
          : "The tax on the estimate for the full year.",
    },
    taxPayable: { cents: taxPayableCents, filled: taxPayableCents != null },
    estimateAgainstActual: {
      text: estimatePercentOfActual == null ? "" : `${estimatePercentOfActual}%`,
      filled: estimatePercentOfActual != null,
      note:
        estimatePercentOfActual == null
          ? undefined
          : `Your estimate is ${estimatePercentOfActual}% of the actual figure so far.`,
    },
  };

  const lines: Irp6Line[] = [];
  for (const field of IRP6_FIELDS) {
    if (field.periods && !field.periods.includes(period)) continue;
    const value = values[field.id];
    if (field.id === "basicAmount" && !basicAmountRequired && !value.filled) continue;
    const required =
      field.required === true ||
      (field.required === "estimate-under-r1m" && basicAmountRequired) ||
      (field.required === "after-period-1" && period > 1);
    let source = field.source;
    if (field.id === "profitBeforeTax" && books.profitCents == null) source = "input";
    if (field.id === "estimatedTaxableIncome" && inputs.estimateOverrideCents != null)
      source = "input";
    const display = value.cents !== undefined ? money(value.cents) : (value.text ?? "");
    const plain =
      value.cents !== undefined
        ? value.cents == null
          ? ""
          : plainRands(value.cents)
        : (value.text ?? "");
    const missing = required && !value.filled && (source === "input" || source === "books");
    lines.push({
      id: field.id,
      section: field.section,
      label:
        field.id === "provisionalPaid" && period === 2
          ? "Provisional tax paid for period 1"
          : field.label,
      efiling: field.id === "provisionalPaid" && period === 3 ? null : field.efiling,
      display,
      plain,
      source,
      sourceLabel: sourceLabel(source, value.filled, client.financialsAsOf),
      required,
      missing,
      note: value.note,
    });
  }

  const checks: Irp6Check[] = [];
  if (!supported) {
    checks.push({
      id: "supported",
      level: "error",
      text: `This sheet covers years of assessment ending on or after ${formatSampleDate(IRP6_FIRST_SUPPORTED_YEAR_END)}.`,
    });
  }
  const ref = normaliseTaxReference(inputs.taxReference);
  if (ref && !validTaxReference(ref)) {
    checks.push({
      id: "tax-reference",
      level: "error",
      text: "The income tax reference number should be 10 digits.",
    });
  }
  if (books.profitCents != null && books.periodEnd && !books.inYear) {
    checks.push({
      id: "period-end",
      level: "warning",
      text: `The books end on ${formatSampleDate(books.periodEnd)}, outside the year ${formatSampleDate(yearStart)} to ${formatSampleDate(yearEnd)}.`,
    });
  } else if (
    books.profitCents != null &&
    books.periodEnd &&
    books.inYear &&
    books.months >= 12 &&
    books.periodEnd !== yearEnd
  ) {
    checks.push({
      id: "period-end",
      level: "warning",
      text: `The books cover 12 months to ${formatSampleDate(books.periodEnd)}, but the year ends on ${formatSampleDate(yearEnd)}.`,
    });
  } else if (books.periodEnd && books.inYear) {
    checks.push({
      id: "period-end",
      level: "ok",
      text: `Period end ${formatSampleDate(dates.periodEnd)} sits in the year that ends on ${formatSampleDate(yearEnd)}.`,
    });
  }
  inputs.adjustments.forEach((row, index) => {
    if (!row.description.trim() || row.amountCents == null || row.amountCents === 0) {
      checks.push({
        id: `adjustment-${row.id}`,
        level: "error",
        text: `Adjustment ${index + 1} needs a description and an amount.`,
      });
    }
  });
  if (fullYearProfitCents != null && workedEstimateCents != null) {
    const sum = Math.max(0, fullYearProfitCents + addedCents - deductedCents);
    checks.push({
      id: "adds-up",
      level: sum === workedEstimateCents ? "ok" : "error",
      text: `${formatSampleCents(fullYearProfitCents)} + ${formatSampleCents(addedCents)} added − ${formatSampleCents(deductedCents)} deducted = ${formatSampleCents(workedEstimateCents)}.`,
    });
  }
  if (
    estimateCents != null &&
    estimatedTaxCents != null &&
    estimatedTaxCents !== taxAtCompanyRate(estimateCents)
  ) {
    checks.push({ id: "rate", level: "error", text: "The tax is not 27% of the estimate." });
  }
  if (taxForPeriodCents != null && creditsCents > taxForPeriodCents) {
    checks.push({
      id: "credits",
      level: "warning",
      text: `Credits of ${formatSampleCents(creditsCents)} are more than the tax for this period. Payable shows nil.`,
    });
  }
  if (basicAmountRequired && inputs.basicAmountCents != null && estimateCents != null) {
    if (estimateCents < inputs.basicAmountCents) {
      checks.push({
        id: "basic-amount",
        level: "warning",
        text: `The estimate is below the basic amount of ${formatSampleCents(inputs.basicAmountCents)}. SARS can ask you to justify it.`,
      });
    }
    checks.push({
      id: "basic-amount-uplift",
      level: "warning",
      text: "If the latest assessment is for a year that ended more than 18 months before this estimate, SARS adds 8% a year to the basic amount. This sheet does not add it.",
    });
  }
  if (
    period === 2 &&
    estimatePercentOfActual != null &&
    workedEstimateCents != null &&
    estimateCents != null
  ) {
    const above = workedEstimateCents > IRP6_BASIC_AMOUNT_LIMIT_CENTS;
    const low = above
      ? estimatePercentOfActual < 80
      : estimatePercentOfActual < 90 &&
        (inputs.basicAmountCents == null || estimateCents < inputs.basicAmountCents);
    checks.push({
      id: "eighty",
      level: low ? "warning" : "ok",
      text: low
        ? above
          ? `Your estimate is ${estimatePercentOfActual}% of the actual figure so far. Below 80% can bring an underestimation penalty.`
          : `Your estimate is ${estimatePercentOfActual}% of the actual figure so far and below the basic amount. Below 90% can bring an underestimation penalty.`
        : `Your estimate is ${estimatePercentOfActual}% of the actual figure so far.`,
    });
  }

  return {
    yearOfAssessment,
    period,
    yearStart,
    yearEnd,
    periodEnd: dates.periodEnd,
    statutoryDue: dates.statutoryDue,
    due: dates.due,
    supported,
    booksMethod: books.method,
    booksInYear: books.inYear,
    grossIncomeCents: books.grossIncomeCents,
    profitBeforeTaxCents,
    fullYearProfitCents,
    addedCents,
    deductedCents,
    netAdjustmentsCents,
    workedEstimateCents,
    estimateCents,
    basicAmountRequired,
    estimatedTaxCents,
    taxForPeriodCents,
    creditsCents,
    taxPayableCents,
    estimatePercentOfActual,
    lines,
    missing: lines.filter((line) => line.missing),
    checks,
  };
}

export function irp6MissingSentence(count: number): string {
  if (count === 0) return "";
  return count === 1
    ? "1 field needs input before you can download."
    : `${count} fields need input before you can download.`;
}

/** Download needs every required field, no errors, and every section approved. */
export function irp6CanDownload(
  sheet: Irp6Sheet,
  approvals: Partial<Record<Irp6SectionId, boolean>>,
): boolean {
  return (
    sheet.missing.length === 0 &&
    !sheet.checks.some((check) => check.level === "error") &&
    IRP6_SECTIONS.every((section) => approvals[section.id])
  );
}

function fileSafe(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "Client"
  );
}

export function irp6FileName(
  clientName: string,
  yearOfAssessment: number,
  period: Irp6Period,
  ext: "pdf" | "csv",
): string {
  return `IRP6_${fileSafe(clientName)}_${yearOfAssessment}_P${period}.${ext}`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Field name and value, one row each. eFiling names where eFiling has the field. */
export function irp6Csv(sheet: Irp6Sheet, adjustments: Irp6Adjustment[]): string {
  const rows: Array<[string, string]> = [["Field", "Value"]];
  for (const line of sheet.lines) {
    rows.push([line.efiling ?? line.label, line.plain]);
    if (line.id === "netAdjustments") {
      for (const row of adjustments) {
        const sign = row.direction === "add" ? "added" : "deducted";
        rows.push([
          `Adjustment, ${sign}: ${row.description.trim()}`,
          plainRands(Math.abs(row.amountCents ?? 0)),
        ]);
      }
    }
  }
  rows.push(["Due date", sheet.due]);
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

/** Today in South Africa, as YYYY-MM-DD. */
export function zaToday(now: Date = new Date()): string {
  const { year, month, day } = calendarDateInTimeZone(now, "Africa/Johannesburg");
  return isoOf({ y: year, m: month, d: day });
}
