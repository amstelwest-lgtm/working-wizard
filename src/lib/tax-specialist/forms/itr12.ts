/**
 * ITR12 preparation sheet for a South African individual / sole practitioner.
 *
 * Figures come from a cited tax pack or from the accountant. Totals are
 * sums of those figures. Tax payable, the medical tax credit, the
 * retirement-annuity cap, and the local-interest exemption are not
 * computed: those tables are not signed off in docs/sars, and this sheet
 * must not invent them. The accountant captures on eFiling.
 *
 * Milōn does not log into SARS, does not submit, and does not email the
 * sheet to the client.
 */
import { SEND_ITEM_LABELS, type SendItemKey } from "@/lib/client-agent-send";
import {
  TAX_PACK_FILE_MARK,
  type CitedFigure,
  type TaxPackDraft,
  type TaxPackSourceFile,
} from "@/lib/tax-deliverable";
import { formatSampleCents, formatSampleDate } from "../sample-compute.ts";
import type { TaxFormDraft, TaxFormDraftField } from "./drafts.ts";
import {
  normaliseTaxReference,
  parseRandsToCents,
  plainRands,
  validTaxReference,
} from "./irp6.ts";

/**
 * Capture-sheet vintage. Section totals are sums of cited figures.
 * Not a personal-income-tax rate table.
 */
export const ITR12_RULES_YEAR = 2026;

export const ITR12_FOOTER =
  "Prepared by Milōn for checking. Not a SARS return. Capture and submit on SARS eFiling. This sheet is not sent to the client.";

export type Itr12SectionId =
  | "taxpayer"
  | "income"
  | "deductions"
  | "medical"
  | "ra"
  | "travel"
  | "interest"
  | "queries"
  | "result";

export const ITR12_SECTIONS: ReadonlyArray<{
  id: Itr12SectionId;
  title: string;
  purpose: string;
}> = [
  {
    id: "taxpayer",
    title: "Taxpayer",
    purpose: "Who the return is for and which year of assessment it covers.",
  },
  {
    id: "income",
    title: "Income",
    purpose: "Employment income and practice income. Each figure cites a file or is typed by you.",
  },
  {
    id: "deductions",
    title: "Deductions",
    purpose: "Practice expenses. Each figure cites a file or is typed by you.",
  },
  {
    id: "medical",
    title: "Medical",
    purpose: "Medical scheme contributions as cited. The medical tax credit is not computed here.",
  },
  {
    id: "ra",
    title: "Retirement annuity",
    purpose: "Retirement annuity contributions as cited. The deduction limit is not computed here.",
  },
  {
    id: "travel",
    title: "Travel",
    purpose: "Travel from the logbook. A blank is not zero.",
  },
  {
    id: "interest",
    title: "Local interest",
    purpose: "Local interest from an IT3(b). The interest exemption is not applied here.",
  },
  {
    id: "queries",
    title: "Open queries",
    purpose: "Unresolved queries block Approve.",
  },
  {
    id: "result",
    title: "Result",
    purpose: "Section totals from the cited figures. Tax payable is not computed.",
  },
];

export type Itr12MoneyFieldId =
  | "employmentIncome"
  | "practiceIncome"
  | "practiceExpenses"
  | "medicalContributions"
  | "raContributions"
  | "travelClaim"
  | "localInterest";

export type Itr12FieldId =
  | "fullName"
  | "taxReference"
  | "yearOfAssessment"
  | Itr12MoneyFieldId
  | "incomeTotal"
  | "openQueries"
  | "taxPayable";

type Itr12Intake =
  | { from: "client-record" }
  | { from: "accountant" }
  | { from: "worked" }
  | { from: "checklist"; itemKey: string };

export type Itr12CatalogField = {
  id: Itr12FieldId;
  section: Itr12SectionId;
  label: string;
  efiling: null;
  type: "text" | "tax-reference" | "year" | "amount";
  required: boolean;
  source: "client" | "input" | "file" | "worked";
  intake: Itr12Intake;
};

