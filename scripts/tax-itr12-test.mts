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
  itr12YearStart,
  type Itr12Inputs,
  type Itr12SectionId,
} from "../src/lib/tax-specialist/forms/itr12";
import {
  RENTAL_GAP_PROMPTS,
  businessSchedule,
  markItr12BusinessNil,
  markItr12RentalNil,
  rentalSchedule,
  undoItr12BusinessNil,
  undoItr12RentalNil,
  type Itr12BusinessInput,
  type Itr12RentalProperty,
} from "../src/lib/tax-specialist/forms/itr12-schedules";
import { assetFieldIssue, wearSchedule, type WearAsset } from "../src/lib/tax-specialist/forms/itr14-allowances";
import { NIL_CONFIRMED_NOTE } from "../src/lib/tax-specialist/forms/nil-mark";
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
assert(view.includes("A blank schedule is not zero"), "a blank schedule says it is not zero");
assert(view.includes('data-itr12-entry="business-gross"'), "business gross is on the sheet");
assert(view.includes("data-itr12-deduction-add"), "a deduction line can be added");
assert(view.includes('data-itr12-entry="home-equipped"'), "the s23(b) equipped mark is on the sheet");
assert(view.includes('data-itr12-entry="s20a"'), "the s20A mark is on the sheet");
assert(view.includes("data-itr12-rental-add"), "a rental property can be added");
assert(view.includes('data-itr12-entry="private-use"') || view.includes("Private use: Blank"), "private use is on the blank rental schedule");
const blankBusiness = view.split('data-itr12-business="blank"')[1]?.split("data-itr12-rental=")[0] ?? "";
assert(blankBusiness.includes("A blank schedule is not zero"), "the blank business section says it is not zero");
assert(!blankBusiness.includes("0.00"), "a blank business schedule does not show 0.00");
const blankRental = view.split('data-itr12-rental="blank"')[1]?.split('data-itr12-section="result"')[0] ?? "";
assert(blankRental.includes("A blank schedule is not zero"), "the blank rental section says it is not zero");
assert(!blankRental.includes("0.00"), "a blank rental schedule does not show 0.00");

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
assert(!owner.includes("data-itr12-deduction-add"), "the owner cannot add a deduction");
assert(!owner.includes("data-itr12-asset-add"), "the owner cannot add a wear-and-tear asset");
assert(!owner.includes("data-itr12-rental-add"), "the owner cannot add a property");
assert(owner.includes("A blank schedule is not zero"), "the owner still sees a blank schedule");

const sheetSrc = readFileSync("src/components/tax-specialist/za-itr12-sheet.tsx", "utf8");
const pdfSrc = readFileSync("src/components/tax-specialist/za-itr12-pdf.tsx", "utf8");
const scheduleSrc = readFileSync("src/lib/tax-specialist/forms/itr12-schedules.ts", "utf8");
for (const src of [
  sheetSrc,
  pdfSrc,
  scheduleSrc,
  readFileSync("src/lib/tax-specialist/forms/itr12.ts", "utf8"),
]) {
  assert(!/mailto:|sendEmail|resend|eFiling login|sars\.gov/i.test(src), "no send and no SARS login");
}
assert(sheetSrc.includes("A blank schedule is not zero"), "the sheet source names a blank schedule");
assert(sheetSrc.includes('entry="business-gross"'), "the sheet source has a gross income control");
assert(sheetSrc.includes("data-itr12-deduction-add"), "the sheet source can add a deduction");
assert(sheetSrc.includes('entry="home-equipped"'), "the sheet source has the equipped s23(b) mark");
assert(sheetSrc.includes('entry="home-exclusive"'), "the sheet source has the exclusive s23(b) mark");
assert(sheetSrc.includes('entry="s20a"'), "the sheet source has the s20A mark");
assert(sheetSrc.includes('entry="asset-description"'), "the sheet source has a wear-and-tear asset control");
assert(sheetSrc.includes("data-itr12-asset-add"), "the sheet source can add an asset");
assert(sheetSrc.includes("data-itr12-rental-add"), "the sheet source can add a property");
assert(sheetSrc.includes('entry="private-use"'), "the sheet source has private use");
assert(sheetSrc.includes("onBlur"), "schedule amounts commit on blur");
assert(sheetSrc.includes("AssetDateInput"), "the asset date uses the shared input");
assert(!sheetSrc.includes('type="date"'), "the asset date is not the browser date control");
assert(sheetSrc.includes("Asset {index + 1}"), "an asset legend does not echo the description");
assert(sheetSrc.includes("data-itr12-gap"), "a missing rental field is named beside the input");
const dateSrc = readFileSync("src/components/tax-specialist/asset-date-input.tsx", "utf8");
assert(dateSrc.includes("onBlur"), "the date commits on blur");
assert(dateSrc.includes('type="text"'), "the date is a plain text input");
assert(!dateSrc.includes('type="date"'), "the date input is not type=date");
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
let pdfText = "";
for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  pdfText += content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}
assert(pdfText.includes("Not a SARS return"), "the PDF pages say it is not a SARS return");
assert(pdfText.includes("Not computed"), "the PDF does not invent tax payable");
assert(pdfText.includes("file-0"), "the PDF cites a file id");
assert(pdfText.includes("A blank schedule is not zero"), "a blank schedule is not shown as zero");
assert(!/mailto:/i.test(pdfText), "the PDF is not an email");

