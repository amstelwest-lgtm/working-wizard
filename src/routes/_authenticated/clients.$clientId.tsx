import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { BackLink } from "@/components/back-link";
import { PeriodPill } from "@/components/chrome-icons";
import { openPracticeSettings } from "@/lib/user-roles";
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, Suspense, type ReactNode } from "react";
import { lazyPanel, TabErrorBoundary } from "@/components/lazy-panel";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { completeDeliverablePdfItems, downloadActionPlanPdf } from "@/lib/action-plan-pdf";
import { AdvisoryDrafter } from "@/components/advisory-drafter";
import { CashForecastPanel } from "@/components/cash-forecast";
import { CollectionsPanel } from "@/components/collections-panel";
import { PayablesPanel } from "@/components/payables-panel";
import { BudgetPanel } from "@/components/budget/budget-panel";
import type { ExistingCashflow } from "@/lib/cash-from-banks.publish";
import { UploadFinancials } from "@/components/upload-financials";
import { BalanceSheetPrompt } from "@/components/balance-sheet-prompt";
import { needsBalanceSheetPrompt } from "@/lib/balance-sheet-prompt";
import { BankStatementDrafter } from "@/components/bank-statement-drafter";
import { WalkthroughWizard } from "@/components/walkthrough-wizard";
import { CheckoutAfterInsight } from "@/components/checkout-after-insight";
import { loadStarterMonthlyLabel } from "@/lib/trial-card-price";
import { FirmDashboardCrumb, firmDashboardCrumbIsLink } from "@/components/firm-dashboard-crumb";
import { useFirmBillingEntitled } from "@/contexts/firm-billing-access";
import { markInsightSeen } from "@/lib/funnel-timing";
import {
  ACCOUNTANT_CLIENT_EMPTY_TOUR_KEY,
  markOnboardingDone,
  shouldReopenFirstDataAfterEmptyTour,
} from "@/lib/onboarding";
import {
  loadAutoPopulateState,
  runAutoPopulate,
  runSyncAutoPopulate,
  type AutoPopulateState,
} from "@/lib/auto-populate-run";
import {
  defaultAutoPopulatePrefs,
  prefsToRemember,
  summariseAutoPopulate,
  type AutoPopulatePrefs,
} from "@/lib/auto-populate";
import { mergeStatementFinancials } from "@/lib/statement-parse";
import { autosaveKeepsLedgerSync } from "@/lib/ledger-sync-financials";
import { MarketProvider } from "@/contexts/market";
import { MarketGate } from "@/components/market-gate";
import {
  currencySymbol,
  formatDate,
  formatMoneyCompact,
  formatMonthYear,
  isUsCopy,
  laborCostLabel,
  localizeCopy,
  marketForClient,
  marketToJson,
  parseMarketSelection,
  resolveMarket,
  type ResolvedMarket,
} from "@/lib/market";
import { formatMoney } from "@/lib/market/format";
import { PlaybookDrawer } from "@/components/playbook-drawer";
import { computeOverviewCaption, healthAnswerSentence } from "@/lib/overview-insights";
import { PlBankDisagreeNotice } from "@/components/pl-bank-disagree-notice";
import type { ExtractionResult } from "@/lib/financialSchema";
import { cashFlowKnown, coherentEquity, effectivePeriodMonths } from "@/lib/equity-coherence";
import {
  clientReportsReadyCount,
  financialsHaveStatementFigures,
  reportsHomeReadyLine,
} from "@/lib/reports-drafter-copy";
import { pickCurrentSnapshot } from "@/lib/financial-snapshots";
import {
  DERIVED_EQUITY_LABEL,
  EQUITY_DERIVED_KEY,
  scalarsWithReadTimeEquity,
  periodFinancialsFromExtraction,
  preserveHandEnteredEquity,
  statementKindFromExtraction,
  type PeriodFinancials,
} from "@/lib/statement-financials";
import {
  financialsWriteRev,
  financialsWriteSuperseded,
  guardFinancialsWrite,
  importFailureMessage,
  importedUpdateMessage,
  withFinancialsWriteRev,
  statementImportWhat,
} from "@/lib/statement-import-apply";
import { confirmUploadedStatement, earlierStatementNote, liveStatementSpan, passStatementChoice, snapshotCoveringSpan, type PeriodChoice } from "@/lib/statement-import-plan";
import {
  CURRENCY_LABEL_CONFIRM_KEY,
  currencyImportRefusal,
  statementCurrencyGate,
  withCurrencyLabelConfirm,
} from "@/lib/statement-currency";
import { needsTrialBalanceRefresh } from "@/lib/trial-balance-refresh";
import { TrialBalanceRefreshPrompt } from "@/components/trial-balance-refresh-prompt";
import {
  computeRatios,
  PERIOD_MONTH_OPTIONS,
  PERIOD_MONTHS_CHOSEN_KEY,
  PERIOD_MONTHS_KEY,
  periodMonthsOf,
  scoreTier,
} from "@/lib/ratios";
import type { HealthTier } from "@/lib/ratios";
import {
  scoreRatio,
  healthMapFromRatios,
  ratioScoreBand,
  overviewRatioInputs,
  overviewRatios,
  CASH_OPENING_UNSCORED,
  GROSS_MARGIN_MAPPING_NOTE,
  grossMarginLooksImplausible,
  PILLAR_LABELS,
  PILLAR_SHORT_LABELS,
  liveHealthFromBooks,
  numberRatioRecord,
  healthWithoutEvidence,
  NOT_SCORED_YET_LABEL,
  type OverallHealth,
} from "@/lib/health-score";
import { playbookKeyForRatioName } from "@/lib/playbook-key";
import { countOpenRatioQueries, ratioQueryLabel } from "@/lib/ratio-queries";
import { ratioActualLine } from "@/lib/ratio-actuals";
import { buildScorecardRatioResults, scorecardRatiosFromFinancials } from "@/lib/scorecard-rows";
import type { RatioResult } from "@/reports/health-scorecard";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { FirmSwitcher } from "@/components/firm-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { SettingsMenu } from "@/components/settings-menu";
import { FeatureFinder } from "@/components/feature-finder";
import { HEALTH_RING_CAPTION, SphereHero, type SpherePillar } from "@/components/sphere-hero";
import { buildSpherePillars } from "@/components/sphere-hero-adapter";
import { SimplifiedRatios } from "@/components/simplified-ratios";
import {
  ProfitabilityWaterfall,
  profitAnswerSentence,
  type WaterfallExportApi,
} from "@/components/profitability-waterfall";
import { DeliverableAnswerStrip, deliverableDrawerHint } from "@/components/deliverable-answer-strip";
import { ARAP_GOLD_BTN } from "@/components/arap-answer-strip";
import { OverviewSectionCards } from "@/components/overview-section-cards";
import { ReviewInputsDrawer } from "@/components/review-inputs-drawer";
import { figureSourceChipLabel, resolveFigureSource } from "@/lib/ledger-link-copy";
import { booksAnswerSentence, booksCoverPeriod, booksTileLines, homeStatementsLine } from "@/lib/books-answer";
import { computeBudgetMonths } from "@/lib/budget.compute";
import { overviewBudgetTileFigure } from "@/lib/budget-chart-table";
import { parseBudgetDocument } from "@/lib/budget-pdf";
import { budgetSeededFromStatement, budgetVersusStatement, statementBudgetRead, statementCoverMonthCount } from "@/lib/budget.bridges";
import { yearMoneyFromFinancials } from "@/lib/budget-year-compare";
import { planAnswerSentence } from "@/lib/plan-pack-copy";
import { loadClientDisplayNames } from "@/lib/client-display-name";
import { ProductMixPanel } from "@/components/product-mix-panel";
import {
  FinancialInputsContext,
  DEFAULT_WEEKLY_ROW,
  type WeeklyInputs,
  type WeeklyRow,
} from "@/contexts/financial-inputs";
import {
  emptyWeeklyInputs,
  derivePeriodWaterfallFallback,
  resolveWaterfallFigures,
  hasWeeklyProfitFigures,
} from "@/lib/weekly-inputs";
import { fiscalWaterfallFallback } from "@/lib/budget-period";
import { emptyProductMix, type ProductMix, hasProductMixAnswer } from "@/lib/product-mix";
import { useServerFn } from "@tanstack/react-start";
import { listClientReviewSignoffs, indexReviewSignoffs } from "@/lib/review-signoffs.functions";
import type { ClientReviewSignoff, ReviewScope } from "@/lib/review-signoffs.functions";
import { ReviewSignoffButton } from "@/components/review-signoff";
import { AdvisoryTabSignoff } from "@/components/advisory-tab-signoff";
import type { AdvisorySignoffAction } from "@/lib/advisory-signoff";
import {
  parseOperatingProfile,
  stampProfileProvenance,
  type ClientOperatingProfile,
} from "@/lib/client-profile";
import { clientIndustryDisplay } from "@/lib/profile-signals";
import { NoteLayer } from "@/components/note-layer";
import { useNotes } from "@/contexts/notes";
import { accountantWorkspaceTab } from "@/lib/notes-tabs";
import {
  accountantClientRouteSearch,
  accountantClientTabSearch,
  canonicalizeAccountantSearch,
  legacyHashDestination,
  legacyPaneForSearch,
  routerHash,
} from "@/lib/client-route-search";
import { askAgentFromHash, searchWithAskAgent } from "@/lib/ask-agent";
import { ClientRail } from "@/components/client-studio-chrome";
import { ClientOwnerInviteHost } from "@/components/client-owner-invite-dialog";
import { ClientBackLink, ClientSectionOverview, ClientSubpageFrame } from "@/components/client-subpage";
import { clientBackTarget } from "@/lib/client-back";
import { useOverlayHistory } from "@/lib/overlay-history";
import type { ReportsStudioProps } from "@/routes/_authenticated/reports-studio";
import { hashIsCashDetailAnchor } from "@/lib/cash-forecast-view";
import { shouldNavigateForHashChange } from "@/lib/content-scroll-navigation";
import { agentDisplayName } from "@/lib/milon-team";
import { AccountantMenuButton, DrawerBackdrop, useAccountantDrawer } from "@/components/accountant-nav";
import { firmClientCrumbLabel, isActingAsThisClient } from "@/lib/acting-as-client";
import { useTrack } from "@/hooks/use-track";
import { QboConnectCard } from "@/components/qbo-connect";
import { XeroConnectCard } from "@/components/xero-connect";
import { StatementArApTiles, statementArApMoney } from "@/components/statement-arap-fallback";
import { hasStatementWorkingCapital } from "@/lib/collections";
import { SageConnectCard } from "@/components/sage-connect";
import { getXeroStatus, type XeroStatus } from "@/lib/xero.functions";
import { getQboStatus, type QboStatus } from "@/lib/qbo.functions";
import { formatDateRange } from "@/lib/market/format";
import {
  booksPeriodPillLabel,
  figuresPeriodLabelFrom,
  preferStatementPeriod,
  readStatementMeta,
  reportDataPeriodLabel,
  statementSpanLabel,
  statementYearLine,
} from "@/lib/statement-period";
import { clientHomePhase } from "@/lib/client-home-phase";
import {
  bootCriticalRetryFailed,
  bootRetryInFlight,
  bootSelect,
  shellBackstopDue,
  subscribeBootRetry,
} from "@/lib/boot-read";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";
import {
  assessClientMetrics,
  forecastHasRealLines,
  forecastOpeningIsKnown,
  hasFinancialEvidence,
  persistedRunwayWeeks,
  plBankDisagreement,
  runwayDisplayLabel,
  storedOpeningIsMissing,
} from "@/lib/client-metrics";
import { forecastPlFingerprint } from "@/lib/cash-forecast-rows";
import {
  cashOutlookIsCritical,
  cashSignedFiguresChanged,
  clientListStatusWord,
  forecastLowestPoint,
  forecastRunwayHeadlineShared,
  overviewCashTileFigure,
} from "@/lib/cash-forecast-parity";
import { countOpenQueriesForClient } from "@/lib/open-queries";
import { ProfileFunnel } from "@/components/profile/profile-funnel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DebtScheduleEditor } from "@/components/debt-schedule-editor";
import {
  splitFinancialsBlob,
  mergeFinancialsBlob,
  emptyDebtSchedule,
  type DebtSchedule,
} from "@/lib/debt-schedule";
import { BrandConnectButton } from "@/components/brand-connect-button";
import { ClientBriefing } from "@/components/client-briefing";
import { NextStepCard } from "@/components/next-step-card";
import { DataUpToDate } from "@/components/data-up-to-date";
import {
  dataFreshnessLine,
  evidenceForBriefingTab,
  evidenceForPillar,
  type CoachDestination,
} from "@/lib/workflow-coach";
import { relatedTabForRatio } from "@/lib/ratio-briefing";
import { RecommendationsPanel } from "@/components/recommendations-panel";
import { TrialEndedPlanBlock } from "@/components/trial-ended-plan-block";
import { isStarterTrialEndedMessage, messageFromUnknown } from "@/lib/starter-trial-generation";
import { DataRequestsPanel } from "@/components/data-requests-panel";
import { AdvisoryPackPanel } from "@/components/advisory-pack-panel";
import { OutcomesPanel } from "@/components/outcomes-panel";
import { nextStepRoute, type NextStep, type NextStepTarget } from "@/lib/next-step";
import { portalButtonClass } from "@/lib/client-chrome";
import { requestRevealDataRequests } from "@/lib/reveal-data-requests";
import { focusTrapTabIndex, listFocusable, overlayMayHandleKey } from "@/lib/dialog-focus";
import {
  buildFinancialSnapshot,
  describeBusiness,
  fallbackWorkflow,
  healthHeadline,
  whatMatters,
  workflowInputsHash,
  type WorkflowContext,
} from "@/lib/client-briefing";
import {
  overviewAnswerSentence,
  overviewSectionCards,
  snapshotFigure,
  storedAmountFigure,
} from "@/lib/overview-moves-copy";
import { draftMilonWorkflow, type BriefingWorkflow } from "@/lib/client-briefing.functions";
import { buildVarianceChips, resolvePriorSnapshot, type SnapshotRow } from "@/lib/prior-period";
import { AdvisorySentHistory } from "@/components/advisory-sent-history";
import { ClientBrainSummary, StatementFigures } from "@/components/client-brain-summary";
import { StrategicMovesPanel } from "@/components/strategic-moves-panel";
import { attachPillarScore, rankStrategicMoves, stockSittingApplies } from "@/lib/strategic-moves";
import { periodProfitBridge, statementGrossMarginFraction } from "@/lib/period-profit";
import { implausibleSampleNote, statementSampleImplausible } from "@/lib/operating-profit-display";
import {
  hashFigures,
  latestSnapshotId,
  countsAsSent,
  listDeliveries,
  recordDelivery,
  warnIfDeliveryFailed,
  warnIfPdfArchiveFailed,
  type AdvisoryDelivery,
} from "@/lib/advisory-deliveries";
import { upsertCurrentPeriodSnapshot } from "@/lib/financial-snapshots";
import { needsPastPeriodPrompt } from "@/lib/history-coverage";
import { AddPastPeriodLink } from "@/components/add-past-period-link";
import { PastPeriodUploadDialog } from "@/components/past-period-upload";
import { stampFromSignoff } from "@/lib/review-signoff-stamp";
import { cashSignoffIsStale, healthSignoffIsStale, signoffStatusKind, signoffStatusLine } from "@/lib/signoff-status";
import { financialsHomeSignoffLine } from "@/components/owner-signoff-mark";
import { MilonTeamPane } from "@/components/milon-team/milon-team-pane";
import { ClientAgentStandby } from "@/components/client-agent-standby";
import { OwnerHome } from "@/components/owner-door/owner-home";
import { AgentDraftShelf } from "@/components/agent-draft-shelf";
import { FinancialManagerBrief, type HomeBriefHandoff } from "@/components/financial-manager-brief";
import { buildFinancialManagerBrief } from "@/lib/financial-manager-brief";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import { DRAFT_NEEDS_ACCOUNTANT, draftFindingLabel } from "@/hooks/owner-agent-ui";
import { isVisibleAgentFinding } from "@/lib/milon-team-activity";
import { findingForAction } from "@/lib/action-handoff";
import { handoffRowStillWorking } from "@/lib/agent-activity-poll";
import { ownerPresence, steerOpenHandoffs, withCardHandoffRuns } from "@/lib/owner-presence";
import {
  ACTION_PLAN_REFRESH_EVENT,
  clearOptimisticHandoff,
  handoffPaintBlocked,
  HANDOFF_FAILED_COPY,
  loadActionHandoffRuns,
  loadActionNotes,
  loadLatestAssignments,
  optimisticNoteHidden,
  readHandoffError,
  type ActionPlanRefreshDetail,
} from "@/lib/owner-handoff-client";
import {
  applyLiveRuns,
  displayedHandoffRun,
  openHandoffAgents,
  pendingAssignmentLanded,
  personOwnedActionIds,
  rowAssignment,
  withPendingAssignment,
  withPendingNote,
  withoutPersonQueuedRuns,
  type RowAssignment,
} from "@/lib/open-plan-home";
import { ownerAnswerTiles, ownerCardStatuses, ownerHomeLines, spokenCashStrain, type OwnerBooks } from "@/lib/owner-answers";
import { actionOverdueInput, countActionPlan } from "@/lib/action-plan-counts";
import { homeActionNeeds, openActionSentence, presentHomeDraftBody, presentHomeDraftTitle } from "@/lib/owner-needs";
import { healthSnapshotFromBooks, readStoredScoreSnapshotHash, renderHealthNarrative } from "@/lib/health-snapshot";
import { draftStoredFiguresHash, draftStoredHealth, latestFiguresStamp } from "@/lib/draft-figures";
import type { AgentKey } from "@/lib/milon-team-feed";
import type { SavedCashflowLike } from "@/lib/cash-runway";
import { EmptyState } from "@/components/primitives";
import { DeliverableInputConfig } from "@/components/deliverable-input-config";
import { bankAccountsFromDraft, ratiosStatementFigures } from "@/lib/deliverable-input-config";
import { cashDriverDayFigures } from "@/lib/cash-driver-label";

const ActionPlanPanel = lazyPanel(() => import("@/components/action-plan"), "Action Plan");
const ReportsStudioPanel = lazyPanel<ReportsStudioProps>(
  () =>
    import("@/routes/_authenticated/reports-studio").then((m) => ({
      default: m.ReportsStudio,
    })),
  "Reports",
);

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Persists today's computed health score into `client_score_history` so the
 * dashboard/client 8-point sparkline accumulates real history instead of
 * padding a single current score forever. Called every time a real snapshot
 * is saved (manual edit or statement upload) — never for exports/reads.
 * Table may not exist yet (migration 20260802000000_...sql pending
 * application) — swallow only that specific "missing relation" error.
 */
async function recordScoreHistory(clientId: string, score: number | null) {
  if (score == null || !Number.isFinite(score)) return;
  const periodDate = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("client_score_history").upsert(
    {
      client_id: clientId,
      period_date: periodDate,
      score,
      is_estimated: false,
    },
    { onConflict: "client_id,period_date" },
  );
  if (error) {
    const msg = error.message ?? "";
    if (!msg.includes("does not exist") && !msg.includes("relation") && error.code !== "42P01") {
      console.error("record score history error:", error);
    }
  }
}

/**
 * Increments `clients.reports_issued_count` after a report is actually
 * generated (not just when the generator page is opened). Column may not
 * exist yet (migration pending) — swallow only that specific error.
 */
async function recordReportIssued(clientId: string) {
  const { data, error: readErr } = await supabase
    .from("clients")
    .select("reports_issued_count")
    .eq("id", clientId)
    .maybeSingle();
  if (readErr) {
    if (readErr.code !== "42703" && !readErr.message?.includes("reports_issued_count")) {
      console.error("read reports_issued_count error:", readErr);
    }
    return;
  }
  const next = (data?.reports_issued_count ?? 0) + 1;
  const { error } = await supabase
    .from("clients")
    .update({ reports_issued_count: next })
    .eq("id", clientId);
  if (error) console.error("increment reports_issued_count error:", error);
}

function extractionToRatioInputs(r: ExtractionResult): PeriodFinancials {
  return periodFinancialsFromExtraction(r);
}

// Financial input field labels
const FIELD_LABELS: { key: string; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "cogs", label: "COGS" },
  { key: "ebit", label: "EBIT" },
  { key: "ebt", label: "EBT" },
  { key: "netIncome", label: "Net income" },
  { key: "ebitda", label: "EBITDA" },
  { key: "operatingCashflow", label: "Operating cash flow" },
  { key: "totalAssets", label: "Total assets" },
  { key: "equity", label: "Equity" },
  { key: "receivables", label: "Receivables (AR)" },
  { key: "inventory", label: "Inventory" },
  { key: "payables", label: "Payables (AP)" },
  { key: "fixedCosts", label: "Fixed costs" },
  { key: "variableCosts", label: "Variable costs" },
  { key: "top5Revenue", label: "Top-5 customer revenue" },
  { key: "laborCost", label: "Labor cost" },
  { key: "employees", label: "Employees" },
  { key: "founderHours", label: "Founder hours / yr" },
  { key: "cash", label: "Cash" },
];

/** Waterfall-critical fields shown on the Profit tab data-input card. */
const PROFIT_FIELD_LABELS: { key: string; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "cogs", label: "COGS" },
  { key: "fixedCosts", label: "Operating expenses / fixed costs" },
  { key: "ebit", label: "EBIT" },
  { key: "ebt", label: "EBT" },
  { key: "netIncome", label: "Net income" },
];

// tier → band class mapping
function tierToBand(tier: HealthTier): "ok" | "warn" | "risk" {
  if (tier === "healthy") return "ok";
  if (tier === "at_risk") return "warn";
  return "risk";
}

function bandColor(band: "ok" | "warn" | "risk"): string {
  if (band === "ok") return "var(--ok)";
  if (band === "warn") return "var(--warn)";
  return "var(--risk)";
}

// Score from ratio value — delegated to the shared health-score module
function ratioHealthScore(
  name: string,
  val: number,
  market?: Parameters<typeof scoreRatio>[2],
): number {
  return scoreRatio(name, val, market);
}

/** Health ring SVG */
function HealthRing({
  id,
  score,
  status,
  size = 46,
  strokeWidth = 4,
}: {
  id?: string;
  score: number | null;
  /** When set, drives ring colour (critical-pillar tell). */
  status?: HealthTier;
  size?: number;
  strokeWidth?: number;
}) {
  const hasScore = score != null && Number.isFinite(score);
  const shown = hasScore ? score : 0;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const band = tierToBand(status ?? (hasScore ? scoreTier(shown) : "at_risk"));
  const color = bandColor(band);
  const off = c * (1 - shown / 100);
  return (
    <div className="ring" id={id} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="tr"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--pale, #dbeafe)"
          strokeWidth={strokeWidth}
        />
        {hasScore ? (
          <circle
            className="fl"
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={strokeWidth}
            stroke={color}
            strokeDasharray={`${c.toFixed(1)}`}
            strokeDashoffset={`${off.toFixed(1)}`}
          />
        ) : null}
      </svg>
      <b>{hasScore ? Math.round(shown) : "—"}</b>
    </div>
  );
}

// ── route ──────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  validateSearch: accountantClientRouteSearch,
  component: ClientView,
});

type Client = {
  id: string;
  name: string;
  business_type: string | null;
  client_code?: string | null;
  operating_profile?: unknown;
  cash_runway_weeks: number | null;
  last_forecast_at: string | null;
  reports_issued_count?: number;
  financials?: Record<string, string | number | null> | null;
  financials_updated_at?: string | null;
  cashflow?: ExistingCashflow | null;
  market?: unknown;
  /** P1: firm attached → the accountant seat signs off advisory packs. */
  firm_id?: string | null;
  is_demo?: boolean | null;
  budget?: unknown;
};

type ActiveTab =
  | "overview"
  | "ask"
  | "ratios"
  | "profit"
  | "cash"
  | "collections"
  | "payables"
  | "budget"
  | "reports"
  | "plan"
  | "advisory"
  | "drafter"
  | "summary"
  | "moves";

const ACCOUNTANT_TABS: ActiveTab[] = [
  "overview",
  "summary",
  "moves",
  "ask",
  "ratios",
  "profit",
  "cash",
  "collections",
  "payables",
  "budget",
  "reports",
  "plan",
  "advisory",
  "drafter",
];

const CRUMB_PARENT: Record<string, { label: string; tab: string }> = {
  overview: { label: "Home", tab: "home" },
  ask: { label: "Home", tab: "home" },
  ratios: { label: "Health", tab: "health" },
  cash: { label: "Cash flow", tab: "cash" },
  profit: { label: "Profit", tab: "profit" },
  budget: { label: "Budget", tab: "budget" },
  moves: { label: "Next moves", tab: "moves" },
  plan: { label: "Action plan", tab: "plan" },
  reports: { label: "Reports", tab: "reports" },
  summary: { label: "Books", tab: "portal" },
};

function crumbSectionLabel(tab: string, section: string): string {
  if (tab === "reports" && section === "forecast") return "13-week cash forecast";
  if (tab === "reports" && section === "waterfall") return "Profitability waterfall";
  const labels: Record<string, string> = {
    score: "Score",
    pillars: "Where it hurts",
    forecast: "13-week forecast",
    collections: "Who to chase",
    payables: "Who to pay",
    waterfall: "Waterfall",
    lines: "Product lines",
    year: "This year",
    months: "Month by month",
    open: "Open work",
    overdue: "Overdue",
    scorecard: "Health scorecard",
    "budget-pdf": "Budget & variance",
    benchmark: "Benchmark",
    drafts: "Drafts",
    sent: "Sent",
    all: "All reports",
    documents: "Documents",
    connections: "Connections",
  };
  return labels[section] ?? section;
}

function ClientCrumb({
  clientId,
  activeTab,
  section,
  agent,
}: {
  clientId: string;
  activeTab: string;
  section: string | null;
  agent: string | null;
}) {
  const parent = CRUMB_PARENT[activeTab];
  if (!parent) return null;
  const child = agent
    ? agentDisplayName(agent as "financial_manager" | "analyst" | "advisor")
    : section
      ? crumbSectionLabel(activeTab, section)
      : null;
  if (activeTab === "overview" && !agent) return null;
  return (
    <>
      <span>/</span>
      {child ? (
        <Link
          to="/clients/$clientId"
          params={{ clientId }}
          search={(prev) => {
            const next = accountantClientTabSearch(prev, parent.tab);
            delete (next as { agent?: string }).agent;
            return next;
          }}
          className="crumb-link"
        >
          {parent.label}
        </Link>
      ) : (
        <b style={{ color: "var(--ink)" }}>{parent.label}</b>
      )}
      {child ? (
        <>
          <span>/</span>
          <b style={{ color: "var(--ink)" }}>{child}</b>
        </>
      ) : null}
    </>
  );
}

function DeliverableTabHead({
  id,
  eyebrow,
  title,
  lede,
  signoff,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  lede?: React.ReactNode;
  signoff?: React.ReactNode;
}) {
  return (
    <div className="deliverable-tab-head" id={id}>
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <div className="h-sec">{title}</div>
        {lede ? (
          <p className="sub" style={{ margin: "8px 0 0", maxWidth: "68ch" }}>
            {lede}
          </p>
        ) : null}
      </div>
      {signoff ? <div className="deliverable-tab-head__sign">{signoff}</div> : null}
    </div>
  );
}

