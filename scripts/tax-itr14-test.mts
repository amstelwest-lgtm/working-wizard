/**
 * ITR14 preparation sheet: 27% known answer, SBC blocked, part-year books
 * not annualised, year-final and query gates, owner lock, CSV.
 * Run: pnpm test:tax-itr14
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZaItr14Sheet } from "../src/components/tax-specialist/za-itr14-sheet";
import type { TaxFormDraft } from "../src/lib/tax-specialist/forms/drafts";
import {
  ITR14_FIELDS,
  ITR14_FOOTER,
  ITR14_RULES_YEAR,
  ITR14_SECTIONS,
  computeItr14,
  emptyItr14Inputs,
  itr14ApproveBlock,
  itr14Books,
  itr14CanDownload,
  itr14Csv,
  itr14DefaultYear,
  itr14DraftFields,
  itr14Due,
  itr14InputsFromDraft,
  type Itr14Inputs,
  type Itr14SectionId,
} from "../src/lib/tax-specialist/forms/itr14";
import { taxFormSchema } from "../src/lib/tax-specialist/forms/pipeline";
import { SAMPLE_COMPANY, sampleCompanyTax } from "../src/lib/tax-specialist/sample-compute";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected)
    throw new Error(`${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
}

eq(ITR14_RULES_YEAR, 2023, "rules vintage is the 27% table");
eq(taxFormSchema("ITR14").fields.length, ITR14_FIELDS.length, "catalog uses the ITR14 field list");
assert(
  ITR14_FIELDS.every((field) => field.efiling == null),
  "no invented eFiling names",
);
eq(itr14DefaultYear("2026-11-03", 3), 2026, "November prepares the year that has ended");
eq(itr14DefaultYear("2026-02-01", 3), 2025, "before year end, the previous year is the return");
eq(itr14Due("2026-02-28").statutory, "2027-02-28", "ITR14 is twelve months after year end");
eq(itr14Due("2026-02-28").due, "2027-02-26", "a Sunday due date moves to the previous working day");

const sample = SAMPLE_COMPANY.input;
const known = sampleCompanyTax();
const base: Itr14Inputs = {
  ...emptyItr14Inputs(),
  taxReference: "0123456789",
  registrationNumber: "2020/123456/07",
  companyClass: "standard",
  yearFinal: true,
  accountingProfitCents: sample.accountingProfitCents,
  depreciationAddBackCents: sample.depreciationAddBackCents,
  finesAddBackCents: sample.finesAddBackCents,
  wearAndTearCents: sample.wearAndTearCents,
  exemptDividendsCents: sample.exemptDividendsCents,
  assessedLossBroughtForwardCents: sample.assessedLossBroughtForwardCents,
  donationCents: sample.donationCents,
  priorAssessmentCents: SAMPLE_COMPANY.priorAssessedTaxableCents,
  provisionalPeriod1Cents: known.period1Cents,
  provisionalPeriod2Cents: known.period2Cents,
  provisionalTopUpCents: 0,
  turnoverCents: 400_000_000,
  accountTbAcknowledged: true,
  fixedAssetRegisterAcknowledged: true,
  balanceSheetAcknowledged: true,
};

const client = {
  name: "Harbour & Co (Pty) Ltd",
  fyStartMonth: 3,
  financials: null,
  financialsAsOf: null,
};
const sheet = computeItr14({ client, yearOfAssessment: 2026, inputs: base });
eq(sheet.taxableIncomeCents, known.taxableIncomeCents, "taxable income matches the signed sample");
eq(sheet.taxableIncomeCents, 182_850_000, "Harbour taxable income is R 1 828 500.00");
eq(sheet.taxCents, known.taxCents, "normal tax matches the signed sample");
eq(sheet.taxCents, 49_369_500, "normal tax is 27% , R 493 695.00");
eq(sheet.company?.donationAllowedCents, 1_500_000, "the donation is inside the 10% limit");
eq(sheet.company?.donationDisallowedCents, 0, "nothing is disallowed on the sample donation");
eq(sheet.balanceCents, known.topUpCents, "balance is tax less the two provisional payments");
eq(sheet.balanceCents, 3_469_500, "the worksheet balance is R 34 695.00");
assert(!sheet.lines.some((line) => line.plain.includes("28%")), "the sheet does not invent 28%");
assert(
  sheet.checks.some((check) => check.id === "adds-up" && check.level === "ok"),
  "the bridge adds up",
);

const sbc = computeItr14({
  client,
  yearOfAssessment: 2026,
  inputs: { ...base, companyClass: "sbc" },
});
eq(sbc.taxCents, null, "an SBC is not taxed at 27%");
assert(
  sbc.lines.some((line) => line.id === "normalTax" && line.plain === "Not computed"),
  "SBC tax stays blank",
);
assert(
  sbc.checks.some(
    (check) => check.id === "class" && /small business corporation/i.test(check.text),
  ),
  "SBC rates are named as out of scope",
);
eq(
  itr14ApproveBlock({ role: "accountant", section: "result", sheet: sbc }),
  "Confirm a standard company. This sheet does not compute another class.",
  "SBC blocks Approve",
);

const oldYear = computeItr14({ client, yearOfAssessment: 2023, inputs: base });
eq(oldYear.yearEnd, "2023-02-28", "a March start in 2023 ends in February");
eq(oldYear.taxCents, null, "a year before 31 March 2023 is not computed");
assert(
  oldYear.checks.some((check) => /28%/.test(check.text)),
  "the sheet says it does not compute 28%",
);
assert(
  !oldYear.lines.some((line) => line.id === "normalTax" && line.plain !== "Not computed"),
  "no 28% figure",
);

const partial = computeItr14({
  client: {
    ...client,
    financials: {
      ebt: "1000",
      revenue: "5000",
      periodStart: "2025-09-01",
      periodEnd: "2026-02-28",
      periodMonths: 6,
    },
  },
  yearOfAssessment: 2026,
  inputs: { ...base, accountingProfitCents: null, turnoverCents: null },
});
eq(partial.booksCoverYear, false, "six months is not a full year");
assert(!/×|12\s*÷|annualis/i.test(partial.booksMethod), "a part year is not annualised");
eq(
  partial.lines.find((line) => line.id === "accountingProfit")?.plain,
  "",
  "a part-year profit is not used as the return",
);
const typedOverPartial = computeItr14({
  client: partial
    ? {
        name: client.name,
        fyStartMonth: 3,
        financials: {
          ebt: "1000",
          revenue: "5000",
          periodStart: "2025-09-01",
          periodEnd: "2026-02-28",
          periodMonths: 6,
        },
        financialsAsOf: null,
      }
    : client,
  yearOfAssessment: 2026,
  inputs: base,
});
eq(
  typedOverPartial.taxCents,
  49_369_500,
  "the accountant's full-year profit is the one that is taxed",
);

const fullBooks = computeItr14({
  client: {
    name: client.name,
    fyStartMonth: 3,
    financials: {
      ebt: "1850000",
      revenue: "4000000",
      depreciation: "120000",
      cogs: "900000",
      totalAssets: "2000000",
      equity: "1200000",
      totalLiabilities: "800000",
      periodStart: "2025-03-01",
      periodEnd: "2026-02-28",
      periodMonths: 12,
    },
    financialsAsOf: "2026-03-05T00:00:00.000Z",
  },
  yearOfAssessment: 2026,
  inputs: {
    ...base,
    accountingProfitCents: 1,
    depreciationAddBackCents: null,
    turnoverCents: null,
    balanceSheetAcknowledged: false,
  },
});
eq(fullBooks.booksCoverYear, true, "a year-end sync covers the return");
eq(
  fullBooks.lines.find((line) => line.id === "accountingProfit")?.plain,
  "1850000.00",
  "full-year profit comes from the books, not the typed rand",
);
eq(
  fullBooks.lines.find((line) => line.id === "depreciationAddBack")?.plain,
  "120000.00",
  "depreciation on the books is the add-back until the accountant replaces it",
);
eq(
  fullBooks.lines.find((line) => line.id === "depreciationAddBack")?.source,
  "books",
  "depreciation source is the books",
);
eq(
  fullBooks.taxCents,
  49_369_500,
  "books profit and books depreciation still produce the known tax",
);
eq(
  fullBooks.lines.find((line) => line.id === "balanceSheetDifference")?.plain,
  "0.00",
  "assets equal equity plus liabilities",
);
assert(
  !fullBooks.queries.some((query) => query.id === "gap-bs"),
  "a tying balance sheet needs no query",
);
const read = itr14Books(
  fullBooks
    ? {
        name: client.name,
        fyStartMonth: 3,
        financials: { accounts: [{ code: "100" }] },
        financialsAsOf: null,
      }
    : client,
  "2025-03-01",
  "2026-02-28",
);
assert(read.hasAccountLines, "an accounts array on the file is noticed");
assert(!read.coversYear, "account lines alone do not make a full year");

const gaps = computeItr14({
  client,
  yearOfAssessment: 2026,
  inputs: { ...base, accountTbAcknowledged: false, yearFinal: false },
});
assert(
  gaps.queries.some((query) => query.id === "gap-tb"),
  "a missing trial balance is a query",
);
eq(
  itr14ApproveBlock({ role: "accountant", section: "profit", sheet: gaps }),
  "Mark the year final before you approve a section.",
  "the year must be final before any section is approved",
);
eq(
  itr14ApproveBlock({ role: "owner", section: "profit", sheet: sheet }),
  "The owner cannot approve a section.",
  "the owner cannot approve",
);
const allApproved = Object.fromEntries(
  ITR14_SECTIONS.map((section) => [section.id, true]),
) as Partial<Record<Itr14SectionId, boolean>>;
assert(
  itr14CanDownload(sheet, allApproved, "accountant"),
  "a complete standard company sheet can be downloaded",
);
assert(!itr14CanDownload(sheet, allApproved, "owner"), "the owner cannot download");
assert(
  !itr14CanDownload(gaps, allApproved, "accountant"),
  "an open year and an open query block download",
);
const openQuery = computeItr14({
  client,
  yearOfAssessment: 2026,
  inputs: { ...base, queries: [{ id: "q", text: "Confirm the fines list.", resolved: false }] },
});
eq(
  itr14ApproveBlock({ role: "accountant", section: "adjustments", sheet: openQuery }),
  "Resolve the open queries first.",
  "an accountant query blocks Approve",
);

const csv = itr14Csv(sheet);
assert(csv.includes("Not a SARS return"), "the CSV says it is not a SARS return");
assert(csv.includes("not sent to the client"), "the CSV says it is not sent to the client");
assert(csv.includes("493695.00"), "the CSV has the known tax");
assert(!csv.includes("mailto:"), "the CSV is not an email");
assert(!/28%/.test(csv), "the CSV does not invent 28%");

const stored = itr14DraftFields(sheet, base);
const roundTrip = itr14InputsFromDraft({
  id: "d1",
  client_id: "c1",
  form_code: "ITR14",
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
  rules_year: ITR14_RULES_YEAR,
  field_sources: {},
} satisfies TaxFormDraft);
eq(
  roundTrip.accountingProfitCents,
  sample.accountingProfitCents,
  "a saved draft restores the profit",
);
eq(roundTrip.companyClass, "standard", "a saved draft restores the class");
eq(roundTrip.yearFinal, true, "a saved draft restores the year-final mark");
eq(roundTrip.provisionalPeriod1Cents, known.period1Cents, "a saved draft restores period 1");

const view = renderToStaticMarkup(
  createElement(ZaItr14Sheet, {
    client: { ...client, id: "c1" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2026,
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(view.includes('data-itr14-sheet="true"'), "the sheet renders");
assert(view.includes("Not a SARS return"), "the sheet says it is not a SARS return");
assert(view.includes("not sent to the client"), "the sheet says it is not sent to the client");
assert(view.includes('data-itr14-year-final="blocked"'), "Approve waits for a final year");
assert(view.includes("Not computed"), "tax is not invented on an empty sheet");
assert(!view.includes("mailto:"), "the sheet has no email link");
assert(!view.includes("28%"), "the empty sheet does not mention 28%");

const owner = renderToStaticMarkup(
  createElement(ZaItr14Sheet, {
    client: { ...client, id: "c1" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2026,
    approverRole: "owner",
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(owner.includes('data-itr14-role="owner"'), "the owner view is marked");
assert(
  owner.includes("The owner cannot approve a section."),
  "the owner is told they cannot approve",
);
assert(!owner.includes("data-itr14-add-adjustment="), "the owner cannot add an adjustment");

const sheetSrc = readFileSync("src/components/tax-specialist/za-itr14-sheet.tsx", "utf8");
const pdfSrc = readFileSync("src/components/tax-specialist/za-itr14-pdf.tsx", "utf8");
for (const src of [
  sheetSrc,
  pdfSrc,
  readFileSync("src/lib/tax-specialist/forms/itr14.ts", "utf8"),
]) {
  assert(
    !/mailto:|sendEmail|resend|eFiling login|sars\.gov/i.test(src),
    "no send and no SARS login",
  );
}
assert(pdfSrc.includes("Not a SARS return"), "the PDF is labelled not a SARS return");
assert(ITR14_FOOTER.includes("Not a SARS return"), "the footer is the capture-sheet label");
assert(sheetSrc.includes("saveCatalogDraft"), "ITR14 saves through the shared pipeline");
assert(sheetSrc.includes("subject: null"), "ITR14 keeps subject empty");

const { renderToBuffer } = await import("@react-pdf/renderer");
const { Itr14PDF } = await import("../src/components/tax-specialist/za-itr14-pdf");
const pdf = await renderToBuffer(
  createElement(Itr14PDF, {
    clientName: client.name,
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
for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  pdfText += content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}
assert(pdfText.includes("Not a SARS return"), "the PDF pages say it is not a SARS return");
assert(pdfText.includes("493"), "the PDF shows the tax");
assert(!/mailto:/i.test(pdfText), "the PDF is not an email");

console.log("tax-itr14 ok");
