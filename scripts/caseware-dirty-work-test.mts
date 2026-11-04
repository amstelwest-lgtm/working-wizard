/**
 * Caseware dirty-work checklist and summary TB export (US parallel to Draftworx).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import {
  buildCasewareWorkingPaperChecklist,
  casewareDirtyWorkEnabled,
  casewareExportFileName,
  casewareTrialBalanceCsv,
  draftworxDirtyWorkEnabled,
  WORKING_PAPER_TB_CSV_HEADER,
  workingPaperVendorForMarket,
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

assert(casewareDirtyWorkEnabled(US_MARKET), "US market enables Caseware surfaces");
assert(!casewareDirtyWorkEnabled(ZA_MARKET), "ZA market hides Caseware surfaces");
assert(draftworxDirtyWorkEnabled(ZA_MARKET), "ZA still enables Draftworx");
assert(!draftworxDirtyWorkEnabled(US_MARKET), "US does not enable Draftworx");
assert(workingPaperVendorForMarket(US_MARKET) === "caseware", "US vendor is caseware");
assert(workingPaperVendorForMarket(ZA_MARKET) === "draftworx", "ZA vendor is draftworx");

const checklist = buildCasewareWorkingPaperChecklist({
  financials: qaFinancials,
  market: US_MARKET,
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
const casewareRefresh = buildCasewareWorkingPaperChecklist({
  financials: qaFinancials,
  market: US_MARKET,
  needsTrialBalanceRefresh: true,
});
assert(
  casewareRefresh.find((item) => item.id === "tb_refresh")?.detail.includes("Caseware"),
  "Caseware named in checklist detail",
);

const csv = casewareTrialBalanceCsv(qaFinancials, "US QA Co", US_MARKET);
assert(csv.includes(WORKING_PAPER_TB_CSV_HEADER), "csv header matches import labels");
assert(csv.includes("Account Number,Account Name,Debit,Credit,Milōn note"), "full header line");
assert(csv.includes("Caseware Excel import"), "banner names Caseware");
assert(csv.includes("4000"), "csv includes revenue row");

assert(
  casewareExportFileName("US QA Co", "2026-10-31").startsWith("milon-caseware-summary-tb-"),
  "export filename is stable",
);

const compliancePane = readFileSync(resolve("src/components/compliance-pane.tsx"), "utf8");
assert(compliancePane.includes("WorkingPaperDirtyWorkPanel"), "Compliance mounts shared working-paper panel");
assert(compliancePane.includes("complianceDirtyWorkEnabled"), "Compliance gates ZA and US");

console.log("caseware-dirty-work-test: ok");
