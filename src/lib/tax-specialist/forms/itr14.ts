/**
 * ITR14 preparation sheet for a standard resident company, with an IT14SD
 * reconciliation beside it.
 *
 * 27% comes from sample-compute and applies only when the accountant confirms
 * a standard company and the year ends on or after 31 March 2023. SBC and
 * other classes are not computed. Account-level trial balance, a fixed asset
 * register, and provisional-tax control accounts are not on the books sync.
 * Those lines stay blank until the accountant types them or confirms the gap.
 * A blank is not zero.
 *
 * Milōn does not log into SARS, does not submit, and does not email the sheet.
 */
import { effectivePeriodMonths } from "../../equity-coherence.ts";
import {
  companyTaxDeadlines,
  computeCompanyTax,
  formatSampleCents,
  formatSampleDate,
  taxAtCompanyRate,
  yearOfAssessmentStart,
  type CompanyTaxResult,
} from "../sample-compute.ts";
import type { TaxFormDraft, TaxFormDraftField } from "./drafts.ts";
import {
  irp6Supported,
  irp6YearEnd,
  lastWorkingDayOnOrBefore,
  normaliseTaxReference,
  plainRands,
  validTaxReference,
  type Irp6Client,
  type Irp6SourceKind,
} from "./irp6.ts";

export const ITR14_RULES_YEAR = 2023;

export const ITR14_FOOTER =
  "Prepared by Milōn for checking. Not a SARS return. Capture and submit on SARS eFiling. This sheet is not sent to the client.";

export type Itr14SectionId =
  | "taxpayer"
  | "profit"
  | "adjustments"
  | "it14sd"
  | "credits"
  | "queries"
  | "result";

export const ITR14_SECTIONS: ReadonlyArray<{
  id: Itr14SectionId;
  title: string;
  purpose: string;
}> = [
  {
    id: "taxpayer",
    title: "Taxpayer",
    purpose: "Who the company is, which class it is, and whether this year is final.",
  },
  {
    id: "profit",
    title: "Accounting profit",
    purpose: "Profit before tax for the year of assessment. A part-year sync is not annualised.",
  },
  {
    id: "adjustments",
    title: "Tax adjustments",
    purpose: "Items that make taxable income differ from accounting profit. A blank is not zero.",
  },
  {
    id: "it14sd",
    title: "IT14SD",
    purpose: "Supporting reconciliation. Account lines are not mapped from the books.",
  },
  {
    id: "credits",
    title: "Credits",
    purpose: "Provisional tax already paid. The books do not store a tax control account.",
  },
  {
    id: "queries",
    title: "Open queries",
    purpose: "Unresolved queries block Approve.",
  },
  {
    id: "result",
    title: "Result",
    purpose: "Taxable income and normal tax at 27% for a standard company, then the balance.",
  },
];

export type Itr14FieldId =
  | "registeredName"
  | "registrationNumber"
  | "taxReference"
  | "companyClass"
  | "yearOfAssessment"
  | "yearEnd"
  | "yearFinal"
  | "grossIncome"
  | "accountingProfit"
  | "depreciationAddBack"
  | "finesAddBack"
  | "wearAndTear"
  | "exemptDividends"
  | "assessedLossBroughtForward"
  | "otherAdjustmentsNet"
  | "taxableBeforeDonation"
  | "donation"
  | "donationLimit"
  | "donationAllowed"
  | "donationDisallowed"
  | "turnover"
  | "costOfSales"
  | "totalAssets"
  | "equity"
  | "liabilities"
  | "balanceSheetDifference"
  | "fixedAssets"
  | "accountTrialBalance"
  | "priorAssessment"
  | "provisionalPeriod1"
  | "provisionalPeriod2"
  | "provisionalTopUp"
  | "foreignTaxCredits"
  | "creditsTotal"
  | "openQueries"
  | "taxableIncome"
  | "normalTax"
  | "balance"
  | "assessedLossCarried";

export type Itr14Field = {
  id: Itr14FieldId;
  section: Itr14SectionId;
  label: string;
  /** No ITR14 eFiling guide is in docs/sars, so these names are not invented. */
  efiling: null;
  type: "text" | "tax-reference" | "year" | "date" | "class" | "yes-no" | "amount";
  required: boolean;
  source: Irp6SourceKind;
};

