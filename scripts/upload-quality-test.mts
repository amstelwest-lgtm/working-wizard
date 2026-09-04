/**
 * Low-bar upload quality gate.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/upload-quality-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ANCHOR_LABELS,
  MIN_ANCHOR_COUNT,
  UPLOAD_BANK_STATEMENT_REJECT,
  UPLOAD_QUALITY_DISCLAIMER,
  UPLOAD_QUALITY_REJECT,
  assessFlatExtraction,
  assessMergedExtraction,
  assessPortalFigures,
  assertUsable,
  countAnchors,
  preflightUploadFile,
} from "../src/lib/upload-quality";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(MIN_ANCHOR_COUNT === 2, "bar stays at two useful figures");
assert(ANCHOR_LABELS.length >= 6, "enough alternative anchors for messy statements");
assert(/accuracy of (the )?information you upload/i.test(UPLOAD_QUALITY_DISCLAIMER), "disclaimer names accuracy");

const emptyPortal = assessPortalFigures({
  income_statement: {
    revenue: null,
    gross_profit: null,
    operating_profit: null,
    profit_after_tax: null,
  },
  balance_sheet: {
    total_assets: null,
    equity: { total: null },
    total_liabilities: null,
    current_assets: { cash_and_cash_equivalents: null },
  },
});
assert(!emptyPortal.ok, "empty extraction is unusable");

const twoFieldPnl = assessPortalFigures({
  income_statement: {
    revenue: 1_200_000,
    gross_profit: null,
    operating_profit: null,
    profit_after_tax: 80_000,
  },
  balance_sheet: {
    total_assets: null,
    equity: { total: null },
    total_liabilities: null,
    current_assets: { cash_and_cash_equivalents: null },
  },
});
assert(twoFieldPnl.ok, "revenue + PAT is enough (plug and play)");

const oneField = assessPortalFigures({
  income_statement: {
    revenue: 1_200_000,
    gross_profit: null,
    operating_profit: null,
    profit_after_tax: null,
  },
  balance_sheet: {
    total_assets: null,
    equity: { total: null },
    total_liabilities: null,
    current_assets: { cash_and_cash_equivalents: null },
  },
});
assert(!oneField.ok, "a single figure is not useful");

const mergedOk = assessMergedExtraction({
  current_period: {
    income_statement: { revenue: 10, net_income: 1 },
    balance_sheet: {},
  },
});
assert(mergedOk.ok, "merged two-anchor pass");

const bank = assessMergedExtraction({
  document_metadata: {
    document_type: "bank_statement",
    contains_income_statement: false,
    contains_balance_sheet: false,
  },
  current_period: { income_statement: {}, balance_sheet: {} },
});
assert(!bank.ok && bank.reason === UPLOAD_BANK_STATEMENT_REJECT, "bank statement sent back");

assert(!assessFlatExtraction(0).ok, "empty csv rejected");
assert(!assessFlatExtraction(1).ok, "one csv field rejected");
assert(assessFlatExtraction(2).ok, "two csv fields allowed");

try {
  assertUsable({ ok: false, reason: UPLOAD_QUALITY_REJECT, anchors: 0 });
  throw new Error("assertUsable should throw");
} catch (e) {
  assert((e as Error).message === UPLOAD_QUALITY_REJECT, "throw uses bounce copy");
}

assert(countAnchors([0, null, undefined, "x", 12]) === 2, "zero is a real figure");

const emptyFile = { size: 0 } as File;
assert(preflightUploadFile(emptyFile), "empty file bounced before AI");
const tiny = { size: 12 } as File;
assert(preflightUploadFile(tiny), "tiny file bounced");
const okFile = { size: 12_000 } as File;
assert(preflightUploadFile(okFile) === null, "normal pdf size passes");

const portalSrc = readFileSync(resolve("src/lib/extractFinancials.server.ts"), "utf8");
assert(portalSrc.includes("assertUsable"), "accountant PDF path gates usability");
const pdfSrc = readFileSync(resolve("src/lib/extract-financials.functions.ts"), "utf8");
assert(pdfSrc.includes("assertUsable"), "app PDF/CSV path gates usability");
const modalSrc = readFileSync(resolve("src/components/extraction-review-modal.tsx"), "utf8");
assert(modalSrc.includes("UploadQualityDisclaimer"), "review modal requires the disclaimer");
const uploadSrc = readFileSync(resolve("src/components/upload-financials.tsx"), "utf8");
assert(uploadSrc.includes("UploadQualityDisclaimer"), "accountant upload requires the disclaimer");

console.log("upload-quality-test: ok");
