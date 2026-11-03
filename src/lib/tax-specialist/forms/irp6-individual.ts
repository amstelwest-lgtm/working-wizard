/**
 * Second IRP6 schema: a natural person / sole practitioner.
 *
 * Same form code as the company sheet. Drafts are distinguished by
 * subject "individual", which the Phase 0 unique key already allows.
 * No new catalog code.
 *
 * Income, expenses, medical, retirement annuity, and travel come from a
 * cited file, a full year of books, or a figure the accountant types.
 * A blank is not zero. Tax uses the signed-off individual rate table for
 * that year of assessment. A year with no table stays blank.
 *
 * The sheet shows the estimate against 80% of the worked figure. It does
 * not compute a penalty or interest. Medical tax credit and the
 * retirement-annuity cap are not applied.
 *
 * Milōn does not log into SARS, does not submit, and does not email the
 * sheet to the client.
 */
import { SEND_ITEM_LABELS, type SendItemKey } from "@/lib/client-agent-send";
import type { TaxFormDraft, TaxFormDraftField } from "./drafts.ts";
import type { TaxFormField } from "./registry.ts";
import {
  IRP6_INDIVIDUAL_SUBJECT,
  irp6BooksFullYear,
  irp6DefaultPick,
  irp6PeriodDates,
  irp6PeriodLabel,
  irp6YearEnd,
  normaliseTaxReference,
  parseRandsToCents,
  plainRands,
  validTaxReference,
  type Irp6Client,
  type Irp6Period,
  type Irp6SectionId,
  type Irp6SourceKind,
} from "./irp6.ts";
import { formatSampleCents, formatSampleDate, yearOfAssessmentStart } from "../sample-compute.ts";

export { IRP6_INDIVIDUAL_SUBJECT };

export const IRP6_INDIVIDUAL_FOOTER =
  "Prepared by Milōn for checking. Not a SARS return. Capture and submit on SARS eFiling. This sheet is not sent to the client.";

/**
 * Individual rates and rebates by year of assessment.
 * SARS "Rates of Tax for Individuals", read 3 November 2026.
 * 2027 is the table published for 1 March 2026 – 28 February 2027.
 * 2026 and 2025 are recorded there as no change from the 2024 brackets.
 * Rebates for 2024, 2025, and 2026 are the same published amounts.
 * 2023 is the previous published table. Any other year has no tax figure.
 */
type RateBand = {
  /** Inclusive top of the band, in cents. Null on the last band. */
  upToCents: number | null;
  baseCents: number;
  aboveCents: number;
  rateNumerator: number;
};

type RateYear = {
  year: number;
  bands: readonly RateBand[];
  primaryCents: number;
  secondaryCents: number;
  tertiaryCents: number;
};

function rands(amount: number): number {
  return amount * 100;
}

function bands(rows: ReadonlyArray<[number | null, number, number, number]>): readonly RateBand[] {
  return rows.map(([upTo, base, above, rate]) => ({
    upToCents: upTo == null ? null : rands(upTo),
    baseCents: rands(base),
    aboveCents: rands(above),
    rateNumerator: rate,
  }));
}

const BRACKETS_2024 = bands([
  [237_100, 0, 0, 18],
  [370_500, 42_678, 237_100, 26],
  [512_800, 77_362, 370_500, 31],
  [673_000, 121_475, 512_800, 36],
  [857_900, 179_147, 673_000, 39],
  [1_817_000, 251_258, 857_900, 41],
  [null, 644_489, 1_817_000, 45],
]);

const BRACKETS_2023 = bands([
  [226_000, 0, 0, 18],
  [353_100, 40_680, 226_000, 26],
  [488_700, 73_726, 353_100, 31],
  [641_400, 115_762, 488_700, 36],
  [817_600, 170_734, 641_400, 39],
  [1_731_600, 239_452, 817_600, 41],
  [null, 614_192, 1_731_600, 45],
]);

const BRACKETS_2027 = bands([
  [245_100, 0, 0, 18],
  [383_100, 44_118, 245_100, 26],
  [530_200, 79_998, 383_100, 31],
  [695_800, 125_599, 530_200, 36],
  [887_000, 185_215, 695_800, 39],
  [1_878_600, 259_783, 887_000, 41],
  [null, 666_339, 1_878_600, 45],
]);

const REBATES_2024 = {
  primaryCents: rands(17_235),
  secondaryCents: rands(9_444),
  tertiaryCents: rands(3_145),
};

export const IRP6_INDIVIDUAL_RATE_TABLES: readonly RateYear[] = [
  {
    year: 2023,
    bands: BRACKETS_2023,
    primaryCents: rands(16_425),
    secondaryCents: rands(9_000),
    tertiaryCents: rands(2_997),
  },
  { year: 2024, bands: BRACKETS_2024, ...REBATES_2024 },
  { year: 2025, bands: BRACKETS_2024, ...REBATES_2024 },
  { year: 2026, bands: BRACKETS_2024, ...REBATES_2024 },
  {
    year: 2027,
    bands: BRACKETS_2027,
    primaryCents: rands(17_820),
    secondaryCents: rands(9_765),
    tertiaryCents: rands(3_249),
  },
];