export const ITR14_FIELDS: readonly Itr14Field[] = [
  {
    id: "registeredName",
    section: "taxpayer",
    label: "Registered name",
    efiling: null,
    type: "text",
    required: true,
    source: "client",
  },
  {
    id: "registrationNumber",
    section: "taxpayer",
    label: "Company registration number",
    efiling: null,
    type: "text",
    required: true,
    source: "input",
  },
  {
    id: "taxReference",
    section: "taxpayer",
    label: "Income tax reference number",
    efiling: null,
    type: "tax-reference",
    required: true,
    source: "input",
  },
  {
    id: "companyClass",
    section: "taxpayer",
    label: "Company class",
    efiling: null,
    type: "class",
    required: true,
    source: "input",
  },
  {
    id: "yearOfAssessment",
    section: "taxpayer",
    label: "Year of assessment",
    efiling: null,
    type: "year",
    required: true,
    source: "client",
  },
  {
    id: "yearEnd",
    section: "taxpayer",
    label: "Year end",
    efiling: null,
    type: "date",
    required: true,
    source: "client",
  },
  {
    id: "yearFinal",
    section: "taxpayer",
    label: "Year marked final",
    efiling: null,
    type: "yes-no",
    required: true,
    source: "input",
  },
  {
    id: "grossIncome",
    section: "profit",
    label: "Gross income",
    efiling: null,
    type: "amount",
    required: false,
    source: "books",
  },
  {
    id: "accountingProfit",
    section: "profit",
    label: "Accounting profit",
    efiling: null,
    type: "amount",
    required: true,
    source: "books",
  },
  {
    id: "depreciationAddBack",
    section: "adjustments",
    label: "Depreciation add-back",
    efiling: null,
    type: "amount",
    required: true,
    source: "books",
  },
  {
    id: "finesAddBack",
    section: "adjustments",
    label: "Fines and penalties add-back",
    efiling: null,
    type: "amount",
    required: true,
    source: "input",
  },
  {
    id: "wearAndTear",
    section: "adjustments",
    label: "Wear-and-tear allowance",
    efiling: null,
    type: "amount",
    required: true,
    source: "input",
  },
  {
    id: "exemptDividends",
    section: "adjustments",
    label: "Exempt dividends",
    efiling: null,
    type: "amount",
    required: true,
    source: "input",
  },
  {
    id: "assessedLossBroughtForward",
    section: "adjustments",
    label: "Assessed loss brought forward",
    efiling: null,
    type: "amount",
    required: true,
    source: "input",
  },
  {
    id: "otherAdjustmentsNet",
    section: "adjustments",
    label: "Other adjustments, net",
    efiling: null,
    type: "amount",
    required: false,
    source: "worked",
  },
  {
    id: "taxableBeforeDonation",
    section: "adjustments",
    label: "Taxable income before the donation limit",
    efiling: null,
    type: "amount",
    required: true,
    source: "worked",
  },
  {
    id: "donation",
    section: "adjustments",
    label: "Donation",
    efiling: null,
    type: "amount",
    required: true,
    source: "input",
  },
  {
    id: "donationLimit",
    section: "adjustments",
    label: "Donation limit, 10%",
    efiling: null,
    type: "amount",
    required: false,
    source: "worked",
  },
  {
    id: "donationAllowed",
    section: "adjustments",
    label: "Donation allowed",
    efiling: null,
    type: "amount",
    required: false,
    source: "worked",
  },
  {
    id: "donationDisallowed",
    section: "adjustments",
    label: "Donation not allowed",
    efiling: null,
    type: "amount",
    required: false,
    source: "worked",
  },
  {
    id: "turnover",
    section: "it14sd",
    label: "Turnover",
    efiling: null,
    type: "amount",
    required: true,
    source: "books",
  },
  {
    id: "costOfSales",
    section: "it14sd",
    label: "Cost of sales",
    efiling: null,
    type: "amount",
    required: false,
    source: "books",
  },
  {
    id: "totalAssets",
    section: "it14sd",
    label: "Total assets",
    efiling: null,
    type: "amount",
    required: false,
    source: "books",
  },
  {
    id: "equity",
    section: "it14sd",
    label: "Equity",
    efiling: null,
    type: "amount",
    required: false,
    source: "books",
  },
  {
    id: "liabilities",
    section: "it14sd",
    label: "Liabilities",
    efiling: null,
    type: "amount",
    required: false,
    source: "books",
  },
  {
    id: "balanceSheetDifference",
    section: "it14sd",
    label: "Balance sheet difference",
    efiling: null,
    type: "amount",
    required: false,
    source: "worked",
  },
  {
    id: "fixedAssets",
    section: "it14sd",
    label: "Fixed assets, carrying amount",
    efiling: null,
    type: "amount",
    required: false,
    source: "books",
  },
  {
    id: "accountTrialBalance",
    section: "it14sd",
    label: "Account-level trial balance",
    efiling: null,
    type: "text",
    required: true,
    source: "books",
  },
  {
    id: "priorAssessment",
    section: "it14sd",
    label: "Prior assessed taxable income",
    efiling: null,
    type: "amount",
    required: true,
    source: "input",
  },
  {
    id: "provisionalPeriod1",
    section: "credits",
    label: "Provisional tax, period 1",
    efiling: null,
    type: "amount",
    required: true,
    source: "input",
  },
  {
    id: "provisionalPeriod2",
    section: "credits",
    label: "Provisional tax, period 2",
    efiling: null,
    type: "amount",
    required: true,
    source: "input",
  },
  {
    id: "provisionalTopUp",
    section: "credits",
    label: "Provisional tax, top-up",
    efiling: null,
    type: "amount",
    required: true,
    source: "input",
  },
  {
    id: "foreignTaxCredits",
    section: "credits",
    label: "Foreign tax credits",
    efiling: null,
    type: "amount",
    required: false,
    source: "nil",
  },
  {
    id: "creditsTotal",
    section: "credits",
    label: "Credits total",
    efiling: null,
    type: "amount",
    required: true,
    source: "worked",
  },
  {
    id: "openQueries",
    section: "queries",
    label: "Open queries",
    efiling: null,
    type: "text",
    required: false,
    source: "worked",
  },
  {
    id: "taxableIncome",
    section: "result",
    label: "Taxable income",
    efiling: null,
    type: "amount",
    required: true,
    source: "worked",
  },
  {
    id: "normalTax",
    section: "result",
    label: "Normal tax at 27%",
    efiling: null,
    type: "amount",
    required: true,
    source: "worked",
  },
  {
    id: "balance",
    section: "result",
    label: "Balance on this worksheet",
    efiling: null,
    type: "amount",
    required: true,
    source: "worked",
  },
  {
    id: "assessedLossCarried",
    section: "result",
    label: "Assessed loss carried forward",
    efiling: null,
    type: "amount",
    required: false,
    source: "worked",
  },
];

export type Itr14CompanyClass = "" | "standard" | "sbc" | "other";

export type Itr14Adjustment = {
  id: string;
  description: string;
  amountCents: number | null;
  direction: "add" | "deduct";
};

export type Itr14Query = {
  id: string;
  text: string;
  resolved: boolean;
};

export type Itr14Inputs = {
  taxReference: string;
  registrationNumber: string;
  companyClass: Itr14CompanyClass;
  yearFinal: boolean;
  accountingProfitCents: number | null;
  depreciationAddBackCents: number | null;
  finesAddBackCents: number | null;
  wearAndTearCents: number | null;
  exemptDividendsCents: number | null;
  assessedLossBroughtForwardCents: number | null;
  donationCents: number | null;
  priorAssessmentCents: number | null;
  adjustments: Itr14Adjustment[];
  provisionalPeriod1Cents: number | null;
  provisionalPeriod2Cents: number | null;
  provisionalTopUpCents: number | null;
  turnoverCents: number | null;
  costOfSalesCents: number | null;
  fixedAssetsCents: number | null;
  totalAssetsCents: number | null;
  equityCents: number | null;
  liabilitiesCents: number | null;
  accountTbAcknowledged: boolean;
  fixedAssetRegisterAcknowledged: boolean;
  balanceSheetAcknowledged: boolean;
  queries: Itr14Query[];
};