/** Old Staff tasks deep-links land on Action Plan. */
function FirstDataChoice({
  primary,
  label,
  hint,
  onClick,
}: {
  primary?: boolean;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "w-full rounded-xl bg-[#0B5FFF] px-4 py-3 text-left text-white hover:bg-[#2563EB]"
          : "w-full rounded-xl border border-[#DBEAFE] bg-white px-4 py-3 text-left text-[#102A43] hover:border-[#2563EB] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB]"
      }
    >
      <span className="block text-sm font-semibold leading-snug">{label}</span>
      <span className={`mt-0.5 block text-xs ${primary ? "text-white/90" : "text-[#3D5270] dark:text-[#C5D4E4]"}`}>
        {hint}
      </span>
    </button>
  );
}

function resolveAccountantTab(
  input: string | { tab?: string; section?: string; focus?: string } | undefined,
): ActiveTab | null {
  if (input == null) return null;
  const search = typeof input === "string" ? { tab: input } : input;
  const fromNotes = search.tab ? accountantWorkspaceTab(search.tab) : null;
  const pane =
    legacyPaneForSearch(search) ??
    (fromNotes && ACCOUNTANT_TABS.includes(fromNotes as ActiveTab) ? (fromNotes as ActiveTab) : null);
  if (pane && ACCOUNTANT_TABS.includes(pane)) return pane;
  return null;
}

// Friendly labels for SphereHero drivers
const SPHERE_RATIO_META: Record<string, { friendly: string }> = {
  grossMargin: { friendly: "Gross Margin" },
  operatingMargin: { friendly: "Operating Margin" },
  netMargin: { friendly: "Net Margin" },
  fixedCostRatio: { friendly: "Fixed Cost Ratio" },
  assetTurnover: { friendly: "Asset Turnover" },
  roa: { friendly: "Return on Assets" },
  inventoryDays: { friendly: "Inventory Days" },
  salesPerEmployee: { friendly: "Sales per Employee" },
  equityMultiplier: { friendly: "Equity Multiplier" },
  interestBurden: { friendly: "Interest Burden" },
  taxBurden: { friendly: "Tax Burden" },
  debtorDays: { friendly: "Debtor Days" },
  creditorDays: { friendly: "Creditor Days" },
  workingCapitalDays: { friendly: "Working Capital Days" },
  ocfToEbitda: { friendly: "OCF / EBITDA" },
  dol: { friendly: "Operating Leverage" },
  customerConcentration: { friendly: "Customer Concentration" },
  gpToLabor: { friendly: "Gross Profit / Labor" },
  roe: { friendly: "Return on Equity" },
};

// Maps computeRatios() human-readable names → camelCase healthMap keys
// (shared RATIO_NAME_TO_KEY from @/lib/health-score)

// ── Component ──────────────────────────────────────────────────────────────

