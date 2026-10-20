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
import { variancePctCell } from "../src/lib/budget.variance";
import {
  DRAFT_WATERMARK_TOP,
  PDF_CARD_MIN_PRESENCE,
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
assert(PDF_CARD_MIN_PRESENCE >= 72, "a card keeps its header with its body");
assert(variancePctCell(null, "budget is near zero") === "n/a", "a near-zero budget prints n/a in the percent cell");
assert(variancePctCell(null, "budget is negative") === "n/a", "a negative budget prints n/a in the percent cell");
assert(variancePctCell(12.4, null) === "+12.4%", "a real percent still prints in the cell");
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
assert(!header.includes("minPresenceAhead"), "a section header does not keep a private slice of the page");
assert(header.includes('wrap={false}'), "a section header does not split its own title");
assert(header.includes('breakInside: "avoid"'), "a section header does not split");

const layoutSrc = readFileSync(resolve("src/lib/report-pdf-layout.ts"), "utf8");
assert(layoutSrc.includes("export function ReportSection"), "reports share one section primitive");
assert(layoutSrc.includes("wrap: false"), "the section lead does not split");
assert(layoutSrc.includes("sectionMinPresenceAhead(2)"), "the lead asks for the heading plus two rows");
assert(SECTION_KEEP_WITH_NEXT === 52 + 56 * 2, "keep-with-next is the heading plus two rows");

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
assert(budget.includes("ReportSection"), "budget sections use the shared keep-with-next");
assert(budget.includes("variancePctCell"), "the budget percent cell uses the short label");
assert(budget.includes("varianceIsZeroPair"), "a zero pair does not print an amount under the dash");
assert(budget.includes('overflow: "hidden"'), "the percent cell cannot paint over the variance amount");
assert(!budget.includes("hideHeader"), "each budget section is one table");
assert(budget.includes('? "—"'), "a zero pair prints an em dash in the percent cell");
const varianceSrc = readFileSync(resolve("src/lib/budget.variance.ts"), "utf8");
assert(varianceSrc.includes("budget === 0 && actual === 0"), "a zero budget and zero actual is its own case");

const dupont = readFileSync(resolve("src/components/pdf/dupont.tsx"), "utf8");
assert(dupont.includes("wrap={false}") && dupont.includes("minPresenceAhead={PDF_CARD_MIN_PRESENCE}"), "DuPont cards do not split the header from the body");
const scorecard = readFileSync(resolve("src/reports/health-scorecard.tsx"), "utf8");
assert(scorecard.includes("wrap={false}") && scorecard.includes("minPresenceAhead={PDF_CARD_MIN_PRESENCE}"), "scorecard cards are unbreakable");
assert(!scorecard.includes("<View break"), "ratio detail flows under DuPont instead of a hard page break");
assert(scorecard.includes("<SectionHeader"), "ratio headings use the keep-with-next section header");
for (const file of [
  "src/components/pdf/exec-summary.tsx",
  "src/components/pdf/metric-box.tsx",
  "src/components/pdf/insight-box.tsx",
]) {
  const src = readFileSync(resolve(file), "utf8");
  assert(src.includes("wrap={false}"), `${file} cards do not split`);
  assert(src.includes("minPresenceAhead={PDF_CARD_MIN_PRESENCE}"), `${file} keeps the card with its body`);
}
const studioPages = readFileSync(resolve("src/routes/_authenticated/reports-studio.tsx"), "utf8");
assert(!studioPages.includes("{report.pages}"), "report cards do not invent a page count");
const landing = readFileSync(resolve("src/styles/accountant-portal.css"), "utf8");
const primaryAt = landing.indexOf(".accountant-portal .client-subpage-link--primary{");
const primary = landing.slice(primaryAt, primaryAt + 500);
assert(primary.includes("#0B5FFF"), "the reports landing primary is solid cobalt");
assert(!primary.includes("#f4f8ff") && !primary.includes("gold"), "the reports landing primary is not a pale or gold card");

console.log("report-pdf-layout: ok");