const MONEY: ReadonlyArray<{
  id: Itr12MoneyFieldId;
  section: Itr12SectionId;
  label: string;
  itemKey: SendItemKey;
  note: string;
}> = [
  {
    id: "employmentIncome",
    section: "income",
    label: "Employment income",
    itemKey: "irp5",
    note: "From the IRP5. A person with no salaried job needs you to type nil.",
  },
  {
    id: "practiceIncome",
    section: "income",
    label: "Practice income",
    itemKey: "practice_income_expenses",
    note: "Turnover and other practice income cited from the practice documents.",
  },
  {
    id: "practiceExpenses",
    section: "deductions",
    label: "Practice expenses",
    itemKey: "practice_income_expenses",
    note: "Practice expenses cited from the practice documents.",
  },
  {
    id: "medicalContributions",
    section: "medical",
    label: "Medical scheme contributions",
    itemKey: "medical_aid_certificate",
    note: "Certificate total only. The medical tax credit is not computed on this sheet.",
  },
  {
    id: "raContributions",
    section: "ra",
    label: "Retirement annuity contributions",
    itemKey: "ra_contribution_certificate",
    note: "Certificate total only. The deduction limit is not computed on this sheet.",
  },
  {
    id: "travelClaim",
    section: "travel",
    label: "Travel",
    itemKey: "travel_logbook",
    note: "From the travel logbook. Leave this blank until a file or you supply the figure.",
  },
  {
    id: "localInterest",
    section: "interest",
    label: "Local interest",
    itemKey: "it3b",
    note: "From the IT3(b). The interest exemption is not applied on this sheet.",
  },
];

export const ITR12_MONEY_FIELDS = MONEY;

export function itr12MoneyField(id: Itr12MoneyFieldId) {
  const field = MONEY.find((row) => row.id === id);
  if (!field) throw new Error(`Unknown ITR12 amount ${id}.`);
  return field;
}

export const ITR12_FIELDS: readonly Itr12CatalogField[] = [
  {
    id: "fullName",
    section: "taxpayer",
    label: "Full name",
    efiling: null,
    type: "text",
    required: true,
    source: "client",
    intake: { from: "client-record" },
  },
  {
    id: "taxReference",
    section: "taxpayer",
    label: "Income tax reference number",
    efiling: null,
    type: "tax-reference",
    required: true,
    source: "input",
    intake: { from: "accountant" },
  },
  {
    id: "yearOfAssessment",
    section: "taxpayer",
    label: "Year of assessment",
    efiling: null,
    type: "year",
    required: true,
    source: "client",
    intake: { from: "client-record" },
  },
  ...MONEY.map(
    (field): Itr12CatalogField => ({
      id: field.id,
      section: field.section,
      label: field.label,
      efiling: null,
      type: "amount",
      required: true,
      source: "file",
      intake: { from: "checklist", itemKey: field.itemKey },
    }),
  ),
  {
    id: "incomeTotal",
    section: "result",
    label: "Income total",
    efiling: null,
    type: "amount",
    required: true,
    source: "worked",
    intake: { from: "worked" },
  },
  {
    id: "openQueries",
    section: "queries",
    label: "Open queries",
    efiling: null,
    type: "text",
    required: false,
    source: "worked",
    intake: { from: "worked" },
  },
  {
    id: "taxPayable",
    section: "result",
    label: "Tax payable",
    efiling: null,
    type: "text",
    required: false,
    source: "worked",
    intake: { from: "worked" },
  },
];

export type Itr12Cited = {
  id: string;
  fieldId: Itr12MoneyFieldId;
  label: string;
  /** Null while the accountant has not typed a figure yet. */
  amountCents: number | null;
  fileId: string | null;
  source: "file" | "accountant";
  note: string | null;
};

export type Itr12Query = {
  id: string;
  text: string;
  resolved: boolean;
};

export type Itr12Inputs = {
  taxReference: string;
  lines: Itr12Cited[];
  queries: Itr12Query[];
};