export function irp6IndividualRateYear(year: number): RateYear | null {
  return IRP6_INDIVIDUAL_RATE_TABLES.find((row) => row.year === year) ?? null;
}

/** null age uses the primary rebate only. Older rebates need an age band. */
export type Irp6AgeBand = "under-65" | "65" | "75";

export function individualNormalTaxCents(
  year: number,
  taxableCents: number,
  age: Irp6AgeBand | null,
): number | null {
  const table = irp6IndividualRateYear(year);
  if (!table) return null;
  if (!Number.isSafeInteger(taxableCents) || taxableCents <= 0) return 0;
  const band = table.bands.find((row) => row.upToCents == null || taxableCents <= row.upToCents);
  if (!band) return null;
  const above = taxableCents - band.aboveCents;
  const gross = band.baseCents + Math.round((above * band.rateNumerator) / 100);
  let rebate = table.primaryCents;
  if (age === "65" || age === "75") rebate += table.secondaryCents;
  if (age === "75") rebate += table.tertiaryCents;
  return Math.max(0, gross - rebate);
}

export const IRP6_INDIVIDUAL_INTAKE = [
  "irp5",
  "it3b",
  "medical_aid_certificate",
  "ra_contribution_certificate",
  "travel_logbook",
  "practice_income_expenses",
] as const satisfies readonly SendItemKey[];

export type Irp6IndMoneyId =
  | "employmentIncome"
  | "practiceIncome"
  | "localInterest"
  | "practiceExpenses"
  | "travelClaim"
  | "medicalContributions"
  | "raContributions"
  | "basicAmount"
  | "payeWithheld"
  | "paymentsMade";

export const IRP6_INDIVIDUAL_SECTIONS: ReadonlyArray<{
  id: Irp6SectionId;
  title: string;
  purpose: string;
}> = [
  {
    id: "taxpayer",
    title: "Taxpayer",
    purpose: "Who the return is for and which period it covers.",
  },
  {
    id: "estimate",
    title: "Estimate",
    purpose: "Income cited for the full year, and the taxable income to file.",
  },
  {
    id: "adjustments",
    title: "Adjustments",
    purpose:
      "Practice expenses and travel come off the estimate. Medical and retirement annuity certificates are cited and are not subtracted.",
  },
  {
    id: "credits",
    title: "Credits",
    purpose: "PAYE already withheld, and provisional tax already paid.",
  },
  {
    id: "result",
    title: "Result",
    purpose: "Tax on the estimate at the signed-off rates for this year, and the 80% comparison.",
  },
];

const MONEY: ReadonlyArray<{
  id: Irp6IndMoneyId;
  section: Irp6SectionId;
  label: string;
  itemKey: SendItemKey | null;
  required: boolean | "after-period-1";
  note: string;
}> = [
  {
    id: "employmentIncome",
    section: "estimate",
    label: "Employment income",
    itemKey: "irp5",
    required: true,
    note: "From the IRP5. Type nil when there was no salaried job.",
  },
  {
    id: "practiceIncome",
    section: "estimate",
    label: "Practice income",
    itemKey: "practice_income_expenses",
    required: true,
    note: "Turnover and other practice income.",
  },
  {
    id: "localInterest",
    section: "estimate",
    label: "Local interest",
    itemKey: "it3b",
    required: true,
    note: "From the IT3(b). The interest exemption is not applied.",
  },
  {
    id: "practiceExpenses",
    section: "adjustments",
    label: "Practice expenses",
    itemKey: "practice_income_expenses",
    required: true,
    note: "Taken off the estimate.",
  },
  {
    id: "travelClaim",
    section: "adjustments",
    label: "Travel",
    itemKey: "travel_logbook",
    required: true,
    note: "From the logbook. Taken off the estimate. A blank is not zero.",
  },
  {
    id: "medicalContributions",
    section: "adjustments",
    label: "Medical scheme contributions",
    itemKey: "medical_aid_certificate",
    required: true,
    note: "Certificate total only. Not subtracted, and the medical tax credit is not computed.",
  },
  {
    id: "raContributions",
    section: "adjustments",
    label: "Retirement annuity contributions",
    itemKey: "ra_contribution_certificate",
    required: true,
    note: "Certificate total only. Not subtracted, and the deduction limit is not computed.",
  },
  {
    id: "basicAmount",
    section: "estimate",
    label: "Basic amount, from the latest assessment",
    itemKey: null,
    required: true,
    note: "Taxable income on the latest assessment, less any taxable capital gain.",
  },
  {
    id: "payeWithheld",
    section: "credits",
    label: "PAYE already withheld",
    itemKey: null,
    required: true,
    note: "Employees' tax already withheld. Type nil when there is none. This sheet does not split it across periods.",
  },
  {
    id: "paymentsMade",
    section: "credits",
    label: "Provisional tax already paid this year",
    itemKey: null,
    required: "after-period-1",
    note: "Payments already made. Type nil when none have been made.",
  },
];

