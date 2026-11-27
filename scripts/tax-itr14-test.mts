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
  ASSESSED_LOSS_FLOOR_CENTS,
  assessedLossWorking,
  importWearAssets,
  wearSchedule,
  type WearAsset,
} from "../src/lib/tax-specialist/forms/itr14-allowances";
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
assert(pdfText.includes("Wear-and-tear schedule"), "the PDF has a wear-and-tear section");
assert(pdfText.includes("Assessed loss"), "the PDF has an assessed-loss section");
assert(pdfText.includes("Draft for review"), "the workings are marked draft");
assert(/blank register is not zero/i.test(pdfText), "a blank register is labelled on the PDF");

/**
 * Hand-computed register for 1 Mar 2025 – 28 Feb 2026.
 * Laptop R36 000, personal computers, 3 years, full year: R12 000.
 * Desk R18 000, furniture, 6 years, Sep–Feb (6 months): R1 500.
 * Desk addition R12 000 from 1 Dec (3 months): R500.
 * Van R120 000, delivery vehicles, 4 years, year 3, 20% private: R24 000.
 * Tool R7 000, s11(e) small item, full write-off: R7 000.
 * New press R100 000, s12C 40% (June, not pro-rated): R40 000.
 * Used lathe R50 000, s12C year 2 at 20%: R10 000.
 * Sold computer R30 000, year 2, Mar–Aug (6 months): R5 000.
 *   Tax value after the allowance R15 000. Proceeds R22 000. Recoupment R7 000.
 * Written-off computer R9 000, proceeds R12 000. Recoupment capped at cost: R9 000.
 * Allowance total R100 000. Book depreciation R25 000. Recoupment R16 000.
 * Depreciation add-back R41 000.
 */