function ClientView() {
  const { clientId } = Route.useParams();
  const search = Route.useSearch();
  const { user } = useAuth();
  const {
    notes: clientNotes,
    loading: notesLoading,
    openArchive,
    requestOpenNote,
    focusNoteId,
    clearFocusNote,
  } = useNotes();
  const navigate = useNavigate();
  const firmDashboardLinked = firmDashboardCrumbIsLink(useFirmBillingEntitled());
  const { profile, firmId, greetingSource } = useAccountantProfile();
  const track = useTrack();
  const [showQboDialog, setShowQboDialog] = useState(false);
  const [showXeroDialog, setShowXeroDialog] = useState(false);
  const [showSageDialog, setShowSageDialog] = useState(false);

  // QBO / Xero OAuth return — callbacks land here for accountants.
  // Open the connect dialog so Sync is on screen; the inline cards sit on
  // Health & Ratios and are easy to miss after the redirect.
  useEffect(() => {
    if (!search.qbo && !search.xero) return;
    if (search.qbo === "connected") {
      toast.success("QuickBooks Online connected — tap Sync to import data");
      setShowQboDialog(true);
    } else if (search.qbo === "error") {
      toast.error(`QuickBooks connection failed: ${search.reason ?? "unknown error"}`);
      setShowQboDialog(true);
    }
    if (search.xero === "connected") {
      toast.success("Xero connected — tap Sync to import P&L and balance sheet");
      setShowXeroDialog(true);
    } else if (search.xero === "error") {
      toast.error(`Xero connection failed: ${search.reason ?? "unknown error"}`);
      setShowXeroDialog(true);
    }
    navigate({
      to: "/clients/$clientId",
      params: { clientId },
      search: (prev) => {
        const next = { ...prev };
        delete next.qbo;
        delete next.xero;
        delete next.reason;
        return next;
      },
      replace: true,
    });
  }, [search.qbo, search.xero, search.reason, clientId, navigate]);

  // First-client onboarding: land from dashboard with ?onboard=1 → bank upload nudge
  useEffect(() => {
    if (search.onboard !== "1") return;
    setFirstDataOpen(true);
    navigate({
      to: "/clients/$clientId",
      params: { clientId },
      search: (prev) => {
        const next = { ...prev };
        delete next.onboard;
        return next;
      },
      replace: true,
    });
  }, [search.onboard, clientId, navigate]);

  const [actingAsThisClient, setActingAsThisClient] = useState(false);
  useEffect(() => {
    const stored =
      typeof sessionStorage !== "undefined" ? sessionStorage.getItem("acting_as_client_id") : null;
    setActingAsThisClient(isActingAsThisClient(stored, clientId));
  }, [clientId]);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [clientLoadAttempt, setClientLoadAttempt] = useState(0);
  const [activeTab, setActiveTab] = useState<ActiveTab>(
    () => resolveAccountantTab(search) ?? "overview",
  );
  const [ownerInviteOpen, setOwnerInviteOpen] = useState(false);
  const [healthDrill, setHealthDrill] = useState<{
    token: number;
    pillarId: SpherePillar["id"];
  } | null>(null);
  useEffect(() => {
    if (search.section !== "score" || !healthDrill) return;
    const timer = window.setTimeout(() => {
      document.getElementById("health-score-drill")?.scrollIntoView({ block: "start" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [search.section, healthDrill]);
  const openFromBotRef = useRef<(handoff: CoachDestination & { why?: string }) => void>(() => {});
  const persistedCreateRef = useRef<
    (payload: {
      question: string;
      created: {
        pdf?: boolean;
        items?: Array<{ title: string; outcomeWhy?: string }>;
        overview?: { facts?: string[] };
      };
    }) => void
  >(() => {});
  persistedCreateRef.current = (payload) => {
    window.dispatchEvent(new CustomEvent("milon-action-plan-refresh"));
    const wantsPdf = payload.created?.pdf === true || /\bpdf\b/i.test(payload.question);
    if (!wantsPdf || !client) return;
    const facts = payload.created.overview?.facts ?? [];
    const created = payload.created.items ?? [];
    const clientName = client.name;
    const planClientId = client.id;
    void (async () => {
      let periodLabel: string | null = null;
      let outcomeGoal: string | null = null;
      let planItems: Array<{
        title: string;
        status?: string | null;
        dueDate?: string | null;
        outcomeWhy?: string | null;
        ownerName?: string | null;
      }> = [];
      try {
        const { data: plans } = await supabase
          .from("action_plans")
          .select("id, period_label, outcome_goal")
          .eq("client_id", planClientId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1);
        const plan = (plans?.[0] ?? null) as {
          id: string;
          period_label?: string | null;
          outcome_goal?: string | null;
        } | null;
        if (plan) {
          periodLabel = plan.period_label ?? null; // date-ok: action plan quarter stamp, not a day range
          outcomeGoal = plan.outcome_goal ?? null;
          const { data: rows } = await supabase
            .from("action_items_v")
            .select("title, status, due_date, outcome_why, owner_name")
            .eq("plan_id", plan.id)
            .order("seq");
          planItems = ((rows ?? []) as Array<Record<string, string | null>>).flatMap((row) => {
            const title = row.title?.trim();
            if (!title) return [];
            return [
              {
                title,
                status: row.status,
                dueDate: row.due_date,
                outcomeWhy: row.outcome_why,
                ownerName: row.owner_name,
              },
            ];
          });
        }
      } catch {
        planItems = [];
      }
      await downloadActionPlanPdf({
        clientName,
        periodLabel,
        outcomeGoal,
        headline: facts.length ? facts.join(" · ") : null,
        items: completeDeliverablePdfItems(planItems, created),
        profile,
        market: gateMarket,
      });
    })()
      .then(() => toast.success("Action Plan PDF downloaded"))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "PDF export failed"));
  };
  const onClientSettings = canonicalizeAccountantSearch(search).tab === "settings";
  useEffect(() => {
    if (search.invite !== "owner" || !onClientSettings) return;
    setOwnerInviteOpen(true);
    void navigate({
      to: "/clients/$clientId",
      params: { clientId },
      search: (prev) => {
        const next = { ...(prev as Record<string, unknown>) };
        delete next.invite;
        return next;
      },
      replace: true,
    });
  }, [search.invite, onClientSettings, clientId, navigate]);
  useEffect(() => {
    // Old ?tab= values are rewritten to tab + section in validateSearch.
    const next = resolveAccountantTab(search);
    if (next) setActiveTab(next);
    if (search.note) requestOpenNote(search.note);
    if (search.queries === "open") openArchive("open");
    if (search.profile === 1) setProfileOpen(true);
  }, [search, requestOpenNote, openArchive]);
  const askHashClear = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    let scrolling = false;
    let scrollTimer = 0;
    const markScroll = () => {
      scrolling = true;
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        scrolling = false;
      }, 400);
    };
    const apply = (phase: "load" | "hashchange") => {
      if (!shouldNavigateForHashChange({ phase, scrolling })) return;
      const hash = window.location.hash;
      const asked = askAgentFromHash(hash);
      if (asked) {
        setActiveTab("overview");
        const token = `${clientId}:${asked}`;
        if (search.agent === asked && askHashClear.current === token) return;
        askHashClear.current = token;
        void navigate({
          to: "/clients/$clientId",
          params: { clientId },
          search: (prev) => searchWithAskAgent(prev, asked),
          hash: undefined,
          replace: true,
        });
        return;
      }
      askHashClear.current = null;
      const next = legacyHashDestination({ tab: search.tab, section: search.section }, hash);
      if (!next) return;
      const keepHash = hashIsCashDetailAnchor(hash);
      void navigate({
        to: "/clients/$clientId",
        params: { clientId },
        search: (prev) => accountantClientTabSearch(prev, next.tab, { section: next.section }),
        hash: keepHash ? routerHash(hash) : undefined,
        replace: true,
      });
    };
    apply("load");
    const onHash = () => apply("hashchange");
    window.addEventListener("hashchange", onHash);
    window.addEventListener("scroll", markScroll, { passive: true });
    window.addEventListener("wheel", markScroll, { passive: true });
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("scroll", markScroll);
      window.removeEventListener("wheel", markScroll);
      window.clearTimeout(scrollTimer);
    };
  }, [search.tab, search.section, search.agent, clientId, navigate]);
  // Landing tab: Home (Bot and the team desk). Decided once per client, after
  // load, and never over a ?tab= deep link.
  // The tour variant is fixed at the same moment: flipping to the full tour
  // the instant the first figure is typed would yank the user mid-entry.
  // The full tour runs on the next visit once figures exist.
  const landingTabDecidedFor = useRef<string | null>(null);
  const [tourVariant, setTourVariant] = useState<
    "accountant-client" | "accountant-client-empty" | null
  >(null);
  const decideLandingTab = useCallback(
    (scalars: Record<string, string>) => {
      if (landingTabDecidedFor.current === clientId) return;
      landingTabDecidedFor.current = clientId;
      const figures = FIELD_LABELS.some(({ key }) => (scalars[key] ?? "").trim() !== "");
      setTourVariant(figures ? "accountant-client" : "accountant-client-empty");
      if (resolveAccountantTab(search)) return;
      setActiveTab("overview");
    },
    [clientId, search],
  );
  useEffect(() => {
    track("tab_viewed", {
      tab: activeTab,
      surface: "accountant_portal",
      clientId,
      firmId,
      path: `/clients/${clientId}`,
    });
  }, [activeTab, clientId, firmId, track]);
  const [finOpen, setFinOpen] = useState(false);
  const [profitExport, setProfitExport] = useState<WaterfallExportApi | null>(null);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [planFocusMove, setPlanFocusMove] = useState<string | null>(null);
  const [cashForecastReloadToken, setCashForecastReloadToken] = useState(0);
  const [cashBankUploadToken, setCashBankUploadToken] = useState(0);
  const [pendingBankFile, setPendingBankFile] = useState<File | null>(null);
  const [bankCashDraft, setBankCashDraft] = useState<
    import("@/lib/cash-from-banks.types").CashFromBanksDraftResult | null
  >(null);
  const [budgetReloadToken, setBudgetReloadToken] = useState(0);
  const [, setBudgetReviewStale] = useState(false);
  const [autoPopulateState, setAutoPopulateState] = useState<AutoPopulateState | null>(null);
  const refreshAutoPopulateState = useCallback(async () => {
    try {
      setAutoPopulateState(await loadAutoPopulateState(clientId));
    } catch (e) {
      console.warn("auto-populate state:", e);
    }
  }, [clientId]);
  useEffect(() => {
    void refreshAutoPopulateState();
  }, [refreshAutoPopulateState]);
  const applyAutoPopulateResult = useCallback(
    (r: Awaited<ReturnType<typeof runAutoPopulate>>) => {
      const now = new Date().toISOString();
      setClient((c) =>
        c
          ? {
              ...c,
              ...(r.applied.includes("profitability") ? { financials_updated_at: now } : {}),
              ...(r.applied.includes("cash_forecast")
                ? {
                    last_forecast_at: now,
                    cashflow: (r.cashflow as never) ?? c.cashflow,
                    ...(r.runwayWeeks != null ? { cash_runway_weeks: r.runwayWeeks } : {}),
                  }
                : {}),
            }
          : c,
      );
      if (r.applied.includes("cash_forecast")) setCashForecastReloadToken((n) => n + 1);
      if (r.applied.includes("budget")) setBudgetReloadToken((n) => n + 1);
      track("upload_auto_populated", {
        surface: "accountant_portal",
        clientId,
        firmId,
        firstUpload: r.firstUpload,
        applied: r.applied.join(","),
      });
      toast.success(summariseAutoPopulate(r, r.firstUpload), { duration: 7000 });
      void refreshAutoPopulateState();
    },
    [clientId, firmId, refreshAutoPopulateState, track],
  );

  // Financials state (flat key-value for the fin-grid)
  const [financials, setFinancials] = useState<Record<string, string>>({});
  const [xeroLink, setXeroLink] = useState<XeroStatus>(null);
  const [xeroChecked, setXeroChecked] = useState(false);
  const [xeroRefresh, setXeroRefresh] = useState(0);
  const fetchXeroLink = useServerFn(getXeroStatus);
  const [qboLink, setQboLink] = useState<QboStatus>(null);
  const [qboChecked, setQboChecked] = useState(false);
  const [qboRefresh, setQboRefresh] = useState(0);
  const [sageRefresh, setSageRefresh] = useState(0);
  const fetchQboLink = useServerFn(getQboStatus);
  const [debtSchedule, setDebtSchedule] = useState<DebtSchedule>(emptyDebtSchedule());
  const [weeklyInputs, setWeeklyInputs] = useState<WeeklyInputs>(emptyWeeklyInputs);
  const [productMix, setProductMix] = useState<ProductMix>(emptyProductMix);
  const financialsRef = useRef(financials);
  financialsRef.current = financials;

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    void fetchXeroLink({ data: { clientId } })
      .then((status) => {
        if (!cancelled) {
          setXeroLink(status);
          setXeroChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setXeroLink(null);
          setXeroChecked(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // fetchXeroLink identity is not stable; clientId + refresh token are the triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, xeroRefresh]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    void fetchQboLink({ data: { clientId } })
      .then((status) => {
        if (!cancelled) {
          setQboLink(status);
          setQboChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQboLink(null);
          setQboChecked(true);
        }
      });
    return () => {
      cancelled = true;
    };
    // fetchQboLink identity is not stable; clientId + refresh token are the triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, qboRefresh]);
  const debtScheduleRef = useRef(debtSchedule);
  debtScheduleRef.current = debtSchedule;
  const weeklyInputsRef = useRef(weeklyInputs);
  weeklyInputsRef.current = weeklyInputs;
  const productMixRef = useRef(productMix);
  productMixRef.current = productMix;
  const [profileOpen, setProfileOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const closeUpload = useOverlayHistory(uploadOpen, () => setUploadOpen(false));
  const [uploadPurpose, setUploadPurpose] = useState<"figures" | "aged">("figures");
  const uploadDialogRef = useRef<HTMLDivElement>(null);
  const [pastPeriodOpen, setPastPeriodOpen] = useState(false);
  const historyOnlyUploadRef = useRef(false);
  useEffect(() => {
    if (!uploadOpen) {
      historyOnlyUploadRef.current = false;
      setUploadPurpose("figures");
    }
  }, [uploadOpen]);
  useEffect(() => {
    if (!uploadOpen) return;
    const root = uploadDialogRef.current;
    if (!root) return;
    const previously =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => listFocusable(root);
    const initial = focusables();
    (initial[0] ?? root).focus();
    const onKey = (event: KeyboardEvent) => {
      if (!uploadOpen) return;
      if (!overlayMayHandleKey(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeUpload();
        return;
      }
      if (event.key !== "Tab") return;
      event.preventDefault();
      const items = focusables();
      if (items.length === 0) {
        root.focus();
        return;
      }
      const active = document.activeElement;
      const activeIndex = active instanceof HTMLElement ? items.indexOf(active) : -1;
      const next = focusTrapTabIndex(items.length, activeIndex, event.shiftKey);
      if (next < 0) return;
      items[next]?.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (previously && document.contains(previously)) previously.focus();
    };
  }, [uploadOpen]);
  const [showBankDrafter, setShowBankDrafter] = useState(false);
  const [firstDataOpen, setFirstDataOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [scoreHistory, setScoreHistory] = useState<{ period_date: string; score: number }[]>([]);
  const [deliveryRefresh, setDeliveryRefresh] = useState(0);
  const [sentSeed, setSentSeed] = useState<AdvisoryDelivery[] | null>(null);
  useEffect(() => {
    if (activeTab !== "reports") return;
    let cancelled = false;
    listDeliveries(clientId)
      .then((data) => {
        if (!cancelled) setSentSeed(data.filter(countsAsSent));
      })
      .catch(() => {
        if (!cancelled) setSentSeed([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, clientId, deliveryRefresh]);
  // Bumped by the recommendations panel so the Next Step card re-resolves.
  const [advisoryBump, setAdvisoryBump] = useState(0);
  const [packSignoff, setPackSignoff] = useState<AdvisorySignoffAction | null>(null);
  const [planSentence, setPlanSentence] = useState("");
  const [planKnown, setPlanKnown] = useState(false);
  const [planCount, setPlanCount] = useState(0);
  const focusPlanAdd = useRef<(() => void) | null>(null);
  const onPlanAnswer = useCallback((actions: readonly { title: string; status?: string | null }[]) => {
    setPlanKnown(true);
    setPlanCount(actions.length);
    setPlanSentence(planAnswerSentence(actions));
  }, []);
  const registerPlanAdd = useCallback((focus: () => void) => {
    focusPlanAdd.current = focus;
  }, []);
  const [queriesRefresh, setQueriesRefresh] = useState(0);

  // Accountant sign-off — one stamp per deliverable tab
  const fetchReviewSignoffs = useServerFn(listClientReviewSignoffs);
  const [reviewSignoffs, setReviewSignoffs] = useState<
    Partial<Record<ReviewScope, ClientReviewSignoff>>
  >({});
  const [signoffsKnown, setSignoffsKnown] = useState(false);
  const financialsSignoff = reviewSignoffs.financials ?? null;
  const profitabilitySignoff = reviewSignoffs.profitability ?? null;
  const cashForecastSignoff = reviewSignoffs.cash_forecast ?? null;
  const [cashSignedSnapshot, setCashSignedSnapshot] = useState<unknown>(null);
  const budgetSignoff = reviewSignoffs.budget ?? null;
  const actionPlanSignoff = reviewSignoffs.action_plan ?? null;
  const advisorySignoff = reviewSignoffs.advisory ?? null;
  const patchSignoff = (scope: ReviewScope) => (next: ClientReviewSignoff | null) => {
    setReviewSignoffs((m) => {
      const copy = { ...m };
      if (next) copy[scope] = next;
      else delete copy[scope];
      return copy;
    });
  };

  // Playbook drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerFormula, setDrawerFormula] = useState<string | null>(null);
  const [drawerActual, setDrawerActual] = useState<string | null>(null);
  const [drawerFallbackSteps, setDrawerFallbackSteps] = useState<string[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const routeHref = useRouterState({ select: (s) => s.location.href });
  useEffect(() => {
    setMobileNavOpen(false);
  }, [routeHref]);
  useEffect(() => {
    const next = resolveAccountantTab(search);
    if (next) setActiveTab(next);
  }, [search]);
  useEffect(() => {
    if (search.tab || search.section || search.agent || search.report) return;
    void navigate({
      to: "/clients/$clientId",
      params: { clientId },
      search: (prev) => ({ ...prev, tab: "home" }),
      replace: true,
    });
  }, [search.tab, search.section, search.agent, search.report, clientId, navigate]);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (!mobileNavOpen) return;
      if (!overlayMayHandleKey(event)) return;
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);
  useAccountantDrawer(mobileNavOpen, () => setMobileNavOpen(false));
  const [drawerRatioKey, setDrawerRatioKey] = useState<string | null>(null);
  const [drawerRatioName, setDrawerRatioName] = useState<string>("");
  const [drawerTier, setDrawerTier] = useState<HealthTier>("at_risk");
  const [drawerRatioValue, setDrawerRatioValue] = useState<number | null>(null);
  const [drawerRevenue, setDrawerRevenue] = useState<number | null>(null);
  const [drawerNetProfit, setDrawerNetProfit] = useState<number | null>(null);

  /** Unresolved client notes — live open-query count for triage. */
  const [openQueriesCount, setOpenQueriesCount] = useState(0);

  const storedClientSelection = parseMarketSelection(client?.market);
  /** Tax card, rand, and SA-only copy. A missing market is not ZA. */
  const clientGateCountry = parseMarketSelection(client?.market)?.country ?? null;
  /** Dates, timezone, and locale. A missing market stays South Africa. */
  const clientMarket = useMemo(() => marketForClient({ market: client?.market }), [client?.market]);
  const gateMarket = useMemo((): ResolvedMarket => {
    if (storedClientSelection) return resolveMarket(storedClientSelection);
    const dates = clientMarket;
    return {
      ...dates,
      currency: "USD",
      copyPack: "us",
      tax: { regime: "none" },
    };
  }, [storedClientSelection, clientMarket]);
  const fyStartMonth =
    parseOperatingProfile(client?.operating_profile)?.fyStartMonth ?? clientMarket.fyStartMonthDefault;
  // Health and the ratios under it use the stored figures cover, the same
  // cover as the scorecard PDF. A year-span must not score different inventory
  // or working-capital days than that PDF.
  const statementMonths = periodMonthsOf(financials);
  const coverageMonths = effectivePeriodMonths(financials, { fyStartMonth });
  const partMonth = (reportDataPeriodLabel(financials, clientMarket) ?? "").includes("part month");
  const equityCheck = coherentEquity(financials);
  const parsedEquity = Number(equityCheck.equity);
  const equityAmount =
    equityCheck.equity.trim() !== "" && Number.isFinite(parsedEquity) ? parsedEquity : null;
  const ratioInputs = overviewRatioInputs(financials, {
    fyStartMonth,
    periodMonths: statementMonths,
  });
  const periodMonths = coverageMonths;
  /** True once any P&L / balance-sheet figure exists — gates the empty-state card and Ask AI note. */
  const hasFigures = useMemo(() => financialsHaveStatementFigures(financials), [financials]);
  useEffect(() => {
    // Mark only once Overview is showing the score. A bot tab or an import
    // in flight must not count as "figures seen" and pull the card wall.
    if (hasFigures && (activeTab === "ask" || activeTab === "overview")) markInsightSeen(firmId);
  }, [hasFigures, activeTab, firmId]);
  const startStudioTourAfterFigures = useCallback(() => {
    markOnboardingDone(ACCOUNTANT_CLIENT_EMPTY_TOUR_KEY);
    setFirstDataOpen(false);
    setTourVariant("accountant-client");
  }, []);
  const jumpToFinancials = useCallback(() => {
    setActiveTab("ratios");
    setFinOpen(true);
    window.setTimeout(() => {
      document
        .getElementById("finCollapse")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.querySelector<HTMLInputElement>("#finCollapse .fin-grid input")?.focus();
    }, 120);
  }, []);
  const ratios = overviewRatios(financials, {
    fyStartMonth,
    periodMonths: statementMonths,
  });
  const ratioQueryCounts = useMemo(() => countOpenRatioQueries(clientNotes), [clientNotes]);
  const statementMeta = readStatementMeta(financials, clientMarket);
  const statementDated = Boolean(statementMeta.periodStart && statementMeta.periodEnd);
  const priorSnapshot = resolvePriorSnapshot(snapshots, new Date(), {
    periodEnd: statementMeta.periodEnd,
    financials,
  });
  const assessed = useMemo(
    () =>
      assessClientMetrics({
        financials,
        cashflow: client?.cashflow,
        financialsUpdatedAt: client?.financials_updated_at ?? null,
        priorFinancials: priorSnapshot?.financials ?? null,
        timeZone: clientMarket.timezone,
        fyStartMonth,
      }),
    [
      financials,
      client?.cashflow,
      client?.financials_updated_at,
      priorSnapshot,
      clientMarket.timezone,
      fyStartMonth,
    ],
  );
  const metricRunway = assessed.runway;
  const cashOutlook = assessed.outlook;
  /** Weeks blended into health. Cash-generative is omitted — it is not 0 weeks. */
  const effectiveRunway =
    metricRunway.kind === "weeks" || metricRunway.kind === "zero" ? metricRunway.weeks : null;
  const cashBalance = assessed.cash.amount;
  const cashKnown = cashBalance != null;
  const cashOnFile = cashKnown || forecastOpeningIsKnown(client?.cashflow);
  const openingMissing = storedOpeningIsMissing(client?.cashflow);
  const healthIndustry = clientIndustryDisplay(
    client?.name,
    parseOperatingProfile(client?.operating_profile),
  );
  const evidenced = hasFinancialEvidence({
    financials,
    cashflow: client?.cashflow,
  });
  const forecastLines = forecastHasRealLines(client?.cashflow);
  const scoredHealth = liveHealthFromBooks({
    financials: financials as Record<string, unknown>,
    cashflow: client?.cashflow,
    financialsUpdatedAt: client?.financials_updated_at ?? null,
    priorFinancials: priorSnapshot?.financials ?? null,
    fyStartMonth,
    market: clientMarket,
    industry: healthIndustry,
    timeZone: clientMarket.timezone,
  });
  const overallHealth: OverallHealth = evidenced ? scoredHealth : healthWithoutEvidence(scoredHealth);
  const bookStatusWord = clientListStatusWord({
    healthLabel: overallHealth.displayLabel,
    healthOverall: overallHealth.overall,
    source: cashOutlook.source,
    opening: cashOutlook.opening,
    floor: cashOutlook.floor,
    dipsBelowFloorWeek: cashOutlook.dipsBelowFloorWeek,
    totalInflow: cashOutlook.totalInflow,
    totalOutflow: cashOutlook.totalOutflow,
    openingMissing,
    cashOnFile,
  });
  const bookStatusCritical = bookStatusWord.startsWith("Critical");
  const planCashBelowFloor = cashOutlookIsCritical({
    opening: cashOutlook.opening,
    floor: cashOutlook.floor,
    dipsBelowFloorWeek: cashOutlook.dipsBelowFloorWeek,
    openingMissing,
    cashOnFile,
  });
  const plVersusBank = useMemo(
    () => plBankDisagreement({ financials, cashflow: client?.cashflow }),
    [financials, client?.cashflow],
  );
  const healthScoreRounded = overallHealth.overall ?? 0;
  const pageSignoffStale = (
    signoff: ClientReviewSignoff | null,
    updatedAt: string | null | undefined,
  ) =>
    healthSignoffIsStale({
      signoff,
      dataUpdatedAt: updatedAt,
      snapshots,
      liveHealth: overallHealth.overall,
      scoreHistory,
    });
  const reportSignoffStale = useMemo(
    () => ({
      financials: healthSignoffIsStale({
        signoff: financialsSignoff,
        dataUpdatedAt: client?.financials_updated_at ?? null,
        snapshots,
        liveHealth: overallHealth.overall,
        scoreHistory,
      }),
      profitability: healthSignoffIsStale({
        signoff: profitabilitySignoff,
        dataUpdatedAt: client?.financials_updated_at ?? null,
        snapshots,
        liveHealth: overallHealth.overall,
        scoreHistory,
      }),
      cash_forecast: cashSignoffIsStale(
        cashForecastSignoff,
        client?.last_forecast_at ?? null,
        cashSignedFiguresChanged(cashSignedSnapshot, client?.cashflow),
      ),
    }),
    [
      financialsSignoff,
      profitabilitySignoff,
      cashForecastSignoff,
      client?.financials_updated_at,
      client?.last_forecast_at,
      client?.cashflow,
      cashSignedSnapshot,
      snapshots,
      overallHealth.overall,
      scoreHistory,
    ],
  );

  // ── Health orb & pillar computation (same source as header / score history) ──
  const healthMap = healthMapFromRatios(ratios as Record<string, number>, clientMarket);

  const pillarById = Object.fromEntries(
    overallHealth.pillars.map((p) => [p.id, p.score ?? NaN]),
  ) as Record<"profit" | "assets" | "financing" | "cash", number>;
  const pillarStatus = Object.fromEntries(
    overallHealth.pillars.map((p) => [p.id, p.status]),
  ) as Record<"profit" | "assets" | "financing" | "cash", HealthTier>;

  const pillarHealths = {
    profit: pillarById.profit,
    assets: pillarById.assets,
    financing: pillarById.financing,
    cash: pillarById.cash,
  };

  const avgHealth = overallHealth.overall ?? NaN;
  const healthCaption = computeOverviewCaption({
    hasRealFinancials: hasFigures,
    avgHealth,
    cashHealth: pillarHealths.cash ?? NaN,
    displayStatus: overallHealth.displayStatus,
  });
  const healthPillarLines = (["profit", "assets", "financing", "cash"] as const).map((id) => ({
    label: PILLAR_SHORT_LABELS[id],
    score: pillarHealths[id],
    status: pillarStatus[id],
  }));
  const healthSentence = healthAnswerSentence({
    caption: healthCaption,
    score: Number.isFinite(avgHealth) ? avgHealth : null,
    bandLabel: bookStatusWord,
    pillars: healthPillarLines,
    includeScore: search.focus === "pillars",
  });
  const connectedLedger = qboLink?.figuresFromThisSync
    ? "qbo"
    : xeroLink?.figuresFromThisSync
      ? "xero"
      : qboLink
        ? "qbo"
        : xeroLink
          ? "xero"
          : null;
  const figureSource = resolveFigureSource({
    financials,
    snapshotSource: pickCurrentSnapshot(snapshots)?.source,
    connectedLedger,
  });
  const healthChip = figureSourceChipLabel(figureSource);

  const sphereRatioMeta = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(SPHERE_RATIO_META).map(([k, v]) => [
          k,
          { friendly: localizeCopy(v.friendly, gateMarket) },
        ]),
      ),
    [gateMarket],
  );

  const pillarNotes = Object.fromEntries(
    overallHealth.pillars.map((pillar) => [pillar.id, pillar.note ?? null]),
  ) as Record<"profit" | "assets" | "financing" | "cash", string | null>;
  const spherePillars = buildSpherePillars({
    overallHealth: avgHealth,
    pillarHealths,
    pillarStatus,
    pillarNotes,
    healthMap,
    ratioMeta: sphereRatioMeta,
    inventoryApplies: stockSittingApplies(parseOperatingProfile(client?.operating_profile)),
    dayCounts: cashDriverDayFigures(financials),
    driverNotes: grossMarginLooksImplausible(
      statementGrossMarginFraction(financials) ?? ratios["Gross Margin"] ?? Number.NaN,
      healthIndustry,
    )
      ? { grossMargin: GROSS_MARGIN_MAPPING_NOTE }
      : undefined,
  });
  const simplifiedSections = [
    {
      id: "profit",
      label: PILLAR_LABELS.profit,
      health: pillarHealths.profit,
      status: pillarStatus.profit,
      unscoredLabel: pillarNotes.profit,
      series: [] as number[],
    },
    {
      id: "assets",
      label: PILLAR_LABELS.assets,
      health: pillarHealths.assets,
      status: pillarStatus.assets,
      unscoredLabel: pillarNotes.assets,
      series: [] as number[],
    },
    {
      id: "financing",
      label: PILLAR_LABELS.financing,
      health: pillarHealths.financing,
      status: pillarStatus.financing,
      unscoredLabel: pillarNotes.financing,
      series: [] as number[],
    },
    {
      id: "cash",
      label: PILLAR_LABELS.cash,
      health: pillarHealths.cash,
      status: pillarStatus.cash,
      unscoredLabel: pillarNotes.cash ?? (openingMissing ? CASH_OPENING_UNSCORED : null),
      series: [] as number[],
    },
  ];

  const varianceChips = buildVarianceChips({
    currentFinancials: financials,
    currentRatios: ratios,
    prior: priorSnapshot,
    healthScore: healthScoreRounded,
    cashRunwayWeeks: effectiveRunway,
  });

  // ── Client briefing (header) ──────────────────────────────────────────────
  const briefingProfile = parseOperatingProfile(client?.operating_profile);
  const openRatioQueryLabels = useMemo(() => {
    const labels = Object.entries(ratioQueryCounts)
      .filter(([, n]) => n > 0)
      .map(([key]) => ratioQueryLabel(key));
    return [...new Set(labels)];
  }, [ratioQueryCounts]);
  /** Ratios with an open client question. One health view still badges them. */
  const openRatioQueryRows = useMemo(() => {
    const seen = new Set<string>();
    const rows: Array<{ key: string; label: string; count: number }> = [];
    for (const [key, count] of Object.entries(ratioQueryCounts)) {
      if (count <= 0) continue;
      const label = ratioQueryLabel(key);
      if (seen.has(label)) continue;
      seen.add(label);
      rows.push({ key, label, count });
    }
    rows.sort((a, b) => a.label.localeCompare(b.label));
    return rows;
  }, [ratioQueryCounts]);
  const deliverableInputContext = useMemo(
    () => ({
      financials,
      operatingProfile: briefingProfile,
      hasCashLines: Boolean(client?.cashflow),
      hasBankDraft: Boolean(bankCashDraft),
      bankAccounts: bankAccountsFromDraft(bankCashDraft),
      openRatioQueryLabels,
      productMixIncomplete: !hasProductMixAnswer(productMix),
      hasPriorPeriod: Boolean(priorSnapshot),
      hasWeeklyInputs: hasWeeklyProfitFigures(weeklyInputs),
    }),
    [
      financials,
      briefingProfile,
      client?.cashflow,
      bankCashDraft,
      openRatioQueryLabels,
      productMix,
      priorSnapshot,
      weeklyInputs,
    ],
  );
  const currentSnapshot = pickCurrentSnapshot(snapshots);
  const figuresPeriodLabel = figuresPeriodLabelFrom(
    financials,
    pickCurrentSnapshot(snapshots)?.period_label,
    clientMarket,
  );
  const liveScoreSnapshot = healthSnapshotFromBooks({
    health: overallHealth,
    periodLabel: figuresPeriodLabel,
  });
  const ledgerSpan = (link: {
    periodLabel: string | null;
    periodStart: string | null;
    periodEnd: string | null;
  }) =>
    statementSpanLabel({
      periodStart: link.periodStart,
      periodEnd: link.periodEnd,
      periodLabel: link.periodLabel,
      market: clientMarket,
    });
  const snapshotFinancials =
    currentSnapshot?.financials && typeof currentSnapshot.financials === "object"
      ? currentSnapshot.financials
      : null;
  const snapshotMeta = readStatementMeta(snapshotFinancials, clientMarket);
  const liveDates = Boolean(statementMeta.periodStart && statementMeta.periodEnd);
  // Dates already on the client. Do not wait for the ledger status request:
  // that request can return a successful sync with the period stripped, and
  // the books sentence would drop the span.
  const booksSpanLabel = statementSpanLabel({
    periodStart: liveDates ? statementMeta.periodStart : snapshotMeta.periodStart,
    periodEnd: liveDates ? statementMeta.periodEnd : snapshotMeta.periodEnd,
    periodLabel: liveDates
      ? statementMeta.periodLabel
      : snapshotMeta.periodLabel || currentSnapshot?.period_label,
    market: clientMarket,
  });
  const snapshotSpan = booksSpanLabel;
  const dataFreshness = dataFreshnessLine({
    xero: xeroLink
      ? {
          lastSyncedAt: xeroLink.lastSyncedAt,
          syncStatus: xeroLink.syncStatus,
          periodLabel: ledgerSpan(xeroLink),
        }
      : null,
    qbo: qboLink
      ? {
          lastSyncedAt: qboLink.lastSyncedAt,
          syncStatus: qboLink.syncStatus,
          periodLabel: ledgerSpan(qboLink),
        }
      : null,
    snapshotPeriod: snapshotSpan,
    market: clientMarket,
  });
  const booksPeriod = booksCoverPeriod(dataFreshness);
  const budgetDoc = parseBudgetDocument(client?.budget ?? null);
  const budgetCompared = budgetDoc
    ? budgetVersusStatement(
        statementBudgetRead(budgetDoc, financials as Record<string, unknown>).doc,
        financials as Record<string, unknown>,
        clientMarket,
      )
    : null;
  const budgetMoney = (amount: number) => formatMoneyCompact(amount, gateMarket);
  let budgetFigure: string | null = null;
  const budgetComparable =
    budgetCompared != null &&
    (budgetCompared.periodKnown !== false || budgetSeededFromStatement(budgetCompared));
  if (budgetComparable && budgetCompared) {
    budgetFigure = overviewBudgetTileFigure({
      budgetRevenue: budgetCompared.budgetRevenue,
      actualRevenue: budgetCompared.revenue,
      seeded: budgetSeededFromStatement(budgetCompared),
      money: budgetMoney,
    });
  } else if (budgetDoc) {
    const rows = computeBudgetMonths(budgetDoc, budgetDoc.activeScenario);
    const row = rows.find((entry) => entry.revenue > 0) ?? rows[0];
    budgetFigure = overviewBudgetTileFigure({
      budgetRevenue: row?.revenue,
      seeded: true,
      money: budgetMoney,
    });
  }
  const statementGrossMargin = statementGrossMarginFraction(financials);
  const statementFigureFacts = {
    grossMargin: statementGrossMargin ?? ratios["Gross Margin"],
    operatingMargin: ratios["Operating Margin"],
    netMargin: ratios["Net Margin"],
    periodLabel: figuresPeriodLabel,
  };
  const clientProfitBridge = periodProfitBridge(financials);
  const debtorDaysForMoves = ratiosStatementFigures(financials).debtorDays;
  const strategicMoves = rankStrategicMoves({
    healthByKey: healthMap,
    profile: briefingProfile,
    suppressKeys: clientProfitBridge.interestBurdenUsable ? undefined : ["interestBurden"],
    debtorDays: debtorDaysForMoves,
    financingHealth: pillarHealths.financing,
    weakestPillar: overallHealth.weakestPillar?.id ?? null,
    hasEvidence: evidenced,
    market: clientMarket,
  });
  const cashRunwayHeadline = hasFigures
    ? forecastRunwayHeadlineShared({
        opening: cashOutlook.opening,
        closings: cashOutlook.closing,
        floor: cashOutlook.floor,
        runwayLabel: runwayDisplayLabel(metricRunway),
        cashGenerative: metricRunway.kind === "cash_generative",
        openingMissing,
      }).headline
    : null;
  const cashLowPoint = hasFigures
    ? forecastLowestPoint(cashOutlook.opening, cashOutlook.closing)
    : null;
  const briefingSnapshot = buildFinancialSnapshot({
    chips: varianceChips,
    cashRunwayWeeks: effectiveRunway,
    runwayLabel: cashRunwayHeadline,
    financialsUpdatedAt: client?.financials_updated_at ?? null,
    lastForecastAt: client?.last_forecast_at ?? null,
    priorLabel: priorSnapshot
      ? statementSpanLabel({
          periodStart: readStatementMeta(priorSnapshot.financials, clientMarket).periodStart,
          periodEnd: readStatementMeta(priorSnapshot.financials, clientMarket).periodEnd,
          periodLabel: priorSnapshot.period_label,
          market: clientMarket,
        })
      : null,
    periodLabel: figuresPeriodLabel,
    datedPeriod: statementDated,
    market: gateMarket,
    cash:
      hasFigures && assessed.cash.amount != null
        ? {
            amount: cashOutlook.opening,
            floor: cashOutlook.floor,
            dipsBelowFloorWeek: cashOutlook.dipsBelowFloorWeek,
            note: cashOutlook.anchorNote,
          }
        : null,
  });
  const debtorDaysFigure = ratios["Debtor Days"];
  const actualDebtorDays = Number.isFinite(debtorDaysFigure) ? debtorDaysFigure : null;
  const briefingAbout = describeBusiness(
    briefingProfile,
    client?.business_type ?? null,
    actualDebtorDays,
    { name: client?.name ?? null, businessType: client?.business_type ?? null },
  );
  const briefingMatters = whatMatters({
    healthScore: overallHealth.overall,
    healthStatus: overallHealth.displayStatus,
    chips: varianceChips,
    cashRunwayWeeks: effectiveRunway,
    profile: briefingProfile,
    hasFigures,
    ratios: ratios as Record<string, number>,
    forecastNet: assessed.forecastNet,
  });
  const overviewSentence = overviewAnswerSentence({
    whatMatters: briefingMatters,
    score: hasFigures ? overallHealth.overall : null,
    label: bookStatusWord,
  });
  const statementPosition = ratiosStatementFigures(financials);
  const booksLines = booksTileLines({
    period: booksPeriod ?? snapshotFigure(briefingSnapshot, "updated"),
    source: figureSource,
    sourceLabel: healthChip,
    syncedStamp: snapshotFigure(briefingSnapshot, "updated"),
  });
  const overviewCards = overviewSectionCards({
    health: hasFigures ? healthHeadline(overallHealth.overall, bookStatusWord) : null,
    cash:
      overviewCashTileFigure({
        headline: cashRunwayHeadline,
        opening: hasFigures ? cashOutlook.opening : null,
        lowest: cashLowPoint?.amount ?? null,
        lowestIsOpening: cashLowPoint?.isOpening ?? true,
        money: (amount) => formatMoneyCompact(amount, gateMarket),
      }) ?? snapshotFigure(briefingSnapshot, "cash"),
    profit: snapshotFigure(briefingSnapshot, "om"),
    collections: storedAmountFigure(statementPosition.receivables, (amount) =>
      statementArApMoney(amount, gateMarket),
    ),
    payables: storedAmountFigure(statementPosition.payables, (amount) =>
      statementArApMoney(amount, gateMarket),
    ),
    budget: budgetFigure,
    moves: strategicMoves[0]?.title ?? null,
    books: booksLines.figure,
  }, booksLines.detail ? { books: booksLines.detail } : undefined);
  const [openPlanTitles, setOpenPlanTitles] = useState<string[] | null>(null);
  const [openPlanHandoffs, setOpenPlanHandoffs] = useState<HomeBriefHandoff[]>([]);
  const [openPlanOverdue, setOpenPlanOverdue] = useState(0);
  const [openPlanUnavailable, setOpenPlanUnavailable] = useState(false);
  const [openPlanTick, setOpenPlanTick] = useState(0);
  const [openActionAgent, setOpenActionAgent] = useState<AgentKey | null>(null);
  const [assignmentRows, setAssignmentRows] = useState<RowAssignment[]>([]);
  const [handedTitle, setHandedTitle] = useState<string | null>(null);
  const pendingHandoffs = useRef(new Map<string, ActionPlanRefreshDetail>());
  const assignmentRowsRef = useRef(assignmentRows);
  assignmentRowsRef.current = assignmentRows;
  const handoffsRef = useRef(openPlanHandoffs);
  handoffsRef.current = openPlanHandoffs;
  const priorHandoff = useRef(
    new Map<string, { since: string; row: RowAssignment | null; handoff: HomeBriefHandoff | null }>(),
  );
  const paintAssignments = (
    rows: readonly { id: string; title: string; assigneeName: string | null }[],
    assigned: readonly RowAssignment[],
    notes: ReadonlyMap<string, { note: string | null; at: string; actorLabel?: string | null; actorType?: string | null }[]>,
    runs: ReadonlyMap<string, { id?: string; agent: AgentKey; status: string; at: string }>,
  ) => {
    const first = assigned.find((row) => row.open);
    setAssignmentRows([...assigned]);
    setOpenPlanHandoffs(
      rows.map((row) => {
        const item = assigned.find((entry) => entry.id === row.id);
        const run = runs.get(row.id) ?? null;
        return {
          id: row.id,
          title: row.title,
          assignee: item?.assigneeName ?? row.assigneeName,
          agent: item?.agent ?? null,
          notes: (notes.get(row.id) ?? []).filter((note) => !optimisticNoteHidden(row.id, note.at)),
          openedAt: item?.openedAt,
          runId: item?.runId ?? run?.id,
          error: readHandoffError(row.id),
          run,
        };
      }),
    );
    setOpenActionAgent(first?.agent ?? null);
    setHandedTitle(first ? (rows.find((row) => row.id === first.id)?.title ?? null) : null);
  };
  useEffect(() => {
    const bump = (event: Event) => {
      const detail = (event as CustomEvent<ActionPlanRefreshDetail | undefined>).detail;
      if (detail?.failed && detail.actionItemId) {
        const id = detail.actionItemId;
        const prior = priorHandoff.current.get(id);
        pendingHandoffs.current.delete(id);
        if (prior) {
          setAssignmentRows((current) =>
            prior.row
              ? current.map((row) => (row.id === id ? { ...prior.row!, open: false, runId: undefined } : row))
              : current.filter((row) => row.id !== id),
          );
          setOpenPlanHandoffs((rows) => {
            const restored = prior.handoff
              ? {
                  ...prior.handoff,
                  notes: (prior.handoff.notes ?? []).filter((note) => note.at !== detail.since),
                  error: detail.error ?? HANDOFF_FAILED_COPY,
                  runId: undefined,
                }
              : null;
            if (restored) return rows.map((row) => (row.id === id ? restored : row));
            return rows.filter((row) => row.id !== id);
          });
        }
        setOpenPlanTick((n) => n + 1);
        return;
      }
      if (detail?.actionItemId && detail.reused) {
        const id = detail.actionItemId;
        const current = pendingHandoffs.current.get(id);
        pendingHandoffs.current.set(id, { ...(current ?? detail), ...detail, note: undefined, reused: true });
        setOpenPlanHandoffs((rows) =>
          rows.map((row) =>
            row.id === id
              ? {
                  ...row,
                  runId: detail.runId ?? row.runId,
                  error: null,
                  openedAt: row.openedAt ?? detail.since,
                }
              : row,
          ),
        );
        setAssignmentRows((currentRows) =>
          currentRows.map((row) =>
            row.id === id
              ? { ...row, open: row.agent != null, openedAt: row.openedAt ?? detail.since, runId: detail.runId ?? row.runId }
              : row,
          ),
        );
        setOpenPlanTick((n) => n + 1);
        return;
      }
      if (detail?.actionItemId) {
        const agent = detail.agent ?? null;
        const name = detail.assigneeName ?? (agent ? agentDisplayName(agent) : null);
        if (name) {
          if (detail.since && priorHandoff.current.get(detail.actionItemId)?.since !== detail.since) {
            priorHandoff.current.set(detail.actionItemId, {
              since: detail.since,
              row: assignmentRowsRef.current.find((row) => row.id === detail.actionItemId) ?? null,
              handoff: handoffsRef.current.find((row) => row.id === detail.actionItemId) ?? null,
            });
          }
          pendingHandoffs.current.set(detail.actionItemId, { ...detail, agent, assigneeName: name });
          const nextRow: RowAssignment = {
            id: detail.actionItemId,
            assigneeName: name,
            agent,
            open: agent != null,
            openedAt: agent ? detail.since : undefined,
            runId: detail.runId,
          };
          setAssignmentRows((current) =>
            current.some((row) => row.id === nextRow.id)
              ? current.map((row) => (row.id === nextRow.id ? nextRow : row))
              : [...current, nextRow],
          );
          setOpenPlanHandoffs((rows) => {
            const current = rows.find((row) => row.id === detail.actionItemId);
            const found = Boolean(current);
            const sameWorking =
              !detail.runId &&
              current?.run != null &&
              current.run.agent === agent &&
              (current.run.status === "queued" || current.run.status === "running");
            const patched = {
              assignee: name,
              agent,
              notes:
                detail.note && !optimisticNoteHidden(detail.actionItemId, detail.note.at)
                  ? withPendingNote(current?.notes ?? [], detail.note)
                  : (current?.notes ?? []).filter((note) => !optimisticNoteHidden(detail.actionItemId, note.at)),
              openedAt: sameWorking ? current?.openedAt : agent ? detail.since : undefined,
              runId: detail.runId ?? (sameWorking ? (current?.runId ?? current?.run?.id) : current?.runId),
              error: null,
              run: agent
                ? sameWorking && current?.run
                  ? current.run
                  : {
                      id: detail.runId,
                      agent,
                      status: "queued" as const,
                      at: detail.since ?? new Date().toISOString(),
                    }
                : null,
            };
            const next = rows.map((row) => (row.id === detail.actionItemId ? { ...row, ...patched } : row));
            return found
              ? next
              : [...next, { id: detail.actionItemId, title: detail.title, ...patched }];
          });
          if (agent) {
            setOpenActionAgent(agent);
            setHandedTitle(detail.title);
          }
          if (detail.title) {
            setOpenPlanTitles((titles) =>
              titles && titles.includes(detail.title) ? titles : [...(titles ?? []), detail.title],
            );
          }
        }
      }
      setOpenPlanTick((n) => n + 1);
    };
    window.addEventListener(ACTION_PLAN_REFRESH_EVENT, bump);
    return () => window.removeEventListener(ACTION_PLAN_REFRESH_EVENT, bump);
  }, []);
  const seenPlanClient = useRef<string | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    if (seenPlanClient.current !== clientId) {
      seenPlanClient.current = clientId;
      pendingHandoffs.current.clear();
      setOpenPlanTitles(null);
      setOpenPlanHandoffs([]);
      setHandedTitle(null);
      setOpenActionAgent(null);
      setAssignmentRows([]);
    }
    setOpenPlanUnavailable(false);
    void (async () => {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const [itemsRes, planRes] = await Promise.all([
        supabase
          .from("action_items_v")
          .select("id, title, due_date, status, owner_name, created_at")
          .eq("client_id", clientId)
          .neq("status", "done")
          .order("seq"),
        supabase
          .from("action_plans")
          .select("target_date")
          .eq("client_id", clientId)
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      if (cancelled) return;
      const { data, error } = itemsRes;
      if (error) {
        setOpenPlanUnavailable(true);
        setOpenPlanTitles([]);
        setOpenPlanHandoffs([]);
        setOpenPlanOverdue(0);
        setOpenActionAgent(null);
        setAssignmentRows([]);
        setHandedTitle(null);
        return;
      }
      const rows = (data ?? []) as {
        id?: string | null;
        title?: string | null;
        due_date?: string | null;
        status?: string | null;
        created_at?: string | null;
        owner_name?: string | null;
      }[];
      const planTarget =
        (planRes.data?.[0] as { target_date?: string | null } | undefined)?.target_date ?? null;
      const titles = rows.flatMap((row) => {
        const title = row.title?.trim() ?? "";
        return title ? [title] : [];
      });
      setOpenPlanUnavailable(false);
      setOpenPlanTitles(titles);
      const ids = rows.flatMap((row) => (row.id && row.title?.trim() ? [row.id] : []));
      const [assignments, runs, noteLog] = ids.length
        ? await Promise.all([loadLatestAssignments(ids), loadActionHandoffRuns(ids), loadActionNotes(ids)])
        : [new Map(), new Map(), new Map()];
      if (cancelled) return;
      const pendings = [...pendingHandoffs.current.values()].filter(
        (pending) => pending.assigneeName && !handoffPaintBlocked(pending.actionItemId, pending.since),
      );
      const openRows = rows.flatMap((row) => {
        const title = row.title?.trim() ?? "";
        return row.id && title
          ? [{ id: row.id, title, ownerName: row.owner_name?.trim() || null }]
          : [];
      });
      const assigned = openRows.map((row) => {
        const stored = assignments.get(row.id) ?? null;
        return rowAssignment({
          id: row.id,
          ownerName: row.ownerName,
          notes: stored
            ? [
                {
                  note:
                    stored.kind === "bot"
                      ? `Handed to ${stored.name}.`
                      : `Assigned to ${stored.name}.`,
                  at: stored.at,
                },
              ]
            : [],
          run: runs.get(row.id) ?? null,
        });
      });
      let merged = assigned;
      const paintedNotes = new Map(noteLog);
      const paintedRuns = new Map(runs);
      for (const pending of pendings) {
        const pendingStored = assignments.get(pending.actionItemId) ?? null;
        const pendingView = {
          id: pending.actionItemId,
          agent: pending.agent ?? null,
          assigneeName: pending.assigneeName ?? "",
          since: pending.since,
          runId: pending.runId,
        };
        const serverRun = runs.get(pending.actionItemId) ?? null;
        const reusedLanded = Boolean(pending.reused && pending.runId && serverRun?.id === pending.runId);
        const pendingLanded = reusedLanded || (!pending.reused && pendingAssignmentLanded(pendingStored, pendingView));
        if (pendingLanded) {
          pendingHandoffs.current.delete(pending.actionItemId);
          clearOptimisticHandoff(pending.actionItemId);
          continue;
        }
        merged = withPendingAssignment(merged, pendingView, pendingStored);
        if (pending.note && !optimisticNoteHidden(pending.actionItemId, pending.note.at)) {
          paintedNotes.set(
            pending.actionItemId,
            withPendingNote(paintedNotes.get(pending.actionItemId) ?? [], pending.note),
          );
        }
        const shownRun = displayedHandoffRun(
          serverRun,
          { agent: pending.agent ?? null, since: pending.since },
          false,
        );
        if (shownRun) {
          paintedRuns.set(pending.actionItemId, {
            id: pending.runId ?? serverRun?.id,
            agent: shownRun.agent,
            status: shownRun.status,
            at: shownRun.at ?? pending.since ?? "",
          });
        }
        if (pending.title && !titles.includes(pending.title)) titles.push(pending.title);
      }
      const labelled = openRows.map((row) => ({
        id: row.id,
        title: row.title,
        assigneeName: row.ownerName,
      }));
      for (const pending of pendings) {
        if (pendingHandoffs.current.has(pending.actionItemId) && pending.title && pending.assigneeName) {
          if (!labelled.some((row) => row.id === pending.actionItemId)) {
            labelled.push({
              id: pending.actionItemId,
              title: pending.title,
              assigneeName: pending.assigneeName,
            });
          }
        }
      }
      setOpenPlanTitles(titles);
      setOpenPlanOverdue(
        countActionPlan(
          rows.flatMap((row) => {
            const title = row.title?.trim() ?? "";
            if (!title) return [];
            return [
              actionOverdueInput(
                {
                  status: row.status,
                  dueDate: row.due_date,
                  createdAt: row.created_at ?? null,
                  planTarget,
                },
                today,
              ),
            ];
          }),
          today,
        ).overdue,
      );
      paintAssignments(labelled, merged, paintedNotes, paintedRuns);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, openPlanTick]);
  const workflowCtx: WorkflowContext = {
    clientName: client?.name ?? "",
    profile: briefingProfile,
    businessType: client?.business_type ?? null,
    healthScore: overallHealth.overall,
    healthLabel: bookStatusWord,
    snapshot: briefingSnapshot,
    chips: varianceChips,
    cashRunwayWeeks: effectiveRunway,
    whatMatters: briefingMatters,
    openQueries: openQueriesCount,
    debtorDays: actualDebtorDays,
    forecastKey: forecastPlFingerprint(client?.cashflow, financials),
  };
  const workflowHash = workflowInputsHash(workflowCtx);
  const [workflow, setWorkflow] = useState<BriefingWorkflow | null>(null);
  const [workflowLoading, setWorkflowLoading] = useState(false);
  const [generationTrialOpen, setGenerationTrialOpen] = useState(false);
  const draftWorkflow = useServerFn(draftMilonWorkflow);
  const workflowCtxRef = useRef(workflowCtx);
  workflowCtxRef.current = workflowCtx;
  const requestWorkflow = useCallback(
    async (force: boolean) => {
      if (!clientId) return;
      setWorkflowLoading(true);
      try {
        const res = await draftWorkflow({
          data: { clientId, force, context: workflowCtxRef.current as never },
        });
        setWorkflow(res);
      } catch (e) {
        if (isStarterTrialEndedMessage(messageFromUnknown(e))) {
          setGenerationTrialOpen(true);
        }
        console.warn("[briefing] workflow draft failed:", messageFromUnknown(e) || e);
      } finally {
        setWorkflowLoading(false);
      }
    },
    [clientId, draftWorkflow],
  );
  // Instant fallback so the briefing is never empty; the drafted line
  // upgrades it when the cached or newly generated text arrives.
  useEffect(() => {
    if (!client || loading || !hasFigures) return;
    setWorkflow((prev) => {
      if (prev && prev.inputsHash === workflowHash) return prev;
      return {
        text: fallbackWorkflow(workflowCtxRef.current),
        source: "fallback",
        generatedAt: new Date().toISOString(),
        inputsHash: workflowHash,
      };
    });
    const t = setTimeout(() => void requestWorkflow(false), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, workflowHash, loading, hasFigures, Boolean(client)]);
  useEffect(() => {
    const onTrialEnded = () => setGenerationTrialOpen(true);
    window.addEventListener("milon-starter-trial-ended", onTrialEnded);
    return () => window.removeEventListener("milon-starter-trial-ended", onTrialEnded);
  }, []);

  const accountantProfitPeriod = fiscalWaterfallFallback(financials, fyStartMonth);
  const waterfallFallback =
    accountantProfitPeriod?.fallback ?? derivePeriodWaterfallFallback(financials);
  const profitPeriodLabel = accountantProfitPeriod?.slice.label ?? figuresPeriodLabel;

  // ── Milōn Bot widget mount (same widget the owner app uses) ─────────────
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const el = document.getElementById("ask-ai-accountant");
    if (!el) return;
    // Always refresh the client context — submit() reads dataset.clientId at
    // request time, so a stale value would send questions for the wrong client.
    el.dataset.clientId = clientId;
    el.dataset.forecastKey = forecastPlFingerprint(client.cashflow, client.financials);
    const askAgent =
      search.agent === "financial_manager" || search.agent === "analyst" || search.agent === "advisor"
        ? search.agent
        : "";
    if (askAgent) el.dataset.agent = askAgent;
    else delete el.dataset.agent;
    el.dispatchEvent(new Event("ask-ai-context"));
    // Remount once figures land so the pre-figures note disappears (same
    // pattern as the owner board's useAskAiMount).
    const wantMode = hasFigures ? "live" : "pre-figures";
    if (el.dataset.askAiMounted && el.dataset.askAiMode === wantMode) return;
    el.innerHTML = "";
    delete el.dataset.askAiMounted;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — plain JS module without type declarations
    import("../../lib/ask-ai.js")
      .then((mod: { mountAskAi?: (el: HTMLElement, opts: unknown) => void }) => {
        if (cancelled || typeof mod.mountAskAi !== "function") return;
        el.dataset.clientId = clientId;
        el.dataset.askAiMounted = "1";
        el.dataset.askAiMode = wantMode;
        const base = import.meta.env.VITE_SUPABASE_URL;
        mod.mountAskAi(el, {
          endpoint: `${base}/functions/v1/ask-ai`,
          botEndpoint: `${base}/functions/v1/milon-bot`,
          variant: "studio",
          audience: "accountant",
          onOpenDeliverable: (handoff: CoachDestination & { why?: string }) =>
            openFromBotRef.current(handoff),
          onPersistedCreate: (payload: {
            question: string;
            created: {
              pdf?: boolean;
              items?: Array<{ title: string; outcomeWhy?: string }>;
              overview?: { facts?: string[] };
            };
          }) => persistedCreateRef.current(payload),
          note: hasFigures
            ? null
            : "Answers get more relevant once this client's figures are in — upload a statement, draft from bank statements, or type them into Financials.",
          getToken: async () => {
            const { data } = await supabase.auth.getSession();
            return data.session?.access_token ?? null;
          },
          getStarterMonthly: () => loadStarterMonthlyLabel(),
        });
      })
      .catch(() => {
        // Widget module unavailable — silent fail
      });
    return () => {
      cancelled = true;
    };
  }, [client, clientId, activeTab, hasFigures, search.agent]);

  // Autosave debounce ref
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped when an import writes. An autosave that started earlier must not land after it.
  const financialsWriteGen = useRef(0);

  // ── Load client ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadTimedOut(false);
    const backstopAt = Date.now() + SHELL_GATE_TIMEOUT_MS;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      if (cancelled) return;
      if (!shellBackstopDue(Date.now(), backstopAt)) {
        // A retry still running, or one that already failed, stays on the
        // recoverable "Couldn't load" screen. The backstop does not replace it.
        if (bootRetryInFlight() || bootCriticalRetryFailed()) return;
        timer = window.setTimeout(arm, Math.max(0, backstopAt - Date.now()));
        return;
      }
      setLoadTimedOut(true);
      setLoading(false);
    };
    arm();
    const unsubscribe = subscribeBootRetry(arm);
    (async () => {
      let gaveUp = false;
      try {
        // Defensive query: reports_issued_count may not exist yet.
        // A missing column is a different select, not a second try of this one.
        const first = await bootSelect(
          (signal) =>
            supabase
              .from("clients")
              .select(
                "id, name, business_type, client_code, operating_profile, cash_runway_weeks, last_forecast_at, financials, financials_updated_at, reports_issued_count, cashflow, market, firm_id, is_demo, budget",
              )
              .eq("id", clientId)
              .abortSignal(signal)
              .maybeSingle(),
          { critical: true },
        );
        if (!first.ok) {
          gaveUp = true;
          if (!cancelled) setLoadTimedOut(true);
          return;
        }
        const { data, error } = first.value;

        if (error) {
          const msg = error.message ?? "";
          const missingMarket = /market/i.test(msg) || error.code === "42703";
          if (
            missingMarket ||
            msg.includes("reports_issued_count") ||
            msg.includes("client_code")
          ) {
            const withoutMarket =
              "id, name, business_type, client_code, operating_profile, cash_runway_weeks, last_forecast_at, financials, financials_updated_at, reports_issued_count, cashflow, firm_id";
            const stripped =
              "id, name, business_type, operating_profile, cash_runway_weeks, last_forecast_at, financials, financials_updated_at, cashflow, firm_id";
            const retrySelect = /market/i.test(msg) ? withoutMarket : stripped;
            const { data: data2, error: error2 } = await supabase
              .from("clients")
              .select(retrySelect)
              .eq("id", clientId)
              .maybeSingle();
            if (error2 && retrySelect !== stripped) {
              const { data: data3, error: error3 } = await supabase
                .from("clients")
                .select(stripped)
                .eq("id", clientId)
                .maybeSingle();
              if (error3) {
                toast.error(error3.message);
              } else {
                setClient((data3 as Client | null) ?? null);
                const fin = (data3 as Client | null)?.financials ?? {};
                const {
                  scalars,
                  debtSchedule: ds,
                  weeklyInputs: weeks,
                  productMix: mix,
                } = splitFinancialsBlob(fin as Record<string, unknown>);
                const shownScalars = scalarsWithReadTimeEquity(scalars);
                setFinancials(shownScalars);
                setDebtSchedule(ds);
                setWeeklyInputs(weeks);
                setProductMix(mix);
                financialsRef.current = shownScalars;
                debtScheduleRef.current = ds;
                weeklyInputsRef.current = weeks;
                productMixRef.current = mix;
                decideLandingTab(scalars);
              }
            } else if (error2) {
              toast.error(error2.message);
            } else {
              setClient((data2 as Client | null) ?? null);
              const fin = (data2 as Client | null)?.financials ?? {};
              const {
                scalars,
                debtSchedule: ds,
                weeklyInputs: weeks,
                productMix: mix,
              } = splitFinancialsBlob(fin as Record<string, unknown>);
              const shownScalars = scalarsWithReadTimeEquity(scalars);
              setFinancials(shownScalars);
              setDebtSchedule(ds);
              setWeeklyInputs(weeks);
              setProductMix(mix);
              financialsRef.current = shownScalars;
              debtScheduleRef.current = ds;
              weeklyInputsRef.current = weeks;
              productMixRef.current = mix;
              decideLandingTab(scalars);
            }
          } else {
            toast.error(error.message);
          }
        } else {
          setClient((data as Client | null) ?? null);
          const fin = (data as Client | null)?.financials ?? {};
          const {
            scalars,
            debtSchedule: ds,
            weeklyInputs: weeks,
            productMix: mix,
          } = splitFinancialsBlob(fin as Record<string, unknown>);
          const shownScalars = scalarsWithReadTimeEquity(scalars);
          setFinancials(shownScalars);
          setDebtSchedule(ds);
          setWeeklyInputs(weeks);
          setProductMix(mix);
          financialsRef.current = shownScalars;
          debtScheduleRef.current = ds;
          weeklyInputsRef.current = weeks;
          productMixRef.current = mix;
          decideLandingTab(scalars);
        }
      } finally {
        window.clearTimeout(timer);
        unsubscribe();
        if (!cancelled) {
          setLoading(false);
          if (!gaveUp) setLoadTimedOut(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, clientLoadAttempt]);

  useEffect(() => {
    if (!client?.id) return;
    let cancelled = false;
    void loadClientDisplayNames(
      supabase as never,
      [{ id: client.id, name: client.name, financials: client.financials }],
      greetingSource,
    ).then((names) => {
      if (cancelled) return;
      const next = names.get(client.id);
      if (!next || next === client.name) return;
      setClient((current) => (current && current.id === client.id ? { ...current, name: next } : current));
    }).catch(() => {
      /* keep the stored name when the lookup cannot run */
    });
    return () => {
      cancelled = true;
    };
  }, [client?.id, client?.name, client?.financials, greetingSource]);

  // Load financial snapshots for variance / prior period
  useEffect(() => {
    if (!clientId) return;
    supabase
      .from("client_financial_snapshots")
      .select("id, period_label, period_date, financials, ratios, source, created_at")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(24)
      .then(({ data }) => {
        setSnapshots(
          (data ?? []).map((s) => ({
            id: s.id as string,
            period_label: s.period_label as string, // date-ok: snapshot row kept; display formats at read time
            period_date: s.period_date as string,
            financials: (s.financials as Record<string, unknown>) ?? null,
            ratios: (s.ratios as Record<string, number>) ?? null,
            source: (s.source as string | null) ?? null,
            created_at: (s.created_at as string | null) ?? null,
          })),
        );
      });
    supabase
      .from("client_score_history")
      .select("period_date, score")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(24)
      .then(({ data, error }) => {
        if (error) return;
        setScoreHistory(
          (data ?? []).map((row) => ({
            period_date: row.period_date,
            score: row.score,
          })),
        );
      });
  }, [clientId, client?.financials_updated_at]);

  useEffect(() => {
    if (!clientId) {
      setOpenQueriesCount(0);
      return;
    }
    let cancelled = false;
    countOpenQueriesForClient(clientId).then((n) => {
      if (!cancelled) setOpenQueriesCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, activeTab, queriesRefresh]);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    fetchReviewSignoffs({ data: { clientId } })
      .then(({ signoffs }) => {
        if (cancelled) return;
        setReviewSignoffs(indexReviewSignoffs(signoffs));
        setSignoffsKnown(true);
      })
      .catch(() => {
        if (!cancelled) setSignoffsKnown(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, activeTab, cashForecastReloadToken]);

  useEffect(() => {
    if (!clientId) {
      setCashSignedSnapshot(null);
      return;
    }
    let cancelled = false;
    void (supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, value: string) => {
            eq: (col: string, value: string) => {
              maybeSingle: () => Promise<{ data: { content_snapshot?: unknown } | null }>;
            };
          };
        };
      };
    })
      .from("client_deliverable_states")
      .select("content_snapshot")
      .eq("client_id", clientId)
      .eq("scope", "cash_forecast")
      .maybeSingle()
      .then((res) => {
        if (!cancelled) setCashSignedSnapshot(res.data?.content_snapshot ?? null);
      })
      .catch(() => {
        if (!cancelled) setCashSignedSnapshot(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, cashForecastReloadToken, cashForecastSignoff?.signed_off_at]);

  // ── Impersonation exit ────────────────────────────────────────────────────

  const exitImpersonation = useCallback(async () => {
    if (!user) return;
    const { data: rows } = await supabase
      .from("impersonation_audit")
      .select("id")
      .eq("firm_user_id", user.id)
      .eq("client_id", clientId)
      .is("ended_at", null)
      .order("started_at", { ascending: false })
      .limit(1);
    if (rows?.[0]) {
      await supabase
        .from("impersonation_audit")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", rows[0].id);
    }
    sessionStorage.removeItem("acting_as_client_id");
    sessionStorage.removeItem("acting_as_client_name");
    navigate({ to: "/dashboard" });
  }, [user, clientId, navigate]);

  // ── Autosave financial field ────────────────────────────────────────────

  const mergeCurrentBlob = useCallback(
    (
      scalars: Record<string, string> = financialsRef.current,
      ds: DebtSchedule = debtScheduleRef.current,
      weeks: WeeklyInputs = weeklyInputsRef.current,
      mix: ProductMix = productMixRef.current,
    ) => mergeFinancialsBlob(scalars, ds, weeks, mix),
    [],
  );

  const persistMergedFinancials = useCallback(
    async (updated: Record<string, unknown>) => {
      const gen = financialsWriteGen.current;
      const { data: row } = await supabase
        .from("clients")
        .select("financials")
        .eq("id", clientId)
        .maybeSingle();
      if (gen !== financialsWriteGen.current) return false;
      const seenRev = financialsWriteRev(row?.financials);
      const financials = autosaveKeepsLedgerSync(row?.financials ?? null, updated);
      const updatedAt = new Date().toISOString();
      if (gen !== financialsWriteGen.current) return false;
      const pending = guardFinancialsWrite(
        supabase
          .from("clients")
          .update({ financials: financials as never, financials_updated_at: updatedAt })
          .eq("id", clientId),
        seenRev,
      );
      const { data: saved, error } = await pending.select("id");
      if (gen !== financialsWriteGen.current) return false;
      if (error) {
        toast.error(`Autosave failed: ${error.message}`);
        setAutosaveStatus("idle");
        return false;
      }
      if (!saved?.length) {
        const { data: again } = await supabase
          .from("clients")
          .select("financials")
          .eq("id", clientId)
          .maybeSingle();
        if (financialsWriteSuperseded(seenRev, again?.financials)) {
          setAutosaveStatus("idle");
          return false;
        }
        toast.error("Autosave failed: the figures were not written.");
        setAutosaveStatus("idle");
        return false;
      }
      setClient((c) => (c ? { ...c, financials_updated_at: updatedAt } : c));
      void upsertCurrentPeriodSnapshot({
        clientId,
        financials,
        source: "autosave",
      });
      setAutosaveStatus("saved");
      setTimeout(() => setAutosaveStatus("idle"), 2000);
      return true;
    },
    [clientId],
  );

  const populateAfterSync = useCallback(
    (inputs: Record<string, string>, provider: "QuickBooks" | "Xero" | "Sage") => {
      void runSyncAutoPopulate({
        clientId,
        fields: inputs,
        chosen: autoPopulateState?.prefs ?? defaultAutoPopulatePrefs(),
        firstUpload: autoPopulateState?.firstUpload ?? true,
        firstActualsMonth: inputs.periodStart?.slice(0, 7) ?? null,
        fallbackMarket: client?.market ?? null,
        surface: "accountant_portal",
      })
        .then(applyAutoPopulateResult)
        .catch((e) => {
          console.warn(`auto-populate after ${provider} sync:`, e);
          toast.error(`Figures saved, but drafting deliverables failed: ${(e as Error).message}`);
        });
    },
    [applyAutoPopulateResult, autoPopulateState, client?.market, clientId],
  );

  const onQboSyncComplete = useCallback(
    (inputs: Record<string, string>) => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
      const nextScalars = { ...financialsRef.current, ...inputs };
      financialsRef.current = nextScalars;
      setFinancials(nextScalars);
      setClient((c) => (c ? { ...c, financials_updated_at: new Date().toISOString() } : c));
      setQboRefresh((n) => n + 1);
      setCashForecastReloadToken((n) => n + 1);
      populateAfterSync(inputs, "QuickBooks");
    },
    [populateAfterSync],
  );

  const onXeroSyncComplete = useCallback(
    (inputs: Record<string, string>) => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
      const nextScalars = { ...financialsRef.current, ...inputs };
      financialsRef.current = nextScalars;
      setFinancials(nextScalars);
      setClient((c) => (c ? { ...c, financials_updated_at: new Date().toISOString() } : c));
      setXeroRefresh((n) => n + 1);
      setCashForecastReloadToken((n) => n + 1);
      populateAfterSync(inputs, "Xero");
    },
    [populateAfterSync],
  );

  const onSageSyncComplete = useCallback(
    (inputs: Record<string, string>) => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
      const nextScalars = { ...financialsRef.current, ...inputs };
      financialsRef.current = nextScalars;
      setFinancials(nextScalars);
      setClient((c) => (c ? { ...c, financials_updated_at: new Date().toISOString() } : c));
      setSageRefresh((n) => n + 1);
      setCashForecastReloadToken((n) => n + 1);
      populateAfterSync(inputs, "Sage");
    },
    [populateAfterSync],
  );

  const handleFinancialChange = useCallback(
    (key: string, value: string) => {
      setFinancials((prev) => {
        const next = { ...prev, [key]: value };
        if (key === "equity") next[EQUITY_DERIVED_KEY] = "";
        financialsRef.current = next;
        return next;
      });
      setAutosaveStatus("saving");
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        void persistMergedFinancials(mergeCurrentBlob());
      }, 600);
    },
    [mergeCurrentBlob, persistMergedFinancials],
  );

  const handleDebtScheduleChange = useCallback(
    (next: DebtSchedule) => {
      debtScheduleRef.current = next;
      setDebtSchedule(next);
      setAutosaveStatus("saving");
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        void persistMergedFinancials(mergeCurrentBlob());
      }, 600);
    },
    [mergeCurrentBlob, persistMergedFinancials],
  );

  const updateWeek = useCallback(
    (weekKey: string, field: keyof WeeklyRow, value: number) => {
      setWeeklyInputs((prev) => {
        const next: WeeklyInputs = {
          weeks: {
            ...prev.weeks,
            [weekKey]: { ...(prev.weeks[weekKey] ?? DEFAULT_WEEKLY_ROW), [field]: value },
          },
        };
        weeklyInputsRef.current = next;
        return next;
      });
      setAutosaveStatus("saving");
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(() => {
        void persistMergedFinancials(mergeCurrentBlob());
      }, 600);
    },
    [mergeCurrentBlob, persistMergedFinancials],
  );

  const saveProductMix = useCallback(
    (mix: ProductMix) => {
      productMixRef.current = mix;
      setProductMix(mix);
      setAutosaveStatus("saving");
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      void persistMergedFinancials(mergeCurrentBlob());
    },
    [mergeCurrentBlob, persistMergedFinancials],
  );

  const financialInputsCtxValue = useMemo(
    () => ({ weeklyInputs, updateWeek, productMix, saveProductMix }),
    [weeklyInputs, updateWeek, productMix, saveProductMix],
  );

  // ── Save snapshot ────────────────────────────────────────────────────────

  const handleSaveSnapshot = useCallback(async () => {
    const now = new Date();
    const periodDate = now.toISOString().slice(0, 10);
    const periodLabel = formatMonthYear(now, clientMarket.timezone);
    const ratiosOut = overviewRatios(financials, {
      fyStartMonth,
      periodMonths: periodMonthsOf(financials),
    });

    const { data: existing } = await supabase
      .from("client_financial_snapshots")
      .select("id")
      .eq("client_id", clientId)
      .eq("period_label", periodLabel)
      .maybeSingle();

    let saveError: { message: string } | null = null;
    if (existing?.id) {
      const { error } = await supabase
        .from("client_financial_snapshots")
        .update({
          financials: mergeCurrentBlob() as never,
          ratios: ratiosOut as never,
        })
        .eq("id", existing.id);
      saveError = error;
    } else {
      const { error } = await supabase.from("client_financial_snapshots").insert({
        client_id: clientId,
        period_label: periodLabel,
        period_date: periodDate,
        financials: mergeCurrentBlob() as never,
        ratios: ratiosOut as never,
        source: "manual",
      });
      saveError = error;
    }

    if (saveError) {
      toast.error(`Failed to save snapshot: ${saveError.message}`);
    } else {
      // Reports read financial history from client_financial_snapshots (latest by
      // period_date), not directly from clients.financials — so this save changes
      // what a generated report shows and must bump financials_updated_at, or a
      // prior sign-off stays "current" against data that has since changed.
      const financialsUpdatedAt = new Date().toISOString();
      const blob = mergeCurrentBlob();
      const { error: touchError } = await supabase
        .from("clients")
        .update({ financials: blob as never, financials_updated_at: financialsUpdatedAt })
        .eq("id", clientId);
      if (touchError) {
        toast.error(`Snapshot saved, but failed to mark financials updated: ${touchError.message}`);
      } else {
        setClient((c) => (c ? { ...c, financials_updated_at: financialsUpdatedAt } : c));
      }
      toast.success(`Snapshot saved for ${periodLabel}`);
      await recordScoreHistory(clientId, overallHealth.overall);
    }
  }, [clientId, clientMarket.timezone, financials, debtSchedule, fyStartMonth, overallHealth.overall, mergeCurrentBlob]);

  // ── Upload confirm ────────────────────────────────────────────────────────

  const handleConfirmFinancials = useCallback(
    async (
      result: ExtractionResult,
      autoPopulate?: AutoPopulatePrefs,
      period?: {
        periodEnd: string;
        periodLabel: string;
        periodStart?: string | null;
        periodMonths?: number | null;
      },
      choice?: PeriodChoice | null,
    ) => {
      const currencyGate = statementCurrencyGate({
        storedMarket: client?.market ?? null,
        extraction: result,
      });
      const labelConfirm = result.currency_label_confirm ?? null;
      const currencyRefusal = currencyImportRefusal(currencyGate, labelConfirm);
      if (currencyRefusal) {
        return { ok: false as const, message: importFailureMessage(currencyRefusal) };
      }
      const withLabel = <T extends Record<string, unknown>>(blob: T) =>
        withCurrencyLabelConfirm(blob, labelConfirm);
      const extracted = extractionToRatioInputs(result);
      const keptEquity = preserveHandEnteredEquity(financialsRef.current, extracted);
      const drafted = {
        ...extracted,
        ...keptEquity,
      };
      const periodDate = period?.periodEnd?.trim() ?? "";
      const periodLabel = period?.periodLabel?.trim() ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodDate) || !periodLabel) {
        return { ok: false as const, message: importFailureMessage("Choose the statement period before importing.") };
      }

      const statementKind = statementKindFromExtraction(result);
      const healthBefore = liveHealthFromBooks({
        financials: financialsRef.current as Record<string, unknown>,
        cashflow: client?.cashflow,
        fyStartMonth,
        market: clientMarket,
        industry: healthIndustry,
        timeZone: clientMarket.timezone,
      });
      const planned = confirmUploadedStatement({
        existing: financialsRef.current,
        incoming: {
          ...drafted,
          [PERIOD_MONTHS_CHOSEN_KEY]: "",
        },
        kind: statementKind,
        periodStart: period?.periodStart,
        periodEnd: period?.periodEnd,
        periodMonths: period?.periodMonths,
        choice: choice ?? null,
        pillarsBefore: healthBefore.pillars,
        market: clientMarket,
        fyStartMonth,
        preClose:
          drafted.periodProfitInEquity != null &&
          String(drafted.periodProfitInEquity).trim() !== "" &&
          String(drafted.periodProfitInEquity) !== "0",
      });
      const fileSpan = planned.span;
      const inputs = planned.stamped;
      if (planned.action === "block") {
        return { ok: false as const, message: planned.message };
      }
      if (planned.action === "choose") {
        return {
          ok: false as const,
          message: planned.message,
          choice: { replaceLabel: planned.replaceLabel, addLabel: planned.addLabel },
        };
      }
      if (planned.action === "history" && planned.history) {
        const { data: rows } = await supabase
          .from("client_financial_snapshots")
          .select("id, financials")
          .eq("client_id", clientId)
          .order("period_date", { ascending: false })
          .limit(24);
        const match = snapshotCoveringSpan(rows, fileSpan);
        const ratiosOut = overviewRatios(planned.history, { fyStartMonth });
        const periodDate = fileSpan?.periodEnd ?? period?.periodEnd ?? "";
        const periodLabel = planned.periodLabel || period?.periodLabel || periodDate;
        const historyBody = withLabel(planned.history as Record<string, unknown>);
        const write = match?.id
          ? supabase
              .from("client_financial_snapshots")
              .update({
                financials: historyBody as never,
                ratios: ratiosOut as never,
                period_label: periodLabel,
                period_date: periodDate,
              })
              .eq("id", match.id)
          : supabase.from("client_financial_snapshots").insert({
              client_id: clientId,
              period_label: periodLabel,
              period_date: periodDate,
              financials: historyBody as never,
              ratios: ratiosOut as never,
              source: "pdf_upload",
            });
        const { error } = await write;
        if (error) {
          return { ok: false as const, message: importFailureMessage(error.message) };
        }
        return { ok: true as const, message: planned.message };
      }
      const { data: byDate } = await supabase
        .from("client_financial_snapshots")
        .select("id, financials")
        .eq("client_id", clientId)
        .eq("period_date", periodDate)
        .maybeSingle();
      let existing = byDate as { id?: string; financials?: unknown } | null;
      if (!existing?.id) {
        const { data: byLabel } = await supabase
          .from("client_financial_snapshots")
          .select("id, financials")
          .eq("client_id", clientId)
          .eq("period_label", periodLabel)
          .maybeSingle();
        existing = byLabel as { id?: string; financials?: unknown } | null;
      }

      const snapshotMerged = withLabel(
        mergeStatementFinancials(existing?.financials ?? null, inputs, statementKind) as Record<string, unknown>,
      );
      const ratiosOut = overviewRatios(snapshotMerged, { fyStartMonth });

      let saveError: { message: string } | null = null;
      if (existing?.id) {
        const { error } = await supabase
          .from("client_financial_snapshots")
          .update({ financials: snapshotMerged as never, ratios: ratiosOut as never })
          .eq("id", existing.id);
        saveError = error;
      } else {
        const { error } = await supabase.from("client_financial_snapshots").insert({
          client_id: clientId,
          period_label: periodLabel,
          period_date: periodDate,
          financials: snapshotMerged as never,
          ratios: ratiosOut as never,
          source: "pdf_upload",
        });
        saveError = error;
      }

      if (saveError) {
        return {
          ok: false as const,
          message: importFailureMessage(`Failed to save snapshot: ${saveError.message}`),
        };
      }

      if (historyOnlyUploadRef.current) {
        historyOnlyUploadRef.current = false;
        const { data } = await supabase
          .from("client_financial_snapshots")
          .select("id, period_label, period_date, financials, ratios, source, created_at")
          .eq("client_id", clientId)
          .order("period_date", { ascending: false })
          .limit(24);
        setSnapshots(
          (data ?? []).map((s) => ({
            id: s.id as string,
            period_label: s.period_label as string, // date-ok: snapshot row kept; display formats at read time
            period_date: s.period_date as string,
            financials: (s.financials as Record<string, unknown>) ?? null,
            ratios: (s.ratios as Record<string, number>) ?? null,
            source: (s.source as string | null) ?? null,
            created_at: (s.created_at as string | null) ?? null,
          })),
        );
        return { ok: true as const, message: importedUpdateMessage(`${periodLabel} history`) };
      }

      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
      financialsWriteGen.current += 1;
      const financialsUpdatedAt = new Date().toISOString();
      const liveMerged = planned.live ?? mergeStatementFinancials(financialsRef.current, inputs, statementKind);
      const nextScalars = Object.fromEntries(
        Object.entries(liveMerged).flatMap(([key, value]) =>
          value == null || typeof value === "object" ? [] : [[key, String(value)]],
        ),
      ) as Record<string, string>;
      if (labelConfirm) nextScalars[CURRENCY_LABEL_CONFIRM_KEY] = JSON.stringify(labelConfirm);
      const blob = withFinancialsWriteRev(withLabel(mergeCurrentBlob(nextScalars)));
      const { data: savedLive, error: liveError } = await supabase
        .from("clients")
        .update({ financials: blob as never, financials_updated_at: financialsUpdatedAt })
        .eq("id", clientId)
        .select("id");
      if (liveError || !savedLive?.length) {
        return {
          ok: false as const,
          message: importFailureMessage(
            liveError?.message ?? "The figures were not written to this client.",
          ),
        };
      }
      financialsRef.current = nextScalars;

      await recordScoreHistory(
        clientId,
        liveHealthFromBooks({
          financials: blob as Record<string, unknown>,
          cashflow: client?.cashflow,
          financialsUpdatedAt,
          priorFinancials: priorSnapshot?.financials ?? null,
          fyStartMonth,
          market: clientMarket,
          industry: healthIndustry,
          timeZone: clientMarket.timezone,
        }).overall,
      );

      // Update local state with new financials. The panel stays open until it
      // shows this message, then the caller closes it.
      setFinancials(nextScalars);
      setClient((c) => (c ? { ...c, financials_updated_at: financialsUpdatedAt } : c));
      track("financials_uploaded", {
        surface: "accountant_portal",
        clientId,
        firmId,
      });

      if (autoPopulate) {
        try {
          const r = await runAutoPopulate({
            clientId,
            fields: nextScalars,
            chosen: autoPopulate,
            prefsToRemember: prefsToRemember(
              autoPopulate,
              statementKind,
              autoPopulateState?.prefs ?? defaultAutoPopulatePrefs(),
            ),
            firstUpload: autoPopulateState?.firstUpload,
            statementKind,
            cashOpeningDate: statementKind === "balance_sheet" ? periodDate : null,
            firstActualsMonth: periodDate.slice(0, 7),
            fallbackMarket: client?.market ?? null,
            surface: "accountant_portal",
            source: "financial_statement",
          });
          applyAutoPopulateResult(r);
        } catch (e) {
          console.warn("auto-populate after statement upload:", e);
          toast.error(`Figures saved, but drafting deliverables failed: ${(e as Error).message}`);
        }
      }
      return { ok: true as const, message: planned.message || importedUpdateMessage(statementImportWhat(statementKind)) };
    },
    [
      clientId,
      fyStartMonth,
      effectiveRunway,
      clientMarket,
      cashOutlook.shortfallWeek,
      mergeCurrentBlob,
      firmId,
      track,
      autoPopulateState?.firstUpload,
      autoPopulateState?.prefs,
      client?.market,
      applyAutoPopulateResult,
    ],
  );

  // ── Deliverables bar actions ──────────────────────────────────────────────

  const writeAccountantTab = useCallback(
    (tab: ActiveTab, filter?: string, section?: string) => {
      setActiveTab(tab);
      void navigate({
        to: "/clients/$clientId",
        params: { clientId },
        search: (prev) => {
          const next = accountantClientTabSearch(prev, tab, section ? { section } : undefined);
          if (filter) (next as { filter?: string }).filter = filter;
          return next;
        },
      });
    },
    [clientId, navigate],
  );

  const revealTab = useCallback(
    (tab: ActiveTab, paneId?: string, filter?: string) => {
      writeAccountantTab(tab, filter);
      const id = paneId ?? `pane-${tab}`;
      window.setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    },
    [writeAccountantTab],
  );

  const openOverviewCard = useCallback(
    (section: string) => {
      const pane = resolveAccountantTab({ tab: "overview", section });
      if (pane) setActiveTab(pane);
      void navigate({
        to: "/clients/$clientId",
        params: { clientId },
        search: (prev) => accountantClientTabSearch(prev, "overview", { section }),
      });
    },
    [clientId, navigate],
  );

  const openCoach = useCallback(
    (dest: CoachDestination) => {
      if (dest.assign) {
        setActiveTab("plan");
        void navigate({
          to: "/clients/$clientId",
          params: { clientId },
          search: (prev) => accountantClientTabSearch(prev, "plan", { section: "open" }),
        });
        window.setTimeout(() => {
          document.getElementById("action-plan-work")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, 120);
        return;
      }
      const canonical = canonicalizeAccountantSearch({
        tab: dest.tab,
        section: dest.section,
        focus: dest.focus,
      });
      const tab = resolveAccountantTab(canonical);
      if (!tab) return;
      setActiveTab(tab);
      navigate({
        to: "/clients/$clientId",
        params: { clientId },
        search: (prev) => {
          const next = accountantClientTabSearch(prev, canonical.tab, {
            section: canonical.section,
          });
          if (dest.coach) next.coach = dest.coach;
          else delete next.coach;
          if (dest.why) next.why = dest.why;
          else delete next.why;
          if (canonical.focus) next.focus = canonical.focus;
          return next;
        },
      });
      const targetId =
        canonical.section === "pillars" || canonical.focus === "pillars"
          ? "coach-pillars"
          : canonical.section === "collections"
            ? "pane-collections"
            : canonical.section === "payables"
              ? "pane-payables"
              : tab === "summary"
                ? "data-up-to-date"
                : `pane-${tab}`;
      window.setTimeout(() => {
        document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    },
    [clientId, navigate, writeAccountantTab],
  );
  openFromBotRef.current = openCoach;

  const handleGenerateReport = useCallback(() => {
    revealTab("reports");
  }, [revealTab]);

  const overviewScorecardPeriodLabel = useCallback(() => {
    return (
      reportDataPeriodLabel(financials, clientMarket) ??
      formatMonthYear(new Date(), clientMarket.timezone)
    );
  }, [financials, clientMarket.timezone]);

  /** Fresh scorecard. Never the archived blob from an earlier sign-off. */
  const renderOverviewScorecard = useCallback(async (): Promise<Blob | null> => {
    if (!client) return null;
    const { HealthScorecardPDF } = await import("@/reports/health-scorecard");
    const { pdf } = await import("@react-pdf/renderer");
    const periodLabel = overviewScorecardPeriodLabel();
    const ratioResults = buildScorecardRatioResults(
      scorecardRatiosFromFinancials(financials, { fyStartMonth }),
      clientMarket,
      {
        equity: equityAmount,
        periodMonths: periodMonthsOf(financials),
        partMonth,
        cashFlowKnown: cashFlowKnown(financials),
        industry: healthIndustry,
      },
    );
    const clientFirmName =
      firmId && client.firm_id && firmId === client.firm_id ? profile.firmName : null;
    const financialsStamp = stampFromSignoff(
      financialsSignoff,
      pageSignoffStale(financialsSignoff, client.financials_updated_at ?? null),
      { clientFirmName },
    );
    return pdf(
      HealthScorecardPDF({
        smeData: { name: client.name, period: periodLabel },
        ratioResults: ratioResults as RatioResult[],
        accountantProfile: profile,
        cashRunwayWeeks: effectiveRunway,
        overallHealth,
        operatingProfile: parseOperatingProfile(client.operating_profile),
        reviewSignoff: financialsStamp,
        sample: Boolean(client.is_demo),
        market: gateMarket,
      }) as Parameters<typeof pdf>[0],
    ).toBlob();
  }, [
    client,
    financials,
    fyStartMonth,
    gateMarket,
    equityAmount,
    periodMonths,
    partMonth,
    financialsSignoff,
    snapshots,
    scoreHistory,
    profile,
    firmId,
    effectiveRunway,
    overallHealth,
    healthIndustry,
    overviewScorecardPeriodLabel,
  ]);

  const handleExportPDF = useCallback(async () => {
    if (!client) return;
    try {
      const periodLabel = overviewScorecardPeriodLabel();
      const blob = await renderOverviewScorecard();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const periodSlug = periodLabel.replace(/[–—]/g, "-").replace(/[^a-zA-Z0-9]+/g, "_");
      a.download = `${client.name.replace(/\s+/g, "_")}_${periodSlug}_Health_Scorecard.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Scorecard PDF downloaded");
      await recordReportIssued(client.id);
      setClient((c) => (c ? { ...c, reports_issued_count: (c.reports_issued_count ?? 0) + 1 } : c));
      if (user) {
        const snapId = await latestSnapshotId(client.id);
        const logged = await recordDelivery({
          clientId: client.id,
          firmId,
          channel: "pdf_download",
          kind: "report_pdf",
          reportKey: "scorecard",
          snapshotId: snapId,
          figuresHash: hashFigures({ financials, ratios, debtSchedule }),
          periodLabel: periodLabel,
          createdBy: user.id,
          pdfBlob: blob,
        });
        warnIfDeliveryFailed(logged.error);
        warnIfPdfArchiveFailed(logged.pdfError);
        setDeliveryRefresh((n) => n + 1);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed");
    }
  }, [
    client,
    ratios,
    user,
    financials,
    debtSchedule,
    firmId,
    overviewScorecardPeriodLabel,
    renderOverviewScorecard,
  ]);

  const handleEmailDraft = useCallback(async () => {
    if (!client) return;
    const score = healthScoreRounded;
    const tierLabel = bookStatusWord;
    const runway = cashRunwayHeadline ?? runwayDisplayLabel(metricRunway) ?? "—";
    const weak =
      overallHealth.weakestPillar != null
        ? `\nWeakest pillar: ${overallHealth.weakestPillar.label} (${overallHealth.weakestPillar.score})\n`
        : "\n";
    const subjectText = `${client.name} — Financial Health Update`;
    const bodyText =
      `Hi,\n\nHere is a brief financial health summary for ${client.name}.\n\n` +
      `Overall Health Score: ${score} (${tierLabel})\n` +
      `Cash Runway: ${runway}` +
      weak +
      `Open Queries: ${openQueriesCount}\n\n` +
      `Please review the attached report for detailed ratio analysis and recommended actions.\n\n` +
      `Best regards,\n${profile.accountantName || "Your Accountant"}\n${profile.firmName || ""}`;
    let shareBody = bodyText;
    if (user) {
      const snapId = await latestSnapshotId(client.id);
      const logged = await recordDelivery({
        clientId: client.id,
        firmId,
        channel: "mailto",
        kind: "health_summary",
        subject: subjectText,
        body: bodyText,
        snapshotId: snapId,
        figuresHash: hashFigures({ financials, ratios, score }),
        periodLabel: formatMonthYear(new Date(), clientMarket.timezone),
        createdBy: user.id,
      });
      warnIfDeliveryFailed(logged.error);
      shareBody = logged.body ?? bodyText;
      setDeliveryRefresh((n) => n + 1);
    }
    window.open(
      `mailto:?subject=${encodeURIComponent(subjectText)}&body=${encodeURIComponent(shareBody)}`,
    );
  }, [
    client,
    healthScoreRounded,
    overallHealth,
    profile,
    effectiveRunway,
    metricRunway.label,
    cashRunwayHeadline,
    bookStatusWord,
    openQueriesCount,
    user,
    financials,
    ratios,
    firmId,
    clientMarket.timezone,
  ]);

  const handleWhatsApp = useCallback(async () => {
    if (!client) return;
    const score = healthScoreRounded;
    const tierLabel = bookStatusWord;
    const text =
      `${client.name} Financial Health Update\n` +
      `Health Score: ${score} (${tierLabel})\n` +
      `Cash Runway: ${cashRunwayHeadline ?? runwayDisplayLabel(metricRunway) ?? "—"}\n` +
      `Open Queries: ${openQueriesCount}\n` +
      `Prepared by ${profile.firmName || "your accountant"} via MILŌN Portal.`;
    let shareText = text;
    if (user) {
      const snapId = await latestSnapshotId(client.id);
      const logged = await recordDelivery({
        clientId: client.id,
        firmId,
        channel: "whatsapp",
        kind: "health_summary",
        body: text,
        snapshotId: snapId,
        figuresHash: hashFigures({ financials, ratios, score }),
        periodLabel: formatMonthYear(new Date(), clientMarket.timezone),
        createdBy: user.id,
      });
      warnIfDeliveryFailed(logged.error);
      shareText = logged.body ?? text;
      setDeliveryRefresh((n) => n + 1);
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank");
  }, [
    client,
    healthScoreRounded,
    overallHealth,
    profile,
    effectiveRunway,
    metricRunway.label,
    cashRunwayHeadline,
    bookStatusWord,
    openQueriesCount,
    user,
    financials,
    ratios,
    firmId,
    clientMarket.timezone,
  ]);

  // ── Playbook drawer ───────────────────────────────────────────────────────

  const openDrawer = useCallback(
    (ratioName: string, score: number) => {
      const tier = ratioScoreBand(score).tier;
      const key = playbookKeyForRatioName(ratioName);
      const actual = ratioActualLine(ratioName, ratioInputs, (n) =>
        formatMoneyCompact(n, gateMarket),
      );
      setDrawerRatioKey(key);
      setDrawerRatioName(ratioName);
      setDrawerTier(tier);
      setDrawerFormula(actual.formula);
      setDrawerActual(
        actual.calculation ?? (actual.missing.length ? `Need: ${actual.missing.join(", ")}` : null),
      );
      setDrawerFallbackSteps(actual.steps);
      const rawValue = (ratios as Record<string, number>)[ratioName];
      setDrawerRatioValue(typeof rawValue === "number" && Number.isFinite(rawValue) ? rawValue : null);
      const revenue = Number(ratioInputs.revenue);
      const netProfit = Number(ratioInputs.netIncome);
      setDrawerRevenue(Number.isFinite(revenue) ? revenue : null);
      setDrawerNetProfit(Number.isFinite(netProfit) ? netProfit : null);
      setDrawerOpen(true);
      track("playbook_opened", {
        surface: "accountant_portal",
        clientId,
        firmId,
        ratioName,
      });
    },
    [clientId, gateMarket, firmId, ratioInputs, ratios, track],
  );

  const openDrawerFromUiKey = useCallback(
    (uiKey: string) => {
      const name = ratioQueryLabel(uiKey);
      const mapped = healthMap[uiKey];
      const val = (ratios as Record<string, number>)[name];
      const fromCard = typeof mapped === "number" && Number.isFinite(mapped) ? mapped : Number.NaN;
      const rescored = Math.round(ratioHealthScore(name, val as number, clientMarket));
      const score = Number.isFinite(fromCard) ? fromCard : rescored;
      openDrawer(name, Number.isFinite(score) ? score : 0);
    },
    [openDrawer, ratios, clientMarket, healthMap],
  );

  useEffect(() => {
    if (!focusNoteId) return;
    const note = clientNotes.find((n) => n.id === focusNoteId);
    if (!note?.ratioKey) return;
    setActiveTab("ratios");
    openDrawerFromUiKey(note.ratioKey);
  }, [focusNoteId, clientNotes, openDrawerFromUiKey]);

  // ── Report navigation ─────────────────────────────────────────────────────

  const handleTourTabChange = useCallback(
    (tab: string) => {
      const next = resolveAccountantTab(tab);
      if (next) writeAccountantTab(next);
    },
    [writeAccountantTab],
  );

  // ── Next Step (P0.4) — the card resolves; the studio performs the CTA ─────
  const handleNextStepAct = useCallback(
    (step: NextStep, target?: NextStepTarget) => {
      const key = target ?? step.key;
      switch (key) {
        case "profile":
          setProfileOpen(true);
          return;
        case "upload":
        case "restart":
          // Same two doors the first-figures card offers.
          if (hasFigures) setUploadOpen(true);
          else setFirstDataOpen(true);
          return;
        case "data_request":
          // The missing-documents panel is already on Overview, in the first
          // viewport. Changing ?tab= or scrolling the pane is invisible.
          requestRevealDataRequests();
          return;
        default: {
          const route = nextStepRoute(key, "accountant", clientId);
          const canonical = canonicalizeAccountantSearch({
            tab: route.tab ?? undefined,
            section: route.search.section,
          });
          const tab = resolveAccountantTab(canonical) ?? "overview";
          setActiveTab(tab);
          void navigate({
            to: "/clients/$clientId",
            params: { clientId },
            search: (prev) => {
              const next = accountantClientTabSearch(
                prev,
                route.tab ?? tab,
                route.search.section ? { section: route.search.section } : undefined,
              );
              if (route.search.filter) (next as { filter?: string }).filter = route.search.filter;
              return next;
            },
          });
          const scrollId =
            canonical.tab === "reports" && canonical.section === "drafts"
              ? "reports-drafts"
              : canonical.tab === "reports" && canonical.section === "sent"
                ? "reports-sent"
                : `pane-${tab}`;
          window.setTimeout(() => {
            document.getElementById(scrollId)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 80);
        }
      }
    },
    [clientId, hasFigures, navigate],
  );

  const awaitingRun = assignmentRows.filter((row) => row.open).map((row) => ({ openedAt: row.openedAt }));
  const homeActivity = useAgentActivity(clientId, awaitingRun);
  const settledRows = useMemo(
    () =>
      applyLiveRuns(
        assignmentRows,
        homeActivity.runs.map((run) => ({
          id: run.id,
          actionItemId: run.action_item_id,
          agent: run.agent,
          status: run.status,
          at: run.finished_at || run.queued_at,
        })),
      ),
    [assignmentRows, homeActivity.runs],
  );
  const workingRows = useMemo(
    () => settledRows.map((row) => (handoffRowStillWorking(row, homeActivity.runs) ? row : { ...row, open: false })),
    [settledRows, homeActivity.runs],
  );
  const openAgents = useMemo(() => openHandoffAgents(workingRows), [workingRows]);
  const homeCardRuns = useMemo(
    () =>
      withCardHandoffRuns(
        withoutPersonQueuedRuns(homeActivity.runs, personOwnedActionIds(settledRows)),
        workingRows,
      ),
    [homeActivity.runs, settledRows, workingRows],
  );
  const figuresUpdatedAt = useMemo(
    () => latestFiguresStamp(snapshots.map((row) => ({ at: row.created_at, source: row.source }))),
    [snapshots],
  );
  const homePresence = useMemo(
    () =>
      steerOpenHandoffs(
        ownerPresence({ ...homeActivity, runs: homeCardRuns }, null, liveScoreSnapshot, figuresUpdatedAt, client?.id ?? null),
        openAgents,
      ),
    [homeActivity, homeCardRuns, openAgents, overallHealth, figuresUpdatedAt, client?.id],
  );
  const shownHandoffs = useMemo(
    () =>
      openPlanHandoffs.map((row) => {
        let live: { id: string; agent: AgentKey; status: string; at: string } | null = null;
        for (const run of homeActivity.runs) {
          if (run.action_item_id !== row.id) continue;
          if (row.runId && run.id !== row.runId) continue;
          const at = run.finished_at || run.queued_at;
          if (!live || at > live.at) live = { id: run.id, agent: run.agent, status: run.status, at };
        }
        const settled = settledRows.find((item) => item.id === row.id);
        const missed = Boolean(!row.error && settled?.open && !handoffRowStillWorking(settled, homeActivity.runs));
        const finding = findingForAction({
          actionItemId: row.id,
          runs: homeActivity.runs,
          findings: homeActivity.findings,
        });
        const draft = {
          draftId: finding?.id ?? null,
          findingsReady: !homeActivity.loading,
        };
        if (!live || !row.agent || live.agent !== row.agent) return { ...row, missed, ...draft };
        const current = row.run;
        const currentOpen = current?.status === "queued" || current?.status === "running";
        if (currentOpen && live.at < (current.at ?? "") && live.status !== "queued" && live.status !== "running") {
          return { ...row, missed, ...draft };
        }
        return { ...row, run: live, runId: row.runId ?? live.id, missed: false, ...draft };
      }),
    [openPlanHandoffs, homeActivity.runs, homeActivity.findings, homeActivity.loading, settledRows],
  );
  const notedFinish = useRef(new Set<string>());
  useEffect(() => {
    let due = false;
    for (const row of assignmentRows) {
      if (!row.open || !row.agent) continue;
      const run = homeActivity.runs.find(
        (item) =>
          item.action_item_id === row.id &&
          item.agent === row.agent &&
          (!row.runId || item.id === row.runId) &&
          (item.status === "succeeded" || item.status === "partial"),
      );
      if (!run) continue;
      const key = `${row.id}:${run.id}`;
      if (notedFinish.current.has(key)) continue;
      notedFinish.current.add(key);
      due = true;
    }
    if (!due) return;
    const timer = window.setTimeout(() => setOpenPlanTick((n) => n + 1), 400);
    return () => window.clearTimeout(timer);
  }, [assignmentRows, homeActivity.runs]);
  const homeAgent: AgentKey | null =
    search.agent === "financial_manager" || search.agent === "analyst" || search.agent === "advisor"
      ? search.agent
      : null;
  const showHomeThread = activeTab === "overview" && homeAgent != null;
  const pageBack = clientBackTarget({
    tab: activeTab,
    section: search.section ?? null,
    agent: homeAgent,
  });
  const openHomeAgent = useCallback(
    (agent: AgentKey) => {
      setActiveTab("overview");
      void navigate({
        to: "/clients/$clientId",
        params: { clientId },
        search: (prev) => searchWithAskAgent(prev, agent),
      });
    },
    [clientId, navigate],
  );
  const openHomeSection = useCallback(
    (tab: string, section?: string) => {
      const pane = resolveAccountantTab({ tab, section }) ?? "overview";
      setActiveTab(pane);
      void navigate({
        to: "/clients/$clientId",
        params: { clientId },
        search: (prev) => accountantClientTabSearch(prev, tab, section ? { section } : undefined),
      });
    },
    [clientId, navigate],
  );
  const openDraft = useCallback(
    (draftId?: string | null) => {
      setActiveTab("reports");
      void navigate({
        to: "/clients/$clientId",
        params: { clientId },
        search: (prev) => {
          const next = accountantClientTabSearch(prev, "reports", { section: "drafts" }) as Record<string, unknown>;
          if (draftId) next.draft = draftId;
          else delete next.draft;
          return next;
        },
      });
    },
    [clientId, navigate],
  );
  const openReportPage = useCallback(
    (report: string, action?: "preview" | "download") => {
      const section =
        report === "scorecard" || report === "forecast" || report === "waterfall" ? report : "all";
      setActiveTab("reports");
      void navigate({
        to: "/clients/$clientId",
        params: { clientId },
        search: (prev) => {
          const next = accountantClientTabSearch(prev, "reports", { section }) as Record<string, unknown>;
          next.report = report;
          if (action) next.action = action;
          return next;
        },
      });
    },
    [clientId, navigate],
  );
  const homeBooks = useMemo<OwnerBooks>(() => {
    const priorFin =
      priorSnapshot?.financials && typeof priorSnapshot.financials === "object"
        ? (priorSnapshot.financials as Record<string, unknown>)
        : null;
    const amount = (value: unknown): number | null => {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value !== "string" || !value.trim()) return null;
      const parsed = Number(value.replace(/,/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      hasBooks: hasFigures || Boolean(qboLink || xeroLink),
      ledger: qboLink ? "QuickBooks" : xeroLink ? "Xero" : null,
      revenue: amount(financials.revenue),
      priorRevenue: amount(priorFin?.revenue),
      cogs: amount(financials.cogs),
      priorCogs: amount(priorFin?.cogs),
      grossProfit: amount(financials.grossProfit),
      priorGrossProfit: amount(priorFin?.grossProfit),
      netIncome: amount(financials.netIncome),
      operatingProfit: clientProfitBridge.ebit,
      openingMissing,
      receivables: statementPosition.receivables ?? null,
      cashflow: (client?.cashflow as SavedCashflowLike | null) ?? null,
      hasEvidence: evidenced,
      cashOnFile,
      cashOutlook:
        evidenced && cashOnFile
          ? {
              opening: cashOutlook.opening,
              closing: cashOutlook.closing,
              floor: cashOutlook.floor,
              dipsBelowFloorWeek: cashOutlook.dipsBelowFloorWeek,
            }
          : null,
      cashPillarStatus: evidenced && cashOnFile ? (pillarStatus.cash ?? null) : null,
      cashRunwayWeeks: evidenced ? effectiveRunway : null,
      cashDebtorScore: evidenced && Number.isFinite(healthMap.debtorDays) ? healthMap.debtorDays : null,
      cashBurnScore: evidenced && Number.isFinite(healthMap.ocfToEbitda) ? healthMap.ocfToEbitda : null,
      openAction: openPlanUnavailable
        ? "Open actions aren't available yet."
        : openPlanTitles == null
          ? null
          : openActionSentence(openPlanTitles),
      actionsReady: openPlanUnavailable || openPlanTitles != null,
      signedBy: null,
      signedOn: null,
      market: gateMarket,
      balanceSheetNote: earlierStatementNote(financials, gateMarket),
    };
  }, [
    priorSnapshot,
    hasFigures,
    qboLink,
    xeroLink,
    financials,
    statementPosition.receivables,
    client?.cashflow,
    cashOutlook.opening,
    cashOutlook.closing,
    cashOutlook.floor,
    cashOutlook.dipsBelowFloorWeek,
    openPlanTitles,
    openPlanUnavailable,
    gateMarket,
    openingMissing,
    cashOnFile,
    clientProfitBridge.ebit,
    pillarStatus.cash,
    evidenced,
    effectiveRunway,
    healthMap.debtorDays,
    healthMap.ocfToEbitda,
  ]);
  const homeLines = useMemo(
    () => ownerHomeLines(ownerAnswerTiles(homeBooks), strategicMoves[0]?.title ?? null, openActionAgent, handedTitle),
    [homeBooks, strategicMoves, openActionAgent, handedTitle],
  );
  const homeStatus = useMemo(() => ownerCardStatuses(homeBooks), [homeBooks]);
  // Declared before the memo. A const after the loading return is still in
  // the temporal dead zone here, and the minified chunk throws
  // "Cannot access '…' before initialization" on every /clients/:id render.
  const reportsIssued = client?.reports_issued_count ?? 0;
  const reportsReady = clientReportsReadyCount(financials);
  const reportsLine = reportsHomeReadyLine(reportsReady);
  const canonicalRatios = useMemo(
    () => numberRatioRecord(scorecardRatiosFromFinancials(financials, { fyStartMonth })),
    [financials, fyStartMonth],
  );
  const homeNeeds = useMemo(() => {
    const planNeeds = homeActionNeeds({
      known: openPlanTitles != null,
      unavailable: openPlanUnavailable,
      titles: openPlanTitles ?? [],
      overdue: openPlanOverdue,
    });
    const actionsHeading = planNeeds.heading;
    const actionLines = planNeeds.lines;
    const drafts = homeActivity.findings.filter(
      (row) => row.status !== "approved" && isVisibleAgentFinding(row) && draftFindingLabel(row) != null,
    );
    const waiting = drafts.filter((row) => draftFindingLabel(row) === DRAFT_NEEDS_ACCOUNTANT);
    const shownDraft = waiting[0] ?? drafts[0] ?? null;
    const draftsHeading = "Drafts";
    const liveDraft = {
      overall: liveScoreSnapshot?.overall ?? overallHealth.overall,
      storedHash: shownDraft ? draftStoredFiguresHash(shownDraft.evidence) : null,
      health: liveScoreSnapshot,
      storedHealth: shownDraft ? draftStoredHealth(shownDraft.evidence) : null,
      writtenAt: shownDraft?.created_at ?? null,
      figuresUpdatedAt,
    };
    const titlePresented = shownDraft
      ? presentHomeDraftTitle(shownDraft.title, canonicalRatios, liveDraft)
      : null;
    const bodyPresented = shownDraft?.detail?.trim()
      ? presentHomeDraftBody(shownDraft.detail, canonicalRatios, liveDraft)
      : null;
    const presented = titlePresented?.text ? titlePresented : bodyPresented;
    const draftLines = homeActivity.loading
      ? ["Checking drafts."]
      : homeActivity.error
        ? ["Drafts aren't available yet."]
        : presented?.text
          ? [presented.text]
          : ["No draft waiting."];
    const draftStale = presented ? [presented.stale || presented.refresh || Boolean(bodyPresented?.refresh)] : undefined;
    const booksLine =
      homeStatementsLine(booksSpanLabel) ?? booksAnswerSentence({ freshness: dataFreshness });
    return {
      actionsHeading,
      actionLines,
      draftsHeading,
      draftLines,
      draftId: shownDraft?.id ?? null,
      draftStale,
      draftLiveSentence: liveScoreSnapshot ? renderHealthNarrative(liveScoreSnapshot) : null,
      deliverablesHeading: "Reports",
      deliverableLines: reportsLine ? [reportsLine] : [],
      syncHeading: "Books",
      syncLines: [booksLine],
    };
  }, [
    openPlanTitles,
    openPlanOverdue,
    openPlanUnavailable,
    homeActivity,
    canonicalRatios,
    overallHealth.overall,
    liveScoreSnapshot,
    dataFreshness,
    reportsLine,
    booksSpanLabel,
    figuresUpdatedAt,
  ]);
  const homeBrief = useMemo(
    () =>
      buildFinancialManagerBrief({
        clientName: client?.name ?? "",
        currentFinancials: financials,
        currentPeriodEnd: statementMeta.periodEnd,
        snapshots: snapshots.map((row) => {
          const meta = readStatementMeta(row.financials, clientMarket);
          return {
            periodDate: row.period_date,
            periodLabel: statementSpanLabel({
              periodStart: meta.periodStart,
              periodEnd: meta.periodEnd,
              periodLabel: row.period_label,
              market: clientMarket,
            }),
            financials: row.financials,
          };
        }),
        openActionTitles: openPlanTitles ?? [],
        overdueActions: openPlanOverdue,
        cashflow: (client?.cashflow as SavedCashflowLike | null) ?? null,
        cashDipWeek: forecastLines ? cashOutlook.dipsBelowFloorWeek : null,
        cashOpening: evidenced && cashOnFile ? cashOutlook.opening : null,
        // Passed through for a forecast with no lines. A stored series replaces this
        // with forecastMinimumCash, the same floor as Cash.
        cashFloor: evidenced && cashOnFile ? cashOutlook.floor : null,
        cashClosing: evidenced && cashOnFile ? cashOutlook.closing : null,
        market: gateMarket,
        openingMissing,
        cashOnFile,
        cashPillarStatus: evidenced && cashOnFile ? (pillarStatus.cash ?? null) : null,
        cashStrainLine: spokenCashStrain(homeBooks),
        balanceSheetNote: earlierStatementNote(financials, gateMarket),
        receivables: statementPosition.receivables ?? null,
        drafts: homeActivity.findings.flatMap((row) => {
          if (row.status === "approved" || !isVisibleAgentFinding(row)) return [];
          if (draftFindingLabel(row) !== DRAFT_NEEDS_ACCOUNTANT) return [];
          const title = row.title?.trim() ?? "";
          if (!title) return [];
          return [{
            id: row.id,
            title,
            detail: row.detail,
            figuresHash: draftStoredFiguresHash(row.evidence),
            storedHealth: draftStoredHealth(row.evidence),
            storedScoreHash: readStoredScoreSnapshotHash(row.evidence),
            evidence: row.evidence,
            createdAt: row.created_at,
          }];
        }),
        figuresUpdatedAt,
        canonicalRatios,
        healthOverall: overallHealth.overall,
        healthSnapshot: liveScoreSnapshot,
        draftsReady: !homeActivity.loading && !homeActivity.error,
        actionsReady: openPlanTitles != null && !openPlanUnavailable,
        formatMoney: (amount) => formatMoney(amount, gateMarket),
      }),
    [
      client?.name,
      financials,
      statementMeta.periodEnd,
      snapshots,
      openPlanTitles,
      openPlanOverdue,
      openPlanUnavailable,
      client?.cashflow,
      cashOutlook.dipsBelowFloorWeek,
      hasFigures,
      evidenced,
      forecastLines,
      cashOutlook.opening,
      cashOutlook.closing,
      cashOutlook.floor,
      openingMissing,
      cashOnFile,
      pillarStatus.cash,
      homeBooks,
      statementPosition.receivables,
      homeActivity,
      figuresUpdatedAt,
      canonicalRatios,
      overallHealth.overall,
      gateMarket,
    ],
  );
  const financialsHomeLine = financialsHomeSignoffLine(
    financialsSignoff
      ? [
          {
            scope: "financials",
            signed_off_by_name: financialsSignoff.signed_off_by_name,
            signed_off_at: financialsSignoff.signed_off_at,
            firm_name: financialsSignoff.firm_name,
          },
        ]
      : [],
    clientMarket,
  );
  const advisoryHomeKind = signoffStatusKind({
    hasSignoff: Boolean(advisorySignoff),
    isStale: pageSignoffStale(advisorySignoff, client?.financials_updated_at ?? null),
    readyForReview: false,
  });
  const advisoryHomeLine = signoffStatusLine({
    kind: advisoryHomeKind,
    name: advisorySignoff?.signed_off_by_name,
    date: advisorySignoff ? formatDate(advisorySignoff.signed_off_at, clientMarket) : null,
    scopeLabel: "Advisory",
  });
  const homeSignoffLine =
    financialsHomeLine && advisoryHomeKind !== "signed" && advisoryHomeKind !== "stale"
      ? financialsHomeLine
      : financialsHomeLine
        ? `${financialsHomeLine} ${advisoryHomeLine}`
        : advisoryHomeLine;

  // ── Loading / error states ────────────────────────────────────────────────

  const homePhase = clientHomePhase({
    loading,
    timedOut: loadTimedOut,
    hasClient: Boolean(client),
  });
  if (homePhase === "loading" || homePhase === "error") {
    return (
      <ClientAgentStandby
        timedOut={homePhase === "error"}
        onRetry={
          homePhase === "error"
            ? () => {
                setLoadTimedOut(false);
                setLoading(true);
                setClientLoadAttempt((n) => n + 1);
              }
            : undefined
        }
      />
    );
  }

  if (!client) {
    return (
      <div className="accountant-portal premium-shell">
        <EmptyState
          className="min-h-screen"
          title="Client not found or you don't have access."
          action={
            <BackLink variant="portal" onClick={() => navigate({ to: "/dashboard" })}>
              Back to dashboard
            </BackLink>
          }
        />
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (client.market === null) {
    return (
      <MarketGate
        onSave={async (draft) => {
          const sel = parseMarketSelection({
            country: draft.country,
            regionCode: draft.regionCode,
          });
          if (!sel) throw new Error("Pick a region and, for the US, a state.");
          const { error } = await supabase
            .from("clients")
            .update({
              market: marketToJson(sel),
              financial_year_start_month: sel.country === "US" ? 1 : 3,
            })
            .eq("id", client.id);
          if (error) throw error;
          setClient((current) => (current ? { ...current, market: marketToJson(sel) } : current));
        }}
      />
    );
  }

  return (
    <MarketProvider selection={storedClientSelection} gatesFollowStored>
      <FinancialInputsContext.Provider value={financialInputsCtxValue}>
        <div className={`accountant-portal premium-shell milon-page-enter${mobileNavOpen ? " nav-open" : ""}`}>
          {/* Two honest steps while the client has no figures; the full studio
              tour runs once a real score exists, so "Start with Milōn Bot" and
              the seeded budget are never promised over an empty book. */}
          <WalkthroughWizard
            key={tourVariant ?? "pending"}
            variant={tourVariant ?? "accountant-client-empty"}
            ready={
              tourVariant !== null &&
              !loading &&
              !!client &&
              !firstDataOpen &&
              !showBankDrafter &&
              !uploadOpen &&
              !showQboDialog &&
              !showXeroDialog &&
              !showSageDialog
            }
            onTabChange={handleTourTabChange}
            onFinish={
              tourVariant === "accountant-client-empty" &&
              shouldReopenFirstDataAfterEmptyTour(hasFigures)
                ? () => setFirstDataOpen(true)
                : undefined
            }
            userId={user?.id ?? null}
          />
          {/* Ambient background */}
          <div id="atmos">
            <div className="glow g1" />
            <div className="glow g2" />
            <div className="grid" />
          </div>

          <div className="shell">
            {/* ===== TOP BAR ===== */}
            <div className="topbar">
              <span className="brand">
                <span className="gold-text">MILŌN</span>
              </span>
              <FirmSwitcher />
              <PeriodPill periodLabel={booksPeriodPillLabel(statementMeta.periodEnd, figuresPeriodLabel)} />
              <FeatureFinder audience="accountant" clientId={clientId} />
              <span className="spacer" />
              <SettingsMenu
                className="tb-btn settings-gear"
                onSettings={() => {
                  setMobileNavOpen(false);
                  openPracticeSettings();
                  void navigate({ to: "/settings" });
                }}
                onPlan={() => {
                  setMobileNavOpen(false);
                  openPracticeSettings();
                  void navigate({ to: "/settings", hash: "firm-billing" });
                }}
              />
              <span className="topbar-theme">
                <ThemeToggle />
              </span>
              <AccountantMenuButton open={mobileNavOpen} onClick={() => setMobileNavOpen((o) => !o)} />
            </div>

            {/* ===== BREADCRUMB ===== */}
            <div className="crumb">
              <FirmDashboardCrumb linked={firmDashboardLinked} onBack={() => void exitImpersonation()} />
              <span>/</span>
              <span>
                <b style={{ color: "var(--ink)" }}>
                  {firmClientCrumbLabel(client.name, actingAsThisClient)}
                </b>
              </span>
              {onClientSettings ? (
                <>
                  <span>/</span>
                  <span>Settings</span>
                </>
              ) : (
                <ClientCrumb
                  clientId={clientId}
                  activeTab={activeTab}
                  section={search.section ?? null}
                  agent={homeAgent}
                />
              )}
              {hasFigures ? (
                <span className="aud">On file</span>
              ) : (
                <span className="crumb-empty">No data yet</span>
              )}
            </div>

            <div className="client-workspace">
              <DrawerBackdrop open={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
              <ClientRail
                clientId={clientId}
                search={search}
                onNavigate={() => setMobileNavOpen(false)}
              />
              <div className="deliverable-main">
                {pageBack && !onClientSettings ? (
                  <ClientBackLink clientId={clientId} label={pageBack.label} tab={pageBack.tab} />
                ) : null}
                <div data-notes-tray-slot="" className="notes-tray-slot" />
                <ClientOwnerInviteHost
                  clientId={client.id}
                  clientName={client.name}
                  market={clientMarket}
                  open={ownerInviteOpen}
                  onOpenChange={setOwnerInviteOpen}
                  showEntry={onClientSettings}
                />
                <div hidden={onClientSettings}>
                {!hasFigures && activeTab === "summary" ? (
                  <div className="card hero-card first-figures" id="first-figures-card">
                    <div className="ff-copy">
                      <p className="kicker">Step 1 · Bring in this client's figures</p>
                      <h3>Nothing is scored yet</h3>
                      <p>
                        The health orb, profit waterfall, cash forecast and Milōn Bot all wait on
                        the first numbers. Books is where the first numbers come in.{" "}
                        {isUsCopy(gateMarket)
                          ? "Fastest: a P&L and balance sheet as Excel, CSV or PDF."
                          : "Fastest: about 3 months of bank statements for every account."}
                      </p>
                    </div>
                  </div>
                ) : null}
                <div
                  className={`tabpane${activeTab === "overview" && !showHomeThread ? " on" : ""}`}
                  id="pane-overview"
                >
                <div className="owner-door" data-client-home="true">
                  {statementSampleImplausible(financials) ? (
                    <p className="mb-4 text-sm text-[#3D5270] dark:text-slate-300" role="status" data-sample-notice="">
                      {implausibleSampleNote(clientMarket)}
                    </p>
                  ) : null}
                  <FinancialManagerBrief
                    brief={homeBrief}
                    clientId={clientId}
                    handoffs={shownHandoffs}
                    audience="accountant"
                    onOpen={(tab) => openHomeSection(tab)}
                    onOpenDraft={(id) => openDraft(id)}
                  />
                  <OwnerHome
                    title="Your whole finance team"
                    variant="character"
                    showInvite={false}
                    audience="accountant"
                    marketCountry={clientGateCountry}
                    sampleClient={Boolean(client.is_demo)}
                    cardPhase="ready"
                    firmId={client.firm_id ?? null}
                    presence={homePresence}
                    lines={homeLines}
                    status={homeStatus}
                    onOpen={openHomeAgent}
                    onAsk={openHomeAgent}
                    needs={homeNeeds}
                    onMoves={() => openHomeSection("plan")}
                    onActions={() => openHomeSection("plan")}
                    onDrafts={() => openDraft(homeNeeds.draftId)}
                    onDeliverables={() => openHomeSection("reports")}
                    onBooks={() => openHomeSection("portal")}
                    signoffLine={homeSignoffLine}
                  />
                </div>
                <div hidden>
                <NextStepCard
                  className="mb-4"
                  clientId={client.id}
                  audience="accountant"
                  surface="accountant_portal"
                  refreshKey={`${activeTab}|${snapshots.length}|${hasFigures ? 1 : 0}|${client.last_forecast_at ?? ""}|${advisoryBump}`}
                  onAct={handleNextStepAct}
                  hideCta
                />
                </div>
                </div>

                {/* ===== SUMMARY TAB ===== */}
                <div className={`tabpane${activeTab === "summary" ? " on" : ""}`} id="pane-summary">
                  {activeTab === "summary" && search.section !== "documents" && search.section !== "connections" ? (
                    <ClientSectionOverview
                      clientId={clientId}
                      eyebrow="File"
                      title="Books"
                      subtitle="Documents and connections each have their own page."
                      links={[
                        {
                          id: "documents",
                          label: "Documents",
                          detail: "Figures, files, and what is already on the client record.",
                          search: (prev) => accountantClientTabSearch(prev, "portal", { section: "documents" }),
                        },
                        {
                          id: "connections",
                          label: "Connections",
                          detail: "Xero, QuickBooks, and Sage.",
                          search: (prev) => accountantClientTabSearch(prev, "portal", { section: "connections" }),
                        },
                      ]}
                    />
                  ) : null}
                  {activeTab === "summary" && search.section === "documents" ? (
                    <ClientSubpageFrame
                      id="documents"
                      eyebrow="Books"
                      title="Documents"
                      subtitle="Figures, files, and exports for this client."
                    >
                <ReviewInputsDrawer hint="Exports">
                  <div className="briefing-actions deliverables-more" data-bot-entry>
                    <button
                      type="button"
                      className={portalButtonClass("secondary")}
                      data-ask-bot
                      onClick={() => openHomeAgent("financial_manager")}
                    >
                      Ask Milōn Bot
                    </button>
                    <button
                      type="button"
                      id="client-upload-cta"
                      className={portalButtonClass("secondary")}
                      onClick={() => setUploadOpen(true)}
                    >
                      Upload
                    </button>
                    <button
                      type="button"
                      className={portalButtonClass("secondary")}
                      onClick={() => openArchive(openQueriesCount > 0 ? "open" : "resolved")}
                    >
                      {openQueriesCount > 0
                        ? `${openQueriesCount} open ${openQueriesCount === 1 ? "query" : "queries"}`
                        : "No open queries"}
                    </button>
                    {hasFigures && priorSnapshot ? (
                      <button
                        type="button"
                        className={portalButtonClass("secondary")}
                        onClick={() => openReportPage("movement", "preview")}
                      >
                        Open movement report
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={portalButtonClass("secondary")}
                      onClick={() => revealTab("reports")}
                    >
                      {reportsIssued > 0 ? "Open Reports" : "Create report"}
                    </button>
                    {hasFigures ? (
                      <>
                        <button className={portalButtonClass("secondary")} onClick={handleGenerateReport}>
                          Generate report
                        </button>
                        <button className={portalButtonClass("secondary")} onClick={handleExportPDF}>
                          Export PDF
                        </button>
                        <button className={portalButtonClass("secondary")} onClick={handleEmailDraft}>
                          Email draft
                        </button>
                        <button className={portalButtonClass("secondary")} onClick={handleWhatsApp}>
                          WhatsApp
                        </button>
                      </>
                    ) : null}
                  </div>
                </ReviewInputsDrawer>
                      <StatementFigures facts={statementFigureFacts} />
                      <ClientBrainSummary
                        clientId={client.id}
                        clientName={client.name}
                        firmId={client.firm_id ?? null}
                        operatingProfile={client.operating_profile}
                        market={client.market}
                        businessType={client.business_type}
                        onOpenUpload={() => setUploadOpen(true)}
                        onOpenTab={(tab) => {
                          const resolved = resolveAccountantTab(tab);
                          if (resolved) writeAccountantTab(resolved);
                        }}
                        onAnswerProfile={() => setProfileOpen(true)}
                        figureFacts={statementFigureFacts}
                        renderFrame={({ inputs, body }) => (
                          <>
                            {body}
                            <DeliverableInputConfig
                              className="mb-5"
                              clientId={clientId}
                              deliverableId="summary"
                              context={deliverableInputContext}
                            />
                            {inputs}
                          </>
                        )}
                      />
                    </ClientSubpageFrame>
                  ) : null}
                  {activeTab === "summary" && search.section === "connections" ? (
                    <ClientSubpageFrame
                      id="connections"
                      eyebrow="Books"
                      title="Connections"
                      subtitle="Xero, QuickBooks, and Sage for this client."
                    >
                      <DataUpToDate
                        clientId={clientId}
                        returnPath={`/clients/${clientId}?tab=portal&section=connections`}
                        xeroRefresh={xeroRefresh}
                        qboRefresh={qboRefresh}
                        sageRefresh={sageRefresh}
                        onSageConnectionChange={() => setSageRefresh((n) => n + 1)}
                        onXeroSyncComplete={onXeroSyncComplete}
                        onQboSyncComplete={onQboSyncComplete}
                        onSageSyncComplete={onSageSyncComplete}
                        onUpload={() => setUploadOpen(true)}
                        freshness={dataFreshness}
                        chip={healthChip}
                        openQueries={openQueriesCount}
                        onOpenQueries={() =>
                          openArchive(openQueriesCount > 0 ? "open" : "resolved")
                        }
                      />
                    </ClientSubpageFrame>
                  ) : null}
                </div>

                {/* ===== MOVES ===== */}
                <div className={`tabpane${activeTab === "moves" ? " on" : ""}`} id="pane-moves">
                  {activeTab === "moves" && (
                    <StrategicMovesPanel
                      moves={strategicMoves}
                      clientId={client.id}
                      onOpenPlan={(moveKey) => {
                        setPlanFocusMove(moveKey);
                        openHomeSection("plan", "open");
                      }}
                      onOpenDraft={openDraft}
                    />
                  )}
                </div>

                {/* ===== MILŌN BOT TAB ===== */}
                <div className={`tabpane${activeTab === "ask" || showHomeThread ? " on" : ""}`} id="pane-ask">
                  <div className="milon-desk-host">
                    <MilonTeamPane
                      key={homeAgent ?? "team"}
                      clientId={clientId}
                      agent={homeAgent}
                      marketCountry={clientGateCountry}
                      audience="accountant"
                      sampleClient={Boolean(client.is_demo)}
                      canonicalRatios={canonicalRatios}
                      homeFinding={
                        homeAgent
                          ? homeLines[homeAgent].filter((line) => line.trim()).join(" ")
                          : null
                      }
                      onSelectAgent={openHomeAgent}
                      onOpenApproved={(target) => {
                        if (target.screen === "accountant") {
                          setActiveTab("overview");
                          requestRevealDataRequests();
                          return;
                        }
                        openHomeSection("plan", "open");
                      }}
                    />
                    <div id="ask-ai-accountant" className="ask-ai-studio-shell" />
                    <button
                      type="button"
                      id="wizard-open-queries"
                      className={portalButtonClass("secondary")}
                      onClick={() => openArchive(openQueriesCount > 0 ? "open" : "resolved")}
                    >
                      {openQueriesCount > 0
                        ? `${openQueriesCount} open ${openQueriesCount === 1 ? "query" : "queries"}`
                        : "No open queries"}
                    </button>
                  </div>
                </div>

                {/* ===== RATIOS TAB ===== */}
                <div className={`tabpane${activeTab === "ratios" ? " on" : ""}`} id="pane-ratios">
                  {search.section !== "score" && search.section !== "pillars" ? (
                    <ClientSectionOverview
                      clientId={clientId}
                      eyebrow="Numbers"
                      title="Health"
                      subtitle="Score and where it hurts each have their own page. The figures are edited here."
                      links={[
                        {
                          id: "score",
                          label: "Score",
                          detail: "The health score, with sign-off and the PDF.",
                          search: (prev) => accountantClientTabSearch(prev, "health", { section: "score" }),
                        },
                        {
                          id: "pillars",
                          label: "Where it hurts",
                          detail: "The pillars that pull the score down.",
                          search: (prev) => accountantClientTabSearch(prev, "health", { section: "pillars" }),
                        },
                      ]}
                    />
                  ) : null}
                  {search.section === "score" ? (
                  <ClientSubpageFrame
                    id="score"
                    eyebrow="Health"
                    title="Score"
                    subtitle="The health score for this client. Sign off and export the PDF from this page."
                  >
                  <DeliverableAnswerStrip
                    heading="Health score"
                    sentence={healthSentence}
                    chip={healthChip}
                    scope="financials"
                    clientId={clientId}
                    clientName={client?.name}
                    signoff={financialsSignoff}
                    isStale={pageSignoffStale(
                      financialsSignoff,
                      client?.financials_updated_at ?? null,
                    )}
                    onSignoffChange={patchSignoff("financials")}
                  signoffKnown={signoffsKnown}
                    canSign
                    extraActions={
                      <button
                        type="button"
                        className="answer-strip__icon"
                        aria-label="Export PDF"
                        title="Export PDF"
                        onClick={() => void handleExportPDF()}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                        </svg>
                      </button>
                    }
                  />
                  </ClientSubpageFrame>
                  ) : null}
                  {search.section !== "score" && search.section !== "pillars" ? (
                  <>
                  {needsTrialBalanceRefresh({ live: financials, snapshots }) ? (
                    <TrialBalanceRefreshPrompt onImport={() => setUploadOpen(true)} />
                  ) : null}
                {needsBalanceSheetPrompt(financials) ? (
                  <BalanceSheetPrompt onUpload={() => setUploadOpen(true)} />
                ) : null}
                {/* P0.6 — tracked data asks (system + by hand); accountant can email the owner. */}
                <DataRequestsPanel
                  className="mb-4"
                  clientId={client.id}
                  audience="accountant"
                  refreshKey={`${activeTab}|${snapshots.length}|${advisoryBump}`}
                  financials={financials}
                  onUpload={() => setFirstDataOpen(true)}
                  onOpenForecast={() => openHomeSection("cash", "forecast")}
                  onChanged={() => setAdvisoryBump((n) => n + 1)}
                />

                {generationTrialOpen ? (
                  <TrialEndedPlanBlock firmId={client.firm_id ?? null} />
                ) : null}

                {/* ===== CLIENT BRIEFING — status → what matters → this month's workflow ===== */}
                {statementSampleImplausible(financials) ? (
                  <p className="mb-4 text-sm text-[#3D5270] dark:text-slate-300" role="status">
                    {implausibleSampleNote(clientMarket)}
                  </p>
                ) : null}
                {plVersusBank ? (
                  <PlBankDisagreeNotice disagreement={plVersusBank} market={gateMarket} />
                ) : null}

                <ClientBriefing
                  clientName={client.name}
                  clientCode={client.client_code}
                  industryLabel={clientIndustryDisplay(client.name, briefingProfile, client.business_type)}
                  ring={
                    <HealthRing
                      id="overview-health"
                      score={evidenced ? overallHealth.overall : null}
                      status={evidenced ? overallHealth.displayStatus : undefined}
                      size={74}
                      strokeWidth={5}
                    />
                  }
                  healthScore={evidenced ? overallHealth.overall : null}
                  healthLabel={evidenced ? bookStatusWord : NOT_SCORED_YET_LABEL}
                  healthStatus={evidenced ? (bookStatusCritical ? "critical" : overallHealth.displayStatus) : null}
                  snapshot={briefingSnapshot}
                  about={briefingAbout}
                  profile={briefingProfile}
                  debtorDays={actualDebtorDays}
                  onEditProfile={() => setProfileOpen(true)}
                  whatMatters={briefingMatters}
                  hideWhatMatters
                  hideConnectionActions
                  hideScore
                  hideFigures
                  workflow={workflow}
                  workflowLoading={workflowLoading}
                  onRefreshWorkflow={() => void requestWorkflow(true)}
                  openQueries={
                    notesLoading && clientNotes.length === 0
                      ? openQueriesCount
                      : clientNotes.filter((n) => !n.resolved).length
                  }
                  onOpenQueries={() => openArchive(openQueriesCount > 0 ? "open" : "resolved")}
                  reportsIssued={reportsIssued}
                  movementReportAvailable={Boolean(priorSnapshot)}
                  onOpenMovementReport={() => openReportPage("movement", "preview")}
                  onAddPastPeriod={() => setPastPeriodOpen(true)}
                  onOpenReports={() => revealTab("reports")}
                  hasFigures={hasFigures}
                  figuresPeriodLabel={figuresPeriodLabel}
                  onUpload={() => setUploadOpen(true)}
                  onConnectQuickBooks={() => setShowQboDialog(true)}
                  onConnectXero={() => setShowXeroDialog(true)}
                  onConnectSage={
                    isUsCopy(gateMarket) ? undefined : () => setShowSageDialog(true)
                  }
                  qboLink={
                    qboLink
                      ? {
                          tenantName: qboLink.companyName,
                          lastSyncedAt: qboLink.lastSyncedAt,
                          syncStatus: qboLink.syncStatus,
                          periodLabel: qboLink.periodLabel,
                          revenue: qboLink.revenue,
                          ytdPeriodLabel: qboLink.ytdPeriodLabel,
                          ytdRevenue: qboLink.ytdRevenue,
                          ytdBasis: qboLink.ytdBasis,
                          figuresFromThisSync: qboLink.figuresFromThisSync,
                          syncFigures: qboLink.syncFigures,
                          boardFigures: qboLink.boardFigures,
                        }
                      : null
                  }
                  xeroLink={
                    xeroLink
                      ? {
                          tenantName: xeroLink.tenantName,
                          lastSyncedAt: xeroLink.lastSyncedAt,
                          syncStatus: xeroLink.syncStatus,
                          periodLabel: xeroLink.periodLabel,
                          revenue: xeroLink.revenue,
                          ytdPeriodLabel: xeroLink.ytdPeriodLabel,
                          ytdRevenue: xeroLink.ytdRevenue,
                          ytdBasis: xeroLink.ytdBasis,
                          figuresFromThisSync: xeroLink.figuresFromThisSync,
                          syncFigures: xeroLink.syncFigures,
                          boardFigures: xeroLink.boardFigures,
                          bsAsOf: xeroLink.bsAsOf,
                          bankCount: xeroLink.bankCount,
                          bankTotal: xeroLink.bankTotal,
                          bankWarning: xeroLink.bankWarning,
                          bankFrom: xeroLink.bankFrom,
                          bankTo: xeroLink.bankTo,
                          openingCashNote: xeroLink.openingCashNote,
                          forecastLinesNote: xeroLink.forecastLinesNote,
                        }
                      : null
                  }
                />

                {hasFigures ? <CheckoutAfterInsight /> : null}

                {hasFigures && needsPastPeriodPrompt({ hasLiveFigures: hasFigures, snapshots }) ? (
                  <p className="text-[12px] leading-relaxed text-[color:var(--ink-dim)]">
                    Trend lines and movement need another period.{" "}
                    <AddPastPeriodLink onOpen={() => setPastPeriodOpen(true)} />
                  </p>
                ) : null}

                  <ReviewInputsDrawer hint={deliverableDrawerHint("ratios", deliverableInputContext)}>
                  <DeliverableInputConfig
                    className="mb-5"
                    clientId={clientId}
                    deliverableId="ratios"
                    context={deliverableInputContext}
                    onEngineBoundChange={(patch) => {
                      if (typeof patch.periodMonths === "number") {
                        handleFinancialChange(PERIOD_MONTHS_KEY, String(patch.periodMonths));
                      }
                    }}
                  />
                  {/* Collapsible Financials */}
                  <div className={`card collapse${finOpen ? " open" : ""}`} id="finCollapse">
                    <div
                      className="c-head"
                      onClick={() => setFinOpen((v) => !v)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && setFinOpen((v) => !v)}
                    >
                      <h3>
                        Financials{" "}
                        {autosaveStatus === "saving" && (
                          <span className="autosave" style={{ marginLeft: 10 }}>
                            Saving…
                          </span>
                        )}
                        {autosaveStatus === "saved" && (
                          <span className="autosave" style={{ marginLeft: 10 }}>
                            Auto-saved
                          </span>
                        )}
                        {autosaveStatus === "idle" && (
                          <span className="autosave" style={{ marginLeft: 10 }}>
                            Auto-saved
                          </span>
                        )}
                      </h3>
                      <span className="hint">
                        Edit the figures or upload a statement. The score follows what is saved here.
                      </span>
                      <span className="chev">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </span>
                    </div>
                    <div className="c-body">
                      <div className="c-inner">
                        <div
                          style={{
                            display: "flex",
                            gap: 10,
                            alignItems: "center",
                            justifyContent: "flex-end",
                            flexWrap: "wrap",
                            marginBottom: 16,
                          }}
                        >
                          <label
                            className="fin-period"
                            title="Profit and loss figures are stretched across a full year so the ratios can be compared. Balance-sheet figures stay as they are."
                          >
                            <span>Figures cover</span>
                            {equityCheck.warning ? (
                              <span className="hint" style={{ marginLeft: 8 }}>
                                {equityCheck.warning}
                              </span>
                            ) : null}
                            <select
                              value={String(periodMonths)}
                              onChange={(e) => {
                                handleFinancialChange(PERIOD_MONTHS_KEY, e.target.value);
                                handleFinancialChange(PERIOD_MONTHS_CHOSEN_KEY, "1");
                              }}
                            >
                              {PERIOD_MONTH_OPTIONS.map((o) => (
                                <option key={o.months} value={String(o.months)}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <span style={{ flex: 1 }} />
                          <button className="btn ghost mini" onClick={handleSaveSnapshot}>
                            Save snapshot
                          </button>
                          <button
                            className="btn ghost mini"
                            onClick={() => setShowBankDrafter(true)}
                          >
                            <svg viewBox="0 0 24 24">
                              <path d="M12 15V3M7 8l5-5 5 5M5 21h14" />
                            </svg>
                            Draft from banks
                          </button>
                          <button className="btn ghost mini" onClick={() => setUploadOpen(true)}>
                            <svg viewBox="0 0 24 24">
                              <path d="M12 15V3M7 8l5-5 5 5M5 21h14" />
                            </svg>
                            Upload statement
                          </button>
                        </div>
                        <div className="fin-grid">
                          {FIELD_LABELS.map(({ key, label }) => (
                            <div key={key}>
                              <label>
                                {key === "equity" && financials[EQUITY_DERIVED_KEY] === "1"
                                  ? DERIVED_EQUITY_LABEL
                                  : key === "laborCost"
                                    ? laborCostLabel(gateMarket)
                                    : label}
                              </label>
                              <input
                                value={financials[key] ?? ""}
                                onChange={(e) => handleFinancialChange(key, e.target.value)}
                                onBlur={(e) => handleFinancialChange(key, e.target.value)}
                                placeholder="—"
                                type="number"
                              />
                            </div>
                          ))}
                        </div>
                        <DebtScheduleEditor
                          value={debtSchedule}
                          onChange={handleDebtScheduleChange}
                        />
                      </div>
                    </div>
                  </div>
                  </ReviewInputsDrawer>
                  </>
                  ) : null}
                  {search.section === "score" ? (
                  <div style={{ marginBottom: 32 }}>
                      <div className="health-plate owner-door">
                        <SphereHero
                          variant="ring"
                          caption={HEALTH_RING_CAPTION}
                          hideCaption
                          overallHealth={evidenced && isFinite(avgHealth) ? avgHealth : NaN}
                          displayStatus={evidenced ? (bookStatusCritical ? "critical" : overallHealth.displayStatus) : undefined}
                          statusLabel={evidenced ? (bookStatusCritical ? bookStatusWord : null) : NOT_SCORED_YET_LABEL}
                          pillars={spherePillars}
                          cashFloorCue={homeBrief.healthCue}
                          onCashFloor={() => openHomeAgent("financial_manager")}
                          queryCounts={ratioQueryCounts}
                          drillTo={healthDrill}
                          onDriverClick={(key) => openDrawerFromUiKey(key)}
                          topPriority={(() => {
                            const worst = Object.entries(pillarHealths)
                              .filter(([, h]) => isFinite(h))
                              .sort(([, a], [, b]) => a - b)[0];
                            if (!worst)
                              return {
                                title: "Upload financial data",
                                description:
                                  "Add figures to see a health score and your highest-impact first move.",
                              };
                            const labels: Record<string, string> = PILLAR_LABELS;
                            return {
                              title: `Improve ${labels[worst[0]] ?? worst[0]}`,
                              description: `This pillar scores ${Math.round(worst[1])} — your highest-impact area right now.`,
                            };
                          })()}
                        />
                      </div>
                  </div>
                  ) : null}
                  {search.section === "pillars" ? (
                  <ClientSubpageFrame
                    id="pillars"
                    eyebrow="Health"
                    title="Where it hurts"
                    subtitle="The pillars that pull the score down."
                  >
                  <div style={{ marginBottom: 32 }}>
                      {/* One Health view — orb and pillar cards. No Simplified/Complex switch.
                          Pillar summary cards. SimplifiedRatios owns id="coach-pillars". */}
                      <div className="health-plate">
                        <SimplifiedRatios
                          sections={simplifiedSections}
                          cashFloorCue={homeBrief.healthCue}
                          onCashFloor={() => openHomeAgent("financial_manager")}
                          onAddPastPeriod={() => setPastPeriodOpen(true)}
                          onOpenPillar={(id) => {
                            if (id !== "profit" && id !== "assets" && id !== "financing" && id !== "cash") return;
                            setHealthDrill({ token: Date.now(), pillarId: id });
                            openHomeSection("health", "score");
                          }}
                          onOpenEvidence={(id) => {
                            const evidence = evidenceForPillar(id);
                            if (!evidence) return;
                            if (id === "assets" || id === "financing") {
                              setHealthDrill({ token: Date.now(), pillarId: id });
                            }
                            openCoach(evidence);
                          }}
                        />
                      </div>
                      {openRatioQueryRows.length > 0 ? (
                        <div className="ratio-rows" style={{ marginTop: 16 }}>
                          {openRatioQueryRows.map((row) => (
                            <button
                              key={row.key}
                              type="button"
                              className="ratio-row"
                              onClick={() => openDrawerFromUiKey(row.key)}
                            >
                              <span className="rn">
                                {row.label}
                                <span className="ml-2 inline-flex rounded-full bg-[#0B5FFF] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                                  {row.count === 1 ? "1 query" : `${row.count} queries`}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                  </div>
                  </ClientSubpageFrame>
                  ) : null}

                  {search.section !== "score" && search.section !== "pillars" && hasStatementWorkingCapital(ratiosStatementFigures(financials)) ? (
                    <StatementArApTiles
                      position={ratiosStatementFigures(financials)}
                      market={gateMarket}
                      id="ratios-statement-position"
                    />
                  ) : null}
                </div>

                {/* ===== PROFIT TAB ===== */}
                <div className={`tabpane${activeTab === "profit" ? " on" : ""}`} id="pane-profit">
                  {activeTab === "profit" && search.section !== "waterfall" && search.section !== "lines" ? (
                    <ClientSectionOverview
                      clientId={clientId}
                      eyebrow="Profit"
                      title="Profit"
                      subtitle="The waterfall and the product lines each have their own page."
                      links={[
                        {
                          id: "waterfall",
                          label: "Waterfall",
                          detail: "Where profit goes, from revenue down to the bottom line.",
                          search: (prev) => accountantClientTabSearch(prev, "profit", { section: "waterfall" }),
                        },
                        {
                          id: "lines",
                          label: "Product lines",
                          detail: "Revenue and gross profit by product line.",
                          search: (prev) => accountantClientTabSearch(prev, "profit", { section: "lines" }),
                        },
                      ]}
                    />
                  ) : null}
                  {activeTab === "profit" && search.section === "lines" ? (
                    <ClientSubpageFrame
                      id="lines"
                      eyebrow="Profit"
                      title="Product lines"
                      subtitle="Revenue and gross profit by product line, so you can see which lines actually make the money."
                    >
                      <ProductMixPanel
                        totalRevenue={
                          resolveWaterfallFigures(weeklyInputs, waterfallFallback, {
                            preferPeriod: preferStatementPeriod(financials),
                          }).revenue
                        }
                        incentive="Answer these to build revenue and gross profit per product line."
                      />
                    </ClientSubpageFrame>
                  ) : null}
                  {activeTab === "profit" && search.section === "waterfall" ? (
                  <>
                  <ClientSubpageFrame
                    id="waterfall"
                    eyebrow="Profit"
                    title="Waterfall"
                    subtitle="Where profit goes, from revenue down to the bottom line. Sign off and export from here."
                  >
                  <DeliverableAnswerStrip
                    heading="Profitability"
                    sentence={profitAnswerSentence({
                      currency: currencySymbol(gateMarket),
                      periodLabel: profitPeriodLabel,
                      preferPeriod: statementDated,
                      revenueText:
                        accountantProfitPeriod?.slice.revenue != null
                          ? formatMoneyCompact(accountantProfitPeriod.slice.revenue, gateMarket)
                          : Number(financials.revenue) > 0
                            ? formatMoneyCompact(Number(financials.revenue), gateMarket)
                            : null,
                      netMarginPct:
                        typeof ratios["Net Margin"] === "number" && Number.isFinite(ratios["Net Margin"])
                          ? ratios["Net Margin"] * 100
                          : null,
                      grossMarginPct:
                        statementGrossMargin != null
                          ? statementGrossMargin * 100
                          : typeof ratios["Gross Margin"] === "number" && Number.isFinite(ratios["Gross Margin"])
                            ? ratios["Gross Margin"] * 100
                            : null,
                    })}
                    chip={healthChip}
                    scope="profitability"
                    clientId={clientId}
                    clientName={client?.name}
                    signoff={profitabilitySignoff}
                    isStale={pageSignoffStale(
                      profitabilitySignoff,
                      client?.financials_updated_at ?? null,
                    )}
                    onSignoffChange={patchSignoff("profitability")}
                    signoffKnown={signoffsKnown}
                    canSign
                    extraActions={
                      <button
                        type="button"
                        className="answer-strip__icon"
                        aria-label="Export PDF"
                        title="Export PDF"
                        disabled={profitExport?.exporting}
                        onClick={() => profitExport?.exportPdf()}
                      >
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
                        </svg>
                      </button>
                    }
                  />
                  <ReviewInputsDrawer hint={deliverableDrawerHint("profit", deliverableInputContext)}>
                  <DeliverableInputConfig
                    className="mb-5"
                    clientId={clientId}
                    deliverableId="profit"
                    context={deliverableInputContext}
                  />
                  <p className="sub" style={{ marginTop: 12 }}>
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId }}
                      search={(prev) => accountantClientTabSearch(prev, "health")}
                    >
                      Edit the period figures on Health.
                    </Link>
                  </p>

                  </ReviewInputsDrawer>
                  <div id="wizard-profit-walk">
                    <ProfitabilityWaterfall
                      fallback={waterfallFallback}
                      clientName={client?.name}
                      clientId={client?.id}
                      periodLabel={profitPeriodLabel}
                      preferPeriod={statementDated}
                      yearToDate={statementYearLine(financials, clientMarket)}
                      statementSource={figureSource}
                      periodNote={
                        statementDated || figuresPeriodLabel
                          ? null
                          : "Period dates missing; this may cover more than one month."
                      }
                      reviewSignoff={stampFromSignoff(
                        profitabilitySignoff,
                        pageSignoffStale(profitabilitySignoff, client?.financials_updated_at ?? null),
                      )}
                      hideLead
                      hideCardExport
                      onExportReady={setProfitExport}
                    />
                  </div>
                  </ClientSubpageFrame>
                  </>
                  ) : null}
                </div>

                {/* ===== CASH TAB ===== */}
                <div className={`tabpane${activeTab === "cash" ? " on" : ""}`} id="pane-cash">
                  {activeTab === "cash" && search.section !== "forecast" && search.section !== "collections" && search.section !== "payables" ? (
                    <ClientSectionOverview
                      clientId={clientId}
                      eyebrow="Numbers"
                      title="Cash flow"
                      subtitle="The forecast, who to chase, and who to pay each have their own page."
                      links={[
                        {
                          id: "forecast",
                          label: "13-week forecast",
                          detail: "Thirteen weeks of cash, with sign-off on this page.",
                          search: (prev) => accountantClientTabSearch(prev, "cash", { section: "forecast" }),
                        },
                        {
                          id: "collections",
                          label: "Who to chase",
                          detail: "Debtors to collect.",
                          search: (prev) => accountantClientTabSearch(prev, "cash", { section: "collections" }),
                        },
                        {
                          id: "payables",
                          label: "Who to pay",
                          detail: "Bills to schedule against the cash you have.",
                          search: (prev) => accountantClientTabSearch(prev, "cash", { section: "payables" }),
                        },
                      ]}
                    />
                  ) : null}
                  {activeTab === "cash" && search.section === "forecast" ? (
                  <>
                  <ClientSubpageFrame
                    id="forecast"
                    eyebrow="Cash flow"
                    title="13-week forecast"
                    subtitle="Thirteen weeks of cash. Sign off and export from this page."
                  >
                  <div className="card cf-wrap" id="wizard-cash-panel">
                    <CashForecastPanel
                      clientId={client.id}
                      clientName={client.name}
                      canSign
                      hideReadOnlyStamp
                      hideInlineSignOff
                      signoffStale={cashSignoffIsStale(
                        cashForecastSignoff,
                        client?.last_forecast_at ?? null,
                        cashSignedFiguresChanged(cashSignedSnapshot, client?.cashflow),
                      )}
                      signoff={cashForecastSignoff}
                      signoffKnown={signoffsKnown}
                      onSignoffChange={patchSignoff("cash_forecast")}
                      reloadToken={cashForecastReloadToken}
                      openBankUploadToken={cashBankUploadToken}
                      pendingBankFile={pendingBankFile}
                      onPendingBankFileConsumed={() => setPendingBankFile(null)}
                      initialBankDraft={bankCashDraft}
                      statementChip={healthChip}
                      onBankPublish={(payload) => {
                        setBankCashDraft(null);
                        const published = assessClientMetrics({
                          financials,
                          cashflow: payload,
                          financialsUpdatedAt: client?.financials_updated_at ?? null,
                          fyStartMonth,
                        });
                        setClient((c) =>
                          c
                            ? {
                                ...c,
                                cashflow: payload,
                                last_forecast_at: new Date().toISOString(),
                                cash_runway_weeks: persistedRunwayWeeks(published.runway),
                              }
                            : c,
                        );
                      }}
                    />
                  </div>
                  </ClientSubpageFrame>
                  </>
                  ) : null}
                  {activeTab === "cash" && search.section === "collections" ? (
                  <ClientSubpageFrame
                    id="collections"
                    eyebrow="Cash flow"
                    title="Who to chase"
                    subtitle="Debtors to collect, with the controls for this list."
                  >
                <section id="pane-collections" aria-label="Who to chase">
                  <CollectionsPanel
                    clientId={client.id}
                    market={gateMarket}
                    periodLabel={statementDated ? statementMeta.periodLabel : null}
                    position={ratiosStatementFigures(financials)}
                    statementSource={figureSource}
                    onUploadAged={() => {
                      setUploadPurpose("aged");
                      setUploadOpen(true);
                    }}
                    onConnectXero={() => setShowXeroDialog(true)}
                    onConnectQbo={() => setShowQboDialog(true)}
                    onOpenDrafts={() => openHomeSection("reports", "drafts")}
                    onOpenActions={() => openHomeSection("plan", "open")}
                  />
                </section>
                  </ClientSubpageFrame>
                  ) : null}
                  {activeTab === "cash" && search.section === "payables" ? (
                  <ClientSubpageFrame
                    id="payables"
                    eyebrow="Cash flow"
                    title="Who to pay"
                    subtitle="Bills to schedule against the cash you have."
                  >
                <section id="pane-payables" aria-label="Who to pay">
                  <PayablesPanel
                    clientId={client.id}
                    market={gateMarket}
                    runwayWeeks={effectiveRunway}
                    periodLabel={statementDated ? statementMeta.periodLabel : null}
                    position={ratiosStatementFigures(financials)}
                    statementSource={figureSource}
                    onUploadAged={() => {
                      setUploadPurpose("aged");
                      setUploadOpen(true);
                    }}
                    onConnectXero={() => setShowXeroDialog(true)}
                    onConnectQbo={() => setShowQboDialog(true)}
                    onOpenDrafts={() => openHomeSection("reports", "drafts")}
                    onOpenActions={() => openHomeSection("plan", "open")}
                  />
                </section>
                  </ClientSubpageFrame>
                  ) : null}
                </div>

                {/* ===== BUDGET TAB ===== */}
                <div className={`tabpane${activeTab === "budget" ? " on" : ""}`} id="pane-budget">
                  {activeTab === "budget" && search.section !== "year" && search.section !== "months" ? (
                    <ClientSectionOverview
                      clientId={clientId}
                      eyebrow="Numbers"
                      title="Budget"
                      subtitle="This year and the month-by-month view each have their own page."
                      links={[
                        {
                          id: "year",
                          label: "This year",
                          detail: "The year against the plan, with sign-off and the PDF.",
                          search: (prev) => accountantClientTabSearch(prev, "budget", { section: "year" }),
                        },
                        {
                          id: "months",
                          label: "Month by month",
                          detail: "Every month in the budget, next to actuals.",
                          search: (prev) => accountantClientTabSearch(prev, "budget", { section: "months" }),
                        },
                      ]}
                    />
                  ) : null}
                  {activeTab === "budget" && (search.section === "year" || search.section === "months") ? (
                  <ClientSubpageFrame
                    id={search.section}
                    eyebrow="Budget"
                    title={search.section === "months" ? "Month by month" : "This year"}
                    subtitle={
                      search.section === "months"
                        ? "Every month in the budget, next to actuals. Sign off and export from this page."
                        : "The year against the plan. Sign off and export from this page."
                    }
                  >
                  <div id="wizard-budget-panel">
                    <BudgetPanel
                      clientId={client.id}
                      clientName={client.name}
                      simplified
                      role="accountant"
                      reloadToken={budgetReloadToken}
                      onReviewStale={setBudgetReviewStale}
                      canSign
                      hideInlineSignOff
                      signoff={budgetSignoff}
                      signoffKnown={signoffsKnown}
                      onSignoffChange={patchSignoff("budget")}
                      businessTypeId={client.business_type}
                      operatingProfile={parseOperatingProfile(client.operating_profile)}
                      financials={financials}
                      priorYear={
                        priorSnapshot?.financials
                          ? yearMoneyFromFinancials(priorSnapshot.financials as Record<string, unknown>)
                          : null
                      }
                      priorYearLabel={
                        priorSnapshot
                          ? statementSpanLabel({
                              periodStart: readStatementMeta(priorSnapshot.financials, clientMarket).periodStart,
                              periodEnd: readStatementMeta(priorSnapshot.financials, clientMarket).periodEnd,
                              periodLabel: priorSnapshot.period_label,
                              market: clientMarket,
                            })
                          : null
                      }
                      priorYearMonths={
                        priorSnapshot?.financials
                          ? statementCoverMonthCount(priorSnapshot.financials as Record<string, unknown>)
                          : null
                      }
                      fyStartMonthDefault={fyStartMonth}
                      onRetakeProfile={() => setProfileOpen(true)}
                      onPushedToCash={() => {
                        setCashForecastReloadToken((n) => n + 1);
                        openHomeSection("cash", "forecast");
                      }}
                      seededBooks={{
                        budget: client.budget,
                        cashflow: client.cashflow,
                        financials: client.financials ?? null,
                        financialsUpdatedAt: client.financials_updated_at ?? null,
                      }}
                      lens={search.section === "months" ? "table" : "chart"}
                      onLensChange={(next) => {
                        void navigate({
                          to: "/clients/$clientId",
                          params: { clientId },
                          search: (prev) =>
                            accountantClientTabSearch(prev, "budget", {
                              section: next === "table" ? "months" : "year",
                            }),
                        });
                      }}
                    />
                  </div>
                  </ClientSubpageFrame>
                  ) : null}
                </div>

                {/* ===== REPORTS — each sub-heading is its own page. ===== */}
                <div className={`tabpane${activeTab === "reports" ? " on" : ""}`} id="pane-reports">
                  {activeTab === "reports" &&
                  search.section !== "drafts" &&
                  search.section !== "sent" &&
                  search.section !== "all" &&
                  search.section !== "scorecard" &&
                  search.section !== "forecast" &&
                  search.section !== "waterfall" &&
                  search.section !== "budget-pdf" &&
                  search.section !== "benchmark" ? (
                    <ClientSectionOverview
                      clientId={clientId}
                      eyebrow="Work"
                      title="Reports"
                      subtitle="Each report, the drafts, and what has been sent has its own page."
                      links={[
                        {
                          id: "budget-pdf",
                          label: "Open Budget & variance",
                          detail: "The budget PDF, on its own page.",
                          primary: true,
                          search: (prev) => {
                            const next = accountantClientTabSearch(prev, "reports", { section: "budget-pdf" }) as Record<string, unknown>;
                            next.report = "budget";
                            return next;
                          },
                        },
                        {
                          id: "benchmark",
                          label: "Open Benchmark",
                          detail: "The benchmark PDF, on its own page.",
                          search: (prev) => {
                            const next = accountantClientTabSearch(prev, "reports", { section: "benchmark" }) as Record<string, unknown>;
                            next.report = "benchmark";
                            return next;
                          },
                        },
                        {
                          id: "scorecard",
                          label: "Health scorecard",
                          detail: "The health scorecard PDF.",
                          search: (prev) => {
                            const next = accountantClientTabSearch(prev, "reports", { section: "scorecard" }) as Record<string, unknown>;
                            next.report = "scorecard";
                            return next;
                          },
                        },
                        {
                          id: "forecast",
                          label: "13-week cash forecast",
                          detail: "The 13-week cash forecast PDF.",
                          search: (prev) => {
                            const next = accountantClientTabSearch(prev, "reports", { section: "forecast" }) as Record<string, unknown>;
                            next.report = "forecast";
                            return next;
                          },
                        },
                        {
                          id: "waterfall",
                          label: "Profitability waterfall",
                          detail: "The profitability waterfall PDF.",
                          search: (prev) => {
                            const next = accountantClientTabSearch(prev, "reports", { section: "waterfall" }) as Record<string, unknown>;
                            next.report = "waterfall";
                            return next;
                          },
                        },
                        {
                          id: "drafts",
                          label: "Drafts",
                          detail: "Packs and the drafter, ready for sign-off.",
                          search: (prev) => accountantClientTabSearch(prev, "reports", { section: "drafts" }),
                        },
                        {
                          id: "sent",
                          label: "Sent",
                          detail: "Reports already sent to this client.",
                          search: (prev) => accountantClientTabSearch(prev, "reports", { section: "sent" }),
                        },
                        {
                          id: "all",
                          label: "All reports",
                          detail: "Every board-ready PDF, with export.",
                          search: (prev) => accountantClientTabSearch(prev, "reports", { section: "all" }),
                        },
                      ]}
                    />
                  ) : null}
                  {activeTab === "reports" && search.section === "drafts" ? (
                    <ClientSubpageFrame
                      id="drafts"
                      eyebrow="Reports"
                      title="Drafts"
                      subtitle="Packs, recommendations, and the drafter. Sign off from this page."
                    >
                      <section id="reports-drafts">
                        <AgentDraftShelf
                          findings={homeActivity.findings}
                          focusId={typeof search.draft === "string" ? search.draft : null}
                          canonicalRatios={canonicalRatios}
                          health={liveScoreSnapshot}
                          onRefresh={homeActivity.refresh}
                        />
                        <AdvisoryPackPanel
                          className="mb-5"
                          clientId={client.id}
                          firmId={client.firm_id ?? null}
                          signoff={advisorySignoff}
                          audience="accountant"
                          canGenerate={hasFigures}
                          hasFirm={Boolean(client.firm_id)}
                          liveHealth={liveScoreSnapshot}
                          refreshKey={`${activeTab}|${snapshots.length}|${advisoryBump}`}
                          onChanged={() => setAdvisoryBump((n) => n + 1)}
                          onSignoffAction={setPackSignoff}
                          chip={healthChip}
                          liveCashFloor={cashOutlook.floor}
                          currency={gateMarket.currency}
                          primary={
                            <AdvisoryTabSignoff
                              hideLine
                              action={packSignoff}
                              pageSignoff={advisorySignoff}
                            />
                          }
                          inputs={
                            <DeliverableInputConfig
                              className="mb-5"
                              clientId={clientId}
                              deliverableId="advisory"
                              context={deliverableInputContext}
                            />
                          }
                          currentFigures={{
                            runwayLabel: cashRunwayHeadline ?? runwayDisplayLabel(metricRunway),
                            cash: cashOutlook.opening,
                            healthScore: overallHealth.overall,
                          }}
                        />
                        <RecommendationsPanel
                          className="mb-5"
                          clientId={client.id}
                          firmId={client.firm_id ?? null}
                          audience="accountant"
                          canPropose={hasFigures}
                          refreshKey={advisoryBump}
                          onChanged={() => setAdvisoryBump((n) => n + 1)}
                          onOpenActions={() => openHomeSection("plan")}
                          onAddFigures={() => setFirstDataOpen(true)}
                        />
                        <OutcomesPanel
                          className="mb-5"
                          clientId={client.id}
                          audience="accountant"
                          refreshKey={`${activeTab}|${snapshots.length}|${advisoryBump}`}
                          onChanged={() => setAdvisoryBump((n) => n + 1)}
                        />
                        <section className="mb-5 rounded-2xl border border-[#DBEAFE] bg-white p-4 shadow-sm dark:border-[#1e3a5f] dark:bg-[#102A43]">
                          <AdvisoryDrafter
                            clientId={client.id}
                            clientName={client.name}
                            onLogged={() => setDeliveryRefresh((n) => n + 1)}
                          />
                        </section>
                      </section>
                    </ClientSubpageFrame>
                  ) : null}
                  {activeTab === "reports" &&
                  (search.section === "all" ||
                    search.section === "scorecard" ||
                    search.section === "forecast" ||
                    search.section === "waterfall" ||
                    search.section === "budget-pdf" ||
                    search.section === "benchmark") ? (
                    <ClientSubpageFrame
                      id={search.section ?? "all"}
                      eyebrow="Reports"
                      title={
                        search.section === "scorecard"
                          ? "Health scorecard"
                          : search.section === "forecast"
                            ? "13-week cash forecast"
                            : search.section === "waterfall"
                              ? "Profitability waterfall"
                              : search.section === "budget-pdf"
                                ? "Budget & variance"
                                : search.section === "benchmark"
                                  ? "Benchmark"
                                  : "All reports"
                      }
                      subtitle={
                        search.section === "all"
                          ? "Every board-ready PDF. Export one, or the whole pack."
                          : "This PDF on its own, with its export."
                      }
                    >
                      <section id="reports-pdfs">
                        <TabErrorBoundary label="Reports">
                          <Suspense
                            fallback={
                              <div style={{ padding: 24, color: "var(--ink-dim)" }}>
                                Loading reports…
                              </div>
                            }
                          >
                            <ReportsStudioPanel
                              key={`${client.id}-${search.section ?? "all"}`}
                              client={client.name}
                              clientId={client.id}
                              report={
                                search.section === "budget-pdf"
                                  ? "budget"
                                  : search.section === "all"
                                    ? undefined
                                    : search.section
                              }
                              action={
                                search.action === "preview" || search.action === "download"
                                  ? search.action
                                  : undefined
                              }
                              onlyKeys={
                                search.section === "scorecard" ||
                                search.section === "forecast" ||
                                search.section === "waterfall" ||
                                search.section === "benchmark"
                                  ? [search.section]
                                  : search.section === "budget-pdf"
                                    ? ["budget"]
                                    : undefined
                              }
                              embedded
                              figuresOnFile={hasFigures}
                              knownSignoffs={reviewSignoffs}
                              signoffsKnown={signoffsKnown}
                              knownSignoffStale={reportSignoffStale}
                              onSignoffChange={(scope, next) => patchSignoff(scope)(next)}
                              sourceChip={healthChip}
                              inputs={
                                <DeliverableInputConfig
                                  className="mb-5"
                                  clientId={clientId}
                                  deliverableId="reports"
                                  context={deliverableInputContext}
                                />
                              }
                              onSearchCleared={() => {
                                void navigate({
                                  to: "/clients/$clientId",
                                  params: { clientId },
                                  search: (prev) => {
                                    const next = { ...(prev as Record<string, unknown>) };
                                    delete next.report;
                                    delete next.action;
                                    return next;
                                  },
                                  replace: true,
                                });
                              }}
                            />
                          </Suspense>
                        </TabErrorBoundary>
                      </section>
                    </ClientSubpageFrame>
                  ) : null}
                  {activeTab === "reports" && search.section === "sent" ? (
                    <ClientSubpageFrame
                      id="sent"
                      eyebrow="Reports"
                      title="Sent"
                      subtitle="Reports already sent to this client."
                    >
                      <section id="reports-sent">
                        <AdvisorySentHistory
                          clientId={client.id}
                          refreshToken={deliveryRefresh}
                          seedRows={sentSeed}
                          statementPeriodLabel={reportDataPeriodLabel(financials, clientMarket)}
                          liveScorecard={renderOverviewScorecard}
                        />
                      </section>
                    </ClientSubpageFrame>
                  ) : null}
                </div>

                {/* ===== ACTION PLAN TAB ===== */}
                <div className={`tabpane${activeTab === "plan" ? " on" : ""}`} id="pane-plan">
                  {activeTab === "plan" && search.section !== "open" && search.section !== "overdue" ? (
                    <ClientSectionOverview
                      clientId={clientId}
                      eyebrow="Work"
                      title="Action plan"
                      subtitle="Open work and overdue actions each have their own page, with sign-off on the page."
                      links={[
                        {
                          id: "open",
                          label: "Open work",
                          detail: "Actions still open.",
                          search: (prev) => accountantClientTabSearch(prev, "plan", { section: "open" }),
                        },
                        {
                          id: "overdue",
                          label: "Overdue",
                          detail: "Actions past their date.",
                          search: (prev) => {
                            const next = accountantClientTabSearch(prev, "plan", { section: "overdue" }) as Record<string, unknown>;
                            next.filter = "overdue";
                            return next;
                          },
                        },
                      ]}
                    />
                  ) : null}
                  {activeTab === "plan" && (search.section === "open" || search.section === "overdue") ? (
                  <ClientSubpageFrame
                    id={search.section}
                    eyebrow="Action plan"
                    title={search.section === "overdue" ? "Overdue" : "Open work"}
                    subtitle={
                      search.section === "overdue"
                        ? "Actions past their date. Sign off from this page."
                        : "Actions still open. Sign off from this page."
                    }
                  >
                  <section className="mb-5 rounded-2xl border border-[#DBEAFE] bg-white p-4 shadow-sm dark:border-[#1e3a5f] dark:bg-[#102A43]">
                  <DeliverableAnswerStrip
                    heading="Action plan"
                    sentence={planKnown ? planSentence : ""}
                    scope="action_plan"
                    clientId={clientId}
                    clientName={client?.name}
                    signoff={actionPlanSignoff}
                    isStale={false}
                    onSignoffChange={patchSignoff("action_plan")}
                    signoffKnown={signoffsKnown}
                    canSign={planCount > 0}
                    signoffVerbOnly
                    extraActions={
                      planKnown && planCount === 0 ? (
                        <button
                          type="button"
                          className={ARAP_GOLD_BTN}
                          onClick={() => focusPlanAdd.current?.()}
                        >
                          Add action
                        </button>
                      ) : null
                    }
                  />
                  <ReviewInputsDrawer hint={deliverableDrawerHint("plan", deliverableInputContext)}>
                    <DeliverableInputConfig
                      className="mb-5"
                      clientId={clientId}
                      deliverableId="plan"
                      context={deliverableInputContext}
                    />
                  </ReviewInputsDrawer>
                  </section>
                  {/* Follow the portal theme. A nested `.dark` island made Tailwind
              light-on-dark copy fire while accountant `--card` stayed a
              near-transparent cream — titles vanished in light mode. */}
                  <TabErrorBoundary label="Action Plan">
                    <div id="action-plan-work">
                    <Suspense
                      fallback={
                        <div className="rounded-xl border border-[#DBEAFE] bg-white p-8 text-sm font-semibold text-[#102A43]">
                          Loading the plan…
                        </div>
                      }
                    >
                      {activeTab === "plan" && (
                        <ActionPlanPanel
                          key={`${client.id}-${search.filter ?? "all"}`}
                          clientId={client.id}
                          clientName={client.name}
                          canonicalRatios={canonicalRatios}
                          healthSnapshot={liveScoreSnapshot}
                          figuresUpdatedAt={figuresUpdatedAt}
                          reviewSignoff={stampFromSignoff(actionPlanSignoff, false)}
                          simplified
                          isOwner
                          cashBelowFloor={planCashBelowFloor}
                          initialFilter={
                            search.section === "overdue"
                              ? "overdue"
                              : search.filter === "at_risk" ||
                                  search.filter === "blocked" ||
                                  search.filter === "done" ||
                                  search.filter === "all"
                                ? search.filter
                                : undefined
                          }
                          pillars={overallHealth.pillars}
                          moves={strategicMoves.map((move) =>
                            attachPillarScore(
                              {
                                key: move.key,
                                title: move.title,
                                ratioName: move.ratioName,
                                impactLine: move.impactLine,
                                health: Number.isFinite(move.health) ? move.health : Number.NaN,
                              },
                              overallHealth.pillars,
                            ),
                          )}
                          focusMoveKey={planFocusMove}
                          onFocusHandled={() => setPlanFocusMove(null)}
                          onAnswer={onPlanAnswer}
                          onRegisterAdd={registerPlanAdd}
                          onInviteOwner={() => setOwnerInviteOpen(true)}
                          onOpenDraft={(id) => openDraft(id)}
                        />
                      )}
                    </Suspense>
                    </div>
                  </TabErrorBoundary>
                  </ClientSubpageFrame>
                  ) : null}
                </div>
                </div>

              </div>
            </div>

            <div className="footer-note">MILŌN Practice Portal</div>
          </div>

          {/* ===== PLAYBOOK DRAWER ===== */}
          <PlaybookDrawer
            ratioKey={drawerRatioKey}
            ratioName={drawerRatioName}
            healthTier={drawerTier}
            open={drawerOpen}
            onClose={() => {
              setDrawerOpen(false);
              clearFocusNote();
            }}
            clientId={client.id}
            clientName={client.name}
            isAccountant={true}
            formula={drawerFormula}
            actualLine={drawerActual}
            fallbackSteps={drawerFallbackSteps}
            ratioValue={drawerRatioValue}
            revenue={drawerRevenue}
            netProfit={drawerNetProfit}
            formatAmount={(amount) => formatMoney(amount, gateMarket)}
            evidence={(() => {
              if (!drawerRatioKey || drawerTier === "healthy") return null;
              const related = relatedTabForRatio(drawerRatioKey);
              if (!related) return null;
              const evidence = evidenceForBriefingTab(related.tab);
              return {
                label: evidence.label,
                onOpen: () => {
                  setDrawerOpen(false);
                  openCoach(evidence);
                },
              };
            })()}
          />

          {/* Contextual notes — shared with owner app, persisted per client */}
          {client && (
            <NoteLayer
              clientId={client.id}
              tab={activeTab}
              workspace="accountant"
              clientName={client.name}
              authorName={
                (user?.user_metadata as { full_name?: string; name?: string } | null)?.full_name ??
                (user?.user_metadata as { full_name?: string; name?: string } | null)?.name ??
                user?.email ??
                "Accountant"
              }
              onNotesChanged={() => setQueriesRefresh((n) => n + 1)}
              onNeedTab={(next) => {
                const resolved = resolveAccountantTab(next);
                if (!resolved) return;
                const section = typeof next === "object" ? next.section : undefined;
                writeAccountantTab(resolved, undefined, section);
              }}
            />
          )}

          {/* ===== UPLOAD FINANCIALS MODAL ===== */}
          {uploadOpen && (
            <div className="veil open" onClick={closeUpload} role="presentation">
              <div
                ref={uploadDialogRef}
                className="drawer open"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="upload-statement-title"
                tabIndex={-1}
                style={{ overflowY: "auto", padding: "26px 30px" }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 20,
                  }}
                >
                  <div>
                    <button type="button" className="client-subpage-back" onClick={closeUpload}>
                      Back
                    </button>
                    <h3 id="upload-statement-title" style={{ fontSize: 20, fontWeight: 700 }}>
                      {uploadPurpose === "aged"
                        ? "Upload aged debtors and creditors"
                        : "Upload financial statement"}
                    </h3>
                  </div>
                  <button
                    className="close"
                    onClick={closeUpload}
                    aria-label="Close"
                    style={{
                      position: "static",
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      border: "1px solid var(--line)",
                      background: "transparent",
                      color: "var(--ink-dim)",
                      display: "grid",
                      placeItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                </div>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--ink-dim)",
                    marginBottom: 20,
                  }}
                >
                  {uploadPurpose === "aged"
                    ? "PDF, Excel or CSV of the aged debtors and creditors report. A balance sheet in the file updates the receivables and payables already on Overview. Named customers and age buckets come through when you connect Xero or QuickBooks."
                    : "Upload your income statement or balance sheet, one file at a time. Figures are read from the file. PDF, Excel, OpenDocument or CSV. Review every figure before confirming. The quality of the financial information we produce depends on the accuracy of the information you upload."}
                </p>
                <UploadFinancials
                  clientName={client?.name}
                  booksHaveSpan={Boolean(liveStatementSpan(financials))}
                  storedMarket={client?.market ?? null}
                  onConfirm={passStatementChoice(handleConfirmFinancials)}
                  onApplied={() => {
                    setActiveTab("overview");
                    void navigate({
                      to: "/clients/$clientId",
                      params: { clientId },
                      search: (prev) => accountantClientTabSearch(prev, "home"),
                    });
                    startStudioTourAfterFigures();
                    closeUpload();
                  }}
                  onOpenBankUpload={(file) => {
                    setUploadOpen(false);
                    setShowBankDrafter(false);
                    setPendingBankFile(file);
                    setActiveTab("cash");
                    setCashBankUploadToken((n) => n + 1);
                  }}
                  autoPopulate={
                    autoPopulateState ? { ...autoPopulateState, role: "accountant" } : null
                  }
                />
              </div>
            </div>
          )}

          <PastPeriodUploadDialog
            open={pastPeriodOpen}
            onOpenChange={setPastPeriodOpen}
            onContinue={(opts) => {
              historyOnlyUploadRef.current = !opts.replaceLive;
              setUploadOpen(true);
            }}
          />

          <Dialog open={showQboDialog} onOpenChange={setShowQboDialog}>
            <DialogContent className="max-w-2xl border border-[#DBEAFE] bg-white text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB]">
              <DialogHeader>
                <DialogTitle className="text-[15px] font-semibold uppercase tracking-[0.15em] text-[#102A43] dark:text-[#F4F7FB]">
                  QuickBooks Integration
                </DialogTitle>
                <DialogDescription className="text-xs text-[#3D5270] dark:text-[#C5D4E4]">
                  Connect QuickBooks Online to pull this client&apos;s figures into Milōn.
                </DialogDescription>
              </DialogHeader>
              <QboConnectCard
                clientId={clientId}
                returnPath={`/clients/${clientId}`}
                refreshToken={qboRefresh}
                onSyncComplete={(inputs) => {
                  onQboSyncComplete(inputs);
                  setShowQboDialog(false);
                }}
              />
            </DialogContent>
          </Dialog>

          <Dialog open={showSageDialog} onOpenChange={setShowSageDialog}>
            <DialogContent className="max-w-2xl border border-[#DBEAFE] bg-white text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB]">
              <DialogHeader>
                <DialogTitle className="text-[15px] font-semibold uppercase tracking-[0.15em] text-[#102A43] dark:text-[#F4F7FB]">
                  Sage Accounting
                </DialogTitle>
                <DialogDescription className="text-xs text-[#3D5270] dark:text-[#C5D4E4]">
                  Connect Sage Business Cloud Accounting (South Africa). Email, password, and
                  Company ID. Sync does not change this client&apos;s figures yet.
                </DialogDescription>
              </DialogHeader>
              <SageConnectCard
                clientId={clientId}
                refreshToken={sageRefresh}
                onConnectionChange={() => setSageRefresh((n) => n + 1)}
                onSyncComplete={(inputs) => {
                  onSageSyncComplete(inputs);
                  setShowSageDialog(false);
                }}
              />
            </DialogContent>
          </Dialog>

          <Dialog open={showXeroDialog} onOpenChange={setShowXeroDialog}>
            <DialogContent className="max-w-2xl border border-[#DBEAFE] bg-white text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB]">
              <DialogHeader>
                <DialogTitle className="text-[15px] font-semibold uppercase tracking-[0.15em] text-[#102A43] dark:text-[#F4F7FB]">
                  Xero Integration
                </DialogTitle>
                <DialogDescription className="text-xs text-[#3D5270] dark:text-[#C5D4E4]">
                  Connect a Xero organisation to pull P&amp;L, the balance sheet and bank
                  balances into this client&apos;s figures. Existing connections need a reconnect
                  once the bank summary scope is enabled.
                </DialogDescription>
              </DialogHeader>
              <XeroConnectCard
                clientId={clientId}
                returnPath={`/clients/${clientId}`}
                refreshToken={xeroRefresh}
                onSyncComplete={(inputs) => {
                  onXeroSyncComplete(inputs);
                  setShowXeroDialog(false);
                }}
              />
            </DialogContent>
          </Dialog>

          {/* First-client: bank statements nudge */}
          <Dialog open={firstDataOpen} onOpenChange={setFirstDataOpen}>
            <DialogContent className="max-w-md border border-[#DBEAFE] bg-white text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB]">
              <DialogHeader>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#0B5FFF] dark:text-[#F4F7FB]">
                  {client?.name ?? "First client"} · Step 1 of 2
                </p>
                <DialogTitle className="mt-1 text-xl text-[#102A43] dark:text-[#F4F7FB]">
                  Bring in this client's figures
                </DialogTitle>
                <DialogDescription className="text-[#3D5270] dark:text-[#C5D4E4]">
                  {isUsCopy(gateMarket)
                    ? "One action. Fastest: the latest P&L and balance sheet as Excel, CSV or PDF. That pack drafts Health, Profit, Cash and Budget for you to review."
                    : "One action. Fastest: about 3 months of bank statements for every account. That pack drafts Health, Profit, Cash and Budget for you to review."}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-2.5 pt-2">
                {isUsCopy(gateMarket) ? (
                  <FirstDataChoice
                    primary
                    label="Upload a P&L and balance sheet"
                    hint="Excel, CSV or PDF — review every figure before it saves"
                    onClick={() => {
                      setFirstDataOpen(false);
                      setUploadOpen(true);
                    }}
                  />
                ) : (
                  <FirstDataChoice
                    primary
                    label="Upload bank statements"
                    hint="About 3 months of PDFs for each account"
                    onClick={() => {
                      setFirstDataOpen(false);
                      setShowBankDrafter(true);
                    }}
                  />
                )}
                <details>
                  <summary className="cursor-pointer pt-1 text-xs text-[#3D5270] dark:text-[#C5D4E4]">
                    Other ways
                  </summary>
                  <div className="mt-2 flex flex-col gap-2.5">
                    {isUsCopy(gateMarket) ? (
                      <FirstDataChoice
                        label="Upload bank statements instead"
                        hint="About 3 months for each account"
                        onClick={() => {
                          setFirstDataOpen(false);
                          setShowBankDrafter(true);
                        }}
                      />
                    ) : (
                      <FirstDataChoice
                        label="Upload a P&L and balance sheet instead"
                        hint="Excel, CSV or PDF"
                        onClick={() => {
                          setFirstDataOpen(false);
                          setUploadOpen(true);
                        }}
                      />
                    )}
                    <FirstDataChoice
                      label="Connect QuickBooks"
                      hint="Live sync from QuickBooks Online"
                      onClick={() => {
                        setFirstDataOpen(false);
                        setShowQboDialog(true);
                      }}
                    />
                    <FirstDataChoice
                      label="Connect Xero"
                      hint="Live sync of P&L and balance sheet"
                      onClick={() => {
                        setFirstDataOpen(false);
                        setShowXeroDialog(true);
                      }}
                    />
                    {!isUsCopy(gateMarket) ? (
                      <FirstDataChoice
                        label="Connect Sage"
                        hint="Sage Business Cloud Accounting (South Africa)"
                        onClick={() => {
                          setFirstDataOpen(false);
                          setShowSageDialog(true);
                        }}
                      />
                    ) : null}
                    <FirstDataChoice
                      label="Type the figures by hand"
                      hint="Fill the financials grid yourself"
                      onClick={() => {
                        setFirstDataOpen(false);
                        jumpToFinancials();
                      }}
                    />
                  </div>
                </details>
                <button
                  type="button"
                  onClick={() => setFirstDataOpen(false)}
                  className="pt-1 text-center text-xs text-[#3D5270] dark:text-[#C5D4E4] underline-offset-2 hover:text-[#102A43] dark:hover:text-[#F4F7FB] hover:underline"
                  style={{ background: "none", border: "none", cursor: "pointer" }}
                >
                  Skip for now — look around first
                </button>
              </div>
            </DialogContent>
          </Dialog>

          <BankStatementDrafter
            open={showBankDrafter}
            onClose={() => setShowBankDrafter(false)}
            autoPopulate={autoPopulateState ? { ...autoPopulateState, role: "accountant" } : null}
            onApply={async ({ fields, annualised, cashDraft, draft, autoPopulate }) => {
              const asStrings = Object.fromEntries(
                Object.entries(fields).map(([k, v]) => [k, v != null ? String(v) : ""]),
              );
              setFinancials((prev) => {
                const next = { ...prev, ...asStrings };
                financialsRef.current = next;
                return next;
              });
              setShowBankDrafter(false);

              const financialsUpdatedAt = new Date().toISOString();
              const merged = mergeCurrentBlob(financialsRef.current);
              const { error } = await supabase
                .from("clients")
                .update({
                  financials: merged as never,
                  financials_updated_at: financialsUpdatedAt,
                })
                .eq("id", clientId);
              if (error) {
                toast.error(`Could not save bank draft: ${error.message}`);
                return;
              }
              setClient((c) => (c ? { ...c, financials_updated_at: financialsUpdatedAt } : c));
              void upsertCurrentPeriodSnapshot({
                clientId,
                financials: merged,
                source: "upload",
              });
              const draftedFinancials = { ...financials, ...asStrings } as Record<string, unknown>;
              await recordScoreHistory(
                clientId,
                hasFinancialEvidence({ financials: draftedFinancials, cashflow: client?.cashflow })
                  ? liveHealthFromBooks({
                      financials: draftedFinancials,
                      cashflow: client?.cashflow,
                      financialsUpdatedAt,
                      priorFinancials: priorSnapshot?.financials ?? null,
                      fyStartMonth,
                      market: clientMarket,
                      industry: healthIndustry,
                      timeZone: clientMarket.timezone,
                    }).overall
                  : null,
              );
              toast.success(
                annualised
                  ? "Draft figures applied (annualised) — saved."
                  : "Draft figures applied for the statement period — saved.",
              );
              startStudioTourAfterFigures();

              // Same pack drafts cash forecast + budget (first upload: always;
              // later: per the checkboxes). No second dialog, no re-upload.
              try {
                const r = await runAutoPopulate({
                  clientId,
                  fields,
                  cashDraft: cashDraft ?? null,
                  chosen: autoPopulate,
                  firstUpload: autoPopulateState?.firstUpload,
                  firstActualsMonth: draft.period_start?.slice(0, 7) ?? null,
                  fallbackMarket: client?.market ?? null,
                  surface: "accountant_portal",
                  source: "bank_pack",
                });
                applyAutoPopulateResult(r);
                if (r.applied.includes("cash_forecast")) setActiveTab("cash");
              } catch (e) {
                console.warn("auto-populate after bank draft:", e);
                toast.error(
                  `Figures saved, but drafting deliverables failed: ${(e as Error).message}`,
                );
              }
            }}
          />

          <Dialog open={profileOpen} modal={false} onOpenChange={setProfileOpen}>
            <DialogContent
              overlayClassName="profile-funnel-overlay"
              data-profile-funnel=""
              className="flex h-[min(80vh,calc(100dvh-6rem))] max-h-[min(80vh,calc(100dvh-6rem))] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden border border-[#DBEAFE] bg-white p-4 text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB] sm:p-6"
            >
              <DialogHeader className="sr-only">
                <DialogTitle>Business profile</DialogTitle>
                <DialogDescription>Ten questions that tune Milōn to this client</DialogDescription>
              </DialogHeader>
              <ProfileFunnel
                mode="retake"
                initial={parseOperatingProfile(client.operating_profile)}
                initialFyStartMonth={
                  parseOperatingProfile(client.operating_profile)?.fyStartMonth ?? undefined
                }
                onCancel={() => setProfileOpen(false)}
                onComplete={async (profile) => {
                  const stamped = stampProfileProvenance(profile, "firm", user?.id);
                  const { error } = await supabase
                    .from("clients")
                    .update({
                      business_type: stamped.businessTypeId,
                      operating_profile: stamped as unknown as Record<string, unknown>,
                      financial_year_start_month: stamped.fyStartMonth,
                    } as never)
                    .eq("id", clientId);
                  if (error) {
                    toast.error(`Could not save profile: ${error.message}`);
                    return;
                  }
                  setClient((c) =>
                    c
                      ? {
                          ...c,
                          business_type: stamped.businessTypeId,
                          operating_profile: stamped as unknown as Record<string, unknown>,
                        }
                      : c,
                  );
                  setProfileOpen(false);
                  toast.success("Business profile saved for this client");
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </FinancialInputsContext.Provider>
    </MarketProvider>
  );
}