const yearStart = itr12YearStart(2026);
const yearEnd = itr12YearEnd(2026);
const laptop: WearAsset = {
  id: "pc",
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
  bookDepreciationCents: null,
};
const businessInput: Itr12BusinessInput = {
  grossIncomeCents: 20_000_000,
  deductions: [
    { id: "fees", label: "Accounting fees", amountCents: 1_000_000 },
    { id: "phone", label: "Telephone", amountCents: 500_000 },
  ],
  homeOffice: {
    amountCents: 200_000,
    specificallyEquipped: true,
    regularlyAndExclusivelyUsed: true,
  },
  assets: [laptop],
  wearAndTearCents: null,
  ringFenceS20A: false,
};
const business = businessSchedule(businessInput, yearStart, yearEnd);
eq(business?.wearAndTearCents, wearSchedule([laptop], yearStart, yearEnd)?.wearAndTearCents, "wear comes from the asset register");
eq(business?.wearAndTearCents, 1_200_000, "the laptop is a full year at 3 years");
eq(business?.netProfitCents, 17_100_000, "acceptance: business fixture net profit is R171 000.00");
const ringFenced = businessSchedule({ ...businessInput, ringFenceS20A: true }, yearStart, yearEnd);
eq(ringFenced?.netProfitCents, business?.netProfitCents, "the s20A mark does not change the net");
eq(ringFenced?.ringFenceS20A, true, "the s20A mark is kept");
const homeRefused = businessSchedule(
  {
    ...businessInput,
    assets: [],
    wearAndTearCents: 0,
    homeOffice: {
      amountCents: 200_000,
      specificallyEquipped: false,
      regularlyAndExclusivelyUsed: true,
    },
  },
  yearStart,
  yearEnd,
);
eq(homeRefused?.homeOffice?.deductedCents, 0, "a failed s23(b) mark does not deduct the home office");
eq(homeRefused?.netProfitCents, 18_500_000, "the refused home office stays out of the net");
const homeOpen = businessSchedule(
  {
    ...businessInput,
    assets: [],
    wearAndTearCents: 0,
    homeOffice: {
      amountCents: 200_000,
      specificallyEquipped: null,
      regularlyAndExclusivelyUsed: true,
    },
  },
  yearStart,
  yearEnd,
);
eq(homeOpen?.netProfitCents, null, "an unmarked s23(b) condition leaves the net blank");
eq(homeOpen?.homeOffice?.deductedCents, null, "an unmarked home office deduction stays blank");
const wearBlank = businessSchedule(
  {
    grossIncomeCents: 20_000_000,
    deductions: [],
    homeOffice: null,
    assets: [],
    wearAndTearCents: null,
    ringFenceS20A: null,
  },
  yearStart,
  yearEnd,
);
eq(wearBlank?.wearAndTearCents, null, "wear without a register stays blank");
eq(wearBlank?.netProfitCents, null, "a missing wear figure does not become zero");