export function irp6IndividualMoney(id: Irp6IndMoneyId) {
  const field = MONEY.find((row) => row.id === id);
  if (!field) throw new Error(`Unknown individual IRP6 amount ${id}.`);
  return field;
}

function intakeFor(field: (typeof MONEY)[number]): TaxFormField["intake"] {
  if (field.itemKey) return { from: "checklist", itemKey: field.itemKey };
  return { from: "accountant" };
}

export const IRP6_INDIVIDUAL_FIELDS: readonly TaxFormField[] = [
  {
    id: "fullName",
    section: "taxpayer",
    label: "Full name",
    efiling: "Registered name",
    type: "text",
    required: true,
    source: "client",
    intake: { from: "client-record" },
  },
  {
    id: "taxReference",
    section: "taxpayer",
    label: "Income tax reference number",
    efiling: "Taxpayer reference number",
    type: "tax-reference",
    required: true,
    source: "input",
    intake: { from: "accountant" },
  },
  {
    id: "yearOfAssessment",
    section: "taxpayer",
    label: "Year of assessment",
    efiling: "Year of assessment",
    type: "year",
    required: true,
    source: "client",
    intake: { from: "client-record" },
  },
  {
    id: "period",
    section: "taxpayer",
    label: "Period",
    efiling: "Period",
    type: "period",
    required: true,
    source: "client",
    intake: { from: "client-record" },
  },
  {
    id: "periodEnd",
    section: "taxpayer",
    label: "Period end date",
    efiling: null,
    type: "date",
    required: true,
    source: "client",
    intake: { from: "client-record" },
  },
  {
    id: "ageBand",
    section: "taxpayer",
    label: "Age band",
    efiling: null,
    type: "text",
    required: false,
    source: "input",
    intake: { from: "accountant" },
  },
  ...MONEY.map(
    (field): TaxFormField => ({
      id: field.id,
      section: field.section,
      label: field.label,
      efiling:
        field.id === "payeWithheld"
          ? "Employees' tax for this period"
          : field.id === "paymentsMade"
            ? "Provisional tax paid for the first period"
            : field.id === "basicAmount"
              ? null
              : null,
      type: "amount",
      required: field.required === "after-period-1" ? "after-period-1" : field.required,
      source: "file",
      intake: intakeFor(field),
    }),
  ),
  {
    id: "estimatedTaxableIncome",
    section: "estimate",
    label: "Estimated taxable income for the full year",
    efiling: "Estimated taxable income",
    type: "amount",
    required: true,
    source: "worked",
    intake: { from: "worked" },
  },
  {
    id: "estimatedTax",
    section: "estimate",
    label: "Tax on estimated taxable income",
    efiling: "Tax on estimated taxable income",
    type: "amount",
    required: true,
    source: "worked",
    intake: { from: "worked" },
  },
  {
    id: "taxForPeriod",
    section: "result",
    label: "Tax for this period",
    efiling: "Tax for this period",
    type: "amount",
    required: true,
    source: "worked",
    intake: { from: "worked" },
  },
  {
    id: "taxPayable",
    section: "result",
    label: "Provisional tax payable for this period",
    efiling: "Tax payable for this period",
    type: "amount",
    required: true,
    source: "worked",
    intake: { from: "worked" },
  },
  {
    id: "eightyOfWorked",
    section: "result",
    label: "80% of the worked figure",
    efiling: null,
    type: "amount",
    required: false,
    source: "worked",
    intake: { from: "worked" },
  },
  {
    id: "estimateAgainstActual",
    section: "result",
    label: "Estimate against the worked figure",
    efiling: null,
    type: "percent",
    required: false,
    source: "worked",
    intake: { from: "worked" },
  },
];

export type Irp6IndLine = {
  id: string;
  fieldId: Irp6IndMoneyId;
  label: string;
  amountCents: number | null;
  fileId: string | null;
  source: "file" | "accountant" | "books";
  note: string | null;
};

export type Irp6IndQuery = {
  id: string;
  text: string;
  resolved: boolean;
};

export type Irp6IndividualInputs = {
  taxReference: string;
  ageBand: Irp6AgeBand | null;
  lines: Irp6IndLine[];
  estimateOverrideCents: number | null;
  queries: Irp6IndQuery[];
};

export type Irp6IndividualApproverRole = "owner" | "accountant";

const INTAKE_NEEDLE: Record<string, RegExp> = {
  irp5: /irp5|employment|salar/,
  it3b: /it3|\binterest\b/,
  medical_aid_certificate: /medical/,
  ra_contribution_certificate: /retirement|annuity/,
  travel_logbook: /travel|logbook/,
  practice_income_expenses: /practice|expense|turnover/,
};

export function irp6IndividualGapQueries(covered: ReadonlySet<string>): Irp6IndQuery[] {
  return IRP6_INDIVIDUAL_INTAKE.filter((item) => !covered.has(item)).map((item) => ({
    id: `missing-${item}`,
    text: `${SEND_ITEM_LABELS[item]} was not in the tax pack. Cite the file or type the amount.`,
    resolved: false,
  }));
}