export function emptyItr14Inputs(): Itr14Inputs {
  return {
    taxReference: "",
    registrationNumber: "",
    companyClass: "",
    yearFinal: false,
    accountingProfitCents: null,
    depreciationAddBackCents: null,
    finesAddBackCents: null,
    wearAndTearCents: null,
    exemptDividendsCents: null,
    assessedLossBroughtForwardCents: null,
    donationCents: null,
    priorAssessmentCents: null,
    adjustments: [],
    provisionalPeriod1Cents: null,
    provisionalPeriod2Cents: null,
    provisionalTopUpCents: null,
    turnoverCents: null,
    costOfSalesCents: null,
    fixedAssetsCents: null,
    totalAssetsCents: null,
    equityCents: null,
    liabilitiesCents: null,
    accountTbAcknowledged: false,
    fixedAssetRegisterAcknowledged: false,
    balanceSheetAcknowledged: false,
    queries: [],
  };
}

export type Itr14ApproverRole = "owner" | "accountant";

export type Itr14Check = { id: string; level: "error" | "warning" | "ok"; text: string };

export type Itr14Line = {
  id: Itr14FieldId;
  section: Itr14SectionId;
  label: string;
  display: string;
  plain: string;
  source: Irp6SourceKind | "missing";
  sourceLabel: string;
  missing: boolean;
  note?: string;
};

export type Itr14Sheet = {
  yearOfAssessment: number;
  yearStart: string;
  yearEnd: string;
  statutoryDue: string;
  due: string;
  supported: boolean;
  yearFinal: boolean;
  companyClass: Itr14CompanyClass;
  booksCoverYear: boolean;
  booksMethod: string;
  lines: Itr14Line[];
  queries: Itr14Query[];
  missing: Itr14Line[];
  checks: Itr14Check[];
  rulesYear: number;
  taxableIncomeCents: number | null;
  taxCents: number | null;
  balanceCents: number | null;
  company: CompanyTaxResult | null;
};

export type Itr14Client = Irp6Client;

type Books = {
  coversYear: boolean;
  inYear: boolean;
  months: number;
  periodEnd: string | null;
  method: string;
  profitCents: number | null;
  revenueCents: number | null;
  cogsCents: number | null;
  depreciationCents: number | null;
  totalAssetsCents: number | null;
  equityCents: number | null;
  liabilitiesCents: number | null;
  fixedAssetsCents: number | null;
  hasAccountLines: boolean;
};

function finCents(fin: Record<string, unknown> | null, key: string): number | null {
  const raw = fin?.[key];
  if (raw == null || String(raw).trim() === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[\s,]/g, ""));
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function firstCents(fin: Record<string, unknown> | null, keys: readonly string[]): number | null {
  for (const key of keys) {
    const cents = finCents(fin, key);
    if (cents != null) return cents;
  }
  return null;
}

function isoDay(raw: unknown): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw == null ? "" : String(raw));
  return match ? match[1] : null;
}

function hasLines(fin: Record<string, unknown> | null, key: string): boolean {
  const value = fin?.[key];
  return Array.isArray(value) && value.length > 0;
}

/** Statement totals already on the client. No annualising, and no account map. */
export function itr14Books(client: Itr14Client, yearStart: string, yearEnd: string): Books {
  const fin = client.financials;
  const periodEnd = isoDay(fin?.periodEnd);
  const months = effectivePeriodMonths(fin, { fyStartMonth: client.fyStartMonth });
  const inYear = periodEnd != null && periodEnd >= yearStart && periodEnd <= yearEnd;
  const coversYear = inYear && months >= 12 && periodEnd === yearEnd;
  const profitCents = finCents(fin, "ebt");
  let method: string;
  if (profitCents == null) {
    method = "The books have no profit before tax. Type the full-year figure.";
  } else if (!periodEnd) {
    method = "The books have no period end, so the profit is not used for this return.";
  } else if (!inYear) {
    method = `The books run to ${formatSampleDate(periodEnd)}, outside this year. Type the full-year figure.`;
  } else if (!coversYear) {
    method = `The books cover ${months} month${months === 1 ? "" : "s"} to ${formatSampleDate(periodEnd)}. Type the full-year figure.`;
  } else {
    method = `The books cover the full year to ${formatSampleDate(periodEnd)}. Used as they are.`;
  }
  const use = coversYear;
  const current = finCents(fin, "currentLiabilities");
  const nonCurrent = finCents(fin, "nonCurrentLiabilities");
  const liabilities =
    firstCents(fin, ["totalLiabilities"]) ??
    (current != null && nonCurrent != null ? current + nonCurrent : null);
  return {
    coversYear,
    inYear,
    months,
    periodEnd,
    method,
    profitCents: use ? profitCents : null,
    revenueCents: use ? finCents(fin, "revenue") : null,
    cogsCents: use ? finCents(fin, "cogs") : null,
    depreciationCents: use ? firstCents(fin, ["depreciation", "depreciation_amortisation"]) : null,
    totalAssetsCents: use ? finCents(fin, "totalAssets") : null,
    equityCents: use ? finCents(fin, "equity") : null,
    liabilitiesCents: use ? liabilities : null,
    fixedAssetsCents: use ? firstCents(fin, ["fixedAssets", "fixed_assets", "ppe"]) : null,
    hasAccountLines:
      hasLines(fin, "accounts") ||
      hasLines(fin, "trialBalance") ||
      hasLines(fin, "chartOfAccounts"),
  };
}

export function itr14DefaultYear(today: string, fyStartMonth: number): number {
  const year = Number(today.slice(0, 4));
  if (!Number.isInteger(year)) throw new Error("today must be YYYY-MM-DD");
  for (const candidate of [year + 1, year, year - 1, year - 2]) {
    const end = irp6YearEnd(candidate, fyStartMonth);
    if (end <= today && irp6Supported(end)) return candidate;
  }
  return year;
}

export function itr14YearOptions(today: string, fyStartMonth: number): number[] {
  const pick = itr14DefaultYear(today, fyStartMonth);
  return [pick - 1, pick, pick + 1].filter((year) =>
    irp6Supported(irp6YearEnd(year, fyStartMonth)),
  );
}

export function itr14YearChoices(today: string, fyStartMonth: number, selected: number): number[] {
  return [...new Set([...itr14YearOptions(today, fyStartMonth), selected])].sort((a, b) => a - b);
}