const asset = (row: WearAsset): WearAsset => row;
const fixture: WearAsset[] = [
  asset({
    id: "laptop",
    description: "Laptop",
    costCents: 3_600_000,
    broughtIntoUse: "2025-03-01",
    category: "Personal computers",
    section: "s11e",
    privateUsePercent: 0,
    newAndUnused: false,
    additionCents: null,
    additionDate: null,
    disposalDate: null,
    proceedsCents: null,
    bookDepreciationCents: 1_500_000,
  }),
  asset({
    id: "desk",
    description: "Desk",
    costCents: 1_800_000,
    broughtIntoUse: "2025-09-01",
    category: "Furniture and fittings",
    section: "s11e",
    privateUsePercent: 0,
    newAndUnused: false,
    additionCents: 1_200_000,
    additionDate: "2025-12-01",
    disposalDate: null,
    proceedsCents: null,
    bookDepreciationCents: 0,
  }),
  asset({
    id: "van",
    description: "Delivery van",
    costCents: 12_000_000,
    broughtIntoUse: "2023-03-01",
    category: "Delivery vehicles",
    section: "s11e",
    privateUsePercent: 20,
    newAndUnused: false,
    additionCents: null,
    additionDate: null,
    disposalDate: null,
    proceedsCents: null,
    bookDepreciationCents: 0,
  }),
  asset({
    id: "tool",
    description: "Loose tool",
    costCents: 700_000,
    broughtIntoUse: "2025-12-01",
    category: "Workshop equipment",
    section: "s11e",
    privateUsePercent: 0,
    newAndUnused: false,
    additionCents: null,
    additionDate: null,
    disposalDate: null,
    proceedsCents: null,
    bookDepreciationCents: 0,
  }),
  asset({
    id: "press",
    description: "New press",
    costCents: 10_000_000,
    broughtIntoUse: "2025-06-01",
    category: "Manufacturing plant",
    section: "s12c",
    privateUsePercent: 0,
    newAndUnused: true,
    additionCents: null,
    additionDate: null,
    disposalDate: null,
    proceedsCents: null,
    bookDepreciationCents: 1_000_000,
  }),
  asset({
    id: "lathe",
    description: "Used lathe",
    costCents: 5_000_000,
    broughtIntoUse: "2024-03-01",
    category: "Manufacturing plant",
    section: "s12c",
    privateUsePercent: 0,
    newAndUnused: false,
    additionCents: null,
    additionDate: null,
    disposalDate: null,
    proceedsCents: null,
    bookDepreciationCents: 0,
  }),
  asset({
    id: "sold-pc",
    description: "Sold computer",
    costCents: 3_000_000,
    broughtIntoUse: "2024-03-01",
    category: "Personal computers",
    section: "s11e",
    privateUsePercent: 0,
    newAndUnused: false,
    additionCents: null,
    additionDate: null,
    disposalDate: "2025-08-31",
    proceedsCents: 2_200_000,
    bookDepreciationCents: 0,
  }),
  asset({
    id: "scrap-pc",
    description: "Fully written off computer",
    costCents: 900_000,
    broughtIntoUse: "2022-03-01",
    category: "Personal computers",
    section: "s11e",
    privateUsePercent: 0,
    newAndUnused: false,
    additionCents: null,
    additionDate: null,
    disposalDate: "2025-06-30",
    proceedsCents: 1_200_000,
    bookDepreciationCents: 0,
  }),
];
const schedule = wearSchedule(fixture, "2025-03-01", "2026-02-28");
const row = (id: string) => schedule?.rows.find((line) => line.id === id);
eq(row("laptop")?.allowanceCents, 1_200_000, "laptop is a full year at 3 years");
eq(row("desk")?.allowanceCents, 200_000, "desk is 6 months plus a 3 month addition");
eq(row("van")?.allowanceCents, 2_400_000, "van keeps 80% after private use");
eq(row("tool")?.allowanceCents, 700_000, "R7 000 is written off in full");
eq(row("press")?.allowanceCents, 4_000_000, "new s12C plant is 40% and not pro-rated");
eq(row("lathe")?.allowanceCents, 1_000_000, "used s12C plant is 20% in year 2");
eq(row("sold-pc")?.allowanceCents, 500_000, "a mid-year s11(e) disposal is pro-rated");
eq(row("sold-pc")?.recoupmentCents, 700_000, "recoupment is proceeds over tax value");
eq(row("scrap-pc")?.allowanceCents, 0, "a fully written off asset has no further allowance");
eq(row("scrap-pc")?.recoupmentCents, 900_000, "recoupment stops at cost");
eq(schedule?.wearAndTearCents, 10_000_000, "acceptance: fixture wear-and-tear is R100 000.00");
eq(schedule?.recoupmentCents, 1_600_000, "fixture recoupment is R16 000.00");
eq(schedule?.depreciationAddBackCents, 4_100_000, "add-back is book depreciation plus recoupment");

const imported = importWearAssets(
  fixture.map((line) => ({
    description: line.description,
    cost: (line.costCents / 100).toFixed(2),
    dateBroughtIntoUse: line.broughtIntoUse,
    category: line.category,
    section: line.section === "s12c" ? "s12C" : "s11(e)",
    privateUse: line.privateUsePercent,
    newAndUnused: line.newAndUnused ? "yes" : "no",
    addition: line.additionCents == null ? "" : (line.additionCents / 100).toFixed(2),
    additionDate: line.additionDate ?? "",
    disposalDate: line.disposalDate ?? "",
    proceeds: line.proceedsCents == null ? "" : (line.proceedsCents / 100).toFixed(2),
    bookDepreciation: ((line.bookDepreciationCents ?? 0) / 100).toFixed(2),
  })),
);
eq(
  wearSchedule(imported, "2025-03-01", "2026-02-28")?.wearAndTearCents,
  10_000_000,
  "an imported register matches the typed fixture",
);

const cheapPlant = wearSchedule(
  [
    asset({
      id: "cheap",
      description: "Small press",
      costCents: 500_000,
      broughtIntoUse: "2025-06-01",
      category: "Manufacturing plant",
      section: "s12c",
      privateUsePercent: 0,
      newAndUnused: true,
      additionCents: null,
      additionDate: null,
      disposalDate: null,
      proceedsCents: null,
      bookDepreciationCents: null,
    }),
  ],
  "2025-03-01",
  "2026-02-28",
);
eq(cheapPlant?.wearAndTearCents, 200_000, "s12C does not use the s11(e) small-item write-off");

