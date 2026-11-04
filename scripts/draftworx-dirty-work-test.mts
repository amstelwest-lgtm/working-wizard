/**
 * Draftworx dirty-work checklist and summary TB export.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import {
  buildDraftworxWorkingPaperChecklist,
  draftworxDirtyWorkEnabled,
  draftworxExportFileName,
  draftworxSummaryTrialBalanceRows,
  draftworxTrialBalanceCsv,
  DRAFTWORX_TB_CSV_HEADER,
} from "../src/lib/draftworx-dirty-work";
import { resolveMarket, ZA_MARKET } from "../src/lib/market/resolve";

const US_MARKET = resolveMarket({ country: "US", regionCode: "CA" });

const qaFinancials = {
  revenue: "120000",
  cogs: "45000",
  fixedCosts: "42000",
  netIncome: "33000",
  cash: "25000",
  receivables: "18000",
  payables: "10000",
  totalAssets: "43000",
  totalLiabilities: "10000",
  equity: "33000",
  periodEnd: "2026-10-31",
  periodStart: "2025-11-01",
};

assert(draftworxDirtyWorkEnabled(ZA_MARKET), "ZA market enables Draftworx surfaces");
assert(!draftworxDirtyWorkEnabled(US_MARKET), "US market hides Draftworx surfaces");

const checklist = buildDraftworxWorkingPaperChecklist({
  financials: qaFinancials,
  market: ZA_MARKET,
  needsTrialBalanceRefresh: false,
});
assert(checklist.length >= 8, "checklist covers dirty-work steps");
assert(
  checklist.some((item) => item.id === "figures_on_file" && item.status === "pass"),
  "figures on file pass",
);
assert(
  checklist.some((item) => item.id === "financials_signoff" && item.status === "todo"),
  "unsigned financials stay todo",
);

const signedChecklist = buildDraftworxWorkingPaperChecklist({
  financials: qaFinancials,
  market: ZA_MARKET,
  financialsSignoff: {
    id: "1",
    client_id: "c",
    scope: "financials",
    signed_off_by_id: "u",
    signed_off_by_name: "Thandi Tester",
    signed_off_by_initials: null,
    signed_off_by_title: null,
    firm_name: "QA Firm",
    note: null,
    signature_data: null,
    signed_off_at: "2026-10-21T08:12:00Z",
  },
  signoffStale: true,
});
assert(
  signedChecklist.find((item) => item.id === "signoff_fresh")?.status === "warn",
  "stale sign-off warns",
);

const rows = draftworxSummaryTrialBalanceRows(qaFinancials);
assert(rows.some((row) => row.accountNumber === "4000" && row.credit === 120000), "revenue credits");
assert(rows.some((row) => row.accountNumber === "1000" && row.debit === 25000), "cash debits");

const csv = draftworxTrialBalanceCsv(qaFinancials, "QA Test Co", ZA_MARKET);
assert(csv.includes(DRAFTWORX_TB_CSV_HEADER), "csv header matches Draftworx mapping labels");
assert(csv.includes("4000"), "csv includes revenue row");

assert(
  draftworxExportFileName("QA Test Co", "2026-10-31").startsWith("milon-draftworx-summary-tb-"),
  "export filename is stable",
);

const clientRoute = readFileSync(
  resolve("src/routes/_authenticated/clients.$clientId.tsx"),
  "utf8",
);
assert(clientRoute.includes('id="pane-compliance"'), "Compliance route has its own pane");
assert(clientRoute.includes("<CompliancePane"), "Compliance pane mounts working-paper surface");
assert(clientRoute.includes("compliance-pane"), "compliance pane import wired");
const ratiosPane = clientRoute.slice(
  clientRoute.indexOf('id="pane-ratios"'),
  clientRoute.indexOf('id="pane-profit"'),
);
assert(!ratiosPane.includes("DraftworxDirtyWorkPanel"), "Diagnose overview no longer mounts Draftworx");
assert(!ratiosPane.includes("draftworx-dirty-work-panel"), "Draftworx import removed from Diagnose pane");

console.log("draftworx-dirty-work-test: ok");
