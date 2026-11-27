/**
 * Eighth Schedule disposal register on the ITR12 and ITR14 draft sheets.
 * Run: pnpm test:tax-cgt
 *
 * 2026 and 2027 are signed off in docs/sars. Any other year stays blank.
 * Row gains are worked out either way.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ZaItr12Sheet } from "../src/components/tax-specialist/za-itr12-sheet";
import { ZaItr14Sheet } from "../src/components/tax-specialist/za-itr14-sheet";
import {
  capitalGainsSchedule,
  cgtCsvRows,
  cgtYear,
  type CgtDisposal,
} from "../src/lib/tax-specialist/forms/cgt";
import {
  NIL_CONFIRMED_NOTE,
  markCapitalLossNil,
  undoCapitalLossNil,
} from "../src/lib/tax-specialist/forms/nil-confirm";
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

const year2026 = cgtYear(2026);
const year2027 = cgtYear(2027);
eq(year2026?.annualExclusionCents, 4_000_000, "2026 annual exclusion is R40 000");
eq(year2026?.primaryResidenceExclusionCents, 200_000_000, "2026 primary residence exclusion is R2 000 000");
eq(year2026?.individualInclusionPercent, 40, "2026 individual inclusion is 40%");
eq(year2026?.companyInclusionPercent, 80, "2026 company inclusion is 80%");
eq(year2027?.annualExclusionCents, 5_000_000, "2027 annual exclusion is R50 000");
eq(year2027?.primaryResidenceExclusionCents, 300_000_000, "2027 primary residence exclusion is R3 000 000");
eq(year2027?.individualInclusionPercent, 40, "2027 individual inclusion is 40%");
eq(year2027?.companyInclusionPercent, 80, "2027 company inclusion is 80%");
eq(cgtYear(2025), null, "2025 is not signed off");
eq(cgtYear(2028), null, "2028 is not signed off");
const readme = readFileSync("docs/sars/README.md", "utf8");
assert(readme.includes("Fetched on 27 November 2026"), "docs/sars records the fetch date");
assert(
  readme.includes("https://www.sars.gov.za/tax-rates/income-tax/capital-gains-tax-cgt/"),
  "docs/sars cites the capital gains rates page",
);
assert(
  readme.includes("https://www.sars.gov.za/wp-content/uploads/20256/Budget-tax-guide-21-May-2025.pdf"),
  "docs/sars cites the 2025/26 budget tax guide",
);
assert(
  readme.includes(
    "https://www.sars.gov.za/wp-content/uploads/Docs/Budget/Budget2026/Budget-tax-guide-2026-web-version.pdf",
  ),
  "docs/sars cites the 2026/27 budget tax guide",
);
assert(
  readme.includes(
    "https://www.sars.gov.za/wp-content/uploads/Ops/Guides/Legal-Pub-Guide-IT11-Tax-guide-for-share-owners.pdf",
  ),
  "docs/sars cites the share owners guide for the inclusion rates",
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
const ya2027 = capitalGainsSchedule({
  person: "individual",
  yearOfAssessment: 2027,
  disposals: [
    { ...residence, id: "home-2027" },
    { ...shares, id: "shares-2027" },
  ],
  assessedCapitalLossBroughtForwardCents: 0,
});
eq(ya2027?.primaryResidenceExclusionCents, 290_000_000, "2027 disregards the whole residence gain under the R3 000 000 cap");
eq(ya2027?.annualExclusionCents, 5_000_000, "2027 uses the R50 000 annual exclusion");
eq(ya2027?.taxableCapitalGainCents, 7_600_000, "2027 taxable capital gain is the shares balance at 40%");

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
eq(individual.capital?.primaryResidenceExclusionCents, 200_000_000, "R2 000 000 of the residence gain is excluded");
eq(individual.capital?.annualExclusionCents, 4_000_000, "the R40 000 annual exclusion is applied");
eq(individual.capital?.netCapitalGainCents, 110_000_000, "net capital gain is R1 100 000");
eq(individual.capital?.inclusionPercent, 40, "the individual inclusion rate is 40%");
eq(
  individual.capital?.taxableCapitalGainCents,
  44_000_000,
  "acceptance: taxable capital gain is R440 000",
);
eq(individual.capital?.includedInTaxableIncome, true, "the taxable capital gain is included");
eq(
  individual.capital?.ratesNote,
  "Rates from SARS published tables YA2026; accountant to confirm",
  "the sheet names the signed-off year for the accountant to confirm",
);
eq(individual.taxableIncomeCents, 50_500_000, "taxable income includes the taxable capital gain");
eq(
  (individual.taxableTie?.employmentCents ?? 0) +
    (individual.taxableTie?.practiceNetCents ?? 0) +
    (individual.taxableTie?.taxableCapitalGainCents ?? 0),
  individual.taxableIncomeCents,
  "acceptance: taxable income ties to employment, practice, and the taxable capital gain",
);
assert(
  !individual.checks.some((check) => check.id === "tie"),
  "the tie check passes",
);

const unsignedIndividual = computeItr12({
  clientName: "Nicola Physio",
  yearOfAssessment: 2025,
  inputs: individualInputs,
});
eq(unsignedIndividual.capital?.taxableCapitalGainCents ?? null, null, "an unsigned year leaves the taxable capital gain blank");
eq(unsignedIndividual.capital?.ratesNote, null, "an unsigned year has no rates note");
eq(unsignedIndividual.taxableIncomeCents, 6_500_000, "an unsigned year does not add a capital gain to taxable income");
assert(
  !unsignedIndividual.checks.some((check) => check.id === "tie"),
  "the unsigned year still ties",
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
eq(gained.capital?.inclusionPercent, 80, "the company inclusion rate is 80%");
eq(gained.capital?.taxableCapitalGainCents, 64_000_000, "acceptance: company taxable capital gain is R800 000 at 80%");
eq(gained.capital?.annualExclusionApplies, false, "a company has no annual exclusion");
eq(gained.capital?.primaryResidenceApplies, false, "a company has no primary residence exclusion");
eq(gained.taxableIncomeCents, 246_850_000, "taxable income includes the company taxable capital gain");
eq(gained.taxCents, 66_649_500, "normal tax is 27% of taxable income after the capital gain");
assert(
  gained.checks.some((check) => check.id === "adds-up" && check.level === "ok"),
  "the company bridge still ties",
);
assert(
  !gained.checks.some((check) => check.id === "rate"),
  "the rate check passes after the capital gain is included",
);
const unsignedCompany = computeItr14({
  client: companyClient,
  yearOfAssessment: 2025,
  inputs: {
    ...companyBase,
    disposals: [companyGain],
    assessedCapitalLossBroughtForwardCents: 0,
  },
});
eq(unsignedCompany.capital?.inclusionPercent, null, "an unsigned company year does not apply 80%");
eq(unsignedCompany.capital?.taxableCapitalGainCents ?? null, null, "an unsigned company year leaves the taxable capital gain blank");
eq(unsignedCompany.taxableIncomeCents, 182_850_000, "an unsigned company year does not add a capital gain");

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
assert(sectionSrc.includes("ratesNote"), "the taxable capital gain line carries the rates note");
assert(pdf12.includes("ratesNote"), "the ITR12 PDF carries the rates note");
assert(pdf14.includes("ratesNote"), "the ITR14 PDF carries the rates note");
assert(!/sars\.gov/i.test(cgtSrc), "the capital gains source does not embed a SARS address");
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
const typedLoss = markCapitalLossNil(4_000_000, false);
eq(typedLoss.cents, 4_000_000, "a typed brought-forward loss stays");
eq(typedLoss.confirmed, false, "a typed brought-forward loss is not confirmed nil");
const blankLoss = markCapitalLossNil(null, false);
eq(blankLoss.cents, 0, "a blank brought-forward loss becomes nil");
eq(blankLoss.confirmed, true, "a blank brought-forward loss is confirmed nil");
const restoredLoss = undoCapitalLossNil(blankLoss.cents, blankLoss.confirmed);
eq(restoredLoss.cents, null, "undo restores the blank brought-forward loss");
eq(restoredLoss.confirmed, false, "undo clears the capital-loss confirmation");
const nilCapital = capitalGainsSchedule({
  person: "individual",
  yearOfAssessment: 2026,
  disposals: [shares],
  assessedCapitalLossBroughtForwardCents: blankLoss.cents,
  broughtForwardNilConfirmed: true,
});
assert(nilCapital?.notes.includes(NIL_CONFIRMED_NOTE), "the capital gains schedule carries the nil note");
eq(nilCapital?.rows[0]?.proceedsCents, 40_000_000, "the disposal proceeds stay");
assert(
  cgtCsvRows(nilCapital).some((row) => row.includes(NIL_CONFIRMED_NOTE)),
  "the capital gains CSV carries the nil confirmation",
);
const nilCgtView = renderToStaticMarkup(
  createElement(ZaItr12Sheet, {
    client: { id: "c1", name: "Nicola Physio" },
    today: "2026-11-03",
    drafts: [],
    initialYear: 2026,
    seed: {
      taxReference: "",
      lines: [],
      queries: [],
      disposals: [shares],
      assessedCapitalLossBroughtForwardCents: 0,
      capitalLossNilConfirmed: true,
    },
    onSaved: () => undefined,
    onBack: () => undefined,
  }),
);
assert(nilCgtView.includes('data-nil-mark="cgt"'), "the capital loss has the nil button");
assert(nilCgtView.includes('data-nil-undo="cgt"'), "the capital loss confirmation can be undone");
assert(nilCgtView.includes('data-nil-note="cgt"'), "the capital gains sheet shows the nil note");
assert(nilCgtView.includes(NIL_CONFIRMED_NOTE), "the capital gains sheet shows the confirmation sentence");
const nilCgtSheet = computeItr12({
  clientName: "Nicola Physio",
  yearOfAssessment: 2026,
  inputs: {
    taxReference: "",
    lines: [],
    queries: [],
    disposals: [shares],
    assessedCapitalLossBroughtForwardCents: 0,
    capitalLossNilConfirmed: true,
  },
});
assert(itr12Csv(nilCgtSheet).includes(NIL_CONFIRMED_NOTE), "the ITR12 CSV carries the capital-loss confirmation");
const { renderToBuffer: renderNilCgt } = await import("@react-pdf/renderer");
const { Itr12PDF: NilCgtPDF } = await import("../src/components/tax-specialist/za-itr12-pdf");
const nilCgtPdf = await renderNilCgt(
  createElement(NilCgtPDF, {
    clientName: "Nicola Physio",
    sheet: nilCgtSheet,
    approvedByName: null,
    approvedAt: null,
    preparedOn: "2026-11-03",
  }) as Parameters<typeof renderNilCgt>[0],
);
const nilCgtDoc = await getDocumentProxy(new Uint8Array(nilCgtPdf));
let nilCgtText = "";
for (let pageNumber = 1; pageNumber <= nilCgtDoc.numPages; pageNumber += 1) {
  const page = await nilCgtDoc.getPage(pageNumber);
  const content = await page.getTextContent();
  nilCgtText += content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
}
assert(nilCgtText.includes(NIL_CONFIRMED_NOTE), "the capital gains PDF carries the nil confirmation");
assert(pdfText.includes("Not a SARS return"), "the PDF pages say it is not a SARS return");
assert(pdfText.includes("Capital gains"), "the PDF has the capital gains section");
assert(pdfText.includes("Primary residence"), "the PDF names the primary residence");
assert(
  pdfText.includes("Rates from SARS published tables YA2026; accountant to confirm"),
  "the PDF asks the accountant to confirm the signed-off rates",
);

console.log("acceptance residence gain cents", home?.gainCents);
console.log("acceptance shares gain cents", listed?.gainCents);
console.log("acceptance aggregate cents", individual.capital?.aggregateCents);
console.log("acceptance taxable capital gain cents", individual.capital?.taxableCapitalGainCents);
console.log("acceptance individual taxable income cents", individual.taxableIncomeCents);
console.log("acceptance company gain cents", gained.capital?.rows[0]?.gainCents);
console.log("acceptance company inclusion", gained.capital?.inclusionPercent);
console.log("acceptance company loss carried forward cents", lost.capital?.carriedForwardCents);
console.log("tax-cgt ok");
