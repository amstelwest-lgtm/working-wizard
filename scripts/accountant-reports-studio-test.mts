/**
 * Accountant Reports tab must be the production Reports Studio, not the old
 * client gallery or the /reports/demo mock overlay.
 * Run: pnpm test:accountant-reports-studio
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ForecastPreviewEmptyCopy,
  reportDeepLinkAction,
  ReportsStudio,
} from "../src/routes/_authenticated/reports-studio";
import {
  FORECAST_PREVIEW_EMPTY,
  forecastPreviewButtonDisabled,
  forecastPreviewGap,
  forecastPreviewMessage,
} from "../src/lib/report-preview";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(typeof ReportsStudio === "function", "ReportsStudio is exported for the client workspace tab");
assert(reportDeepLinkAction(undefined) === null, "opening Reports does not preview a PDF");
assert(reportDeepLinkAction("scorecard") === null, "a report key is not a preview action");
assert(reportDeepLinkAction("preview") === "preview", "an explicit preview still opens");
assert(reportDeepLinkAction("download") === "download", "an explicit download still starts");
assert(forecastPreviewGap(null) === FORECAST_PREVIEW_EMPTY, "no forecast weeks is not enough data");
assert(forecastPreviewGap([]) === FORECAST_PREVIEW_EMPTY, "an empty week list is not enough data");
assert(forecastPreviewGap([{ period_label: "Week 1" }]) === null, "an entered week can preview");
assert(
  FORECAST_PREVIEW_EMPTY.includes("The 13-week chart appears once a forecast line is entered."),
  "the preview uses the same sentence as the cash screen",
);
assert(!/vat/i.test(FORECAST_PREVIEW_EMPTY), "the empty forecast sentence has no VAT wording");

const emptyClientMessage = forecastPreviewMessage({
  emptyClient: true,
  hasStatementData: false,
  cashForecast: null,
});
assert(emptyClientMessage === FORECAST_PREVIEW_EMPTY, "an empty client uses the existing not-enough-data sentence");
assert(
  forecastPreviewButtonDisabled({
    gateDisabled: true,
    emptyClient: true,
    loading: false,
    previewing: false,
  }) === false,
  "empty-client 13-week Preview stays enabled",
);
assert(
  forecastPreviewButtonDisabled({
    gateDisabled: true,
    emptyClient: true,
    loading: true,
    previewing: false,
  }) === true,
  "Preview stays disabled while the empty client is still loading",
);
assert(
  forecastPreviewButtonDisabled({
    gateDisabled: true,
    emptyClient: false,
    loading: false,
    previewing: false,
  }) === true,
  "a blocked report that is not the empty 13-week preview stays disabled",
);
assert(
  forecastPreviewMessage({
    emptyClient: false,
    hasStatementData: true,
    cashForecast: [{ period_label: "Week 1" }],
  }) === null,
  "a week on file does not show the empty sentence",
);
assert(
  forecastPreviewMessage({
    emptyClient: false,
    hasStatementData: false,
    cashForecast: null,
  }) === null,
  "a demo with no client still previews instead of the empty-client sentence",
);
const emptyHtml = renderToStaticMarkup(
  createElement(ForecastPreviewEmptyCopy, { message: emptyClientMessage ?? "" }),
);
assert(
  emptyHtml.includes("Not enough data. The 13-week chart appears once a forecast line is entered."),
  "the empty-client message is visible",
);
assert(emptyHtml.includes("data-forecast-preview-empty"), "the empty sentence is marked in the preview");
assert(emptyHtml.includes("#102A43"), "the empty sentence is navy on the white preview card");
assert(!/vat/i.test(emptyHtml), "the visible empty-client message has no VAT wording");

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(clientSrc.includes("ReportsStudioPanel"), "client Reports tab mounts ReportsStudio");
assert(clientSrc.includes("embedded"), "client workspace embeds studio chrome");
assert(!clientSrc.includes("REPORT_TEMPLATES"), "old report gallery catalogue is gone");
assert(!clientSrc.includes("rep-grid"), "old report gallery markup is gone");
assert(clientSrc.includes('revealTab("reports")'), "Generate report opens the client Reports tab and scrolls to it");
{
  const header = clientSrc.slice(clientSrc.indexOf("topbar-actions"), clientSrc.indexOf("BREADCRUMB"));
  assert(!header.includes("Reports studio"), "the client header has no Reports studio button");
  assert(!header.includes("openReportsStudio"), "the client header does not leave for a studio");
  assert(!clientSrc.includes("const openReportsStudio"), "the studio opener is gone");
}
assert(
  !clientSrc.includes("data-view-mode-toggle"),
  "simple/complex toggle is hidden on Reports — the studio does not change",
);

const routeSrc = readFileSync(resolve("src/routes/_authenticated/reports.index.tsx"), "utf8");
const redirectSrc = readFileSync(resolve("src/lib/reports-index-redirect.ts"), "utf8");
const studioSrc = readFileSync(resolve("src/routes/_authenticated/reports-studio.tsx"), "utf8");
assert(studioSrc.includes("export function ReportsStudio"), "studio is a reusable panel");
assert(routeSrc.includes("beforeLoad"), "/reports redirects");
assert(!routeSrc.includes("ReportsPage"), "/reports does not render a studio");
assert(
  redirectSrc.includes("search.report") && redirectSrc.includes("next.report = search.report"),
  "report deep links stay on the studio search",
);
assert(!studioSrc.includes("/reports/demo") && !routeSrc.includes("/reports/demo"), "studio no longer links to the mock preview");
assert(studioSrc.includes("embedded"), "studio supports embedded (client tab) chrome");
{
  const previewFn = studioSrc.slice(
    studioSrc.indexOf("async function handlePreview"),
    studioSrc.indexOf("function clearDeepLinkSearch"),
  );
  const gapAt = previewFn.indexOf("forecastPreviewMessage");
  const guardAt = previewFn.indexOf("assertCanGenerate");
  const genAt = previewFn.indexOf("await GEN[report.key]");
  assert(
    gapAt !== -1 && guardAt !== -1 && gapAt < guardAt,
    "an empty client is explained before the upload block",
  );
  assert(gapAt !== -1 && genAt !== -1 && gapAt < genAt, "an empty forecast is explained before a PDF is built");
  assert(
    previewFn.includes('message.startsWith("No cash forecast saved")') &&
      previewFn.includes("showForecastGap"),
    "a thrown missing-forecast error still opens the message",
  );
  assert(studioSrc.includes('emptyHref: "cash"'), "the message links to the cash forecast");
  const dismissAt = previewFn.lastIndexOf("setPreviewState(null)");
  const thrownAt = previewFn.indexOf('message.startsWith("No cash forecast saved")');
  assert(thrownAt !== -1 && dismissAt !== -1 && thrownAt < dismissAt, "the missing-forecast path returns before the modal is cleared");
  assert(previewFn.includes("showForecastGap(report)"), "the empty-client preview opens the existing message");
}
{
  const card = studioSrc.slice(studioSrc.indexOf("function ReportCard"), studioSrc.indexOf("function SettingsPanel"));
  assert(card.includes("forecastPreviewButtonDisabled"), "the 13-week card uses the empty-client preview gate");
  assert(card.includes('report.key === "forecast"'), "only the 13-week card keeps Preview enabled when the client is empty");
  assert(card.includes("disabled={gate.disabled || isGenerating}"), "Download stays disabled on an empty client");
  const blockedLink = studioSrc.slice(studioSrc.lastIndexOf("if (blockedForClient)"), studioSrc.lastIndexOf("if (blockedForClient)") + 420);
  assert(
    blockedLink.includes('deepLinkReport.key === "forecast"') && blockedLink.includes("showForecastGap(deepLinkReport)"),
    "an empty-client forecast preview link still opens the message",
  );
}
assert(studioSrc.includes("REPORT_SIGNOFF_SCOPE"), "each report card maps to a deliverable sign-off");
assert(studioSrc.includes("report-card__rule"), "studio cards keep the gold hairline");
assert(studioSrc.includes('key: "budget"'), "studio lists a Budget & variance PDF");
assert(studioSrc.includes('budget: "budget"'), "budget PDF uses the budget sign-off scope");

const budgetWorkspace = readFileSync(resolve("src/components/budget/budget-workspace.tsx"), "utf8");
assert(budgetWorkspace.includes("BudgetPdfExportButton"), "client Budget tab exports the PDF from the answer strip");
const budgetExport = readFileSync(resolve("src/components/budget/budget-pdf-export.tsx"), "utf8");
assert(budgetExport.includes("budget-export-pdf"), "Budget tab download control is the budget PDF button");
assert(budgetExport.includes("BudgetVariancePDF"), "Budget tab uses the shared budget PDF");

const demoSrc = readFileSync(resolve("src/routes/_authenticated/reports.demo.tsx"), "utf8");
assert(demoSrc.includes('to: "/reports"'), "legacy /reports/demo redirects to studio");
assert(!demoSrc.includes("MOCK_RATIO_RESULTS"), "demo mock UI is deleted, not overlaid");

const dashSrc = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");
assert(!dashSrc.includes('aria-label="Generate report"'), "the clients table has no report button");
assert(dashSrc.includes("data-client-row"), "the row opens the client");
assert(!dashSrc.includes('to: "/reports"'), "practice has no standalone Reports studio");
assert(!dashSrc.includes("Reports studio"), "practice has no Reports studio button");

const walkSrc = readFileSync(resolve("src/components/walkthrough-wizard.tsx"), "utf8");
{
  const start = walkSrc.indexOf("const ACCOUNTANT_CLIENT_STEPS: Step[] = [");
  const tour = walkSrc.slice(start, walkSrc.indexOf("];", start));
  const i = tour.indexOf('tab: "reports"');
  const reportsStep = tour.slice(i, tour.indexOf("},", i));
  assert(i !== -1, "accountant client tour has a Reports tab step");
  assert(reportsStep.includes('targetId: "pane-reports"'), "Reports step points at the Reports Studio pane");
  assert(reportsStep.includes("same Reports Studio"), "walkthrough describes the studio on the Reports tab");
  assert(/sign off/i.test(reportsStep), "Reports step says deliverables are signed off before delivery (#175)");
  assert(reportsStep.includes("Business Health & Ratios"), "Reports step uses full deliverable names");
}

console.log("accountant-reports-studio-test: ok");
