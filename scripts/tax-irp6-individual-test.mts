/**
 * Individual IRP6: rate tables, cited intake, 80% comparison, approvals.
 * Run: pnpm test:tax-irp6-individual
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZaIrp6IndividualSheet } from "../src/components/tax-specialist/za-irp6-individual-sheet";
import { TAX_PACK_FILE_MARK } from "../src/lib/tax-deliverable";
import { findIrp6Draft, taxDraftTitle, type TaxFormDraft } from "../src/lib/tax-specialist/forms/drafts";
import { irp6IndividualSeedFromPack } from "../src/lib/tax-specialist/forms/irp6-individual-load";
import {
  IRP6_INDIVIDUAL_FOOTER,
  IRP6_INDIVIDUAL_SECTIONS,
  IRP6_INDIVIDUAL_SUBJECT,
  computeIrp6Individual,
  emptyIrp6IndividualInputs,
  individualNormalTaxCents,
  irp6IndividualApproveBlock,
  irp6IndividualCanDownload,
  irp6IndividualCsv,
  irp6IndividualFromCited,
  type Irp6IndLine,
  type Irp6IndividualInputs,
} from "../src/lib/tax-specialist/forms/irp6-individual";
import type { Irp6Client } from "../src/lib/tax-specialist/forms/irp6";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
  }
}

const nicola: Irp6Client = {
  name: "Nicola Physio",
  fyStartMonth: 3,
  financials: null,
  financialsAsOf: null,
};

eq(individualNormalTaxCents(2027, 9_900_000, "under-65"), 0, "2027 threshold tax is nil after the primary rebate");
eq(individualNormalTaxCents(2026, 9_575_000, "under-65"), 0, "2026 uses the unchanged 2024 table and rebate");
eq(individualNormalTaxCents(2025, 9_575_000, "under-65"), 0, "2025 uses the same table");
eq(individualNormalTaxCents(2024, 9_575_000, "under-65"), 0, "2024 threshold tax is nil");
eq(
  individualNormalTaxCents(2027, 55_500_000, "under-65"),
  11_670_700,
  "2027 tax on R555,000 is the bracket plus the primary rebate",
);
eq(individualNormalTaxCents(2027, 55_500_000, "65"), 11_670_700 - 976_500, "65 adds the secondary rebate");
eq(individualNormalTaxCents(2028, 55_500_000, "under-65"), null, "a year without a signed-off table has no tax");

function line(fieldId: Irp6IndLine["fieldId"], cents: number, fileId: string): Irp6IndLine {
  return {
    id: fileId,
    fieldId,
    label: fieldId,
    amountCents: cents,
    fileId,
    source: "file",
    note: null,
  };
}

const filled: Irp6IndividualInputs = {
  taxReference: "1234567890",
  ageBand: "under-65",
  estimateOverrideCents: null,
  queries: [],
  lines: [
    line("employmentIncome", 40_000_000, "file-emp"),
    line("practiceIncome", 20_000_000, "file-prac"),
    line("localInterest", 1_000_000, "file-int"),
    line("practiceExpenses", 5_000_000, "file-exp"),
    line("travelClaim", 500_000, "file-travel"),
    line("medicalContributions", 2_000_000, "file-med"),
    line("raContributions", 1_500_000, "file-ra"),
    line("basicAmount", 30_000_000, "file-assess"),
    line("payeWithheld", 8_000_000, "file-paye"),
    line("paymentsMade", 1_000_000, "file-paid"),
  ],
};

const sheet = computeIrp6Individual({
  client: nicola,
  yearOfAssessment: 2027,
  period: 2,
  inputs: filled,
});
eq(sheet.rulesYear, 2027, "the draft rules year is the year of assessment");
eq(sheet.workedCents, 55_500_000, "worked figure is income minus practice expenses and travel");
eq(sheet.estimateCents, 55_500_000, "the estimate is the worked figure");
eq(sheet.estimatedTaxCents, 11_670_700, "tax uses the 2027 table");
eq(sheet.taxForPeriodCents, 11_670_700, "period 2 is the full-year tax");
eq(sheet.taxPayableCents, 2_670_700, "PAYE and payments already made come off");
eq(sheet.eightyCents, 44_400_000, "80% of the worked figure is shown");
eq(sheet.estimatePercent, 100, "the estimate is 100% of the worked figure");
assert(
  sheet.checks.some((check) => check.id === "eighty" && check.text.includes("R 444 000.00")),
  "the 80% comparison is a rand figure of the worked amount",
);
assert(!sheet.checks.some((check) => /penalty|interest charge/i.test(check.text)), "no penalty or interest charge");
assert(sheet.lines.some((row) => row.fileId === "file-emp"), "employment cites a file id");
assert(
  sheet.lines.find((row) => row.id === "medicalContributions")?.note?.includes("not computed"),
  "the medical tax credit is not computed",
);
eq(sheet.missing.length, 0, "a fully cited sheet has nothing missing");
eq(
  irp6IndividualApproveBlock({ role: "accountant", section: "result", sheet }),
  null,
  "the accountant can approve a complete section",
);
eq(
  irp6IndividualApproveBlock({ role: "owner", section: "result", sheet }),
  "The owner cannot approve a section.",
  "the owner cannot approve",
);
assert(
  irp6IndividualCanDownload(sheet, Object.fromEntries(IRP6_INDIVIDUAL_SECTIONS.map((section) => [section.id, true])), "accountant"),
  "the accountant can download once every section is approved",
);
assert(
  !irp6IndividualCanDownload(
    sheet,
    Object.fromEntries(IRP6_INDIVIDUAL_SECTIONS.map((section) => [section.id, true])),
    "owner",
  ),
  "the owner cannot download",
);

const period1 = computeIrp6Individual({
  client: nicola,
  yearOfAssessment: 2027,
  period: 1,
  inputs: filled,
});
eq(period1.taxForPeriodCents, 5_835_350, "period 1 is half the tax");
assert(!period1.lines.some((row) => row.id === "paymentsMade"), "period 1 does not ask for payments already made");
eq(period1.taxPayableCents, Math.max(0, 5_835_350 - 8_000_000), "period 1 comes off PAYE only");

const low = computeIrp6Individual({
  client: nicola,
  yearOfAssessment: 2027,
  period: 2,
  inputs: { ...filled, estimateOverrideCents: 40_000_000 },
});
eq(low.estimatedTaxCents, 6_741_700, "an override uses the 2027 table on that figure");
eq(low.estimatePercent, 72, "72% is below the 80% comparison");
assert(low.checks.some((check) => check.id === "eighty" && check.level === "warning"), "below 80% is a warning");
assert(!low.checks.some((check) => /penalty/.test(check.text)), "the warning is not a rand penalty");

const gap = computeIrp6Individual({
  client: nicola,
  yearOfAssessment: 2027,
  period: 2,
  inputs: { ...filled, lines: filled.lines.filter((row) => row.fieldId !== "travelClaim") },
});
eq(gap.workedCents, null, "a missing travel figure is not treated as zero");
eq(gap.estimatedTaxCents, null, "tax stays blank until the worked figure is complete");
assert(gap.missing.some((row) => row.id === "travelClaim"), "missing travel blocks the sheet");

const queried = computeIrp6Individual({
  client: nicola,
  yearOfAssessment: 2027,
  period: 2,
  inputs: { ...filled, queries: [{ id: "q", text: "Confirm the logbook.", resolved: false }] },
});
eq(
  irp6IndividualApproveBlock({ role: "accountant", section: "estimate", sheet: queried }),
  "Resolve the open queries first.",
  "an open query blocks Approve",
);

const fromBooks = computeIrp6Individual({
  client: {
    ...nicola,
    financials: { revenue: "180000", periodStart: "2026-03-01", periodEnd: "2027-02-28" },
    financialsAsOf: "2027-03-01T08:00:00.000Z",
  },
  yearOfAssessment: 2027,
  period: 1,
  inputs: {
    ...filled,
    lines: filled.lines.filter((row) => row.fieldId !== "practiceIncome"),
  },
});
const practice = fromBooks.lines.find((row) => row.id === "practiceIncome");
eq(practice?.source, "books", "a full year of books supplies practice income");
eq(practice?.plain, "180000.00", "the books figure is not annualised");
assert(practice?.sourceLabel.includes("From books"), "the books source is named");

const later = computeIrp6Individual({
  client: nicola,
  yearOfAssessment: 2028,
  period: 2,
  inputs: filled,
});
eq(later.rulesYear, null, "2028 has no signed-off rules year");
eq(later.estimatedTaxCents, null, "2028 tax is not invented");
assert(later.checks.some((check) => check.id === "rates"), "the sheet says the table is missing");

const dropped = irp6IndividualFromCited({
  lines: [
    {
      id: "ghost",
      fieldId: "practiceIncome",
      label: "Practice turnover",
      amountCents: 10_000,
      fileId: null,
      source: "file",
      note: null,
    },
  ],
  queries: [],
});
eq(dropped.lines.length, 0, "an uncited amount is not copied");
assert(dropped.queries.some((query) => query.text.includes("no file id")), "an uncited amount becomes a query");

const cited = `notes.pdf${TAX_PACK_FILE_MARK}file-emp.`;
const pack = irp6IndividualSeedFromPack(
  [
    "DRAFT tax pack — Nicola Physio — 2027 year of assessment",
    "1. Practice income and expenses",
    "Income",
    `- Employment income per IRP5 code 3601: R 400 000.00 — source: ${cited}`,
    `- PAYE withheld per IRP5 code 4102: R 80 000.00 — source: irp5.pdf${TAX_PACK_FILE_MARK}file-paye.`,
    "3. ITR12 preparation worksheet",
    `- Basic amount from the latest assessment: R 300 000.00 — source: assessment.pdf${TAX_PACK_FILE_MARK}file-assess.`,
    `- Provisional tax already paid: R 10 000.00 — source: proof.pdf${TAX_PACK_FILE_MARK}file-paid.`,
    "4. Missing items and queries",
    "- Confirm the logbook.",
  ].join("\n"),
);
assert(pack, "a tax pack seeds an individual IRP6");
eq(pack?.year, 2027, "the pack year is kept");
assert(pack?.inputs.lines.some((row) => row.fieldId === "employmentIncome" && row.fileId === "file-emp"), "IRP5 income is cited");
assert(pack?.inputs.lines.some((row) => row.fieldId === "payeWithheld" && row.fileId === "file-paye"), "PAYE is cited");
assert(pack?.inputs.lines.some((row) => row.fieldId === "basicAmount" && row.fileId === "file-assess"), "the prior assessment is cited");
assert(pack?.inputs.lines.some((row) => row.fieldId === "paymentsMade"), "payments made are cited");
assert(pack?.inputs.queries.some((query) => /logbook/i.test(query.text)), "a pack query is kept");

const csv = irp6IndividualCsv(sheet);
assert(csv.includes("Not a SARS return"), "the CSV says it is not a SARS return");
assert(csv.includes("not sent to the client"), "the CSV is not for the client");
assert(csv.includes("file-emp"), "the CSV cites a file id");
assert(csv.includes("116707.00"), "the CSV has the tax figure");
assert(csv.includes("80% of the worked figure"), "the CSV has the 80% comparison");
assert(!/penalty/.test(csv), "the CSV has no penalty");
assert(IRP6_INDIVIDUAL_FOOTER.includes("Not a SARS return"), "the footer is the capture-sheet label");

const companyDraft = {
  id: "co",
  form_code: "IRP6",
  tax_year: 2027,
  period: 2,
  subject: null,
  superseded_by: null,
  version: 1,
} as TaxFormDraft;
const personDraft = {
  ...companyDraft,
  id: "person",
  subject: IRP6_INDIVIDUAL_SUBJECT,
} as TaxFormDraft;
eq(findIrp6Draft([personDraft, companyDraft], 2027, 2)?.id, "co", "company IRP6 ignores an individual draft");
eq(
  taxDraftTitle(personDraft),
  "IRP6 2027, period 2 (individual)",
  "the draft list names the individual return",
);

const view = renderToStaticMarkup(
  createElement(ZaIrp6IndividualSheet, {
    client: { ...nicola, id: "nicola" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2027,
    initialPeriod: 2,
    seed: filled,
    approverRole: "accountant",
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(view.includes('data-irp6-individual="true"'), "the individual sheet is marked");
for (const id of ["taxpayer", "estimate", "adjustments", "credits", "result"]) {
  assert(view.includes(`data-irp6-approve="${id}"`), `${id} has an Approve tick`);
}
assert(view.includes("file-emp"), "the sheet shows the file id");
assert(view.includes("R 116 707.00"), "the sheet shows the tax");
assert(view.includes("R 444 000.00"), "the sheet shows 80% of the worked figure");
assert(view.includes('data-irp6-period="1"'), "period 1 is on the sheet");
assert(view.includes('data-irp6-period="3"'), "period 3 is on the sheet");
assert(!/penalty/.test(view), "the sheet does not show a penalty");

const blocked = renderToStaticMarkup(
  createElement(ZaIrp6IndividualSheet, {
    client: { ...nicola, id: "nicola" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2027,
    initialPeriod: 2,
    seed: emptyIrp6IndividualInputs(),
    approverRole: "accountant",
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(blocked.includes("Resolve the open queries first."), "missing intake is a query that blocks Approve");
assert(/data-irp6-approve="estimate"[^>]*disabled/.test(blocked), "Approve stays disabled");

const owner = renderToStaticMarkup(
  createElement(ZaIrp6IndividualSheet, {
    client: { ...nicola, id: "nicola" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2027,
    initialPeriod: 2,
    seed: filled,
    approverRole: "owner",
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(owner.includes('data-irp6-role="owner"'), "the owner view is marked");
assert(owner.includes("The owner cannot approve a section."), "the owner is told they cannot approve");
assert(!owner.includes("data-irp6-add="), "the owner cannot type a figure");
assert(/data-irp6-download="pdf"[^>]*disabled/.test(owner), "the owner cannot download");

for (const src of [
  "src/lib/tax-specialist/forms/irp6-individual.ts",
  "src/components/tax-specialist/za-irp6-individual-sheet.tsx",
  "src/components/tax-specialist/za-irp6-pdf.tsx",
]) {
  const text = readFileSync(src, "utf8");
  assert(!/mailto:|sendEmail|resend|eFiling login|sars\.gov/i.test(text), `${src} does not send or log in`);
  assert(!/\bIRS\b|1040|Form 1040/.test(text), `${src} does not name a US form`);
}

const { renderToBuffer } = await import("@react-pdf/renderer");
const { Irp6IndividualPDF } = await import("../src/components/tax-specialist/za-irp6-pdf");
const pdf = await renderToBuffer(
  createElement(Irp6IndividualPDF, {
    clientName: "Nicola Physio",
    sheet,
    approvedByName: "Ada Mbeki",
    approvedAt: "2026-11-03T08:00:00.000Z",
    preparedOn: "2026-11-03",
  }) as Parameters<typeof renderToBuffer>[0],
);
assert(pdf.subarray(0, 5).toString() === "%PDF-", "the capture sheet is a PDF");
const { getDocumentProxy } = await import("unpdf");
const doc = await getDocumentProxy(new Uint8Array(pdf));
let pdfText = "";
for (let n = 1; n <= doc.numPages; n += 1) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  pdfText += content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}
assert(pdfText.includes("Not a SARS return"), "the PDF says it is not a SARS return");
assert(pdfText.includes("not sent to the client"), "the PDF is not for the client");
assert(pdfText.includes("file-emp"), "the PDF cites a file id");
assert(pdfText.includes("116") || pdfText.includes("R 116"), "the PDF shows the tax");
assert(!/penalty/.test(pdfText), "the PDF has no penalty");
assert(!/mailto:/i.test(pdfText), "the PDF is not an email");

console.log("tax-irp6-individual ok");