export function emptyIrp6IndividualInputs(): Irp6IndividualInputs {
  return {
    taxReference: "",
    ageBand: null,
    lines: [],
    estimateOverrideCents: null,
    queries: irp6IndividualGapQueries(new Set()),
  };
}

function counts(line: Irp6IndLine): boolean {
  if (line.amountCents == null || !Number.isSafeInteger(line.amountCents)) return false;
  if (line.source === "accountant" || line.source === "books") return true;
  return line.source === "file" && Boolean(line.fileId?.trim());
}

function coveredItems(lines: readonly Irp6IndLine[]): Set<string> {
  const covered = new Set<string>();
  for (const line of lines) {
    if (!counts(line)) continue;
    const item = irp6IndividualMoney(line.fieldId).itemKey;
    if (item) covered.add(item);
  }
  return covered;
}

function pushQuery(queries: Irp6IndQuery[], text: string, id: string): void {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || queries.some((query) => query.text === clean)) return;
  queries.push({ id, text: clean, resolved: false });
}

/** A cited pack line, already checked, turned into an individual IRP6 line. */
export type Irp6PackCited = {
  id: string;
  fieldId: string;
  label: string;
  amountCents: number | null;
  fileId: string | null;
  source: "file" | "accountant";
  note: string | null;
};

const PAYE_LABEL = /paye|employees. tax|\b4102\b/;
const SALARY_LABEL = /\b3601\b|salary|remuneration|employment income/;
const BASIC_LABEL = /basic amount|prior assessment|latest assessment/;
const PAID_LABEL = /provisional tax (already )?paid|payments? made|irp6 payment/;

export function irp6IndividualFieldFromPack(fieldId: string, label: string): Irp6IndMoneyId | null {
  const text = label.toLowerCase();
  if (PAYE_LABEL.test(text) && !SALARY_LABEL.test(text)) return "payeWithheld";
  if (BASIC_LABEL.test(text)) return "basicAmount";
  if (PAID_LABEL.test(text)) return "paymentsMade";
  if (
    fieldId === "employmentIncome" ||
    fieldId === "practiceIncome" ||
    fieldId === "localInterest" ||
    fieldId === "practiceExpenses" ||
    fieldId === "travelClaim" ||
    fieldId === "medicalContributions" ||
    fieldId === "raContributions"
  ) {
    return fieldId;
  }
  return null;
}

export function irp6IndividualFromCited(input: {
  taxReference?: string;
  lines: readonly Irp6PackCited[];
  queries: readonly Irp6IndQuery[];
}): Irp6IndividualInputs {
  const lines: Irp6IndLine[] = [];
  const queries: Irp6IndQuery[] = input.queries.map((query) => ({ ...query }));
  input.lines.forEach((line, index) => {
    const fieldId = irp6IndividualFieldFromPack(line.fieldId, line.label);
    if (!fieldId || line.amountCents == null) {
      pushQuery(
        queries,
        `${line.label}: the tax pack line could not be placed on the IRP6, so the amount was left out.`,
        `irp6-drop-${index}`,
      );
      return;
    }
    if (line.source === "file" && !line.fileId?.trim()) {
      pushQuery(
        queries,
        `${line.label}: the figure had no file id, so it was left out.`,
        `irp6-file-${index}`,
      );
      return;
    }
    lines.push({
      id: line.id || `pack-${fieldId}-${index}`,
      fieldId,
      label: line.label,
      amountCents: line.amountCents,
      fileId: line.fileId,
      source: line.source,
      note: line.note,
    });
  });
  for (const gap of irp6IndividualGapQueries(coveredItems(lines))) {
    const item = gap.id.slice("missing-".length);
    const needle = INTAKE_NEEDLE[item];
    if (needle && queries.some((query) => needle.test(query.text.toLowerCase()))) continue;
    pushQuery(queries, gap.text, gap.id);
  }
  return {
    taxReference: input.taxReference ?? "",
    ageBand: null,
    lines,
    estimateOverrideCents: null,
    queries,
  };
}

export type Irp6IndividualLine = {
  id: string;
  section: Irp6SectionId;
  label: string;
  efiling: string | null;
  display: string;
  plain: string;
  source: Irp6SourceKind | "file";
  sourceLabel: string;
  fileId: string | null;
  required: boolean;
  missing: boolean;
  note?: string;
};

export type Irp6IndividualCheck = { id: string; level: "error" | "warning" | "ok"; text: string };

export type Irp6IndividualSheet = {
  yearOfAssessment: number;
  period: Irp6Period;
  yearStart: string;
  yearEnd: string;
  periodEnd: string;
  statutoryDue: string;
  due: string;
  /** The signed-off table used. Null when this year has no table. */
  rulesYear: number | null;
  ageBand: Irp6AgeBand | null;
  workedCents: number | null;
  estimateCents: number | null;
  eightyCents: number | null;
  estimatePercent: number | null;
  estimatedTaxCents: number | null;
  taxForPeriodCents: number | null;
  taxPayableCents: number | null;
  lines: Irp6IndividualLine[];
  queries: Irp6IndQuery[];
  missing: Irp6IndividualLine[];
  checks: Irp6IndividualCheck[];
};