export type Itr12ApproverRole = "owner" | "accountant";

export type Itr12Check = { id: string; level: "error" | "warning"; text: string };

export type Itr12SheetLine = {
  id: string;
  section: Itr12SectionId;
  label: string;
  display: string;
  plain: string;
  source: "client" | "input" | "file" | "accountant" | "worked" | "missing";
  sourceLabel: string;
  fileId: string | null;
  missing: boolean;
  note?: string;
};

export type Itr12Sheet = {
  yearOfAssessment: number;
  yearStart: string;
  yearEnd: string;
  rulesYear: number;
  lines: Itr12SheetLine[];
  cited: Itr12Cited[];
  queries: Itr12Query[];
  missing: Itr12SheetLine[];
  checks: Itr12Check[];
  totals: Record<Itr12MoneyFieldId, number | null> & { incomeTotal: number | null };
};

const EMPLOYMENT = /irp5|employment|salary|remuneration|\b3601\b|\b3651\b|\b3701\b/;
const INTEREST = /it3\(b\)|it3b|local interest|interest received|interest income/;
const TRAVEL = /travel|logbook|kilometre|kilometer/;
const MEDICAL = /medical/;
const RA = /retirement|annuity/;
const EXPENSE = /expense|deduction/;

/** Today in South Africa is passed in. March starts the next year of assessment. */
export function itr12YearOfAssessment(today: string): number {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(today);
  if (!match) throw new Error("today must be YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month >= 3 ? year + 1 : year;
}

export function itr12YearEnd(year: number): string {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return `${year}-02-${leap ? "29" : "28"}`;
}

export function itr12YearStart(year: number): string {
  return `${year - 1}-03-01`;
}

export function itr12YearOptions(today: string): number[] {
  const current = itr12YearOfAssessment(today);
  return [current - 2, current - 1, current, current + 1];
}

export function itr12YearChoices(today: string, selected: number): number[] {
  return [...new Set([...itr12YearOptions(today), selected])].sort((a, b) => a - b);
}

/** A label such as "2026 year of assessment" on a tax pack. */
export function itr12YearFromLabel(text: string | null | undefined): number | null {
  if (!text) return null;
  const leading = text.match(/\b(20\d{2})\s+year of assessment/i);
  if (leading) return Number(leading[1]);
  const trailing = text.match(/year of assessment[^\d]{0,16}(20\d{2})/i);
  return trailing ? Number(trailing[1]) : null;
}

export function emptyItr12Inputs(): Itr12Inputs {
  return { taxReference: "", lines: [], queries: intakeGapQueries(new Set<string>()) };
}

function itemForField(id: Itr12MoneyFieldId): SendItemKey {
  return itr12MoneyField(id).itemKey;
}

const ITEM_NEEDLE: Record<string, RegExp> = {
  irp5: /irp5|employment|salar/,
  it3b: /it3|\binterest\b/,
  medical_aid_certificate: /medical/,
  ra_contribution_certificate: /retirement|annuity/,
  travel_logbook: /travel|logbook/,
  practice_income_expenses: /practice|expense|turnover/,
};

function addIntakeGaps(queries: Itr12Query[], lines: readonly Itr12Cited[]): void {
  for (const gap of intakeGapQueries(coveredItems(lines))) {
    const item = gap.id.slice("missing-".length);
    const needle = ITEM_NEEDLE[item];
    if (needle && queries.some((query) => needle.test(query.text.toLowerCase()))) continue;
    pushQuery(queries, gap.text, gap.id);
  }
}

function intakeGapQueries(covered: ReadonlySet<string>): Itr12Query[] {
  const items = [
    "irp5",
    "it3b",
    "medical_aid_certificate",
    "ra_contribution_certificate",
    "travel_logbook",
    "practice_income_expenses",
  ] as const satisfies readonly SendItemKey[];
  return items
    .filter((item) => !covered.has(item))
    .map((item) => ({
      id: `missing-${item}`,
      text: `${SEND_ITEM_LABELS[item]} was not in the tax pack. Cite the file or type the amount.`,
      resolved: false,
    }));
}

function coveredItems(lines: readonly Itr12Cited[]): Set<string> {
  const covered = new Set<string>();
  for (const line of lines) {
    if (line.amountCents == null) continue;
    if (line.source === "file" && !line.fileId?.trim()) continue;
    covered.add(itemForField(line.fieldId));
  }
  return covered;
}

function pushQuery(queries: Itr12Query[], text: string, id: string): void {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || queries.some((query) => query.text === clean)) return;
  queries.push({ id, text: clean, resolved: false });
}