export function itr14Due(yearEnd: string): { statutory: string; due: string } {
  const statutory = companyTaxDeadlines(yearEnd).find((row) => row.id === "itr14")!.due;
  return { statutory, due: lastWorkingDayOnOrBefore(statutory) };
}

export function itr14ClassLabel(value: Itr14CompanyClass): string {
  if (value === "standard") return "Standard company";
  if (value === "sbc") return "Small business corporation";
  if (value === "other") return "Other";
  return "";
}

function moneyText(cents: number | null): { display: string; plain: string } {
  if (cents == null) return { display: "", plain: "" };
  return { display: formatSampleCents(cents), plain: plainRands(cents) };
}

function sourceLabel(kind: Irp6SourceKind | "missing", asOf: string | null): string {
  if (kind === "books") {
    const day = isoDay(asOf);
    return day
      ? // date-ok: formatSampleDate prints the ZA calendar day
        `From books sync, as of ${formatSampleDate(day)}`
      : "From books sync";
  }
  if (kind === "client") return "From client record";
  if (kind === "input") return "Typed by the accountant";
  if (kind === "nil") return "Nil on this sheet";
  if (kind === "missing") return "Needs input";
  return "Worked out on this sheet";
}

function nonNegative(cents: number | null): boolean {
  return cents != null && cents >= 0;
}

