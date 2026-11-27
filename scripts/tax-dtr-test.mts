/**
 * Dividends tax draft pack. R100 000 to three owners, plus a blank input.
 * Run: pnpm test:tax-dtr
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getDocumentProxy } from "unpdf";
import { DtrPDF } from "../src/components/tax-specialist/za-dtr-pdf";
import { ZaDtrSheet } from "../src/components/tax-specialist/za-dtr-sheet";
import { isCatalogForm } from "../src/lib/tax-specialist/forms/pipeline";
import { ZaTaxSpecialistPage } from "../src/components/tax-specialist/za-tax-specialist-page";
import { TaxWorkBoard } from "../src/components/tax-specialist/za-tax-work";
import {
  DTR_PAYMENT_DATE_MESSAGE,
  DTR_RATES_NOTE,
  DTR_STANDARD_RATE_BPS,
  DTR_TITLE,
  computeDtr,
  dtrCsv,
  dtrDueDate,
  emptyDtrInputs,
  emptyDtrOwner,
  type DtrInputs,
} from "../src/lib/tax-specialist/forms/dtr";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
  }
}

type TextItem = { str: string; transform: number[] };

async function pdfText(element: ReturnType<typeof createElement>): Promise<string> {
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const buf = await renderToBuffer(element as Parameters<typeof renderToBuffer>[0]);
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const buckets = new Map<number, Array<{ x: number; str: string }>>();
    for (const item of content.items as TextItem[]) {
      if (!item.str || !item.str.trim()) continue;
      const key = Math.round((item.transform[5] ?? 0) / 3) * 3;
      const row = buckets.get(key) ?? [];
      row.push({ x: item.transform[4] ?? 0, str: item.str });
      buckets.set(key, row);
    }
    pages.push(
      [...buckets.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, parts]) =>
          parts
            .sort((a, b) => a.x - b.x)
            .map((part) => part.str)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .join("\n"),
    );
  }
  return pages.join("\n");
}

const readme = readFileSync("docs/sars/README.md", "utf8");
assert(readme.includes("Fetched 27 November 2026"), "the rate citation is dated");
assert(
  readme.includes("https://www.sars.gov.za/faq/faq-what-is-the-rate-of-dividends-tax/"),
  "the 20% rate cites the SARS FAQ",
);
assert(
  readme.includes("https://www.sars.gov.za/tax-rates/income-tax/interest-and-dividends/"),
  "the published rates table is cited",
);
assert(
  readme.includes("https://www.sars.gov.za/types-of-tax/dividends-tax/"),
  "the due date and the DTR returns are cited",
);
assert(readme.includes("20%"), "the cited rate is 20%");
eq(DTR_STANDARD_RATE_BPS, 2000, "the cited standard rate is 20% in basis points");
eq(
  DTR_RATES_NOTE,
  "Rates from SARS published tables YA2027; accountant to confirm",
  "the sheet names the published table and asks the accountant to confirm",
);

eq(dtrDueDate("2026-03-15"), "2026-04-30", "15 Mar 2026 is due on 30 Apr 2026");
eq(dtrDueDate("2026-01-15"), "2026-02-28", "a January payment is due on the last day of February");
eq(dtrDueDate("2024-01-31"), "2024-02-29", "a leap-year January payment is due on 29 February");
eq(dtrDueDate("2026-12-15"), "2027-01-31", "a December payment is due at the end of January");
eq(dtrDueDate(""), null, "a blank payment date has no due date");
eq(dtrDueDate("2026-02-31"), null, "an impossible day is not a payment date");

const worked: DtrInputs = {
  declarationDate: "2026-03-01",
  paymentDate: "2026-03-15",
  amountCents: 10_000_000,
  kind: "cash",
  owners: [
    {
      ...emptyDtrOwner("a"),
      name: "Owner A",
      amountCents: 6_000_000,
      treatment: "standard",
    },
    {
      ...emptyDtrOwner("b"),
      name: "Owner B",
      amountCents: 3_000_000,
      treatment: "exempt",
      exemptionReason: "Resident company",
    },
    {
      ...emptyDtrOwner("c"),
      name: "Owner C",
      amountCents: 1_000_000,
      treatment: "dta",
      dtaRateText: "10",
    },
  ],
};

const sheet = computeDtr(worked);
eq(sheet.messages.length, 0, "the worked example has every field");
eq(sheet.dueDate, "2026-04-30", "paid 15 Mar 2026, due 30 Apr 2026");
eq(sheet.owners[0]?.rateBps, 2000, "Owner A is an individual at 20%");
eq(sheet.owners[0]?.withholdingCents, 1_200_000, "Owner A: R12 000 on R60 000");
eq(sheet.owners[1]?.withholdingCents, 0, "Owner B, an exempt company, is nil");
eq(sheet.owners[1]?.withholdingLabel, "Nil", "the exempt line says Nil");
eq(sheet.owners[2]?.rateBps, 1000, "Owner C is a 10% DTA rate");
eq(sheet.owners[2]?.withholdingCents, 100_000, "Owner C: R1 000 on R10 000");
eq(sheet.totalWithheldCents, 1_300_000, "total withheld is R13 000");

const csv = dtrCsv(sheet);
assert(csv.includes(DTR_TITLE), "the CSV title is the draft pack");
assert(csv.includes(DTR_RATES_NOTE), "the CSV shows the rates note");
assert(csv.includes("2026-04-30"), "the CSV due date is 30 Apr 2026");
assert(csv.includes("12000.00"), "the CSV shows R12 000 withheld");
assert(csv.includes("Nil"), "the CSV shows the exempt line as Nil");
assert(csv.includes("1000.00"), "the CSV shows R1 000 withheld");
assert(csv.includes("13000.00"), "the CSV shows R13 000 total");

const blank = computeDtr(emptyDtrInputs());
eq(blank.dueDate, null, "a blank pack has no due date");
eq(blank.amountCents, null, "a blank dividend amount stays blank");
eq(blank.totalWithheldCents, null, "a blank total stays blank");
assert(blank.messages.includes(DTR_PAYMENT_DATE_MESSAGE), "a missing payment date names the field");
const blankCsv = dtrCsv(blank);
assert(blankCsv.includes(DTR_PAYMENT_DATE_MESSAGE), "the blank CSV names the payment date");
assert(!blankCsv.includes("0.00"), "a blank CSV is never 0.00");
assert(!blankCsv.includes("Nil"), "a blank line is not an exempt nil");

const unnamed = computeDtr({
  ...emptyDtrInputs(),
  owners: [emptyDtrOwner("owner-1")],
});
assert(
  unnamed.messages.includes("Enter the amount for beneficial owner 1"),
  "a missing owner amount names the field",
);
assert(
  unnamed.messages.includes("Enter the treatment for beneficial owner 1"),
  "a missing treatment names the field",
);
eq(unnamed.owners[0]?.withholdingCents, null, "an unfinished owner line stays blank");

const early = computeDtr({
  ...emptyDtrInputs(),
  declarationDate: "2017-02-01",
  paymentDate: "2017-02-21",
  amountCents: 10_000,
  kind: "cash",
  owners: [
    {
      ...emptyDtrOwner("a"),
      name: "Owner A",
      amountCents: 10_000,
      treatment: "standard",
    },
  ],
});
eq(early.owners[0]?.withholdingCents, null, "the cited 20% is not used before 22 February 2017");
assert(
  early.messages.includes(
    "Enter a payment date on or after 22 February 2017 to use the cited rate",
  ),
  "an earlier payment date is named",
);

const fromStart = computeDtr({
  declarationDate: "2017-02-22",
  paymentDate: "2017-02-22",
  amountCents: 10_000,
  kind: "cash",
  owners: [
    {
      ...emptyDtrOwner("a"),
      name: "Owner A",
      amountCents: 10_000,
      treatment: "standard",
    },
  ],
});
eq(fromStart.owners[0]?.withholdingCents, 2_000, "20% applies on 22 February 2017");
eq(fromStart.dueDate, "2017-03-31", "a 22 February payment is due on 31 March");

const missingRate = computeDtr({
  ...emptyDtrInputs(),
  declarationDate: "2026-03-01",
  paymentDate: "2026-03-15",
  amountCents: 1_000_000,
  kind: "cash",
  owners: [
    {
      ...emptyDtrOwner("c"),
      name: "Owner C",
      amountCents: 1_000_000,
      treatment: "dta",
      dtaRateText: "",
    },
  ],
});
eq(missingRate.owners[0]?.withholdingCents, null, "a missing DTA rate is not defaulted");
assert(
  missingRate.messages.includes("Enter the DTA rate for Owner C"),
  "a missing DTA rate names the field",
);

const zeroRate = computeDtr({
  declarationDate: "2026-03-01",
  paymentDate: "2026-03-15",
  amountCents: 1_000_000,
  kind: "cash",
  owners: [
    {
      ...emptyDtrOwner("c"),
      name: "Owner C",
      amountCents: 1_000_000,
      treatment: "dta",
      dtaRateText: "0",
    },
  ],
});
eq(zeroRate.owners[0]?.rateBps, 0, "a typed 0% rate is entered, not assumed");
eq(zeroRate.owners[0]?.withholdingCents, 0, "a typed 0% rate withholds nil");
eq(zeroRate.owners[0]?.withholdingLabel, "Nil", "a typed zero rate says Nil");

const markup = renderToStaticMarkup(
  createElement(ZaDtrSheet, {
    client: { id: "c1", name: "Harbour" },
    onBack: () => undefined,
  }),
);
assert(markup.includes(DTR_TITLE), "the sheet title is the draft pack");
assert(markup.includes(DTR_RATES_NOTE), "the sheet shows the rates note");
assert(markup.includes(DTR_PAYMENT_DATE_MESSAGE), "the blank sheet names the payment date");
assert(markup.includes('placeholder="YYYY-MM-DD"'), "dates are text YYYY-MM-DD inputs");
assert(markup.includes('id="dtr-declaration-date"'), "the declaration date has its field");
assert(markup.includes('data-asset-date="true"'), "the declaration date uses the shared date input");
assert(markup.includes('data-dtr-section="DTR01"'), "DTR01 is on the sheet");
assert(markup.includes('data-dtr-section="DTR02"'), "DTR02 is on the sheet");
assert(markup.includes('data-dtr-download="pdf"'), "the sheet can download a PDF");
assert(markup.includes('data-dtr-download="csv"'), "the sheet can download a CSV");
assert(markup.includes("Add beneficial owner"), "the owner list is a real control");
assert(!markup.includes("0.00"), "the blank sheet never shows 0.00");
assert(!markup.includes('type="date"'), "the sheet does not use a browser date input");

const board = renderToStaticMarkup(
  createElement(TaxWorkBoard, {
    drafts: [],
    packs: createElement("div"),
    onPrepareIrp6: () => undefined,
    onOpenIrp6: () => undefined,
    onPrepareIrp6Individual: () => undefined,
    onOpenIrp6Individual: () => undefined,
    onPrepareItr12: () => undefined,
    onOpenItr12: () => undefined,
    onPrepareItr14: () => undefined,
    onOpenItr14: () => undefined,
    onPrepareDtr: () => undefined,
  }),
);
assert(
  board.includes('data-tax-work-prepare="DTR"'),
  "the tax tab can open the dividends tax pack",
);
assert(board.includes("Prepare dividends tax"), "the tax tab names the pack");

const page = renderToStaticMarkup(
  createElement(ZaTaxSpecialistPage, {
    client: {
      id: "c1",
      name: "Harbour",
      fyStartMonth: 3,
      financials: null,
      financialsAsOf: null,
    },
    today: "2026-11-27",
  }),
);
assert(page.includes('data-tax-form="DTR"'), "the tax specialist gallery lists the pack");
assert(page.includes("Dividends tax draft"), "the gallery names the pack");
assert(
  page.includes('data-tax-form="DTR"') && page.includes('class="tax-page-form is-open"'),
  "a client can open the pack from the gallery",
);

const workedPdf = await pdfText(
  createElement(DtrPDF, {
    clientName: "Harbour",
    sheet,
    preparedOn: "2026-11-27",
  }),
);
for (const needle of [
  DTR_TITLE,
  DTR_RATES_NOTE,
  "Owner A",
  "R 12 000.00",
  "Nil",
  "R 1 000.00",
  "R 13 000.00",
  "30 Apr 2026",
  "20%",
  "10%",
]) {
  assert(workedPdf.includes(needle), `PDF text includes ${needle}`);
}

const blankPdf = await pdfText(
  createElement(DtrPDF, {
    clientName: "Harbour",
    sheet: blank,
    preparedOn: "2026-11-27",
  }),
);
assert(blankPdf.includes(DTR_TITLE), "the blank PDF is still the draft pack");
assert(blankPdf.includes(DTR_RATES_NOTE), "the blank PDF shows the rates note");
assert(blankPdf.includes(DTR_PAYMENT_DATE_MESSAGE), "the blank PDF names the payment date");
assert(!blankPdf.includes("0.00"), "the blank PDF is never 0.00");

const sheetSrc = readFileSync("src/components/tax-specialist/za-dtr-sheet.tsx", "utf8");
assert(sheetSrc.includes("Add beneficial owner"), "the sheet source is the owner form");
assert(sheetSrc.includes("Download PDF"), "the sheet source downloads a PDF");
assert(sheetSrc.includes("AssetDateInput"), "the declaration date uses the shared date input");
assert(sheetSrc.includes('id="dtr-declaration-date"'), "the shared input is the declaration date");
assert(!sheetSrc.includes("0.00"), "the sheet source does not paint 0.00");
assert(!sheetSrc.includes("Save draft"), "the sheet has no Save until DTR is a catalog form");
assert(!sheetSrc.includes("saveCatalogDraft"), "the sheet does not call the catalog save");
assert(!sheetSrc.includes("saveTaxFormDraft"), "the sheet does not write tax_form_drafts");
assert(!isCatalogForm("DTR"), "DTR is not a catalog form code");
assert(!isCatalogForm("DTR01"), "DTR01 is not a catalog form code");
assert(!isCatalogForm("DTR02"), "DTR02 is not a catalog form code");
const catalogMigration = readFileSync(
  "supabase/migrations/20261102170000_tax_form_drafts_catalog.sql",
  "utf8",
);
assert(!catalogMigration.includes("'DTR'"), "the catalog migration has no DTR row");
assert(
  catalogMigration.includes("unknown tax form") && catalogMigration.includes("23514"),
  "save_tax_form_draft_version rejects a code that is not in tax_form_catalog",
);
assert(
  catalogMigration.includes("tax_form_drafts_form_code_fkey"),
  "form_code references tax_form_catalog",
);
assert(
  !readFileSync("src/components/tax-specialist/za-tax-work.tsx", "utf8").includes(
    'data-tax-work-open="DTR"',
  ),
  "the drafts list has no DTR row until the catalog allows one",
);
assert(
  readFileSync("src/components/tax-specialist/za-tax-work.tsx", "utf8").includes(
    'data-tax-work-prepare="DTR"',
  ),
  "the tax tab wires the pack",
);

console.log("tax-dtr ok");