export function itr12Bucket(
  label: string,
  itemKey: string | null,
  section: "income" | "expenses" | "medical" | "ra" | "worksheet",
): Itr12MoneyFieldId | null {
  const text = `${label} ${itemKey ?? ""}`.toLowerCase();
  if (section === "expenses") return "practiceExpenses";
  if (section === "medical") return "medicalContributions";
  if (section === "ra") return "raContributions";
  if (section === "income") {
    if (EMPLOYMENT.test(text) || itemKey === "irp5") return "employmentIncome";
    return "practiceIncome";
  }
  if (TRAVEL.test(text) || itemKey === "travel_logbook") return "travelClaim";
  if (INTEREST.test(text) || itemKey === "it3b") return "localInterest";
  if (MEDICAL.test(text) || itemKey === "medical_aid_certificate") return "medicalContributions";
  if (RA.test(text) || itemKey === "ra_contribution_certificate") return "raContributions";
  if (EXPENSE.test(text)) return "practiceExpenses";
  if (EMPLOYMENT.test(text) || itemKey === "irp5") return "employmentIncome";
  if (/income|turnover|practice/.test(text) || itemKey === "practice_income_expenses")
    return "practiceIncome";
  return null;
}

function lineFromFigure(
  figure: CitedFigure,
  fieldId: Itr12MoneyFieldId,
  index: number,
  files: ReadonlySet<string> | null,
  queries: Itr12Query[],
): Itr12Cited | null {
  const fileId = figure.fileId.trim();
  if (!fileId || (files && !files.has(fileId))) {
    pushQuery(
      queries,
      `${figure.label}: the figure could not be traced to a sent file, so it was left out.`,
      `drop-${fieldId}-${index}`,
    );
    return null;
  }
  if (figure.confidence === "uncertain") {
    pushQuery(
      queries,
      `Confirm ${figure.label} (${formatSampleCents(figure.amountCents)}) against file ${fileId}.`,
      `check-${fieldId}-${index}`,
    );
  }
  return {
    id: `pack-${fieldId}-${index}`,
    fieldId,
    label: figure.label,
    amountCents: figure.amountCents,
    fileId,
    source: "file",
    note: figure.note,
  };
}

function takeFigures(
  figures: readonly CitedFigure[],
  section: "income" | "expenses" | "medical" | "ra" | "worksheet",
  filesById: ReadonlyMap<string, TaxPackSourceFile>,
  queries: Itr12Query[],
  lines: Itr12Cited[],
): void {
  figures.forEach((figure, index) => {
    const itemKey = filesById.get(figure.fileId)?.itemKey ?? null;
    const fieldId = itr12Bucket(figure.label, itemKey, section);
    if (!fieldId) {
      pushQuery(
        queries,
        `${figure.label}: this worksheet line could not be placed on the ITR12 draft, so the amount was left out.`,
        `place-${index}`,
      );
      return;
    }
    const line = lineFromFigure(figure, fieldId, lines.length + index, new Set(filesById.keys()), queries);
    if (line) lines.push(line);
  });
}