export function computeItr14(input: {
  client: Itr14Client;
  yearOfAssessment: number;
  inputs: Itr14Inputs;
}): Itr14Sheet {
  const { client, yearOfAssessment, inputs } = input;
  const yearEnd = irp6YearEnd(yearOfAssessment, client.fyStartMonth);
  const yearStart = yearOfAssessmentStart(yearEnd);
  const supported = irp6Supported(yearEnd);
  const due = itr14Due(yearEnd);
  const books = itr14Books(client, yearStart, yearEnd);
  const standard = inputs.companyClass === "standard";

  const accountingProfitCents = books.profitCents ?? inputs.accountingProfitCents;
  const depreciationCents =
    inputs.depreciationAddBackCents != null
      ? inputs.depreciationAddBackCents
      : books.depreciationCents;
  const turnoverCents = inputs.turnoverCents != null ? inputs.turnoverCents : books.revenueCents;
  const costOfSalesCents =
    inputs.costOfSalesCents != null ? inputs.costOfSalesCents : books.cogsCents;
  const fixedAssetsCents =
    inputs.fixedAssetsCents != null ? inputs.fixedAssetsCents : books.fixedAssetsCents;

  const typedAssets = [inputs.totalAssetsCents, inputs.equityCents, inputs.liabilitiesCents];
  const anyTypedBs = typedAssets.some((cents) => cents != null);
  const allTypedBs = typedAssets.every((cents) => cents != null);
  const booksBs =
    books.totalAssetsCents != null && books.equityCents != null && books.liabilitiesCents != null;
  const totalAssetsCents = allTypedBs
    ? inputs.totalAssetsCents
    : booksBs && !anyTypedBs
      ? books.totalAssetsCents
      : null;
  const equityCents = allTypedBs
    ? inputs.equityCents
    : booksBs && !anyTypedBs
      ? books.equityCents
      : null;
  const liabilitiesCents = allTypedBs
    ? inputs.liabilitiesCents
    : booksBs && !anyTypedBs
      ? books.liabilitiesCents
      : null;
  const balanceSheetDifference =
    totalAssetsCents != null && equityCents != null && liabilitiesCents != null
      ? totalAssetsCents - equityCents - liabilitiesCents
      : null;

  let addedCents = 0;
  let deductedCents = 0;
  let otherComplete = true;
  inputs.adjustments.forEach((row) => {
    if (!row.description.trim() || row.amountCents == null) {
      otherComplete = false;
      return;
    }
    const amount = Math.abs(row.amountCents);
    if (row.direction === "add") addedCents += amount;
    else deductedCents += amount;
  });
  const otherNet = addedCents - deductedCents;
  const named = [
    depreciationCents,
    inputs.finesAddBackCents,
    inputs.wearAndTearCents,
    inputs.exemptDividendsCents,
    inputs.assessedLossBroughtForwardCents,
    inputs.donationCents,
  ];
  const namedReady = named.every(nonNegative);
  const canCompute =
    standard && supported && accountingProfitCents != null && namedReady && otherComplete;
  const company = canCompute
    ? computeCompanyTax({
        accountingProfitCents: accountingProfitCents! + otherNet,
        depreciationAddBackCents: depreciationCents!,
        finesAddBackCents: inputs.finesAddBackCents!,
        wearAndTearCents: inputs.wearAndTearCents!,
        exemptDividendsCents: inputs.exemptDividendsCents!,
        assessedLossBroughtForwardCents: inputs.assessedLossBroughtForwardCents!,
        donationCents: inputs.donationCents!,
        provisionalEstimateCents: 0,
      })
    : null;

  const creditsReady =
    nonNegative(inputs.provisionalPeriod1Cents) &&
    nonNegative(inputs.provisionalPeriod2Cents) &&
    nonNegative(inputs.provisionalTopUpCents);
  const creditsCents = creditsReady
    ? inputs.provisionalPeriod1Cents! +
      inputs.provisionalPeriod2Cents! +
      inputs.provisionalTopUpCents!
    : null;
  const taxCents = company?.taxCents ?? null;
  const balanceCents = taxCents != null && creditsCents != null ? taxCents - creditsCents : null;

  const queries: Itr14Query[] = [];
  if (!books.hasAccountLines && !inputs.accountTbAcknowledged) {
    queries.push({
      id: "gap-tb",
      text: "No account-level trial balance is on this file. Confirm you filled the adjustments without one.",
      resolved: false,
    });
  }
  if (fixedAssetsCents == null && !inputs.fixedAssetRegisterAcknowledged) {
    queries.push({
      id: "gap-assets",
      text: "No fixed asset register is on this file. Type the carrying amount, or confirm the wear-and-tear line is enough.",
      resolved: false,
    });
  }
  const bsTied = balanceSheetDifference === 0;
  const bsKnown = balanceSheetDifference != null;
  if ((anyTypedBs && !allTypedBs) || (!bsKnown && !inputs.balanceSheetAcknowledged)) {
    queries.push({
      id: "gap-bs",
      text:
        anyTypedBs && !allTypedBs
          ? "Type total assets, equity, and liabilities together, or clear them."
          : "Balance sheet totals are not on this file for this year. Type them, or confirm this sheet does not reconcile them.",
      resolved: false,
    });
  } else if (bsKnown && !bsTied && !inputs.balanceSheetAcknowledged) {
    queries.push({
      id: "gap-bs",
      text: `Assets minus equity minus liabilities is ${formatSampleCents(balanceSheetDifference!)}. Confirm the difference, or correct the totals.`,
      resolved: false,
    });
  }
  for (const query of inputs.queries) {
    if (!queries.some((row) => row.text === query.text)) queries.push(query);
  }

  const lines: Itr14Line[] = [];
  const push = (line: Itr14Line) => lines.push(line);
  const amount = (
    id: Itr14FieldId,
    section: Itr14SectionId,
    label: string,
    cents: number | null,
    source: Irp6SourceKind | "missing",
    required: boolean,
    note?: string,
  ) => {
    const text = moneyText(cents);
    const missing = required && cents == null;
    push({
      id,
      section,
      label,
      display: text.display,
      plain: text.plain,
      source: missing ? "missing" : source,
      sourceLabel: missing ? "Needs input" : sourceLabel(source, client.financialsAsOf),
      missing,
      note,
    });
  };

  const name = client.name.trim();
  push({
    id: "registeredName",
    section: "taxpayer",
    label: "Registered name",
    display: name,
    plain: name,
    source: name ? "client" : "missing",
    sourceLabel: name ? "From client record" : "Needs input",
    missing: !name,
  });
  const registration = inputs.registrationNumber.trim();
  push({
    id: "registrationNumber",
    section: "taxpayer",
    label: "Company registration number",
    display: registration,
    plain: registration,
    source: registration ? "input" : "missing",
    sourceLabel: registration ? "Typed by the accountant" : "Needs input",
    missing: !registration,
  });
  const reference = normaliseTaxReference(inputs.taxReference);
  const referenceValid = validTaxReference(reference);
  push({
    id: "taxReference",
    section: "taxpayer",
    label: "Income tax reference number",
    display: reference,
    plain: reference,
    source: reference ? "input" : "missing",
    sourceLabel: reference ? "Typed by the accountant" : "Needs input",
    missing: !referenceValid,
    note: reference && !referenceValid ? "Should be 10 digits." : undefined,
  });
  const classLabel = itr14ClassLabel(inputs.companyClass);
  push({
    id: "companyClass",
    section: "taxpayer",
    label: "Company class",
    display: classLabel,
    plain: classLabel,
    source: classLabel ? "input" : "missing",
    sourceLabel: classLabel ? "Typed by the accountant" : "Needs input",
    missing: inputs.companyClass !== "standard",
    note:
      inputs.companyClass === "sbc"
        ? "Small business corporation rates are not on this sheet."
        : inputs.companyClass === "other"
          ? "This sheet does not compute gold-mining or other special rates."
          : inputs.companyClass === ""
            ? "Confirm a standard company before tax is computed."
            : "27% applies to a standard company.",
  });
  push({
    id: "yearOfAssessment",
    section: "taxpayer",
    label: "Year of assessment",
    display: String(yearOfAssessment),
    plain: String(yearOfAssessment),
    source: "client",
    sourceLabel: "From the year end on the client",
    missing: false,
  });
  push({
    id: "yearEnd",
    section: "taxpayer",
    label: "Year end",
    display: formatSampleDate(yearEnd),
    plain: yearEnd,
    source: "client",
    sourceLabel: `${formatSampleDate(yearStart)} – ${formatSampleDate(yearEnd)}`,
    missing: !supported,
    note: supported ? undefined : "This sheet does not compute a year ending before 31 March 2023.",
  });
  push({
    id: "yearFinal",
    section: "taxpayer",
    label: "Year marked final",
    display: inputs.yearFinal ? "Final" : "Not final",
    plain: inputs.yearFinal ? "yes" : "no",
    source: inputs.yearFinal ? "input" : "missing",
    sourceLabel: inputs.yearFinal ? "Marked final by the accountant" : "Needs input",
    missing: !inputs.yearFinal,
    note: "Management accounts are not the return until you mark the year final.",
  });

  amount(
    "grossIncome",
    "profit",
    "Gross income",
    books.coversYear ? books.revenueCents : null,
    books.coversYear && books.revenueCents != null ? "books" : "missing",
    false,
    books.coversYear && books.revenueCents == null ? "Not on the books." : undefined,
  );
  amount(
    "accountingProfit",
    "profit",
    "Accounting profit",
    accountingProfitCents,
    books.coversYear && books.profitCents != null
      ? "books"
      : accountingProfitCents != null
        ? "input"
        : "missing",
    true,
    books.method,
  );

  amount(
    "depreciationAddBack",
    "adjustments",
    "Depreciation add-back",
    depreciationCents,
    inputs.depreciationAddBackCents != null
      ? "input"
      : books.depreciationCents != null
        ? "books"
        : "missing",
    true,
    books.depreciationCents == null
      ? "Depreciation is not stored on the books sync. Type the add-back, or nil."
      : inputs.depreciationAddBackCents != null
        ? "Typed over the books figure."
        : "From the books. Type a different figure if the tax add-back differs.",
  );
  amount(
    "finesAddBack",
    "adjustments",
    "Fines and penalties add-back",
    inputs.finesAddBackCents,
    inputs.finesAddBackCents != null ? "input" : "missing",
    true,
  );
  amount(
    "wearAndTear",
    "adjustments",
    "Wear-and-tear allowance",
    inputs.wearAndTearCents,
    inputs.wearAndTearCents != null ? "input" : "missing",
    true,
    "Not read from a fixed asset register.",
  );
  amount(
    "exemptDividends",
    "adjustments",
    "Exempt dividends",
    inputs.exemptDividendsCents,
    inputs.exemptDividendsCents != null ? "input" : "missing",
    true,
  );
  amount(
    "assessedLossBroughtForward",
    "adjustments",
    "Assessed loss brought forward",
    inputs.assessedLossBroughtForwardCents,
    inputs.assessedLossBroughtForwardCents != null ? "input" : "missing",
    true,
    "The loss SARS has agreed. Not taken from the books.",
  );
  amount(
    "otherAdjustmentsNet",
    "adjustments",
    "Other adjustments, net",
    otherComplete ? otherNet : null,
    "worked",
    false,
  );
  amount(
    "taxableBeforeDonation",
    "adjustments",
    "Taxable income before the donation limit",
    company?.taxableBeforeDonationCents ?? null,
    company ? "worked" : "missing",
    true,
  );
  amount(
    "donation",
    "adjustments",
    "Donation",
    inputs.donationCents,
    inputs.donationCents != null ? "input" : "missing",
    true,
    "Section 18A. The 10% limit is applied on this sheet.",
  );
  amount(
    "donationLimit",
    "adjustments",
    "Donation limit, 10%",
    company?.donationLimitCents ?? null,
    company ? "worked" : "missing",
    false,
  );
  amount(
    "donationAllowed",
    "adjustments",
    "Donation allowed",
    company?.donationAllowedCents ?? null,
    company ? "worked" : "missing",
    false,
  );
  amount(
    "donationDisallowed",
    "adjustments",
    "Donation not allowed",
    company?.donationDisallowedCents ?? null,
    company ? "worked" : "missing",
    false,
  );

  amount(
    "turnover",
    "it14sd",
    "Turnover",
    turnoverCents,
    inputs.turnoverCents != null ? "input" : turnoverCents != null ? "books" : "missing",
    true,
    "IT14SD turnover. A part-year sync is not used.",
  );
  amount(
    "costOfSales",
    "it14sd",
    "Cost of sales",
    costOfSalesCents,
    inputs.costOfSalesCents != null ? "input" : costOfSalesCents != null ? "books" : "missing",
    false,
    costOfSalesCents == null
      ? "Not on the books. Leaving this blank does not make it zero."
      : undefined,
  );
  const bsSource: Irp6SourceKind | "missing" = allTypedBs
    ? "input"
    : booksBs && !anyTypedBs
      ? "books"
      : "missing";
  amount("totalAssets", "it14sd", "Total assets", totalAssetsCents, bsSource, false);
  amount("equity", "it14sd", "Equity", equityCents, bsSource, false);
  amount("liabilities", "it14sd", "Liabilities", liabilitiesCents, bsSource, false);
  amount(
    "balanceSheetDifference",
    "it14sd",
    "Balance sheet difference",
    balanceSheetDifference,
    balanceSheetDifference != null ? "worked" : "missing",
    false,
    balanceSheetDifference == null
      ? "Assets, equity, and liabilities are not all on this year."
      : bsTied
        ? "Assets equal equity plus liabilities."
        : "Assets do not equal equity plus liabilities.",
  );
  amount(
    "fixedAssets",
    "it14sd",
    "Fixed assets, carrying amount",
    fixedAssetsCents,
    inputs.fixedAssetsCents != null ? "input" : fixedAssetsCents != null ? "books" : "missing",
    false,
    fixedAssetsCents == null ? "No fixed asset register is on the books sync." : undefined,
  );
  push({
    id: "accountTrialBalance",
    section: "it14sd",
    label: "Account-level trial balance",
    display: books.hasAccountLines
      ? "On file"
      : inputs.accountTbAcknowledged
        ? "Confirmed without one"
        : "",
    plain: books.hasAccountLines ? "on file" : inputs.accountTbAcknowledged ? "confirmed" : "",
    source: books.hasAccountLines ? "books" : inputs.accountTbAcknowledged ? "input" : "missing",
    sourceLabel: books.hasAccountLines
      ? "Account lines are on the file. This sheet does not map them to adjustments."
      : inputs.accountTbAcknowledged
        ? "Confirmed by the accountant"
        : "Needs input",
    missing: !books.hasAccountLines && !inputs.accountTbAcknowledged,
    note: "The tax plan's account-level read is not on this file.",
  });
  amount(
    "priorAssessment",
    "it14sd",
    "Prior assessed taxable income",
    inputs.priorAssessmentCents,
    inputs.priorAssessmentCents != null ? "input" : "missing",
    true,
    "From the latest assessment. This sheet does not add the 8% uplift.",
  );

  amount(
    "provisionalPeriod1",
    "credits",
    "Provisional tax, period 1",
    inputs.provisionalPeriod1Cents,
    inputs.provisionalPeriod1Cents != null ? "input" : "missing",
    true,
    "Not read from a tax control account.",
  );
  amount(
    "provisionalPeriod2",
    "credits",
    "Provisional tax, period 2",
    inputs.provisionalPeriod2Cents,
    inputs.provisionalPeriod2Cents != null ? "input" : "missing",
    true,
  );
  amount(
    "provisionalTopUp",
    "credits",
    "Provisional tax, top-up",
    inputs.provisionalTopUpCents,
    inputs.provisionalTopUpCents != null ? "input" : "missing",
    true,
    "Type nil when there was no third payment.",
  );
  amount(
    "foreignTaxCredits",
    "credits",
    "Foreign tax credits",
    0,
    "nil",
    false,
    "Foreign tax credits stay nil on this sheet.",
  );
  amount(
    "creditsTotal",
    "credits",
    "Credits total",
    creditsCents,
    creditsCents != null ? "worked" : "missing",
    true,
  );

  const open = queries.filter((query) => !query.resolved);
  push({
    id: "openQueries",
    section: "queries",
    label: "Open queries",
    display: open.length === 0 ? "None" : String(open.length),
    plain: String(open.length),
    source: "worked",
    sourceLabel: open.length === 0 ? "None open" : "Unresolved queries block Approve",
    missing: false,
  });

  const taxNote = !standard
    ? inputs.companyClass === "sbc"
      ? "Not computed. Small business corporation rates are not on this sheet."
      : "Not computed until the company is confirmed as standard."
    : !supported
      ? "Not computed. This year is before the 27% table."
      : company
        ? "27% of taxable income."
        : "Not computed until the profit and adjustments are filled.";
  push({
    id: "taxableIncome",
    section: "result",
    label: "Taxable income",
    display: company ? formatSampleCents(company.taxableIncomeCents) : "Not computed",
    plain: company ? plainRands(company.taxableIncomeCents) : "Not computed",
    source: company ? "worked" : "missing",
    sourceLabel: company ? "Worked out on this sheet" : "Not computed on this sheet",
    missing: !company,
    note: taxNote,
  });
  push({
    id: "normalTax",
    section: "result",
    label: company ? "Normal tax at 27%" : "Normal tax",
    display: taxCents != null ? formatSampleCents(taxCents) : "Not computed",
    plain: taxCents != null ? plainRands(taxCents) : "Not computed",
    source: taxCents != null ? "worked" : "missing",
    sourceLabel: taxCents != null ? "Worked out on this sheet" : "Not computed on this sheet",
    missing: taxCents == null,
    note: taxNote,
  });
  push({
    id: "balance",
    section: "result",
    label: "Balance on this worksheet",
    display: balanceCents != null ? formatSampleCents(balanceCents) : "Not computed",
    plain: balanceCents != null ? plainRands(balanceCents) : "Not computed",
    source: balanceCents != null ? "worked" : "missing",
    sourceLabel: balanceCents != null ? "Worked out on this sheet" : "Not computed on this sheet",
    missing: balanceCents == null,
    note: "Not an assessment. Nothing has been submitted.",
  });
  amount(
    "assessedLossCarried",
    "result",
    "Assessed loss carried forward",
    company?.assessedLossCarriedCents ?? null,
    company ? "worked" : "missing",
    false,
  );

  const checks: Itr14Check[] = [];
  if (!inputs.yearFinal) {
    checks.push({
      id: "year-final",
      level: "error",
      text: "Mark the year final before you approve. Management accounts are not the return.",
    });
  }
  if (inputs.companyClass === "sbc") {
    checks.push({
      id: "class",
      level: "error",
      text: "This sheet computes 27% for a standard company. Small business corporation rates are not on this sheet.",
    });
  } else if (inputs.companyClass === "other") {
    checks.push({
      id: "class",
      level: "error",
      text: "This sheet does not compute gold-mining or other special rates.",
    });
  } else if (inputs.companyClass !== "standard") {
    checks.push({
      id: "class",
      level: "error",
      text: "Confirm the company class. Tax at 27% is only for a standard company.",
    });
  }
  if (!supported) {
    checks.push({
      id: "supported",
      level: "error",
      text: "This sheet covers years of assessment ending on or after 31 March 2023. It does not compute 28%.",
    });
  }
  if (reference && !referenceValid) {
    checks.push({
      id: "tax-reference",
      level: "error",
      text: "The income tax reference number should be 10 digits.",
    });
  }
  if (books.profitCents == null && books.periodEnd && !books.coversYear) {
    checks.push({ id: "books-period", level: "warning", text: books.method });
  } else if (!books.coversYear && isoDay(client.financials?.periodEnd)) {
    checks.push({ id: "books-period", level: "warning", text: books.method });
  }
  inputs.adjustments.forEach((row, index) => {
    if (!row.description.trim() || row.amountCents == null) {
      checks.push({
        id: `adjustment-${row.id}`,
        level: "error",
        text: `Adjustment ${index + 1} needs a description and an amount.`,
      });
    }
  });
  if (anyTypedBs && !allTypedBs) {
    checks.push({
      id: "balance-sheet",
      level: "error",
      text: "Type total assets, equity, and liabilities together.",
    });
  }
  for (const [id, cents] of [
    ["depreciation", depreciationCents],
    ["fines", inputs.finesAddBackCents],
    ["wear", inputs.wearAndTearCents],
    ["dividends", inputs.exemptDividendsCents],
    ["loss", inputs.assessedLossBroughtForwardCents],
    ["donation", inputs.donationCents],
  ] as const) {
    if (cents != null && cents < 0) {
      checks.push({
        id: `negative-${id}`,
        level: "error",
        text: "An adjustment cannot be negative.",
      });
    }
  }
  if (company && accountingProfitCents != null && depreciationCents != null) {
    const before =
      accountingProfitCents +
      depreciationCents +
      inputs.finesAddBackCents! +
      otherNet -
      inputs.wearAndTearCents! -
      inputs.exemptDividendsCents! -
      inputs.assessedLossBroughtForwardCents!;
    checks.push({
      id: "adds-up",
      level: before === company.taxableBeforeDonationCents ? "ok" : "error",
      text: `${formatSampleCents(accountingProfitCents)} profit, adjustments applied, is ${formatSampleCents(company.taxableBeforeDonationCents)} before the donation limit.`,
    });
    if (company.taxCents !== taxAtCompanyRate(company.taxableIncomeCents)) {
      checks.push({ id: "rate", level: "error", text: "The tax is not 27% of taxable income." });
    }
  }
  if (balanceCents != null && balanceCents < 0) {
    checks.push({
      id: "credits",
      level: "warning",
      text: `Credits are ${formatSampleCents(-balanceCents)} more than the tax on this worksheet.`,
    });
  }

  return {
    yearOfAssessment,
    yearStart,
    yearEnd,
    statutoryDue: due.statutory,
    due: due.due,
    supported,
    yearFinal: inputs.yearFinal,
    companyClass: inputs.companyClass,
    booksCoverYear: books.coversYear,
    booksMethod: books.method,
    lines,
    queries,
    missing: lines.filter((line) => line.missing),
    checks,
    rulesYear: ITR14_RULES_YEAR,
    taxableIncomeCents: company?.taxableIncomeCents ?? null,
    taxCents,
    balanceCents,
    company,
  };
}