const unknown = wearSchedule(
  [
    asset({
      ...fixture[0],
      id: "odd",
      category: "Time machine",
      bookDepreciationCents: null,
    }),
  ],
  "2025-03-01",
  "2026-02-28",
);
eq(unknown?.wearAndTearCents, null, "an unknown category does not invent a write-off period");
const alreadySold = wearSchedule(
  [
    asset({
      ...fixture[0],
      id: "gone",
      disposalDate: "2024-06-30",
      proceedsCents: 1_000_000,
    }),
  ],
  "2025-03-01",
  "2026-02-28",
);
eq(alreadySold?.wearAndTearCents, 0, "an asset sold before this year has no allowance");
eq(alreadySold?.recoupmentCents, 0, "an asset sold before this year is not recouped again");

const registered = computeItr14({
  client,
  yearOfAssessment: 2026,
  inputs: { ...base, assets: fixture },
});
eq(
  registered.lines.find((line) => line.id === "wearAndTear")?.plain,
  "100000.00",
  "the register fills the wear-and-tear line",
);
eq(
  registered.lines.find((line) => line.id === "depreciationAddBack")?.plain,
  "41000.00",
  "the register fills the depreciation add-back",
);
eq(
  registered.lines.find((line) => line.id === "wearAndTear")?.source,
  "worked",
  "wear comes from the register",
);
eq(
  registered.company?.taxableBeforeDonationCents,
  175_950_000,
  "profit plus the register still ties before the donation",
);
eq(
  registered.taxableIncomeCents,
  174_450_000,
  "taxable income after the register is R1 744 500.00",
);
assert(
  registered.checks.some((check) => check.id === "adds-up" && check.level === "ok"),
  "acceptance: taxable income still ties",
);

const blankRegister = computeItr14({
  client,
  yearOfAssessment: 2026,
  inputs: { ...base, assets: [], depreciationAddBackCents: null, wearAndTearCents: null },
});
eq(blankRegister.wear, null, "a blank register has no schedule");
eq(
  blankRegister.lines.find((line) => line.id === "wearAndTear")?.plain,
  "",
  "acceptance: a blank register leaves wear-and-tear blank",
);
eq(
  blankRegister.lines.find((line) => line.id === "depreciationAddBack")?.plain,
  "",
  "acceptance: a blank register leaves depreciation blank",
);
assert(
  blankRegister.lines.find((line) => line.id === "wearAndTear")?.plain !== "0.00",
  "a blank wear-and-tear line is not zero",
);