/** Promote a structured #815 tax pack. Amounts without a known file id are queries. */
export function itr12FromTaxPack(
  draft: TaxPackDraft,
  files: readonly TaxPackSourceFile[],
): { year: number | null; inputs: Itr12Inputs } {
  const filesById = new Map(files.map((file) => [file.fileId, file]));
  const queries: Itr12Query[] = [];
  const lines: Itr12Cited[] = [];
  takeFigures(draft.income, "income", filesById, queries, lines);
  takeFigures(draft.expenses, "expenses", filesById, queries, lines);
  takeFigures(draft.medicalAid, "medical", filesById, queries, lines);
  takeFigures(draft.retirementAnnuity, "ra", filesById, queries, lines);
  takeFigures(draft.worksheet, "worksheet", filesById, queries, lines);
  draft.queries.forEach((text, index) => pushQuery(queries, text, `pack-q-${index}`));
  addIntakeGaps(queries, lines);
  return {
    year: itr12YearFromLabel(draft.periodLabel),
    inputs: { taxReference: "", lines, queries },
  };
}

const FIGURE_LINE = /^- (.+): (-?R [\d\u00a0 ]+\.\d{2})(?: \(check\))? — source: (.+)$/;

function splitSource(tail: string): { fileId: string | null; note: string | null } {
  const noteAt = tail.indexOf(" Note: ");
  const main = (noteAt >= 0 ? tail.slice(0, noteAt) : tail).trim();
  const note = noteAt >= 0 ? tail.slice(noteAt + " Note: ".length).trim() : null;
  const mark = main.lastIndexOf(TAX_PACK_FILE_MARK);
  if (mark < 0) return { fileId: null, note };
  const fileId = main
    .slice(mark + TAX_PACK_FILE_MARK.length)
    .replace(/\.$/, "")
    .trim();
  return { fileId: fileId || null, note: note || null };
}

/**
 * Read a saved tax-pack body. A figure without a file id becomes a query
 * and is not copied onto the draft.
 */
export function itr12FromTaxPackBody(
  body: string,
): { year: number | null; inputs: Itr12Inputs } | null {
  if (!body.includes("DRAFT tax pack")) return null;
  const queries: Itr12Query[] = [];
  const lines: Itr12Cited[] = [];
  let section: "practice" | "medical" | "worksheet" | "queries" | null = null;
  let practice: "income" | "expenses" = "income";
  let medical: "medical" | "ra" = "medical";
  let figureIndex = 0;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("1. Practice")) {
      section = "practice";
      practice = "income";
      continue;
    }
    if (line.startsWith("2. Medical")) {
      section = "medical";
      medical = "medical";
      continue;
    }
    if (line.startsWith("3. ITR12")) {
      section = "worksheet";
      continue;
    }
    if (line.startsWith("4. Missing")) {
      section = "queries";
      continue;
    }
    if (section === "practice" && line === "Expenses") {
      practice = "expenses";
      continue;
    }
    if (section === "practice" && line === "Income") {
      practice = "income";
      continue;
    }
    if (section === "medical" && line === "Retirement annuity") {
      medical = "ra";
      continue;
    }
    if (section === "queries" && line.startsWith("- ")) {
      pushQuery(queries, line.slice(2), `body-q-${queries.length}`);
      continue;
    }
    if (!section || section === "queries" || !line.startsWith("- ")) continue;
    const match = line.match(FIGURE_LINE);
    if (!match) continue;
    figureIndex += 1;
    const label = match[1].trim();
    const cents = parseRandsToCents(match[2]);
    const uncertain = line.includes(" (check) ");
    const { fileId, note } = splitSource(match[3]);
    const bucketSection =
      section === "practice" ? practice : section === "medical" ? medical : "worksheet";
    const fieldId = itr12Bucket(label, null, bucketSection);
    if (cents == null || !fileId || !fieldId) {
      pushQuery(
        queries,
        `${label}: the tax pack line did not cite a file id on this draft, so the amount was left out.`,
        `body-drop-${figureIndex}`,
      );
      continue;
    }
    if (uncertain) {
      pushQuery(
        queries,
        `Confirm ${label} (${formatSampleCents(cents)}) against file ${fileId}.`,
        `body-check-${figureIndex}`,
      );
    }
    lines.push({
      id: `body-${fieldId}-${figureIndex}`,
      fieldId,
      label,
      amountCents: cents,
      fileId,
      source: "file",
      note,
    });
  }
  addIntakeGaps(queries, lines);
  return {
    year: itr12YearFromLabel(body.slice(0, 400)),
    inputs: { taxReference: "", lines, queries },
  };
}