export function itr14OpenQueries(sheet: Itr14Sheet): Itr14Query[] {
  return sheet.queries.filter((query) => !query.resolved);
}

export function itr14ApproveBlock(input: {
  role: Itr14ApproverRole;
  section: Itr14SectionId;
  sheet: Itr14Sheet;
}): string | null {
  if (input.role === "owner") return "The owner cannot approve a section.";
  if (!input.sheet.yearFinal) return "Mark the year final before you approve a section.";
  if (itr14OpenQueries(input.sheet).length > 0) return "Resolve the open queries first.";
  if (input.sheet.companyClass !== "standard") {
    return "Confirm a standard company. This sheet does not compute another class.";
  }
  if (!input.sheet.supported && (input.section === "taxpayer" || input.section === "result")) {
    return "This year is before the 27% table.";
  }
  if (input.sheet.missing.some((line) => line.section === input.section))
    return "Fill this section first.";
  if (
    input.section === "taxpayer" &&
    input.sheet.checks.some((check) => check.id === "tax-reference")
  ) {
    return "Fix the reference number first.";
  }
  if (
    input.section === "adjustments" &&
    input.sheet.checks.some(
      (check) => check.id.startsWith("adjustment-") || check.id.startsWith("negative-"),
    )
  ) {
    return "Finish the adjustments first.";
  }
  if (input.sheet.checks.some((check) => check.level === "error" && check.id === "rate")) {
    return "The tax figure does not match 27%.";
  }
  return null;
}

