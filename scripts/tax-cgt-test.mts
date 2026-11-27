/**
 * Eighth Schedule disposal register on the ITR12 and ITR14 draft sheets.
 * Run: pnpm test:tax-cgt
 *
 * docs/sars does not sign off an inclusion rate or an exclusion, so the
 * taxable capital gain stays blank. Row gains are still worked out.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZaItr12Sheet } from "../src/components/tax-specialist/za-itr12-sheet";
import { ZaItr14Sheet } from "../src/components/tax-specialist/za-itr14-sheet";
import {
  CGT_YEAR_TABLE,
  capitalGainsSchedule,
  cgtYear,
  type CgtDisposal,
} from "../src/lib/tax-specialist/forms/cgt";
import type { TaxFormDraft } from "../src/lib/tax-specialist/forms/drafts";
import {
  computeItr12,
  itr12Csv,
  itr12DraftFields,
  itr12InputsFromDraft,
  type Itr12Inputs,
} from "../src/lib/tax-specialist/forms/itr12";
import {
  computeItr14,
  emptyItr14Inputs,
  itr14Csv,
  itr14DraftFields,
  itr14InputsFromDraft,
  type Itr14Inputs,
} from "../src/lib/tax-specialist/forms/itr14";
import { SAMPLE_COMPANY, sampleCompanyTax } from "../src/lib/tax-specialist/sample-compute";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
  }
}

eq(CGT_YEAR_TABLE.length, 0, "no year is signed off in docs/sars");
eq(cgtYear(2026), null, "2026 has no signed-off capital gains table");
const readme = readFileSync("docs/sars/README.md", "utf8");
const cgtNote = readme.split("Eighth Schedule capital gains")[1]?.split("\n- ")[0] ?? "";
assert(
  /not signed off/i.test(cgtNote),
  "docs/sars records that the capital gains rates are not signed off",
);
assert(
  !/40%|80%|R40 000|R2 000 000/.test(cgtNote),
  "docs/sars does not invent an inclusion rate or an exclusion",
);

const residence: CgtDisposal = {
  id: "home",
  description: "Primary residence",
  dateAcquired: "2010-03-01",
  dateDisposed: "2025-06-01",
  proceedsCents: 550_000_000,
  costCents: 200_000_000,
  improvementsCents: 50_000_000,
  sellingCostsCents: 10_000_000,
  primaryResidence: true,
};
const shares: CgtDisposal = {
  id: "shares",
  description: "Listed shares",
  dateAcquired: "2020-01-15",
  dateDisposed: "2025-11-01",
  proceedsCents: 40_000_000,
  costCents: 15_000_000,
  improvementsCents: 0,
  sellingCostsCents: 1_000_000,
  primaryResidence: false,
};

const individualInputs: Itr12Inputs = {
  taxReference: "1234567890",
  lines: [
    {
      id: "employment",
      fieldId: "employmentIncome",
      label: "Employment",
      amountCents: 5_000_000,
      fileId: null,
      source: "accountant",
      note: null,
    },
    {
      id: "practice",
      fieldId: "practiceIncome",
      label: "Practice",
      amountCents: 2_000_000,
      fileId: null,
      source: "accountant",
      note: null,
    },
    {
      id: "expenses",
      fieldId: "practiceExpenses",
      label: "Practice expenses",
      amountCents: 500_000,
      fileId: null,
      source: "accountant",
      note: null,
    },
  ],
  queries: [],
  disposals: [residence, shares],
  assessedCapitalLossBroughtForwardCents: 0,
};
const individual = computeItr12({
  clientName: "Nicola Physio",
  yearOfAssessment: 2026,
  inputs: individualInputs,
});
const home = individual.capital?.rows.find((row) => row.id === "home");
const listed = individual.capital?.rows.find((row) => row.id === "shares");
eq(home?.baseCostCents, 260_000_000, "primary residence base cost is cost plus improvements plus selling costs");
eq(home?.gainCents, 290_000_000, "primary residence gain is proceeds minus base cost");
assert((home?.gainCents ?? 0) > 200_000_000, "the primary residence gain is above R2 000 000");
eq(home?.primaryResidence, true, "the primary residence mark is kept");
eq(listed?.gainCents, 24_000_000, "the second disposal gain is proceeds minus base cost");
eq(individual.capital?.aggregateCents, 314_000_000, "the two disposals aggregate");
eq(individual.capital?.annualExclusionCents, null, "the annual exclusion stays blank");
eq(individual.capital?.primaryResidenceExclusionCents, null, "the primary residence exclusion stays blank");
eq(individual.capital?.inclusionPercent, null, "the individual inclusion rate stays blank");
eq(
  individual.capital?.taxableCapitalGainCents ?? null,
  null,
  "acceptance: taxable capital gain stays blank because the year is not signed off",
);
eq(individual.capital?.includedInTaxableIncome, false, "a blank taxable capital gain is not added");
eq(individual.taxableIncomeCents, 6_500_000, "taxable income stays employment plus practice net");
eq(
  (individual.taxableTie?.employmentCents ?? 0) +
    (individual.taxableTie?.practiceNetCents ?? 0) +
    (individual.taxableTie?.taxableCapitalGainCents ?? 0),
  individual.taxableIncomeCents,
  "acceptance: taxable income ties without an invented capital gain",
);
assert(
  !individual.checks.some((check) => check.id === "tie"),
  "the tie check passes",
);
assert(
  individual.capital?.notes.some((note) => /not signed off/i.test(note)),
  "the sheet says the rates are not signed off",
);

const storedIndividual = itr12DraftFields(individual, individualInputs);
const restoredIndividual = itr12InputsFromDraft({
  id: "d1",
  client_id: "c1",
  form_code: "ITR12",
  tax_year: 2026,
  period: null,
  subject: null,
  fields: storedIndividual,
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
  rules_year: 2026,
  field_sources: {},
} satisfies TaxFormDraft);
eq(restoredIndividual.disposals?.[0]?.proceedsCents, 550_000_000, "save draft keeps the disposal on reload");
eq(
  restoredIndividual.disposals?.[1]?.primaryResidence,
  false,
  "save draft keeps the primary residence mark",
);
eq(
  computeItr12({
    clientName: "Nicola Physio",
    yearOfAssessment: 2026,
    inputs: restoredIndividual,
  }).capital?.aggregateCents,
  314_000_000,
  "a reloaded draft keeps the aggregate",
);

const known = sampleCompanyTax();
const sample = SAMPLE_COMPANY.input;
const companyBase: Itr14Inputs = {
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
  provisionalPeriod1Cents: known.period1Cents,
  provisionalPeriod2Cents: known.period2Cents,
  provisionalTopUpCents: 0,
  turnoverCents: 400_000_000,
  accountTbAcknowledged: true,
  fixedAssetRegisterAcknowledged: true,
  balanceSheetAcknowledged: true,
};
const companyClient = {
  name: "Harbour & Co (Pty) Ltd",
  fyStartMonth: 3,
  financials: null,
  financialsAsOf: null,
};
const companyGain: CgtDisposal = {
  id: "plant",
  description: "Plant",
  dateAcquired: "2018-04-01",
  dateDisposed: "2025-08-01",
  proceedsCents: 100_000_000,
  costCents: 20_000_000,
  improvementsCents: 0,
  sellingCostsCents: 0,
  primaryResidence: null,
};
const gained = computeItr14({
  client: companyClient,
  yearOfAssessment: 2026,
  inputs: {
    ...companyBase,
    disposals: [companyGain],
    assessedCapitalLossBroughtForwardCents: 0,
  },
});
eq(gained.capital?.rows[0]?.gainCents, 80_000_000, "the company disposal gain is proceeds minus base cost");
eq(gained.capital?.inclusionPercent, null, "acceptance: company inclusion stays blank; 80% is not signed off");
eq(gained.capital?.taxableCapitalGainCents ?? null, null, "the company taxable capital gain stays blank");
eq(gained.capital?.annualExclusionApplies, false, "a company has no annual exclusion");
eq(gained.capital?.primaryResidenceApplies, false, "a company has no primary residence exclusion");
eq(gained.taxableIncomeCents, 182_850_000, "taxable income is unchanged while the inclusion is blank");
assert(
  gained.checks.some((check) => check.id === "adds-up" && check.level === "ok"),
  "the company bridge still ties",
);

const companyLoss: CgtDisposal = {
  id: "loss",
  description: "Shares sold at a loss",
  dateAcquired: "2019-01-01",
  dateDisposed: "2025-09-01",
  proceedsCents: 10_000_000,
  costCents: 40_000_000,
  improvementsCents: 0,
  sellingCostsCents: 0,
  primaryResidence: null,
};
const lost = computeItr14({
  client: companyClient,
  yearOfAssessment: 2026,
  inputs: {
    ...companyBase,
    disposals: [companyLoss],
    assessedCapitalLossBroughtForwardCents: 0,
  },
});
eq(lost.capital?.aggregateCents, -30_000_000, "the company disposal is a loss");
eq(lost.capital?.carriedForwardCents, 30_000_000, "acceptance: the net capital loss is carried forward");
eq(lost.capital?.lossCarriedForward, true, "the loss is marked carried forward");
eq(lost.capital?.includedInTaxableIncome, false, "the carried-forward loss is not included");
eq(lost.capital?.taxableCapitalGainCents ?? null, null, "a carried-forward loss is not a taxable capital gain");
eq(lost.taxableIncomeCents, 182_850_000, "the loss does not reduce taxable income");
assert(
  lost.checks.some((check) => check.id === "adds-up" && check.level === "ok"),
  "the bridge still ties when a capital loss is carried forward",
);
assert(itr14Csv(lost).includes("Capital loss carried forward"), "the CSV shows the carried-forward loss");
assert(itr14Csv(lost).includes("300000.00"), "the CSV shows the carried-forward amount");

const blank = computeItr14({
  client: companyClient,
  yearOfAssessment: 2026,
  inputs: companyBase,
});
eq(blank.capital, null, "acceptance: a blank register has no capital gains schedule");
eq(blank.taxableIncomeCents, 182_850_000, "a blank register leaves taxable income as it was");
assert(
  itr14Csv(blank).includes("Capital gains schedule,,Blank,A blank schedule is not zero"),
  "the CSV leaves a blank register blank",
);
eq(
  capitalGainsSchedule({
    person: "individual",
    yearOfAssessment: 2026,
    disposals: [],
    assessedCapitalLossBroughtForwardCents: null,
  }),
  null,
  "an empty individual register is blank",
);

const storedCompany = itr14DraftFields(gained, {
  ...companyBase,
  disposals: [companyGain],
  assessedCapitalLossBroughtForwardCents: 0,
});
eq(
  itr14InputsFromDraft({
    id: "d2",
    client_id: "c1",
    form_code: "ITR14",
    tax_year: 2026,
    period: null,
    subject: null,
    fields: storedCompany,
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
    rules_year: 2023,
    field_sources: {},
  } satisfies TaxFormDraft).disposals[0]?.costCents,
  20_000_000,
  "an ITR14 draft reloads the disposal",
);

const blankIndividualView = renderToStaticMarkup(
  createElement(ZaItr12Sheet, {
    client: { id: "c1", name: "Nicola Physio" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2026,
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
const blankCgt =
  blankIndividualView.split('data-itr12-cgt="blank"')[1]?.split('data-itr12-section="result"')[0] ??
  "";
assert(blankCgt.includes("A blank schedule is not zero"), "a blank register says it is not zero");
assert(blankCgt.includes('data-cgt-blank-line="Proceeds"'), "a blank register shows a proceeds line");
assert(blankCgt.includes('data-cgt-blank-line="Gain or loss"'), "a blank register shows a gain line");
assert(!blankCgt.includes("0.00"), "a blank register does not show 0.00");
assert(blankCgt.includes('data-cgt-add="true"'), "the accountant can add a disposal");
assert(blankCgt.includes('data-cgt-entry="assessed-loss"'), "assessed capital loss brought forward is on the sheet");

const owner = renderToStaticMarkup(
  createElement(ZaItr12Sheet, {
    client: { id: "c1", name: "Nicola Physio" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2026,
    approverRole: "owner",
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(owner.includes('data-itr12-cgt="blank"'), "the owner sees the capital gains section");
assert(owner.includes("A blank schedule is not zero"), "the owner sees a blank register");
assert(!owner.includes('data-cgt-add="true"'), "the owner cannot add a disposal");

const blankCompanyView = renderToStaticMarkup(
  createElement(ZaItr14Sheet, {
    client: { ...companyClient, id: "c1" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2026,
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
const blankCompanyCgt =
  blankCompanyView.split('data-itr14-cgt="blank"')[1]?.split("data-itr14-adjustments")[0] ?? "";
assert(blankCompanyCgt.includes("A blank schedule is not zero"), "the company sheet shows a blank register");
assert(!blankCompanyCgt.includes("0.00"), "the company blank register does not show 0.00");
assert(blankCompanyCgt.includes('data-cgt-add="true"'), "the company sheet can add a disposal");

const sectionSrc = readFileSync("src/components/tax-specialist/za-cgt-section.tsx", "utf8");
const cgtSrc = readFileSync("src/lib/tax-specialist/forms/cgt.ts", "utf8");
const sheet12 = readFileSync("src/components/tax-specialist/za-itr12-sheet.tsx", "utf8");
const sheet14 = readFileSync("src/components/tax-specialist/za-itr14-sheet.tsx", "utf8");
const pdf12 = readFileSync("src/components/tax-specialist/za-itr12-pdf.tsx", "utf8");
const pdf14 = readFileSync("src/components/tax-specialist/za-itr14-pdf.tsx", "utf8");
assert(sheet12.includes("<CgtSection"), "the ITR12 sheet mounts the capital gains section");
assert(sheet14.includes("<CgtSection"), "the ITR14 sheet mounts the capital gains section");
assert(cgtSrc.includes("A blank schedule is not zero"), "the schedule source names a blank schedule");
assert(sectionSrc.includes("CGT_BLANK_SCHEDULE"), "the sheet shows that blank-schedule sentence");
assert(sectionSrc.includes("onBlur"), "amounts commit on blur");
assert(sectionSrc.includes('entry="description"'), "the sheet source has a description control");
assert(sectionSrc.includes('data-cgt-entry="date-acquired"'), "the sheet source has a date acquired control");
assert(sectionSrc.includes('data-cgt-entry="date-disposed"'), "the sheet source has a date disposed control");
assert(sectionSrc.includes('entry="proceeds"'), "the sheet source has a proceeds control");
assert(sectionSrc.includes('entry="cost"'), "the sheet source has a cost control");
assert(sectionSrc.includes('entry="improvements"'), "the sheet source has an improvements control");
assert(sectionSrc.includes('entry="selling-costs"'), "the sheet source has a selling costs control");
assert(sectionSrc.includes('data-cgt-entry="primary-residence"'), "the sheet source has a primary residence control");
assert(sectionSrc.includes("Add a disposal"), "the sheet source can add a disposal");
assert(sectionSrc.includes("Remove disposal"), "the sheet source can remove a disposal");
assert(sectionSrc.includes("key={`${row.id}-proceeds`}"), "amount keys stay on the disposal id");
assert(pdf12.includes("Capital gains"), "the ITR12 PDF has a capital gains section");
assert(pdf14.includes("Capital gains"), "the ITR14 PDF has a capital gains section");
assert(pdf12.includes("Not a SARS return"), "the ITR12 PDF is not a SARS return");
assert(pdf14.includes("Not a SARS return"), "the ITR14 PDF is not a SARS return");
for (const src of [sectionSrc, sheet12, sheet14, pdf12, pdf14]) {
  assert(!/mailto:|sendEmail|resend|eFiling login|sars\.gov/i.test(src), "no send and no SARS login");
}
assert(!itr12Csv(individual).includes("mailto:"), "the CSV is not an email");

const { renderToBuffer } = await import("@react-pdf/renderer");
const { Itr12PDF } = await import("../src/components/tax-specialist/za-itr12-pdf");
const pdf = await renderToBuffer(
  createElement(Itr12PDF, {
    clientName: "Nicola Physio",
    sheet: individual,
    approvedByName: null,
    approvedAt: null,
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
assert(pdfText.includes("Capital gains"), "the PDF has the capital gains section");
assert(pdfText.includes("Primary residence"), "the PDF names the primary residence");
assert(/not signed off/i.test(pdfText), "the PDF says the rates are not signed off");

console.log("acceptance residence gain cents", home?.gainCents);
console.log("acceptance shares gain cents", listed?.gainCents);
console.log("acceptance aggregate cents", individual.capital?.aggregateCents);
console.log("acceptance taxable capital gain cents", individual.capital?.taxableCapitalGainCents);
console.log("acceptance individual taxable income cents", individual.taxableIncomeCents);
console.log("acceptance company gain cents", gained.capital?.rows[0]?.gainCents);
console.log("acceptance company inclusion", gained.capital?.inclusionPercent);
console.log("acceptance company loss carried forward cents", lost.capital?.carriedForwardCents);
console.log("tax-cgt ok");