function counts(line: Itr12Cited): boolean {
  if (line.amountCents == null || !Number.isSafeInteger(line.amountCents)) return false;
  if (line.source === "accountant") return true;
  return line.source === "file" && Boolean(line.fileId?.trim());
}

function sumField(lines: readonly Itr12Cited[], id: Itr12MoneyFieldId): number | null {
  const kept = lines.filter((line) => line.fieldId === id && counts(line));
  if (kept.length === 0) return null;
  return kept.reduce((total, line) => total + (line.amountCents ?? 0), 0);
}

function moneyText(cents: number | null): { display: string; plain: string } {
  if (cents == null) return { display: "", plain: "" };
  return { display: formatSampleCents(cents), plain: plainRands(cents) };
}

export function computeItr12(input: {
  clientName: string;
  yearOfAssessment: number;
  inputs: Itr12Inputs;
}): Itr12Sheet {
  const { yearOfAssessment, inputs } = input;
  const cited = inputs.lines.map((line) =>
    line.source === "accountant" ? { ...line, fileId: null } : line,
  );
  const totals = {
    employmentIncome: sumField(cited, "employmentIncome"),
    practiceIncome: sumField(cited, "practiceIncome"),
    practiceExpenses: sumField(cited, "practiceExpenses"),
    medicalContributions: sumField(cited, "medicalContributions"),
    raContributions: sumField(cited, "raContributions"),
    travelClaim: sumField(cited, "travelClaim"),
    localInterest: sumField(cited, "localInterest"),
    incomeTotal: null as number | null,
  };
  totals.incomeTotal =
    totals.employmentIncome == null || totals.practiceIncome == null
      ? null
      : totals.employmentIncome + totals.practiceIncome;

  const name = input.clientName.trim();
  const reference = normaliseTaxReference(inputs.taxReference);
  const referenceValid = validTaxReference(reference);
  const open = inputs.queries.filter((query) => !query.resolved);
  const lines: Itr12SheetLine[] = [];

  const push = (line: Itr12SheetLine) => lines.push(line);

  push({
    id: "fullName",
    section: "taxpayer",
    label: "Full name",
    display: name,
    plain: name,
    source: "client",
    sourceLabel: "From client record",
    fileId: null,
    missing: !name,
  });
  push({
    id: "taxReference",
    section: "taxpayer",
    label: "Income tax reference number",
    display: reference,
    plain: reference,
    source: inputs.taxReference.trim() ? "input" : "missing",
    sourceLabel: reference ? "Typed by the accountant" : "Needs input",
    fileId: null,
    missing: !referenceValid,
    note: reference && !referenceValid ? "Should be 10 digits." : undefined,
  });
  push({
    id: "yearOfAssessment",
    section: "taxpayer",
    label: "Year of assessment",
    display: String(yearOfAssessment),
    plain: String(yearOfAssessment),
    source: "client",
    sourceLabel: `${formatSampleDate(itr12YearStart(yearOfAssessment))} – ${formatSampleDate(itr12YearEnd(yearOfAssessment))}`,
    fileId: null,
    missing: false,
  });

  for (const field of MONEY) {
    const amount = totals[field.id];
    const fieldLines = cited.filter((line) => line.fieldId === field.id && counts(line));
    const one = fieldLines.length === 1 ? fieldLines[0] : null;
    const text = moneyText(amount);
    const source = amount == null ? "missing" : one?.source === "accountant" ? "accountant" : one ? "file" : "worked";
    const fileId = one?.source === "file" ? one.fileId : null;
    push({
      id: field.id,
      section: field.section,
      label: field.label,
      display: text.display,
      plain: text.plain,
      source,
      sourceLabel:
        amount == null
          ? "Needs a file or an accountant figure"
          : source === "accountant"
            ? "Typed by the accountant"
            : source === "file" && fileId
              ? `File ${fileId}`
              : "Worked from the cited lines",
      fileId,
      missing: amount == null,
      note: field.note,
    });
    if (fieldLines.length > 1) {
      for (const line of fieldLines) {
        const part = moneyText(line.amountCents);
        push({
          id: line.id,
          section: field.section,
          label: line.label,
          display: part.display,
          plain: part.plain,
          source: line.source === "accountant" ? "accountant" : "file",
          sourceLabel:
            line.source === "accountant"
              ? "Typed by the accountant"
              : `File ${line.fileId}`,
          fileId: line.fileId,
          missing: false,
          note: line.note ?? undefined,
        });
      }
    }
  }

  const income = moneyText(totals.incomeTotal);
  push({
    id: "incomeTotal",
    section: "result",
    label: "Income total",
    display: income.display,
    plain: income.plain,
    source: totals.incomeTotal == null ? "missing" : "worked",
    sourceLabel: "Worked out on this sheet",
    fileId: null,
    missing: totals.incomeTotal == null,
    note: "Employment income plus practice income. Medical, retirement, travel, and interest stay in their own sections.",
  });
  push({
    id: "taxPayable",
    section: "result",
    label: "Tax payable",
    display: "Not computed",
    plain: "Not computed",
    source: "worked",
    sourceLabel: "Not computed on this sheet",
    fileId: null,
    missing: false,
    note: "The accountant calculates tax on eFiling. This sheet does not.",
  });
  push({
    id: "openQueries",
    section: "queries",
    label: "Open queries",
    display: open.length === 0 ? "None" : String(open.length),
    plain: String(open.length),
    source: "worked",
    sourceLabel: open.length === 0 ? "None open" : "Unresolved queries block Approve",
    fileId: null,
    missing: false,
  });

  const checks: Itr12Check[] = [];
  for (const line of cited) {
    if (line.source === "file" && line.amountCents != null && !line.fileId?.trim()) {
      checks.push({
        id: `uncited-${line.id}`,
        level: "error",
        text: `${line.label} has an amount without a file id, so it is not on the totals.`,
      });
    }
  }
  if (reference && !referenceValid) {
    checks.push({
      id: "tax-reference",
      level: "error",
      text: "The income tax reference number should be 10 digits.",
    });
  }

  return {
    yearOfAssessment,
    yearStart: itr12YearStart(yearOfAssessment),
    yearEnd: itr12YearEnd(yearOfAssessment),
    rulesYear: ITR12_RULES_YEAR,
    lines,
    cited,
    queries: inputs.queries,
    missing: lines.filter((line) => line.missing),
    checks,
    totals,
  };
}