export function itr14CanDownload(
  sheet: Itr14Sheet,
  approvals: Partial<Record<Itr14SectionId, boolean>>,
  role: Itr14ApproverRole,
): boolean {
  if (role === "owner") return false;
  if (!sheet.yearFinal || sheet.companyClass !== "standard" || !sheet.supported) return false;
  if (sheet.missing.length > 0) return false;
  if (sheet.checks.some((check) => check.level === "error")) return false;
  if (itr14OpenQueries(sheet).length > 0) return false;
  return ITR14_SECTIONS.every((section) => approvals[section.id]);
}

export function itr14MissingSentence(count: number): string {
  if (count === 0) return "";
  return count === 1
    ? "1 field still needs a figure or a confirmation before you can download."
    : `${count} fields still need a figure or a confirmation before you can download.`;
}

function isAdjustment(value: unknown): value is Itr14Adjustment {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Itr14Adjustment>;
  return typeof row.id === "string" && (row.direction === "add" || row.direction === "deduct");
}

function isQuery(value: unknown): value is Itr14Query {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Itr14Query>;
  return (
    typeof row.id === "string" && typeof row.text === "string" && typeof row.resolved === "boolean"
  );
}

function isClass(value: unknown): value is Itr14CompanyClass {
  return value === "" || value === "standard" || value === "sbc" || value === "other";
}