export function irp6IndividualYearOfAssessment(today: string): number {
  return irp6DefaultPick(today, 3).yearOfAssessment;
}

export function irp6IndividualYearOptions(today: string): number[] {
  const current = irp6IndividualYearOfAssessment(today);
  return [current - 2, current - 1, current, current + 1];
}

function money(cents: number | null): string {
  return cents == null ? "" : formatSampleCents(cents);
}

function sumField(lines: readonly Irp6IndLine[], id: Irp6IndMoneyId): number | null {
  const rows = lines.filter((line) => line.fieldId === id);
  if (rows.length === 0 || rows.some((line) => !counts(line))) return null;
  return rows.reduce((sum, line) => sum + (line.amountCents ?? 0), 0);
}

function fullYearPracticeIncome(
  client: Irp6Client,
  yearStart: string,
  yearEnd: string,
): { cents: number; asOf: string | null; periodEnd: string } | null {
  const books = irp6BooksFullYear(
    {
      name: client.name,
      fyStartMonth: client.fyStartMonth,
      financials: client.financials,
      financialsAsOf: client.financialsAsOf,
    },
    yearStart,
    yearEnd,
  );
  if (!books.inYear || books.months < 12 || books.grossIncomeCents == null || !books.periodEnd) {
    return null;
  }
  return { cents: books.grossIncomeCents, asOf: client.financialsAsOf, periodEnd: books.periodEnd };
}