export function itr12OpenQueries(inputs: Itr12Inputs): Itr12Query[] {
  return inputs.queries.filter((query) => !query.resolved);
}

export function itr12ApproveBlock(input: {
  role: Itr12ApproverRole;
  section: Itr12SectionId;
  sheet: Itr12Sheet;
}): string | null {
  if (input.role === "owner") return "The owner cannot approve a section.";
  if (itr12OpenQueries({ taxReference: "", lines: [], queries: input.sheet.queries }).length > 0) {
    return "Resolve the open queries first.";
  }
  if (input.sheet.missing.some((line) => line.section === input.section)) {
    return "Fill this section first.";
  }
  if (input.sheet.checks.some((check) => check.level === "error" && check.id === "tax-reference")) {
    if (input.section === "taxpayer") return "Fix the reference number first.";
  }
  return null;
}

export function itr12CanDownload(
  sheet: Itr12Sheet,
  approvals: Partial<Record<Itr12SectionId, boolean>>,
  role: Itr12ApproverRole,
): boolean {
  if (role === "owner") return false;
  if (sheet.missing.length > 0) return false;
  if (sheet.checks.some((check) => check.level === "error")) return false;
  if (itr12OpenQueries({ taxReference: "", lines: [], queries: sheet.queries }).length > 0) {
    return false;
  }
  return ITR12_SECTIONS.every((section) => approvals[section.id]);
}