function isInputs(value: unknown): value is Itr14Inputs {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Itr14Inputs>;
  return (
    typeof row.taxReference === "string" &&
    Array.isArray(row.adjustments) &&
    Array.isArray(row.queries)
  );
}

export function itr14DraftFields(
  sheet: Itr14Sheet,
  inputs: Itr14Inputs,
): Record<string, TaxFormDraftField> {
  const out: Record<string, TaxFormDraftField> = {};
  for (const line of sheet.lines) {
    const source: TaxFormDraftField["source"] =
      line.source === "books"
        ? "books"
        : line.source === "client"
          ? "client"
          : line.source === "nil"
            ? "nil"
            : line.source === "worked"
              ? "worked"
              : "input";
    out[line.id] = { value: line.plain, source };
  }
  out.adjustments = { value: inputs.adjustments, source: "input" };
  out.queries = { value: inputs.queries, source: "input" };
  out.typed = { value: [inputs] as unknown as unknown[], source: "input" };
  return out;
}

function centsOf(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

export function itr14InputsFromDraft(draft: TaxFormDraft | null | undefined): Itr14Inputs {
  if (!draft) return emptyItr14Inputs();
  const typed = draft.fields.typed?.value;
  const stored = Array.isArray(typed) ? (typed as unknown[]).find(isInputs) : undefined;
  if (!stored) return emptyItr14Inputs();
  return {
    ...emptyItr14Inputs(),
    taxReference: stored.taxReference,
    registrationNumber:
      typeof stored.registrationNumber === "string" ? stored.registrationNumber : "",
    companyClass: isClass(stored.companyClass) ? stored.companyClass : "",
    yearFinal: stored.yearFinal === true,
    accountingProfitCents: centsOf(stored.accountingProfitCents),
    depreciationAddBackCents: centsOf(stored.depreciationAddBackCents),
    finesAddBackCents: centsOf(stored.finesAddBackCents),
    wearAndTearCents: centsOf(stored.wearAndTearCents),
    exemptDividendsCents: centsOf(stored.exemptDividendsCents),
    assessedLossBroughtForwardCents: centsOf(stored.assessedLossBroughtForwardCents),
    donationCents: centsOf(stored.donationCents),
    priorAssessmentCents: centsOf(stored.priorAssessmentCents),
    adjustments: stored.adjustments.filter(isAdjustment).map((row) => ({
      ...row,
      description: typeof row.description === "string" ? row.description : "",
      amountCents: centsOf(row.amountCents),
    })),
    provisionalPeriod1Cents: centsOf(stored.provisionalPeriod1Cents),
    provisionalPeriod2Cents: centsOf(stored.provisionalPeriod2Cents),
    provisionalTopUpCents: centsOf(stored.provisionalTopUpCents),
    turnoverCents: centsOf(stored.turnoverCents),
    costOfSalesCents: centsOf(stored.costOfSalesCents),
    fixedAssetsCents: centsOf(stored.fixedAssetsCents),
    totalAssetsCents: centsOf(stored.totalAssetsCents),
    equityCents: centsOf(stored.equityCents),
    liabilitiesCents: centsOf(stored.liabilitiesCents),
    accountTbAcknowledged: stored.accountTbAcknowledged === true,
    fixedAssetRegisterAcknowledged: stored.fixedAssetRegisterAcknowledged === true,
    balanceSheetAcknowledged: stored.balanceSheetAcknowledged === true,
    queries: stored.queries.filter(isQuery),
  };
}

export function findItr14Draft(
  drafts: readonly TaxFormDraft[],
  yearOfAssessment: number,
): TaxFormDraft | undefined {
  return drafts
    .filter(
      (row) =>
        row.superseded_by == null &&
        row.form_code === "ITR14" &&
        row.tax_year === yearOfAssessment &&
        row.period == null &&
        (row.subject ?? null) == null,
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

export function itr14FileName(
  clientName: string,
  yearOfAssessment: number,
  ext: "pdf" | "csv",
): string {
  return `ITR14_${fileSafe(clientName)}_${yearOfAssessment}.${ext}`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Capture sheet for the accountant. Amounts stay blank when they were not supplied. */
export function itr14Csv(sheet: Itr14Sheet): string {
  const rows: string[][] = [["Field", "Value", "Source", "Note"]];
  for (const line of sheet.lines) {
    rows.push([line.label, line.plain, line.sourceLabel, line.note ?? ""]);
  }
  for (const query of sheet.queries) {
    rows.push([
      query.resolved ? "Query, resolved" : "Query, open",
      query.text,
      query.resolved ? "Resolved by the accountant" : "Open",
      "",
    ]);
  }
  rows.push(["Due date", sheet.due, "", ""]);
  rows.push(["Notice", ITR14_FOOTER, "", ""]);
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}
