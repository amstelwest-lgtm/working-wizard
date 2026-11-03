/**
 * ITR12 preparation sheet: cited tax-pack mapping, section totals, queries
 * blocking approval, owner lock, CSV. Run: pnpm test:tax-itr12
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZaItr12Sheet } from "../src/components/tax-specialist/za-itr12-sheet";
import { sampleTaxPackDraft, sampleTaxPackBody } from "../src/lib/tax-deliverable-fixture";
import { SAMPLE_TAX_PACK_FILES } from "../src/lib/tax-deliverable-fixture";
import type { TaxFormDraft } from "../src/lib/tax-specialist/forms/drafts";
import { ITR12_FIELDS } from "../src/lib/tax-specialist/forms/itr12";
import {
  ITR12_FOOTER,
  ITR12_RULES_YEAR,
  ITR12_SECTIONS,
  computeItr12,
  emptyItr12Inputs,
  itr12ApproveBlock,
  itr12CanDownload,
  itr12Csv,
  itr12DraftFields,
  itr12FieldSources,
  itr12FromTaxPack,
  itr12FromTaxPackBody,
  itr12InputsFromDraft,
  itr12YearEnd,
  itr12YearOfAssessment,
  type Itr12Inputs,
  type Itr12SectionId,
} from "../src/lib/tax-specialist/forms/itr12";
import { taxFormSchema } from "../src/lib/tax-specialist/forms/pipeline";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected)
    throw new Error(`${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
}

eq(ITR12_RULES_YEAR, 2026, "rules vintage");
eq(taxFormSchema("ITR12").fields.length, ITR12_FIELDS.length, "catalog uses the ITR12 field list");
eq(itr12YearOfAssessment("2026-11-03"), 2027, "November is the next year of assessment");
eq(itr12YearOfAssessment("2026-02-28"), 2026, "February is still that year of assessment");
eq(itr12YearOfAssessment("2026-03-01"), 2027, "March opens the next year of assessment");
eq(itr12YearEnd(2027), "2027-02-28", "2027 ends 28 February");
eq(itr12YearEnd(2028), "2028-02-29", "2028 ends on the leap day");

const promoted = itr12FromTaxPack(sampleTaxPackDraft(), SAMPLE_TAX_PACK_FILES);
eq(promoted.year, 2026, "the pack year is the draft year");
const sheet = computeItr12({
  clientName: "Nicola Physio",
  yearOfAssessment: promoted.year ?? 2026,
  inputs: promoted.inputs,
});
eq(sheet.rulesYear, 2026, "the sheet records the rules vintage");
eq(sheet.totals.employmentIncome, 18_000_000, "IRP5 employment income is cited");
eq(sheet.totals.practiceIncome, 48_230_000, "practice turnover is cited");
eq(sheet.totals.practiceExpenses, 21_148_050, "practice expenses are cited");
eq(sheet.totals.medicalContributions, 2_894_400, "medical contributions are cited");
eq(sheet.totals.raContributions, 3_600_000, "retirement contributions are cited");
eq(sheet.totals.travelClaim, null, "a missing logbook is not zero");
eq(sheet.totals.localInterest, null, "missing interest is not zero");
eq(sheet.totals.incomeTotal, 66_230_000, "income total is employment plus practice");
const employment = promoted.inputs.lines.find((line) => line.fieldId === "employmentIncome");
eq(employment?.fileId, "file-irp5", "employment cites the IRP5 file");
assert(
  promoted.inputs.queries.some((query) => query.text.includes("file file-irp5")),
  "an uncertain figure stays a query",
);
assert(
  promoted.inputs.queries.some((query) => /travel/i.test(query.text)),
  "the pack's travel query is kept",
);
assert(
  promoted.inputs.queries.some((query) => query.text.includes("IT3(b)")),
  "a missing IT3(b) becomes a query",
);
assert(
  sheet.lines.some((line) => line.id === "taxPayable" && line.plain === "Not computed"),
  "tax payable is not computed",
);
assert(!itr12CanDownload(sheet, {}, "accountant"), "open queries block download");
eq(
  itr12ApproveBlock({ role: "accountant", section: "income", sheet }),
  "Resolve the open queries first.",
  "open queries block Approve",
);
eq(
  itr12ApproveBlock({ role: "owner", section: "income", sheet }),
  "The owner cannot approve a section.",
  "the owner cannot approve",
);

const fromBody = itr12FromTaxPackBody(sampleTaxPackBody());
assert(fromBody, "a rendered pack can be read back");
eq(fromBody?.year, 2026, "the rendered pack keeps the year");
const bodySheet = computeItr12({
  clientName: "Nicola Physio",
  yearOfAssessment: 2026,
  inputs: fromBody?.inputs ?? emptyItr12Inputs(),
});
eq(bodySheet.totals.incomeTotal, 66_230_000, "the rendered pack maps the same income total");
eq(bodySheet.totals.practiceExpenses, 21_148_050, "the rendered pack maps expenses");

const bare = itr12FromTaxPackBody(
  [
    "DRAFT tax pack — Someone — 2026 year of assessment",
    "1. Practice income and expenses",
    "Income",
    "- Practice turnover: R 10.00 — source: notes.pdf.",
    "4. Missing items and queries",
    "- Nothing else.",
  ].join("\n"),
);
assert(bare, "a pack without file ids still parses");
eq(bare?.inputs.lines.length, 0, "an uncited amount is not copied");
assert(
  bare?.inputs.queries.some((query) => query.text.includes("left out")),
  "an uncited amount becomes a query",
);

const typed: Itr12Inputs = {
  taxReference: "1234567890",
  lines: [
    {
      id: "e",
      fieldId: "employmentIncome",
      label: "Employment",
      amountCents: 100,
      fileId: null,
      source: "accountant",
      note: null,
    },
    {
      id: "p",
      fieldId: "practiceIncome",
      label: "Practice",
      amountCents: 50,
      fileId: "file-a",
      source: "file",
      note: null,
    },
    {
      id: "ghost",
      fieldId: "practiceExpenses",
      label: "Guess",
      amountCents: 999,
      fileId: null,
      source: "file",
      note: null,
    },
  ],
  queries: [{ id: "q", text: "Check the logbook.", resolved: false }],
};
const typedSheet = computeItr12({
  clientName: "Nicola Physio",
  yearOfAssessment: 2026,
  inputs: typed,
});
eq(typedSheet.totals.employmentIncome, 100, "an accountant figure needs no file");
eq(typedSheet.totals.practiceIncome, 50, "a cited file counts");
eq(typedSheet.totals.practiceExpenses, null, "a file line without a file id is dropped");
assert(
  typedSheet.checks.some((check) => check.id === "uncited-ghost"),
  "an uncited amount is reported",
);

const readyInputs: Itr12Inputs = {
  taxReference: "1234567890",
  lines: (["employmentIncome", "practiceIncome", "practiceExpenses", "medicalContributions", "raContributions", "travelClaim", "localInterest"] as const).map(
    (fieldId, index) => ({
      id: `ready-${index}`,
      fieldId,
      label: fieldId,
      amountCents: (index + 1) * 100,
      fileId: index === 5 ? null : `file-${index}`,
      source: index === 5 ? ("accountant" as const) : ("file" as const),
      note: null,
    }),
  ),
  queries: [{ id: "q", text: "Was the logbook complete?", resolved: true }],
};
const ready = computeItr12({
  clientName: "Nicola Physio",
  yearOfAssessment: 2026,
  inputs: readyInputs,
});
eq(ready.missing.length, 0, "a complete draft has no missing fields");
eq(ready.totals.incomeTotal, 300, "ready income total is the sum of the two income lines");
const allApproved = Object.fromEntries(ITR12_SECTIONS.map((section) => [section.id, true])) as Partial<
  Record<Itr12SectionId, boolean>
>;
assert(itr12CanDownload(ready, allApproved, "accountant"), "the accountant can download a complete sheet");
assert(!itr12CanDownload(ready, allApproved, "owner"), "the owner cannot download by approving");
const csv = itr12Csv(ready);
assert(csv.includes("Not a SARS return"), "the CSV says it is not a SARS return");
assert(csv.includes("not sent to the client"), "the CSV says it is not sent to the client");
assert(csv.includes("Not computed"), "the CSV does not invent tax payable");
assert(csv.includes("file-0"), "the CSV cites a file id");
assert(!csv.includes("mailto:"), "the CSV is not an email");

const stored = itr12DraftFields(ready, readyInputs);
const sources = itr12FieldSources(readyInputs);
eq(sources["practiceIncome:ready-1"], "file-1", "each cited line keeps its file id");
const roundTrip = itr12InputsFromDraft({
  id: "d1",
  client_id: "c1",
  form_code: "ITR12",
  tax_year: 2026,
  period: null,
  subject: null,
  fields: stored,
  approvals: {},
  status: "draft",
  approved_by: null,
  approved_by_name: null,
  approved_at: null,
  downloaded_at: null,
  created_at: "2026-11-03T00:00:00.000Z",
  updated_at: "2026-11-03T00:00:00.000Z",
  version: 1,
  supersedes_id: null,
  superseded_by: null,
  rules_year: ITR12_RULES_YEAR,
  field_sources: sources,
} satisfies TaxFormDraft);
eq(roundTrip.lines.length, readyInputs.lines.length, "a saved draft restores the cited lines");
eq(roundTrip.taxReference, "1234567890", "a saved draft restores the reference");
eq(roundTrip.queries[0]?.resolved, true, "a resolved query stays resolved");

const view = renderToStaticMarkup(
  createElement(ZaItr12Sheet, {
    client: { id: "c1", name: "Nicola Physio" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2026,
    seed: promoted.inputs,
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(view.includes('data-itr12-sheet="true"'), "the sheet renders");
assert(view.includes("File file-irp5"), "the sheet shows the cited file");
assert(view.includes("Not a SARS return"), "the sheet says it is not a SARS return");
assert(view.includes("not sent to the client"), "the sheet says it is not sent to the client");
assert(view.includes('data-itr12-open-queries='), "open queries are counted");
assert(view.includes("disabled"), "Approve is blocked while queries are open");
assert(!view.includes("mailto:"), "the sheet has no email link");

const owner = renderToStaticMarkup(
  createElement(ZaItr12Sheet, {
    client: { id: "c1", name: "Nicola Physio" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2026,
    seed: readyInputs,
    approverRole: "owner",
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(owner.includes('data-itr12-role="owner"'), "the owner view is marked");
assert(owner.includes("The owner cannot approve a section."), "the owner is told they cannot approve");
assert(!owner.includes('data-itr12-add='), "the owner cannot type a figure");

const sheetSrc = readFileSync("src/components/tax-specialist/za-itr12-sheet.tsx", "utf8");
const pdfSrc = readFileSync("src/components/tax-specialist/za-itr12-pdf.tsx", "utf8");
for (const src of [sheetSrc, pdfSrc, readFileSync("src/lib/tax-specialist/forms/itr12.ts", "utf8")]) {
  assert(!/mailto:|sendEmail|resend|eFiling login|sars\.gov/i.test(src), "no send and no SARS login");
}
assert(pdfSrc.includes("Not a SARS return"), "the PDF is labelled not a SARS return");
assert(ITR12_FOOTER.includes("Not a SARS return"), "the footer is the capture-sheet label");

const { renderToBuffer } = await import("@react-pdf/renderer");
const { Itr12PDF } = await import("../src/components/tax-specialist/za-itr12-pdf");
const pdf = await renderToBuffer(
  createElement(Itr12PDF, {
    clientName: "Nicola Physio",
    sheet: ready,
    approvedByName: "Ada Mbeki",
    approvedAt: "2026-11-03T08:00:00.000Z",
    preparedOn: "2026-11-03",
  }) as Parameters<typeof renderToBuffer>[0],
);
assert(pdf.subarray(0, 5).toString() === "%PDF-", "the capture sheet is a PDF");
const { getDocumentProxy } = await import("unpdf");
const doc = await getDocumentProxy(new Uint8Array(pdf));
const page = await doc.getPage(1);
const content = await page.getTextContent();
const pdfText = content.items
  .map((item) => ("str" in item ? item.str : ""))
  .join(" ");
assert(pdfText.includes("Not a SARS return"), "the PDF pages say it is not a SARS return");
assert(pdfText.includes("Not computed"), "the PDF does not invent tax payable");
assert(pdfText.includes("file-0"), "the PDF cites a file id");
assert(!/mailto:/i.test(pdfText), "the PDF is not an email");

console.log("tax-itr12 ok");