export function itr12MissingSentence(count: number): string {
  if (count === 0) return "";
  return count === 1
    ? "1 field needs a cited file or an accountant figure before you can download."
    : `${count} fields need a cited file or an accountant figure before you can download.`;
}

function isCited(value: unknown): value is Itr12Cited {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Itr12Cited>;
  return (
    typeof row.id === "string" &&
    typeof row.fieldId === "string" &&
    typeof row.label === "string" &&
    (row.source === "file" || row.source === "accountant")
  );
}

function isQuery(value: unknown): value is Itr12Query {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Itr12Query>;
  return typeof row.id === "string" && typeof row.text === "string" && typeof row.resolved === "boolean";
}

export function itr12DraftFields(
  sheet: Itr12Sheet,
  inputs: Itr12Inputs,
): Record<string, TaxFormDraftField> {
  const out: Record<string, TaxFormDraftField> = {};
  for (const line of sheet.lines) {
    if (line.id.startsWith("pack-") || line.id.startsWith("body-") || line.id.startsWith("typed-")) {
      continue;
    }
    const source: TaxFormDraftField["source"] =
      line.source === "file"
        ? "file"
        : line.source === "accountant" || line.source === "input"
          ? "input"
          : line.source === "client"
            ? "client"
            : "worked";
    out[line.id] = {
      value: line.plain,
      source,
      fileId: line.fileId,
    };
  }
  out.lines = { value: inputs.lines as unknown as unknown[], source: "file" };
  out.queries = { value: inputs.queries as unknown as unknown[], source: "input" };
  return out;
}

export function itr12FieldSources(inputs: Itr12Inputs): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of inputs.lines) {
    const fileId = line.fileId?.trim();
    if (line.source === "file" && fileId) out[`${line.fieldId}:${line.id}`] = fileId;
  }
  return out;
}

function listed<T>(value: unknown, keep: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(keep) : [];
}

export function itr12InputsFromDraft(draft: TaxFormDraft | null | undefined): Itr12Inputs {
  if (!draft) return emptyItr12Inputs();
  const lines = listed(draft.fields.lines?.value, isCited);
  const queries = listed(draft.fields.queries?.value, isQuery);
  const taxReference =
    typeof draft.fields.taxReference?.value === "string" ? draft.fields.taxReference.value : "";
  if (lines.length > 0 || queries.length > 0) return { taxReference, lines, queries };
  return { taxReference, lines: [], queries: [] };
}

export function findItr12Draft(
  drafts: readonly TaxFormDraft[],
  yearOfAssessment: number,
): TaxFormDraft | undefined {
  return drafts
    .filter(
      (row) =>
        row.superseded_by == null &&
        row.form_code === "ITR12" &&
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

export function itr12FileName(
  clientName: string,
  yearOfAssessment: number,
  ext: "pdf" | "csv",
): string {
  return `ITR12_${fileSafe(clientName)}_${yearOfAssessment}.${ext}`;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Capture sheet for the accountant. Amounts stay blank when they were not cited. */
export function itr12Csv(sheet: Itr12Sheet): string {
  const rows: string[][] = [["Field", "Value", "Source", "File"]];
  for (const line of sheet.lines) {
    rows.push([line.label, line.plain, line.sourceLabel, line.fileId ?? ""]);
  }
  for (const query of sheet.queries) {
    rows.push([
      query.resolved ? "Query, resolved" : "Query, open",
      query.text,
      query.resolved ? "Resolved by the accountant" : "Open",
      "",
    ]);
  }
  rows.push(["Notice", ITR12_FOOTER, "", ""]);
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}