export function computeIrp6Individual(input: {
  client: Irp6Client;
  yearOfAssessment: number;
  period: Irp6Period;
  inputs: Irp6IndividualInputs;
}): Irp6IndividualSheet {
  const { client, yearOfAssessment, period, inputs } = input;
  const yearEnd = irp6YearEnd(yearOfAssessment, 3);
  const yearStart = yearOfAssessmentStart(yearEnd);
  const dates = irp6PeriodDates(yearEnd, period);
  const table = irp6IndividualRateYear(yearOfAssessment);

  const practiceBooks = inputs.lines.some((line) => line.fieldId === "practiceIncome")
    ? null
    : fullYearPracticeIncome(client, yearStart, yearEnd);
  const amount = (id: Irp6IndMoneyId): number | null => {
    if (id === "practiceIncome" && practiceBooks) return practiceBooks.cents;
    return sumField(inputs.lines, id);
  };

  const employment = amount("employmentIncome");
  const practice = amount("practiceIncome");
  const interest = amount("localInterest");
  const expenses = amount("practiceExpenses");
  const travel = amount("travelClaim");
  const parts = [employment, practice, interest, expenses, travel];
  const workedCents = parts.every((part) => part != null)
    ? (employment ?? 0) + (practice ?? 0) + (interest ?? 0) - (expenses ?? 0) - (travel ?? 0)
    : null;
  const estimateCents =
    inputs.estimateOverrideCents != null ? Math.max(0, inputs.estimateOverrideCents) : workedCents;
  const estimatedTaxCents =
    estimateCents == null
      ? null
      : individualNormalTaxCents(yearOfAssessment, estimateCents, inputs.ageBand);
  const taxForPeriodCents =
    estimatedTaxCents == null
      ? null
      : period === 1
        ? Math.floor(estimatedTaxCents / 2)
        : estimatedTaxCents;
  const paye = amount("payeWithheld");
  const paid = period === 1 ? 0 : amount("paymentsMade");
  const taxPayableCents =
    taxForPeriodCents == null || paye == null || paid == null
      ? null
      : Math.max(0, taxForPeriodCents - paye - paid);
  const eightyCents = workedCents == null ? null : Math.floor((workedCents * 80) / 100);
  const estimatePercent =
    estimateCents != null && workedCents != null && workedCents > 0
      ? Math.floor((estimateCents * 100) / workedCents)
      : null;

  const fileIds = (id: Irp6IndMoneyId): string[] =>
    inputs.lines
      .filter((line) => line.fieldId === id && line.source === "file" && line.fileId?.trim())
      .map((line) => line.fileId!.trim());

  const sourceOf = (
    id: Irp6IndMoneyId,
    cents: number | null,
  ): { source: Irp6IndividualLine["source"]; sourceLabel: string; fileId: string | null } => {
    if (id === "practiceIncome" && practiceBooks && sumField(inputs.lines, id) == null) {
      const day = practiceBooks.asOf ? practiceBooks.asOf.slice(0, 10) : null;
      return {
        source: "books",
        sourceLabel: day
          ? `From books, full year to ${formatSampleDate(practiceBooks.periodEnd)}, as of ${formatSampleDate(day)}`
          : `From books, full year to ${formatSampleDate(practiceBooks.periodEnd)}`,
        fileId: null,
      };
    }
    const rows = inputs.lines.filter((line) => line.fieldId === id && counts(line));
    if (rows.length === 0 || cents == null) {
      return { source: "input", sourceLabel: "Needs input", fileId: null };
    }
    const files = fileIds(id);
    if (rows.every((line) => line.source === "file") && files.length > 0) {
      return {
        source: "file",
        sourceLabel: files.length === 1 ? `File ${files[0]}` : `Files ${files.join(", ")}`,
        fileId: files[0] ?? null,
      };
    }
    if (rows.every((line) => line.source === "accountant")) {
      return { source: "input", sourceLabel: "Typed by the accountant", fileId: null };
    }
    if (rows.every((line) => line.source === "books")) {
      return { source: "books", sourceLabel: "From books", fileId: null };
    }
    const label = files.length
      ? `File ${files.join(", ")} and accountant`
      : "Typed by the accountant";
    return {
      source: files.length ? "file" : "input",
      sourceLabel: label,
      fileId: files[0] ?? null,
    };
  };

  const lines: Irp6IndividualLine[] = [];
  const push = (line: Irp6IndividualLine) => lines.push(line);

  push({
    id: "fullName",
    section: "taxpayer",
    label: "Full name",
    efiling: "Registered name",
    display: client.name.trim(),
    plain: client.name.trim(),
    source: "client",
    sourceLabel: "From client record",
    fileId: null,
    required: true,
    missing: !client.name.trim(),
  });
  const reference = normaliseTaxReference(inputs.taxReference);
  push({
    id: "taxReference",
    section: "taxpayer",
    label: "Income tax reference number",
    efiling: "Taxpayer reference number",
    display: reference,
    plain: reference,
    source: "input",
    sourceLabel: reference ? "Typed by the accountant" : "Needs input",
    fileId: null,
    required: true,
    missing: !reference,
  });
  push({
    id: "yearOfAssessment",
    section: "taxpayer",
    label: "Year of assessment",
    efiling: "Year of assessment",
    display: String(yearOfAssessment),
    plain: String(yearOfAssessment),
    source: "client",
    sourceLabel: "From the year picked on this sheet",
    fileId: null,
    required: true,
    missing: false,
  });
  push({
    id: "period",
    section: "taxpayer",
    label: "Period",
    efiling: "Period",
    display: irp6PeriodLabel(period),
    plain: irp6PeriodLabel(period),
    source: "client",
    sourceLabel: "From the period picked on this sheet",
    fileId: null,
    required: true,
    missing: false,
  });
  push({
    id: "periodEnd",
    section: "taxpayer",
    label: "Period end date",
    efiling: null,
    display: formatSampleDate(dates.periodEnd),
    plain: dates.periodEnd,
    source: "client",
    sourceLabel: "From the year and period",
    fileId: null,
    required: true,
    missing: false,
  });
  const ageLabel =
    inputs.ageBand === "75"
      ? "75 or older"
      : inputs.ageBand === "65"
        ? "65 to 74"
        : inputs.ageBand === "under-65"
          ? "Under 65"
          : "";
  push({
    id: "ageBand",
    section: "taxpayer",
    label: "Age band",
    efiling: null,
    display: ageLabel,
    plain: inputs.ageBand ?? "",
    source: "input",
    sourceLabel: ageLabel ? "Typed by the accountant" : "Not supplied",
    fileId: null,
    required: false,
    missing: false,
    note: ageLabel ? undefined : "Age was not supplied, so only the primary rebate is taken off.",
  });

  for (const field of MONEY) {
    if (field.id === "paymentsMade" && period === 1) continue;
    const cents = amount(field.id);
    const sourced = sourceOf(field.id, cents);
    const required = field.required === true || (field.required === "after-period-1" && period > 1);
    push({
      id: field.id,
      section: field.section,
      label: field.label,
      efiling:
        field.id === "payeWithheld"
          ? "Employees' tax for this period"
          : field.id === "paymentsMade"
            ? period === 3
              ? null
              : "Provisional tax paid for the first period"
            : null,
      display: money(cents),
      plain: cents == null ? "" : plainRands(cents),
      source: cents == null ? "input" : sourced.source,
      sourceLabel: sourced.sourceLabel,
      fileId: sourced.fileId,
      required,
      missing: required && cents == null,
      note: field.note,
    });
  }

  push({
    id: "estimatedTaxableIncome",
    section: "estimate",
    label: "Estimated taxable income for the full year",
    efiling: "Estimated taxable income",
    display: money(estimateCents),
    plain: estimateCents == null ? "" : plainRands(estimateCents),
    source: inputs.estimateOverrideCents != null ? "input" : "worked",
    sourceLabel:
      inputs.estimateOverrideCents != null ? "Typed by the accountant" : "Worked out on this sheet",
    fileId: null,
    required: true,
    missing: estimateCents == null,
    note:
      inputs.estimateOverrideCents != null && workedCents != null
        ? `Typed in. Income minus practice expenses and travel is ${formatSampleCents(workedCents)}. Medical and retirement annuity are not subtracted.`
        : "Employment, practice income, and local interest, minus practice expenses and travel. Medical and retirement annuity are not subtracted.",
  });
  push({
    id: "estimatedTax",
    section: "estimate",
    label: table
      ? `Tax on the estimate at the ${yearOfAssessment} individual rates`
      : "Tax on the estimate",
    efiling: "Tax on estimated taxable income",
    display: money(estimatedTaxCents),
    plain: estimatedTaxCents == null ? "" : plainRands(estimatedTaxCents),
    source: "worked",
    sourceLabel: table
      ? `Rate table ${yearOfAssessment}`
      : "No signed-off rate table for this year",
    fileId: null,
    required: true,
    missing: estimatedTaxCents == null,
    note: table
      ? inputs.ageBand === "75"
        ? "Rates for this year, less the primary, secondary, and tertiary rebates. The medical tax credit is not computed."
        : inputs.ageBand === "65"
          ? "Rates for this year, less the primary and secondary rebates. The medical tax credit is not computed."
          : "Rates for this year, less the primary rebate. The medical tax credit is not computed."
      : `No signed-off individual rate table for ${yearOfAssessment}. Tax is left blank.`,
  });
  push({
    id: "taxForPeriod",
    section: "result",
    label: "Tax for this period",
    efiling: "Tax for this period",
    display: money(taxForPeriodCents),
    plain: taxForPeriodCents == null ? "" : plainRands(taxForPeriodCents),
    source: "worked",
    sourceLabel: "Worked out on this sheet",
    fileId: null,
    required: true,
    missing: taxForPeriodCents == null,
    note:
      period === 1 ? "Half the tax on the estimate." : "The tax on the estimate for the full year.",
  });
  push({
    id: "taxPayable",
    section: "result",
    label: "Provisional tax payable for this period",
    efiling: "Tax payable for this period",
    display: money(taxPayableCents),
    plain: taxPayableCents == null ? "" : plainRands(taxPayableCents),
    source: "worked",
    sourceLabel: "Worked out on this sheet",
    fileId: null,
    required: true,
    missing: taxPayableCents == null,
  });
  push({
    id: "eightyOfWorked",
    section: "result",
    label: "80% of the worked figure",
    efiling: null,
    display: money(eightyCents),
    plain: eightyCents == null ? "" : plainRands(eightyCents),
    source: "worked",
    sourceLabel: "Worked out on this sheet",
    fileId: null,
    required: false,
    missing: false,
    note: "Comparison only.",
  });
  push({
    id: "estimateAgainstActual",
    section: "result",
    label: "Estimate against the worked figure",
    efiling: null,
    display: estimatePercent == null ? "" : `${estimatePercent}%`,
    plain: estimatePercent == null ? "" : `${estimatePercent}%`,
    source: "worked",
    sourceLabel: "Worked out on this sheet",
    fileId: null,
    required: false,
    missing: false,
    note:
      estimatePercent == null
        ? undefined
        : `Your estimate is ${estimatePercent}% of the worked figure.`,
  });

  const checks: Irp6IndividualCheck[] = [];
  if (reference && !validTaxReference(reference)) {
    checks.push({
      id: "tax-reference",
      level: "error",
      text: "The income tax reference number should be 10 digits.",
    });
  }
  if (!table) {
    checks.push({
      id: "rates",
      level: "error",
      text: `No signed-off individual rate table for ${yearOfAssessment}. Tax is left blank.`,
    });
  }
  for (const line of inputs.lines) {
    if (line.source === "file" && line.amountCents != null && !line.fileId?.trim()) {
      checks.push({
        id: `uncited-${line.id}`,
        level: "error",
        text: `${line.label} has an amount without a file id, so it is not in the estimate.`,
      });
    }
  }
  if (!inputs.ageBand) {
    checks.push({
      id: "age",
      level: "warning",
      text: "Age was not supplied, so only the primary rebate is taken off.",
    });
  }
  const basic = amount("basicAmount");
  if (estimateCents != null && basic != null && estimateCents < basic) {
    checks.push({
      id: "basic-amount",
      level: "warning",
      text: `The estimate is below the basic amount of ${formatSampleCents(basic)}.`,
    });
  }
  if (estimatePercent != null && eightyCents != null) {
    checks.push({
      id: "eighty",
      level: estimatePercent < 80 ? "warning" : "ok",
      text: `Your estimate is ${estimatePercent}% of the worked figure. 80% of the worked figure is ${formatSampleCents(eightyCents)}.`,
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
    rulesYear: table?.year ?? null,
    ageBand: inputs.ageBand,
    workedCents,
    estimateCents,
    eightyCents,
    estimatePercent,
    estimatedTaxCents,
    taxForPeriodCents,
    taxPayableCents,
    lines,
    queries: inputs.queries,
    missing: lines.filter((line) => line.missing),
    checks,
  };
}

export function irp6IndividualOpenQueries(inputs: Irp6IndividualInputs): Irp6IndQuery[] {
  return inputs.queries.filter((query) => !query.resolved);
}

export function irp6IndividualApproveBlock(input: {
  role: Irp6IndividualApproverRole;
  section: Irp6SectionId;
  sheet: Irp6IndividualSheet;
}): string | null {
  if (input.role === "owner") return "The owner cannot approve a section.";
  if (input.sheet.queries.some((query) => !query.resolved))
    return "Resolve the open queries first.";
  if (input.sheet.missing.some((line) => line.section === input.section))
    return "Fill this section first.";
  if (
    input.section === "taxpayer" &&
    input.sheet.checks.some((check) => check.level === "error" && check.id === "tax-reference")
  ) {
    return "Fix the reference number first.";
  }
  if (
    input.section === "result" &&
    input.sheet.checks.some((check) => check.level === "error" && check.id === "rates")
  ) {
    return "This year has no signed-off rate table.";
  }
  return null;
}

export function irp6IndividualCanDownload(
  sheet: Irp6IndividualSheet,
  approvals: Partial<Record<Irp6SectionId, boolean>>,
  role: Irp6IndividualApproverRole,
): boolean {
  if (role === "owner") return false;
  if (sheet.missing.length > 0) return false;
  if (sheet.checks.some((check) => check.level === "error")) return false;
  if (sheet.queries.some((query) => !query.resolved)) return false;
  return IRP6_INDIVIDUAL_SECTIONS.every((section) => approvals[section.id]);
}

function isLine(value: unknown): value is Irp6IndLine {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Irp6IndLine>;
  return (
    typeof row.id === "string" &&
    typeof row.fieldId === "string" &&
    typeof row.label === "string" &&
    (row.source === "file" || row.source === "accountant" || row.source === "books")
  );
}

function isQuery(value: unknown): value is Irp6IndQuery {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Irp6IndQuery>;
  return (
    typeof row.id === "string" && typeof row.text === "string" && typeof row.resolved === "boolean"
  );
}

function listed<T>(value: unknown, keep: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(keep) : [];
}

export function irp6IndividualDraftFields(
  sheet: Irp6IndividualSheet,
  inputs: Irp6IndividualInputs,
): Record<string, TaxFormDraftField> {
  const out: Record<string, TaxFormDraftField> = {};
  for (const line of sheet.lines) {
    const source: TaxFormDraftField["source"] =
      line.source === "file"
        ? "file"
        : line.source === "input"
          ? "input"
          : line.source === "books"
            ? "books"
            : line.source === "client"
              ? "client"
              : "worked";
    out[line.id] = { value: line.plain, source, fileId: line.fileId };
  }
  out.lines = { value: inputs.lines as unknown as unknown[], source: "file" };
  out.queries = { value: inputs.queries as unknown as unknown[], source: "input" };
  out.estimateOverride = {
    value: inputs.estimateOverrideCents == null ? "" : plainRands(inputs.estimateOverrideCents),
    source: "input",
  };
  return out;
}

export function irp6IndividualFieldSources(inputs: Irp6IndividualInputs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of inputs.lines) {
    const fileId = line.fileId?.trim();
    if (line.source === "file" && fileId) out[`${line.fieldId}:${line.id}`] = fileId;
  }
  return out;
}

export function irp6IndividualInputsFromDraft(
  draft: TaxFormDraft | null | undefined,
): Irp6IndividualInputs {
  if (!draft) return emptyIrp6IndividualInputs();
  const lines = listed(draft.fields.lines?.value, isLine).filter((line) =>
    MONEY.some((field) => field.id === line.fieldId),
  );
  const queries = listed(draft.fields.queries?.value, isQuery);
  const taxReference =
    typeof draft.fields.taxReference?.value === "string" ? draft.fields.taxReference.value : "";
  const ageRaw = draft.fields.ageBand?.value;
  const ageBand: Irp6AgeBand | null =
    ageRaw === "under-65" || ageRaw === "65" || ageRaw === "75" ? ageRaw : null;
  const override =
    typeof draft.fields.estimateOverride?.value === "string"
      ? parseRandsToCents(draft.fields.estimateOverride.value)
      : null;
  if (lines.length === 0 && queries.length === 0 && !taxReference)
    return emptyIrp6IndividualInputs();
  return {
    taxReference,
    ageBand,
    lines,
    estimateOverrideCents: override,
    queries,
  };
}

export function findIrp6IndividualDraft(
  drafts: readonly TaxFormDraft[],
  yearOfAssessment: number,
  period: Irp6Period,
): TaxFormDraft | undefined {
  return drafts
    .filter(
      (row) =>
        row.superseded_by == null &&
        row.form_code === "IRP6" &&
        row.subject === IRP6_INDIVIDUAL_SUBJECT &&
        row.tax_year === yearOfAssessment &&
        row.period === period,
    )
    .sort((a, b) => b.version - a.version)[0];
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

export function irp6IndividualFileName(
  clientName: string,
  yearOfAssessment: number,
  period: Irp6Period,
  ext: "pdf" | "csv",
): string {
  return `IRP6_${fileSafe(clientName)}_${yearOfAssessment}_P${period}_individual.${ext}`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function irp6IndividualCsv(sheet: Irp6IndividualSheet): string {
  const rows: string[][] = [["Field", "Value", "Source", "File"]];
  for (const line of sheet.lines)
    rows.push([line.label, line.plain, line.sourceLabel, line.fileId ?? ""]);
  for (const query of sheet.queries) {
    rows.push([
      query.resolved ? "Query, resolved" : "Query, open",
      query.text,
      query.resolved ? "Resolved by the accountant" : "Open",
      "",
    ]);
  }
  rows.push(["Notice", IRP6_INDIVIDUAL_FOOTER, "", ""]);
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}