function rental(id: string, description: string, privateUsePercent: number, amounts: number[]): Itr12RentalProperty {
  const [rent, rates, interest, insurance, repairs, levies, agent, wear] = amounts;
  return {
    id,
    description,
    rentReceivedCents: rent,
    ratesCents: rates,
    interestCents: interest,
    insuranceCents: insurance,
    repairsCents: repairs,
    leviesCents: levies,
    agentFeesCents: agent,
    wearAndTearCents: wear,
    assets: [],
    privateUsePercent,
  };
}
const rentals = [
  rental("flat", "Flat", 0, [10_000_000, 1_000_000, 2_000_000, 500_000, 300_000, 200_000, 1_000_000, 1_000_000]),
  rental("house", "House", 25, [8_000_000, 800_000, 1_200_000, 400_000, 600_000, 0, 800_000, 1_200_000]),
];
const rentalSheet = rentalSchedule(rentals, yearStart, yearEnd);
const flat = rentalSheet?.properties.find((row) => row.id === "flat");
const house = rentalSheet?.properties.find((row) => row.id === "house");
eq(flat?.netCents, 4_000_000, "the flat has no private use, so every expense is allowed");
eq(house?.allowableExpensesCents, 3_750_000, "25% private use leaves 75% of the house expenses");
eq(house?.netCents, 4_250_000, "acceptance: the house net is rent minus the apportioned expenses");
eq(rentalSheet?.totalNetCents, 8_250_000, "acceptance: two-property net rental is R82 500.00");
const rentalGap = rentalSchedule(
  [rental("flat", "Flat", 0, [10_000_000, 1_000_000, 2_000_000, 500_000, 300_000, 200_000, 1_000_000, 1_000_000]), { ...rentals[1], privateUsePercent: null }],
  yearStart,
  yearEnd,
);
eq(rentalGap?.properties[1]?.netCents, null, "a missing private-use percent stays blank");
eq(rentalGap?.totalNetCents, null, "one blank property does not become zero in the total");
eq(
  rentalGap?.properties[1]?.gaps.map((gap) => gap.prompt).join(" "),
  RENTAL_GAP_PROMPTS.privateUsePercent,
  "only the missing private-use field is named",
);
const qaProperty: Itr12RentalProperty = {
  id: "qa",
  description: "QA flat",
  rentReceivedCents: 12_000_000,
  ratesCents: null,
  interestCents: null,
  insuranceCents: null,
  repairsCents: 2_000_000,
  leviesCents: null,
  agentFeesCents: null,
  wearAndTearCents: null,
  assets: [],
  privateUsePercent: null,
};
const qaRental = rentalSchedule([qaProperty], yearStart, yearEnd);
eq(qaRental?.properties[0]?.netCents, null, "rent and repairs alone do not invent a net");
eq(qaRental?.totalNetCents, null, "an incomplete rental total stays blank");
const qaPrompts = qaRental?.properties[0]?.gaps.map((gap) => gap.prompt) ?? [];
for (const field of [
  "ratesCents",
  "interestCents",
  "insuranceCents",
  "leviesCents",
  "agentFeesCents",
  "wearAndTearCents",
  "privateUsePercent",
] as const) {
  assert(qaPrompts.includes(RENTAL_GAP_PROMPTS[field]), `${field} is named`);
}
assert(!qaPrompts.includes(RENTAL_GAP_PROMPTS.rentReceivedCents), "typed rent is not listed as missing");
assert(!qaPrompts.includes(RENTAL_GAP_PROMPTS.repairsCents), "typed repairs are not listed as missing");
const qaSheet = computeItr12({
  clientName: "Ben",
  yearOfAssessment: 2026,
  inputs: { ...emptyItr12Inputs(), rentals: [qaProperty] },
});
eq(qaSheet.taxableIncomeCents, null, "incomplete rental does not become taxable income");
const qaTaxable = qaSheet.lines.find((line) => line.id === "taxableIncome");
eq(qaTaxable?.plain, "", "taxable income stays blank");
assert(
  qaTaxable?.note?.includes("The local rental schedule is incomplete"),
  "the incomplete message stays",
);
assert(
  qaTaxable?.note?.includes(RENTAL_GAP_PROMPTS.privateUsePercent),
  "the incomplete message names private use",
);
for (const prompt of qaPrompts) {
  assert(qaTaxable?.note?.includes(prompt), "the incomplete message lists every missing field");
}
const qaView = renderToStaticMarkup(
  createElement(ZaItr12Sheet, {
    client: { id: "c1", name: "Ben" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2026,
    seed: { ...emptyItr12Inputs(), rentals: [qaProperty] },
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(qaView.includes('data-itr12-gap="privateUsePercent"'), "private use is named on the property");
assert(qaView.includes("Net rental: Blank"), "the property net stays Blank");
assert(qaView.includes(">—<") || qaView.includes("—"), "taxable income renders as a dash");
assert(!qaView.includes("Net rental: R 0.00"), "the blank net is not zero");

const combinedInputs: Itr12Inputs = {
  taxReference: "1234567890",
  lines: (
    [
      ["employmentIncome", 5_000_000],
      ["practiceIncome", 1_000_000],
      ["practiceExpenses", 400_000],
      ["medicalContributions", 1],
      ["raContributions", 1],
      ["travelClaim", 1],
      ["localInterest", 1],
    ] as const
  ).map(([fieldId, amountCents], index) => ({
    id: `sched-${index}`,
    fieldId,
    label: fieldId,
    amountCents,
    fileId: `file-${index}`,
    source: "file" as const,
    note: null,
  })),
  queries: [],
  business: businessInput,
  rentals,
};
const combined = computeItr12({
  clientName: "Nicola Physio",
  yearOfAssessment: 2026,
  inputs: combinedInputs,
});
eq(combined.totals.incomeTotal, 6_000_000, "the income tie is still employment plus practice");
eq(
  combined.totals.incomeTotal,
  combined.totals.employmentIncome! + combined.totals.practiceIncome!,
  "the existing income bridge still ties",
);
eq(combined.business?.netProfitCents, 17_100_000, "the business net flows onto the ITR12");
eq(combined.rentals?.totalNetCents, 8_250_000, "the rental total flows onto the ITR12");
eq(combined.taxableIncomeCents, 30_350_000, "acceptance: both schedules flow into taxable income");
eq(combined.taxableTie?.practiceNetCents, null, "the business schedule replaces practice income and expenses");
eq(
  combined.taxableTie?.employmentCents! +
    combined.taxableTie?.businessNetCents! +
    combined.taxableTie?.rentalNetCents!,
  combined.taxableIncomeCents,
  "taxable income ties to employment, business net, and rental net",
);
assert(!combined.checks.some((check) => check.id === "tie"), "the tie check passes");
assert(
  combined.lines.some((line) => line.id === "taxableIncome" && line.note?.includes("not signed off")),
  "unsigned interest, medical, and retirement limits stay out",
);

const blankSheet = computeItr12({
  clientName: "Nicola Physio",
  yearOfAssessment: 2026,
  inputs: emptyItr12Inputs(),
});
eq(blankSheet.business, null, "acceptance: a blank business schedule stays blank");
eq(blankSheet.rentals, null, "acceptance: a blank rental schedule stays blank");
eq(blankSheet.taxableIncomeCents, null, "a blank draft does not invent taxable income");
eq(
  blankSheet.lines.find((line) => line.id === "taxableIncome")?.plain,
  "",
  "a blank taxable income line is empty",
);
assert(
  blankSheet.lines.find((line) => line.id === "taxableIncome")?.plain !== "0.00",
  "a blank taxable income line is not zero",
);

const restored = itr12InputsFromDraft({
  id: "d-sched",
  client_id: "c1",
  form_code: "ITR12",
  tax_year: 2026,
  period: null,
  subject: null,
  fields: itr12DraftFields(combined, combinedInputs),
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
  field_sources: {},
} satisfies TaxFormDraft);
eq(
  computeItr12({ clientName: "Nicola Physio", yearOfAssessment: 2026, inputs: restored }).taxableIncomeCents,
  30_350_000,
  "a saved draft keeps both schedules in taxable income",
);

const schedulePdf = await renderToBuffer(
  createElement(Itr12PDF, {
    clientName: "Nicola Physio",
    sheet: combined,
    approvedByName: "Ada Mbeki",
    approvedAt: "2026-11-03T08:00:00.000Z",
    preparedOn: "2026-11-03",
  }) as Parameters<typeof renderToBuffer>[0],
);
const scheduleDoc = await getDocumentProxy(new Uint8Array(schedulePdf));
let scheduleText = "";
for (let pageNumber = 1; pageNumber <= scheduleDoc.numPages; pageNumber += 1) {
  const page = await scheduleDoc.getPage(pageNumber);
  const content = await page.getTextContent();
  scheduleText += content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}
assert(scheduleText.includes("Local business, trade, or profession"), "the PDF has the business schedule");
assert(scheduleText.includes("Local rental income"), "the PDF has the rental schedule");
assert(scheduleText.includes("R 171 000.00"), "the PDF shows the business net");
assert(scheduleText.includes("R 40 000.00"), "the PDF shows the flat net");
assert(scheduleText.includes("R 42 500.00"), "the PDF shows the house net");
assert(scheduleText.includes("R 82 500.00"), "the PDF shows the rental total");
assert(scheduleText.includes("R 303 500.00"), "the PDF shows taxable income");
assert(scheduleText.includes("not signed off"), "the PDF says what is not signed off");
assert(scheduleText.includes("Not a SARS return"), "the schedule PDF is not a SARS return");
assert(!/mailto:/i.test(scheduleText), "the schedule PDF is not an email");

const scheduledView = renderToStaticMarkup(
  createElement(ZaItr12Sheet, {
    client: { id: "c1", name: "Nicola Physio" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2026,
    seed: combinedInputs,
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(scheduledView.includes('data-itr12-business="filled"'), "the sheet shows the business schedule");
assert(scheduledView.includes('data-itr12-rental="filled"'), "the sheet shows the rental schedule");
assert(scheduledView.includes("R 171 000.00"), "the sheet shows the business net");
assert(scheduledView.includes("not signed off"), "the sheet says what is not signed off");

const nilBusiness: Itr12BusinessInput = {
  grossIncomeCents: 25_000,
  deductions: [{ id: "phone", label: "Phone", amountCents: 5_000 }],
  homeOffice: null,
  assets: [],
  wearAndTearCents: null,
  ringFenceS20A: null,
};
const markedBusiness = markItr12BusinessNil(nilBusiness);
eq(markedBusiness.grossIncomeCents, 25_000, "a typed business gross stays");
eq(markedBusiness.deductions[0]?.amountCents, 5_000, "a typed deduction stays");
eq(markedBusiness.wearAndTearCents, 0, "a blank wear line becomes 0");
assert(
  businessSchedule(markedBusiness, yearStart, yearEnd)?.notes.includes(NIL_CONFIRMED_NOTE),
  "the business schedule carries the nil note",
);
const undoneBusiness = undoItr12BusinessNil(markedBusiness);
eq(undoneBusiness.wearAndTearCents, null, "undo puts the wear line back to blank");
eq(undoneBusiness.grossIncomeCents, 25_000, "undo leaves the typed gross");
eq(undoneBusiness.deductions[0]?.amountCents, 5_000, "undo leaves the typed deduction");
eq(undoneBusiness.nilMark, null, "undo clears the business nil mark");
assert(
  !businessSchedule(undoneBusiness, yearStart, yearEnd)?.notes.includes(NIL_CONFIRMED_NOTE),
  "undo removes the business nil note",
);
const blankMarked = markItr12BusinessNil({
  grossIncomeCents: null,
  deductions: [],
  homeOffice: null,
  assets: [],
  wearAndTearCents: null,
  ringFenceS20A: null,
});
eq(blankMarked.grossIncomeCents, 0, "a blank gross becomes 0");
eq(blankMarked.wearAndTearCents, 0, "a blank wear line becomes 0");

const markedRental = markItr12RentalNil(qaProperty);
eq(markedRental.rentReceivedCents, qaProperty.rentReceivedCents, "typed rent stays");
eq(markedRental.repairsCents, qaProperty.repairsCents, "typed repairs stay");
eq(markedRental.ratesCents, 0, "blank rates become 0");
eq(markedRental.privateUsePercent, 0, "blank private use becomes 0");
assert(
  rentalSchedule([markedRental], yearStart, yearEnd)?.properties[0]?.nilConfirmed === true,
  "the rental schedule carries the nil note",
);
const undoneRental = undoItr12RentalNil(markedRental);
eq(undoneRental.ratesCents, null, "undo puts rates back to blank");
eq(undoneRental.privateUsePercent, null, "undo puts private use back to blank");
eq(undoneRental.rentReceivedCents, qaProperty.rentReceivedCents, "undo leaves typed rent");
eq(undoneRental.repairsCents, qaProperty.repairsCents, "undo leaves typed repairs");
assert(
  rentalSchedule([undoneRental], yearStart, yearEnd)?.properties[0]?.nilConfirmed === false,
  "undo removes the rental nil note",
);

const nilInputs: Itr12Inputs = {
  ...emptyItr12Inputs(),
  business: markedBusiness,
  rentals: [markedRental],
};
const nilSheet = computeItr12({
  clientName: "Nicola Physio",
  yearOfAssessment: 2026,
  inputs: nilInputs,
});
const nilCsv = itr12Csv(nilSheet);
assert(nilCsv.includes(NIL_CONFIRMED_NOTE), "the CSV carries the nil note");
assert(nilCsv.split(NIL_CONFIRMED_NOTE).length >= 3, "business and rental each carry the nil note");
const nilPdf = await renderToBuffer(
  createElement(Itr12PDF, {
    clientName: "Nicola Physio",
    sheet: nilSheet,
    approvedByName: null,
    approvedAt: null,
    preparedOn: "2026-11-03",
  }) as Parameters<typeof renderToBuffer>[0],
);
const nilDoc = await getDocumentProxy(new Uint8Array(nilPdf));
let nilPdfText = "";
for (let pageNumber = 1; pageNumber <= nilDoc.numPages; pageNumber += 1) {
  const page = await nilDoc.getPage(pageNumber);
  const content = await page.getTextContent();
  nilPdfText += content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}
assert(nilPdfText.includes(NIL_CONFIRMED_NOTE), "the PDF carries the nil note");
const nilView = renderToStaticMarkup(
  createElement(ZaItr12Sheet, {
    client: { id: "c1", name: "Nicola Physio" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2026,
    seed: nilInputs,
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(nilView.includes('data-nil-note="itr12-business"'), "the business sheet shows the nil note");
assert(nilView.includes('data-nil-blanks="itr12-business"'), "the business sheet has the nil button");
assert(nilView.includes('data-nil-undo="itr12-business"'), "the business nil mark can be undone");

const clearedAsset = {
  id: "cleared",
  description: "Chair",
  costCents: null,
  broughtIntoUse: "2025-03-01",
  category: "Office equipment",
  section: "s11e" as const,
  privateUsePercent: 0,
  newAndUnused: false,
  additionCents: null,
  additionDate: null,
  disposalDate: null,
  proceedsCents: null,
  bookDepreciationCents: null,
};
const badDateAsset = {
  ...clearedAsset,
  id: "baddate",
  description: "Lamp",
  costCents: 10_000,
  broughtIntoUse: "2025-02-31",
};
eq(assetFieldIssue(clearedAsset)?.field, "cost", "a cleared cost belongs beside cost");
eq(
  assetFieldIssue(badDateAsset)?.message,
  "Date brought into use must be a real date.",
  "a bad date names the date",
);
const assetView = renderToStaticMarkup(
  createElement(ZaItr12Sheet, {
    client: { id: "c1", name: "Nicola Physio" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2026,
    seed: {
      ...emptyItr12Inputs(),
      business: {
        grossIncomeCents: null,
        deductions: [],
        homeOffice: null,
        assets: [clearedAsset, badDateAsset],
        wearAndTearCents: null,
        ringFenceS20A: null,
      },
    },
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(assetView.includes('data-asset-row="cleared"'), "a cleared-cost asset row stays");
assert(assetView.includes('data-asset-row="baddate"'), "a bad-date asset row stays");
assert(
  assetView.includes('data-asset-field-issue="cost"') &&
    assetView.includes("Cost must be a nil or positive amount."),
  "the cleared cost message sits beside the cost field",
);
assert(
  assetView.includes('data-asset-field-issue="date"') &&
    assetView.includes("Date brought into use must be a real date."),
  "the bad date message sits beside the date field",
);

console.log("tax-itr12 ok");