function lossSheet(profitCents: number, lossCents: number) {
  return computeItr14({
    client,
    yearOfAssessment: 2026,
    inputs: {
      ...emptyItr14Inputs(),
      taxReference: "0123456789",
      registrationNumber: "2020/123456/07",
      companyClass: "standard",
      yearFinal: true,
      accountingProfitCents: profitCents,
      depreciationAddBackCents: 0,
      finesAddBackCents: 0,
      wearAndTearCents: 0,
      exemptDividendsCents: 0,
      assessedLossBroughtForwardCents: lossCents,
      donationCents: 0,
      priorAssessmentCents: 0,
      provisionalPeriod1Cents: 0,
      provisionalPeriod2Cents: 0,
      provisionalTopUpCents: 0,
      turnoverCents: 1,
      accountTbAcknowledged: true,
      fixedAssetRegisterAcknowledged: true,
      balanceSheetAcknowledged: true,
    },
  });
}
const eighty = lossSheet(500_000_000, 500_000_000);
eq(eighty.assessedLoss?.eightyPercentCents, 400_000_000, "80% of R5 000 000 is R4 000 000");
eq(eighty.assessedLoss?.limitCents, 400_000_000, "the 80% limb is above R1 000 000");
eq(eighty.assessedLoss?.setOffCents, 400_000_000, "acceptance: set-off stops at 80%");
eq(eighty.taxableIncomeCents, 100_000_000, "20% of the income stays taxable");
eq(eighty.company?.assessedLossCarriedCents, 100_000_000, "the unused 20% is carried forward");
assert(
  eighty.checks.some((check) => check.id === "adds-up" && check.level === "ok"),
  "the 80% set-off still ties to taxable income",
);
const million = lossSheet(110_000_000, 110_000_000);
eq(million.assessedLoss?.eightyPercentCents, 88_000_000, "80% of R1 100 000 is R880 000");
eq(
  million.assessedLoss?.limitCents,
  ASSESSED_LOSS_FLOOR_CENTS,
  "acceptance: the limit is R1 000 000 when that is greater than 80%",
);
eq(million.assessedLoss?.setOffCents, 100_000_000, "set-off uses the R1 000 000 limb");
eq(million.taxableIncomeCents, 10_000_000, "R100 000 stays taxable under the R1 000 000 cap");
eq(million.assessedLoss?.carriedCents, 10_000_000, "R100 000 of the loss is carried forward");
assert(
  million.checks.some((check) => check.id === "adds-up" && check.level === "ok"),
  "the R1 000 000 set-off still ties to taxable income",
);
const underCap = lossSheet(200_000_000, 50_000_000);
eq(underCap.assessedLoss?.setOffCents, 50_000_000, "a loss inside the cap is set off in full");
eq(underCap.taxableIncomeCents, 150_000_000, "the uncapped set-off still ties");
eq(underCap.assessedLoss?.carriedCents, 0, "nothing is carried when the loss is used");
const beforeRingFence = assessedLossWorking({
  taxableBeforeLossCents: 500_000_000,
  broughtForwardCents: 500_000_000,
  yearEnd: "2023-02-28",
});
eq(
  beforeRingFence.ringFenceApplies,
  false,
  "a year ending before 31 March 2023 is outside the ring-fence",
);
eq(beforeRingFence.setOffCents, 500_000_000, "the older year sets the loss off in full");
assert(
  view.includes('data-itr14-wear="true"'),
  "a blank register still shows the wear-and-tear section",
);
assert(view.includes('data-itr14-wear-blank="true"'), "the blank schedule has blank lines");
assert(
  view.includes('data-itr14-wear-allowance=""></td>'),
  "a blank wear-and-tear allowance is empty, not zero",
);
assert(
  !view.includes('data-itr14-assessed-loss="true"'),
  "no assessed-loss box before a balance is typed",
);

