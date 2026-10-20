/**
 * Paper size, independent downloads, and the PDF frame rules.
 * Run: pnpm test:report-pdf-layout
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isUsCopy } from "../src/lib/market/prompt";
import { resolveMarket } from "../src/lib/market/resolve";
import { canonicalizeAccountantSearch, reportPdfSection } from "../src/lib/client-route-search";
import { finishReportDownload, startReportDownload } from "../src/lib/report-downloads";
import {
  DRAFT_WATERMARK_TOP,
  SECTION_KEEP_WITH_NEXT,
  pdfFooterReserve,
  reportPaperSize,
} from "../src/lib/report-pdf-layout";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const us = resolveMarket({ country: "US", regionCode: "NY" });
const za = resolveMarket({ country: "ZA", regionCode: null });

assert(reportPaperSize(us) === "LETTER", "a US client prints on US Letter");
assert(reportPaperSize({ country: "US" }) === "LETTER", "country US is Letter even before a state is read");
assert(isUsCopy(us), "the US market uses the existing US copy helper");
assert(reportPaperSize({ copyPack: "us" }) === "LETTER", "the US copy pack is Letter");
assert(reportPaperSize(za) === "A4", "a ZA client stays on A4");
assert(reportPaperSize({ country: "ZA", copyPack: "za" }) === "A4", "ZA copy stays on A4");
assert(reportPaperSize(null) === "A4", "a missing market stays on A4");
assert(reportPaperSize(undefined) === "A4", "an unset market stays on A4");
assert(reportPdfSection("budget") === "budget-pdf", "the budget PDF has its own reports page");
assert(reportPdfSection("benchmark") === "benchmark", "benchmark has its own reports page");
assert(
  canonicalizeAccountantSearch({ tab: "reports", report: "budget" }).section === "budget-pdf",
  "a budget report link stays on Reports",
);
assert(
  canonicalizeAccountantSearch({ tab: "budget" }).tab === "budget",
  "the Budget tab is still the budget workspace",
);

assert(pdfFooterReserve() >= 72, "flowing content keeps clear of the footer");
assert(pdfFooterReserve({ signed: true }) > pdfFooterReserve(), "a sign-off row reserves more footer space");
assert(SECTION_KEEP_WITH_NEXT >= 72, "a section header keeps room for its first rows");
assert(DRAFT_WATERMARK_TOP > 120 && DRAFT_WATERMARK_TOP < 420, "the draft mark sits in the body");

const forecast = startReportDownload(new Set(), "forecast");
assert(forecast.started, "forecast can start");
const both = startReportDownload(forecast.pending, "benchmark");
assert(both.started, "benchmark starts while forecast is still pending");
assert(both.pending.has("forecast") && both.pending.has("benchmark"), "each report keeps its own pending flag");
const again = startReportDownload(both.pending, "forecast");
assert(!again.started, "the same report does not start a second download");
assert(again.pending.has("benchmark"), "a refused click does not drop the other report");
const left = finishReportDownload(both.pending, "forecast");
assert(!left.has("forecast") && left.has("benchmark"), "finishing one report leaves the other running");

const header = readFileSync(resolve("src/components/pdf/section-header.tsx"), "utf8");
assert(header.includes("minPresenceAhead={SECTION_KEEP_WITH_NEXT}"), "section headers use keep-with-next");
assert(header.includes('breakInside: "avoid"'), "a section header does not split");

const watermark = readFileSync(resolve("src/components/pdf/watermark.tsx"), "utf8");
const draftAt = watermark.indexOf("export function DraftWatermark");
const draftEnd = watermark.indexOf("export function SampleWatermark");
const draft = watermark.slice(draftAt, draftEnd);
assert(draft.includes("DRAFT_WATERMARK_TOP"), "the draft mark uses the body position");
assert(draft.includes("rotate(-32deg)"), "the draft mark is diagonal in the body");
assert(!draft.includes("bottom:"), "the draft mark does not sit in the footer");

const frame = readFileSync(resolve("src/components/pdf/pdf-document.tsx"), "utf8");
assert(frame.includes("reportPaperSize(resolved)"), "every report page uses the market paper size");
assert(frame.includes("pdfFooterReserve("), "every report page reserves footer space");

const footer = readFileSync(resolve("src/components/pdf/report-footer.tsx"), "utf8");
assert(footer.includes("signoffBand"), "the sign-off line has its own footer row");
assert(footer.includes("pdfSignoffBadgeLine"), "the sign-off wording is unchanged");

const studio = readFileSync(resolve("src/routes/_authenticated/reports-studio.tsx"), "utf8");
assert(studio.includes("startReportDownload"), "downloads use the per-report helper");
assert(!studio.includes("if (loadingKey) return"), "a shared lock no longer swallows a second download");
assert(studio.includes('toast.error("This report is already downloading")'), "a refused download still toasts");

const budget = readFileSync(resolve("src/reports/budget-variance.tsx"), "utf8");
assert(budget.includes("wrap={false}"), "the budget table header stays with its first row");

console.log("report-pdf-layout: ok");