const wearDraft = itr14InputsFromDraft({
  id: "d2",
  client_id: "c1",
  form_code: "ITR14",
  tax_year: 2026,
  period: null,
  subject: null,
  fields: itr14DraftFields(registered, { ...base, assets: fixture }),
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
eq(wearDraft.assets.length, fixture.length, "a saved draft restores the register");
eq(
  computeItr14({ client, yearOfAssessment: 2026, inputs: wearDraft }).taxableIncomeCents,
  174_450_000,
  "a restored register still ties",
);

const registeredPdf = await renderToBuffer(
  createElement(Itr14PDF, {
    clientName: client.name,
    sheet: registered,
    approvedByName: null,
    approvedAt: null,
    preparedOn: "2026-11-03",
  }) as Parameters<typeof renderToBuffer>[0],
);
const registeredDoc = await getDocumentProxy(new Uint8Array(registeredPdf));
let registeredText = "";
for (let pageNumber = 1; pageNumber <= registeredDoc.numPages; pageNumber += 1) {
  const page = await registeredDoc.getPage(pageNumber);
  const content = await page.getTextContent();
  registeredText += content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}
assert(registeredText.includes("100 000"), "the PDF shows the fixture wear-and-tear total");
assert(registeredText.includes("Draft for review"), "the fixture PDF stays a draft");
assert(!/mailto:|sars\.gov/i.test(registeredText), "the fixture PDF does not file or email");

function sheetDraft(inputs: Itr14Inputs, id: string): TaxFormDraft {
  const built = computeItr14({ client, yearOfAssessment: 2026, inputs });
  return {
    id,
    client_id: "c1",
    form_code: "ITR14",
    tax_year: 2026,
    period: null,
    subject: null,
    fields: itr14DraftFields(built, inputs),
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
  };
}
function renderSheet(inputs: Itr14Inputs, id: string) {
  return renderToStaticMarkup(
    createElement(ZaItr14Sheet, {
      client: { ...client, id: "c1" },
      today: "2026-11-03",
      drafts: [sheetDraft(inputs, id)],
      initialYear: 2026,
      onSaved: () => undefined,
      onBack: () => undefined,
    }),
  );
}
const laptopInputs: Itr14Inputs = {
  ...base,
  assets: [fixture[0]!],
  wearAndTearCents: null,
  depreciationAddBackCents: null,
};
const laptopView = renderSheet(laptopInputs, "laptop");
assert(
  laptopView.includes('data-itr14-wear-allowance="laptop"'),
  "one asset renders on the schedule",
);
assert(laptopView.includes("R 12 000.00"), "the schedule shows that asset's wear-and-tear");
assert(
  laptopView.includes("From the asset register"),
  "the wear-and-tear line is the computed register total",
);
const lossOnlyView = renderSheet(
  { ...emptyItr14Inputs(), assessedLossBroughtForwardCents: 50_000_000 },
  "loss-only",
);
assert(
  lossOnlyView.includes('data-itr14-assessed-loss="true"'),
  "typing a brought-forward loss shows the working",
);
assert(lossOnlyView.includes("R 500 000.00"), "the working shows the balance brought forward");
assert(
  lossOnlyView.includes('data-itr14-loss-setoff=""></td>'),
  "set-off stays blank until there is taxable income",
);
assert(
  lossOnlyView.includes('data-itr14-loss-cf=""></td>'),
  "carried forward stays blank until there is taxable income",
);
const capInputs: Itr14Inputs = {
  ...emptyItr14Inputs(),
  taxReference: "0123456789",
  registrationNumber: "2020/123456/07",
  companyClass: "standard",
  yearFinal: true,
  accountingProfitCents: 500_000_000,
  depreciationAddBackCents: 0,
  finesAddBackCents: 0,
  wearAndTearCents: 0,
  exemptDividendsCents: 0,
  assessedLossBroughtForwardCents: 500_000_000,
  donationCents: 0,
  priorAssessmentCents: 0,
  provisionalPeriod1Cents: 0,
  provisionalPeriod2Cents: 0,
  provisionalTopUpCents: 0,
  turnoverCents: 1,
  accountTbAcknowledged: true,
  fixedAssetRegisterAcknowledged: true,
  balanceSheetAcknowledged: true,
};
const capView = renderSheet(capInputs, "cap");
assert(capView.includes("R 4 000 000.00"), "the working shows the 80% cap");
assert(capView.includes("R 1 000 000.00"), "taxable income uses the limited set-off");

const { Window } = await import("happy-dom");
const dom = new Window({
  url: "http://127.0.0.1:5000/clients/qa",
  settings: { disableCSSFileLoading: true },
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Node",
  "Element",
  "Document",
  "Event",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: dom[key as keyof typeof dom],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
await act(async () => {
  root.render(
    createElement(ZaItr14Sheet, {
      client: { ...client, id: "c1" },
      today: "2026-11-03",
      drafts: [],
      initialYear: 2026,
      onSaved: () => undefined,
      onBack: () => undefined,
    }),
  );
});
const lossInput = document.querySelector(
  "#itr14-input-assessedLossBroughtForward",
) as HTMLInputElement;
const donationInput = document.querySelector("#itr14-input-donation") as HTMLInputElement;
assert(lossInput && donationInput, "the loss and donation fields are separate inputs");
const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
assert(valueSetter, "the input value can be set the way a keystroke does");
await act(async () => {
  lossInput.focus();
});
for (const digit of "500000") {
  await act(async () => {
    const next = `${lossInput.value}${digit}`;
    valueSetter.call(lossInput, next);
    const tracked = lossInput as HTMLInputElement & {
      _valueTracker?: { setValue: (value: string) => void };
    };
    tracked._valueTracker?.setValue(next.slice(0, -1));
    lossInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
eq(lossInput.value, "500000", "typing the brought-forward loss does not double or revert");
eq(donationInput.value, "", "the donation field does not take the loss keystrokes");
eq(document.activeElement, lossInput, "the loss field keeps focus while it is typed");
assert(
  document.body.innerHTML.includes('data-itr14-assessed-loss="true"'),
  "the working appears once the balance is typed",
);

console.log("acceptance wear-and-tear cents", schedule?.wearAndTearCents);
console.log("tax-itr14 ok");
