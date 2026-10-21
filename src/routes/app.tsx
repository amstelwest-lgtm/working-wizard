import { createFileRoute, Link, redirect, useNavigate, ClientOnly } from "@tanstack/react-router";
import { founderPortalLinks } from "@/styles/app-route-styles";
import { OwnerDoor } from "@/components/owner-door/owner-door";
import { OwnerShell } from "@/components/owner-door/owner-shell";
import { cashFloorForHome } from "@/lib/owner-answers";
import { useState, useMemo, useEffect, Suspense, useRef, useCallback } from "react";
import { lazyPanel, TabErrorBoundary } from "@/components/lazy-panel";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { shouldRedirectToAuth } from "@/lib/auth-session-guard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BackLink } from "@/components/back-link";
import { EmptyState, OwnerBootSkeleton, PageHeader, PanelSkeleton, StatusPill } from "@/components/primitives";
import {
  Upload,
  Loader2,
  Building2,
  Shield,
  Plug2,
  Database,
  FlaskConical,
  ChevronDown,
  Check,
  Pencil,
  LogOut,
  MoreHorizontal,
} from "lucide-react";
import { NextStepsPanel } from "@/components/next-steps-panel";
import { CollectionsOverdueNote } from "@/components/collections-overdue-note";
import { PayablesOverdueNote } from "@/components/payables-overdue-note";
import { formatVal, HealthBar, tierColor } from "@/components/owner-board-ui";
import { MarketProvider, useMarket } from "@/contexts/market";
import { MarketGate } from "@/components/market-gate";
import {
  canShowIndustryMedian,
  coerceMarketSelection,
  formatDate,
  formatMoney,
  formatMoneyCompact,
  formatNumber,
  industryBenchmarkCaption,
  industryBenchmarkShortLabel,
  isMissingMarketSupport,
  isUsCopy,
  laborCostLabel,
  currencySymbol,
  localizeCopy,
  marketToJson,
  marketForClient,
  parseMarketSelection,
  readVisitorMarket,
  resolveMarket,
  selectionPayload,
  withMarketRpcFallback,
  type MarketSelection,
} from "@/lib/market";
import { accountantWithoutFirm } from "@/lib/google-practice-market";
import { listUserFirms } from "@/lib/firm-brand";
import { openOwnerSettings } from "@/lib/user-roles";
import { HeaderShareButton } from "@/components/share";
import { InviteAccountantCard } from "@/components/invite-accountant-card";
import { OwnerBusinessSwitcher } from "@/components/owner-business-switcher";
import {
  boardRoleForWorkspace,
  canOpenOwnerWorkspace,
  fallbackOwnerAppRole,
  inviteWorkspaceAlreadyKnown,
  clearStoredOwnerClientId,
  decideStoredClientAccess,
  mergeOwnerWorkspaces,
  nextWorkspaceListStep,
  ownerBootShellName,
  pickActiveOwnerWorkspace,
  readStoredOwnerClientId,
  writeStoredOwnerClientId,
  type OwnerWorkspace,
} from "@/lib/owner-workspaces";
import { useOwnerBoardGate } from "@/contexts/owner-board-gate";
import { extractFinancials, extractPDFsWithAI } from "@/lib/extract-financials.functions";
import { extractionToInputs, ExtractionReviewModal } from "@/components/extraction-review-modal";
import { BankStatementDrafter } from "@/components/bank-statement-drafter";
import { CashFromBanksDrafter } from "@/components/cash-from-banks-drafter";
import type { MergedExtractionResult } from "@/lib/extraction-types";
import {
  CURRENCY_LABEL_CONFIRM_KEY,
  currencyImportRefusal,
  fileCurrencyFromExtraction,
  statementCurrencyGate,
  withCurrencyLabelConfirm,
} from "@/lib/statement-currency";
import { preflightUploadFile, UPLOAD_QUALITY_DISCLAIMER } from "@/lib/upload-quality";
import { BANK_LEDGER_MESSAGE, looksLikeBankLedger } from "@/lib/bank-ledger";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
// askYourNumbers import removed — superseded by ask-ai edge function
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { KpiTrendline, pctDelta } from "@/components/kpi-trendline";
import { IndustryQuintile } from "@/components/industry-quintile";
import { BenchmarkBar } from "@/components/benchmark-bar";
import { AddToPlanButton } from "@/components/add-to-plan-button";
import { OwnerRatioBriefing } from "@/components/owner-ratio-briefing";
import { ThemeToggle } from "@/components/theme-toggle";
import { SettingsMenu } from "@/components/settings-menu";
import { SettingsNavButton } from "@/components/settings-nav-button";
import { FeatureFinder } from "@/components/feature-finder";
import {
  annualiseFinancials,
  computeRatios,
  currentRatioValue,
  healthBandLabel,
  PERIOD_MONTH_OPTIONS,
  PERIOD_MONTHS_CHOSEN_KEY,
  PERIOD_MONTHS_KEY,
  scoreTier,
} from "@/lib/ratios";
import { benchmarkBusinessType } from "@/lib/benchmark-sector";
import { ratiosStatementFigures, withCanonicalDebtorCreditorDays } from "@/lib/deliverable-input-config";
import { cashDriverDayFigures } from "@/lib/cash-driver-label";
import { HEALTH_NOT_ENOUGH_DATA } from "@/lib/health-metric-row";
import {
  GROSS_MARGIN_MAPPING_NOTE,
  PILLAR_LABELS,
  grossMarginLooksImplausible,
  healthWithoutEvidence,
  NOT_SCORED_YET_LABEL,
  healthMapFromRatios,
  liveHealthFromBooks,
  numberRatioRecord,
  scoreRatio,
} from "@/lib/health-score";
import { effectivePeriodMonths } from "@/lib/equity-coherence";
import { ratioActualLine } from "@/lib/ratio-actuals";
import { type SavedCashflowLike } from "@/lib/cash-runway";
import {
  assessClientMetrics,
  forecastOpeningIsKnown,
  hasFinancialEvidence,
  runwayDisplayLabel,
  storedOpeningIsMissing,
} from "@/lib/client-metrics";
import {
  financialsWriteRev,
  financialsWriteSuperseded,
  guardFinancialsWrite,
  importFailureMessage,
  importedUpdateMessage,
  statementImportWhat,
  withFinancialsWriteRev,
} from "@/lib/statement-import-apply";
import { confirmUploadedStatement, liveStatementSpan, snapshotCoveringSpan, type PeriodChoice } from "@/lib/statement-import-plan";
import { forecastPlFingerprint } from "@/lib/cash-forecast-rows";
import { cashOutlookIsCritical, clientListRunwayHeadline, clientListStatusWord } from "@/lib/cash-forecast-parity";
import { implausibleSampleNote, statementSampleImplausible } from "@/lib/operating-profit-display";
import { scorecardRatiosFromFinancials } from "@/lib/scorecard-rows";
import { resolvePriorSnapshot } from "@/lib/prior-period";
import { yearMoneyFromFinancials } from "@/lib/budget-year-compare";
import { budgetProfitFields, statementCoverMonthCount } from "@/lib/budget.bridges";
import { DERIVED_EQUITY_LABEL, readTimeEquity } from "@/lib/statement-financials";
import { needsTrialBalanceRefresh } from "@/lib/trial-balance-refresh";
import { TrialBalanceRefreshPrompt } from "@/components/trial-balance-refresh-prompt";
import {
  FinancialInputsContext,
  type WeeklyInputs,
  type WeeklyRow,
  DEFAULT_WEEKLY_ROW,
} from "@/contexts/financial-inputs";
import {
  parseWeeklyInputs,
  derivePeriodWaterfallFallback,
  hasWeeklyActivity,
  overlayWeeklyInputs,
  resolveWaterfallFigures,
} from "@/lib/weekly-inputs";
import { fiscalWaterfallFallback } from "@/lib/budget-period";
import {
  figuresPeriodLabelFrom,
  ownerBootPeriodPill,
  preferStatementPeriod,
  readStatementMeta,
  statementSpanLabel,
  statementYearLine,
} from "@/lib/statement-period";
import {
  emptyProductMix,
  hasProductMixAnswer,
  overlayProductMix,
  parseProductMix,
  type ProductMix,
} from "@/lib/product-mix";
import { WeeklyInputTable } from "@/components/weekly-input-table";
import { ProductMixPanel } from "@/components/product-mix-panel";
import {
  ProfitabilityWaterfall,
  ProfitLead,
  priorMarginsFromFinancials,
} from "@/components/profitability-waterfall";
import { useTrack } from "@/hooks/use-track";
import { IndustryPulse, IndustryNewsBand } from "@/components/industry-pulse";
import { OverviewRail } from "@/components/overview-rail";
import { NoteLayer } from "@/components/note-layer";
import { AdminDashboard } from "@/components/admin-dashboard";
import { ProfileFunnel, type ProfileFunnelMode } from "@/components/profile/profile-funnel";
import { ProfileCompletionNote } from "@/components/profile/profile-completion-note";
import { OwnerBrainDrip } from "@/components/owner-brain-drip";
import { NextStepCard } from "@/components/next-step-card";
import { BalanceSheetPrompt } from "@/components/balance-sheet-prompt";
import { needsBalanceSheetPrompt } from "@/lib/balance-sheet-prompt";
import { RecommendationsPanel } from "@/components/recommendations-panel";
import { DataRequestsPanel } from "@/components/data-requests-panel";
import { requestRevealDataRequests } from "@/lib/reveal-data-requests";
import { AdvisoryPackPanel } from "@/components/advisory-pack-panel";
import { healthSnapshotFromBooks } from "@/lib/health-snapshot";
import { latestFiguresStamp } from "@/lib/draft-figures";
import { OutcomesPanel } from "@/components/outcomes-panel";
import { FindAccountantPanel } from "@/components/find-accountant-panel";
import {
  OWNER_BOARD_TABS,
  nextStepRoute,
  type NextStep,
  type NextStepTarget,
} from "@/lib/next-step";
import {
  isLegacyOwnerBoardTab,
  isOwnerAppTab,
  ownerDoorScreen,
  ownerDoorSearch,
} from "@/lib/owner-app-tab";
import { signoffScopeLabel } from "@/lib/signoff-status";
import { SampleBoardBanner } from "@/components/sample-board-banner";
import { VerifyEmailBanner } from "@/components/verify-email-banner";
import { SAMPLE_BUSINESS_BLURB, sampleFinancialsFor } from "@/lib/sample-business";
import {
  parseOperatingProfile,
  profileNeedsCompletion,
  profileShortLabel,
  stampProfileProvenance,
  type ClientOperatingProfile,
} from "@/lib/client-profile";
import { clientIndustryDisplay, profileIndustryLabel } from "@/lib/profile-signals";
import { attachPillarScore, rankStrategicMoves, stockSittingApplies, strategicMovePillar } from "@/lib/strategic-moves";
import { periodProfitBridge } from "@/lib/period-profit";
import { statementKindFromMetadata, type StatementMeta } from "@/lib/statement-parse";
import { prefsToRemember } from "@/lib/auto-populate";
import {
  clearOwnerProfileDefer,
  deferOwnerProfile,
  hasOwnerFirstUploadHandled,
  isInvitedOwnerWithFigures,
  markOwnerFirstUploadHandled,
  ownerBoardReady,
  ownerProfileDeferred,
  ownerProfileResumeVisible,
  ownerWalkthroughReady,
  shouldAutoProposeAfterFirstUpload,
  shouldClearFirstRunAfterFirstUpload,
  shouldShowOwnerProfileFunnel,
} from "@/lib/first-run";
import { markOnboardingDone, OWNER_TOUR_KEY } from "@/lib/onboarding";
import { rewriteDraftMonthStamp } from "@/lib/statement-period";
import { invokeBrainPropose } from "@/lib/brain-propose-client";
import { TrialEndedPlanBlock } from "@/components/trial-ended-plan-block";
import { isStarterTrialEndedMessage, messageFromUnknown } from "@/lib/starter-trial-generation";
import {
  consumeInviteHandoffFlag,
  hasInviteHandoffFlag,
  isClientUuid,
  PENDING_INVITE_CLIENT_KEY,
} from "@/lib/invite-handoff";

type Benchmark = { p25: number; p50: number; p75: number; unit: string; higher_is_better: boolean };

const RATIO_KEY_TO_SNAPSHOT: Record<string, string> = {
  taxBurden: "Tax Burden",
  interestBurden: "Interest Burden",
  operatingMargin: "Operating Margin",
  assetTurnover: "Asset Turnover",
  equityMultiplier: "Equity Multiplier",
  netMargin: "Net Margin",
  roa: "Return on Assets",
  roe: "Return on Equity",
  debtorDays: "Debtor Days",
  inventoryDays: "Inventory Days",
  creditorDays: "Creditor Days",
  workingCapitalDays: "Working Capital Days",
  fixedCostRatio: "Fixed Cost Ratio",
  dol: "Degree of Operating Leverage",
  customerConcentration: "Top-5 Customer Share",
  gpToLabor: "Gross Profit / Labor",
  salesPerEmployee: "Sales-per-Employee Ratio",
  ocfToEbitda: "OCF / EBITDA",
  revenuePerFounderHour: "Revenue per Founder Hour",
  grossMargin: "Gross Margin",
  directCostsRatio: "Direct Cost Ratio",
  fundingStructure: "Equity Solvency",
  workingCapitalUtilization: "WC Efficiency",
  fixedCapitalUtilization: "Fixed Asset Productivity",
  workingCapitalFunding: "WC Funding Intensity",
  revenueGrowth: "Revenue Growth",
  capexIntensity: "Capex Intensity",
  assetReinvestmentRatio: "Asset Reinvestment Ratio",
  currentRatio: "Current Ratio",
  debtToEquity: "Debt-to-Equity",
  debtToAssets: "Debt-to-Assets",
};
const CashForecastPanel = lazyPanel(
  () => import("@/components/cash-forecast").then((m) => ({ default: m.CashForecastPanel })),
  "Cash Forecast",
);
const BudgetPanel = lazyPanel(
  () => import("@/components/budget/budget-panel").then((m) => ({ default: m.BudgetPanel })),
  "Budget",
);
const ActionPlanPanel = lazyPanel(() => import("@/components/action-plan"), "Action Plan");
import { SplashScreen } from "@/components/splash-screen";
import { WalkthroughWizard } from "@/components/walkthrough-wizard";
import { NoFiguresBanner } from "@/components/no-figures-banner";
import {
  loadAutoPopulateState,
  runAutoPopulate,
  runSyncAutoPopulate,
  type AutoPopulateState,
} from "@/lib/auto-populate-run";
import { defaultAutoPopulatePrefs, summariseAutoPopulate } from "@/lib/auto-populate";
import { autosaveKeepsLedgerSync } from "@/lib/ledger-sync-financials";
import {
  UPLOAD_ACCEPT,
  UPLOAD_FORMATS_LABEL,
  fileToText,
  isPdfFile,
  isSpreadsheetFile,
  isTextFile,
} from "@/lib/spreadsheet-text";
import { pdfTransport, unstage, type PdfTransport } from "@/lib/staged-upload-browser";
import { UploadVisibilityChoice } from "@/components/upload-visibility-choice";
import { OwnerUploadsPanel } from "@/components/owner-uploads-panel";
import { archiveUploads, describeArchiveFailures } from "@/lib/client-documents-browser";
import { DEFAULT_UPLOAD_VISIBILITY, type UploadVisibility } from "@/lib/client-documents";
import { QboConnectCard } from "@/components/qbo-connect";
import { XeroConnectCard } from "@/components/xero-connect";
import { SageConnectCard } from "@/components/sage-connect";
import { Button } from "@/components/ui/button";
import { HEALTH_RING_CAPTION, SphereHero } from "@/components/sphere-hero";
import { buildSpherePillars } from "@/components/sphere-hero-adapter";
import { useViewMode } from "@/contexts/view-mode";
import { listClientReviewSignoffs, indexReviewSignoffs } from "@/lib/review-signoffs.functions";
import type { ClientReviewSignoff, ReviewScope } from "@/lib/review-signoffs.functions";
import { computeIsStale } from "@/components/review-signoff";
import { healthSignoffIsStale } from "@/lib/signoff-status";
import { OwnerSignoffMark } from "@/components/owner-signoff-mark";
import { OwnerPageHead } from "@/components/owner-ui";
import {
  currentPeriodDate,
  currentPeriodLabel,
  upsertCurrentPeriodSnapshot,
  upsertPeriodSnapshot,
} from "@/lib/financial-snapshots";
import { buildRatioSeries, needsPastPeriodPrompt } from "@/lib/history-coverage";
import { AddPastPeriodLink } from "@/components/add-past-period-link";
import { PastPeriodUploadDialog } from "@/components/past-period-upload";
import { stampFromSignoff } from "@/lib/review-signoff-stamp";
import { useAskAiMount } from "@/hooks/use-ask-ai-mount";
import {
  computeCashTrajectory,
  computeHealthBand,
  computeNextMoveImpactLabel,
  computeOverviewCaption,
  computePositionPercentile,
  computeWeekChanges,
} from "@/lib/overview-insights";
import { pageHead, SEO_PAGES } from "@/lib/seo";
import { bindShellBackstop, bootSelect } from "@/lib/boot-read";
import { isOwnerDeliverablesRequest, ownerDeliverablesRedirectTarget } from "@/lib/owner-nav";

function AppBootSpinner() {
  return <OwnerBootSkeleton />;
}

export const Route = createFileRoute("/app")({
  // /app uses browser auth + localStorage. SSR of this tree was throwing
  // "This page didn't load" on first paint (signed-out visit and post-login).
  ssr: false,
  // ?tab= lets Next Step emails / links (P0.3 routes) land on a board tab.
  // qbo / xero / reason must survive too: the OAuth callback lands here, and
  // dropping them makes a finished connect look like it never returned.
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    tab?: string;
    qbo?: string;
    xero?: string;
    reason?: string;
    view?: "chart" | "table" | "13week";
    bot?: "financial_manager" | "analyst" | "advisor";
    bots?: "row" | "stack";
    screen?: "settings" | "accountant" | "plan";
    section?: "signed";
    checkout?: "success" | "cancel";
    draft?: string;
  } => {
    const out: {
      tab?: string;
      qbo?: string;
      xero?: string;
      reason?: string;
      view?: "chart" | "table" | "13week";
      bot?: "financial_manager" | "analyst" | "advisor";
      bots?: "row" | "stack";
      screen?: "settings" | "accountant" | "plan";
      section?: "signed";
      checkout?: "success" | "cancel";
      draft?: string;
    } = {};
    if (
      typeof search.tab === "string" &&
      ((OWNER_BOARD_TABS as readonly string[]).includes(search.tab) ||
        isOwnerAppTab(search.tab))
    ) {
      out.tab = search.tab;
    }
    if (search.qbo === "connected" || search.qbo === "error") out.qbo = search.qbo;
    if (search.xero === "connected" || search.xero === "error") out.xero = search.xero;
    if (
      typeof search.reason === "string" &&
      search.reason.length > 0 &&
      search.reason.length <= 180
    ) {
      out.reason = search.reason;
    }
    if (search.view === "table" || search.view === "chart" || search.view === "13week") {
      out.view = search.view;
    }
    if (
      search.bot === "financial_manager" ||
      search.bot === "analyst" ||
      search.bot === "advisor"
    ) {
      out.bot = search.bot;
    }
    if (search.bots === "row" || search.bots === "stack") out.bots = search.bots;
    const rawScreen = typeof search.screen === "string" ? search.screen : null;
    const rawTab = typeof search.tab === "string" ? search.tab : null;
    const rawSection = typeof search.section === "string" ? search.section : null;
    if (
      isOwnerDeliverablesRequest({
        pathname: "/app",
        screen: rawScreen,
        tab: rawTab,
        section: rawSection,
      })
    ) {
      out.screen = "accountant";
      out.section = "signed";
    } else if (rawScreen === "settings" || rawScreen === "plan") {
      out.screen = rawScreen;
    } else if (rawScreen === "accountant") {
      out.screen = "accountant";
      if (rawSection === "signed") out.section = "signed";
    }
    if (search.checkout === "success" || search.checkout === "cancel") {
      out.checkout = search.checkout;
    }
    if (typeof search.draft === "string" && /^[0-9a-f-]{36}$/i.test(search.draft)) {
      out.draft = search.draft;
    }
    return out;
  },
  beforeLoad: ({ location }) => {
    const search =
      location.searchStr.startsWith("?") || location.searchStr === ""
        ? location.searchStr
        : `?${location.searchStr}`;
    const target = ownerDeliverablesRedirectTarget(
      `https://milonfinance.com${location.pathname}${search}`,
    );
    if (!target) return;
    throw redirect({ href: target, replace: true });
  },
  pendingComponent: AppBootSpinner,
  component: function AppRoute() {
    return (
      <ClientOnly fallback={<AppBootSpinner />}>
        <Index />
      </ClientOnly>
    );
  },
  head: () => {
    const seo = pageHead(SEO_PAGES.app);
    return { ...seo, links: [...seo.links, ...founderPortalLinks] };
  },
});

type Inputs = {
  netIncome: string;
  ebt: string;
  ebit: string;
  revenue: string;
  totalAssets: string;
  equity: string;
  /** "1" when equity was plugged from assets − liabilities. */
  equityDerived?: string;
  cogs: string;
  receivables: string;
  inventory: string;
  payables: string;
  fixedCosts: string;
  variableCosts: string;
  top5Revenue: string;
  laborCost: string;
  employees: string;
  operatingCashflow: string;
  ebitda: string;
  founderHours: string;
  priorRevenue: string;
  currentAssets: string;
  currentLiabilities: string;
  capex: string;
  ppeGross: string;
  accumulatedDepreciation: string;
  priorPpeGross: string;
  priorAccumDep: string;
  /** Balance-sheet cash. Empty until a statement or the forecast supplies it. */
  cash: string;
  /** Months the P&L figures cover (1–12); absent = 12. Not a figure, so not in defaults. */
  periodMonths?: string;
  /** "1" when Figures cover was chosen. An unlocked 12 still follows the statement dates. */
  periodMonthsChosen?: string;
  periodStart?: string;
  periodEnd?: string;
  /** Date of the balance-sheet cash line. The Cash tab labels the opening with this. */
  cashAsOf?: string;
  /** JSON scores for Cash, Assets, and Financing held across a P&L-only import. */
  sheetPillarsHeld?: string;
};

// All fields start empty — no demo/placeholder data pre-filled.
// Real values are only set after the user imports or manually enters figures.
// Ratios computed from empty/zero inputs produce NaN/0 which the health-score
// average ignores, so a partial dataset yields an honest partial score.
const defaults: Inputs = {
  netIncome: "",
  ebt: "",
  ebit: "",
  revenue: "",
  totalAssets: "",
  equity: "",
  cogs: "",
  receivables: "",
  inventory: "",
  payables: "",
  fixedCosts: "",
  variableCosts: "",
  top5Revenue: "",
  laborCost: "",
  employees: "",
  operatingCashflow: "",
  ebitda: "",
  founderHours: "",
  priorRevenue: "",
  currentAssets: "",
  currentLiabilities: "",
  capex: "",
  ppeGross: "",
  accumulatedDepreciation: "",
  priorPpeGross: "",
  priorAccumDep: "",
  cash: "",
};

type RatioKey =
  | "taxBurden"
  | "interestBurden"
  | "operatingMargin"
  | "assetTurnover"
  | "equityMultiplier"
  | "netMargin"
  | "roa"
  | "roe"
  | "debtorDays"
  | "inventoryDays"
  | "creditorDays"
  | "workingCapitalDays"
  | "fixedCostRatio"
  | "dol"
  | "customerConcentration"
  | "gpToLabor"
  | "salesPerEmployee"
  | "ocfToEbitda"
  | "revenuePerFounderHour"
  | "grossMargin"
  | "directCostsRatio"
  | "fundingStructure"
  | "workingCapitalUtilization"
  | "fixedCapitalUtilization"
  | "workingCapitalFunding"
  | "revenueGrowth"
  | "capexIntensity"
  | "assetReinvestmentRatio"
  | "currentRatio"
  | "debtToEquity"
  | "debtToAssets";

type RatioMeta = {
  friendly: string;
  techName: string;
  formula: string;
  hint: string;
  icon: string;
  steps: string[]; // 5 strategic moves
  sop: string[]; // up to 5 practical SOP best-practice points
  videoSummary: string; // 5-min video synopsis (placeholder)
};

const RATIO_META: Record<RatioKey, RatioMeta> = {
  taxBurden: {
    friendly: "Tax Survival Rate",
    techName: "Tax Burden",
    formula: "Net Income / EBT",
    hint: "How much profit you keep after the taxman.",
    icon: "🏛️",
    steps: [
      "Claim every legal deduction & R&D credit you qualify for",
      "Time big purchases to fall in high-profit years",
      "Use a tax-efficient business structure (LLC, S-Corp, etc.)",
      "Contribute to retirement / pension plans pre-tax",
      "Hire a proactive tax advisor — not just a filer",
    ],
    sop: [
      "Book a tax-planning call every quarter — not just at year-end",
      "Keep a running 'deductions log' in one spreadsheet",
      "Pre-pay deductible expenses before fiscal year-end",
      "Separate personal and business cards 100%",
      "Run a year-end tax forecast in November every year",
    ],
    videoSummary:
      "Tax Burden 101 — how much of your pre-tax profit you actually keep, why it matters, and 5 legal levers to lower it.",
  },
  interestBurden: {
    friendly: "Debt Drag",
    techName: "Interest Burden",
    formula: "EBT / EBIT",
    hint: "How much profit survives after paying lenders.",
    icon: "⛓️",
    steps: [
      "Refinance high-interest loans at lower rates",
      "Pay down the most expensive debt first (avalanche)",
      "Renegotiate terms with banks once revenue grows",
      "Replace short-term debt with longer fixed-rate loans",
      "Use retained earnings instead of new borrowing",
    ],
    sop: [
      "List every loan with rate, balance, and maturity in one sheet",
      "Auto-direct 10% of monthly profit to highest-rate debt",
      "Re-quote loans annually with 3 banks for competitive offers",
      "Lock fixed rates when central bank rates dip",
      "Never use overdrafts for >30 days — refinance into a term loan",
    ],
    videoSummary:
      "Interest Burden — what % of operating profit lenders eat, and how to claw it back through refinancing and discipline.",
  },
  operatingMargin: {
    friendly: "Profit Power",
    techName: "Operating Margin",
    formula: "EBIT / Revenue",
    hint: "How much each R1 of sales becomes operating profit.",
    icon: "⚔️",
    steps: [
      "Raise prices on your best-selling products",
      "Cut low-margin SKUs and focus on winners",
      "Negotiate better rates with suppliers",
      "Automate manual tasks to lower payroll cost",
      "Reduce overhead: rent, software, subscriptions",
    ],
    sop: [
      "Review price list every 6 months — small 3–5% lifts compound",
      "Run a monthly margin-by-product report; cut bottom 20%",
      "Re-tender top 5 supplier contracts every 12 months",
      "Audit all SaaS subscriptions quarterly — kill unused tools",
      "Tie any new hire to a measurable revenue or savings target",
    ],
    videoSummary:
      "Operating Margin masterclass — the single biggest profitability lever and 5 practical ways to widen it.",
  },
  assetTurnover: {
    friendly: "Asset Engine",
    techName: "Asset Turnover",
    formula: "Revenue / Total Assets",
    hint: "How hard your assets are working to make sales.",
    icon: "⚙️",
    steps: [
      "Sell or lease idle equipment and unused property",
      "Run more shifts on existing machines",
      "Speed up inventory turnover with smaller, frequent orders",
      "Outsource non-core work instead of buying assets",
      "Push marketing to lift sales without adding capacity",
    ],
    sop: [
      "Tag every asset > R1k and record monthly utilisation %",
      "Sell or lease anything under 40% utilisation for 90 days",
      "Schedule equipment for a 2nd shift before buying more",
      "Adopt a 'rent before buy' policy on new capex",
      "Track sales-per-square-foot or per-machine monthly",
    ],
    videoSummary:
      "Asset Turnover — turn dormant assets into cash-generating muscle without raising more capital.",
  },
  equityMultiplier: {
    friendly: "Leverage Level",
    techName: "Equity Multiplier",
    formula: "Total Assets / Equity",
    hint: "How much you rely on debt vs. your own money.",
    icon: "🛡️",
    steps: [
      "Reinvest profits to grow equity organically",
      "Pay down debt to lower the ratio if it's too high",
      "Bring in equity partners instead of more loans",
      "Avoid dividend payouts until leverage is healthy",
      "Match debt maturity to asset life (no short loans on long assets)",
    ],
    sop: [
      "Set a maximum leverage ceiling and write it in the policy doc",
      "Re-test leverage every quarter against that ceiling",
      "Build a 6-month cash buffer before taking new debt",
      "Stress-test debt service at +3% interest rates",
      "Cap dividend payouts at 30% of net profit until ratio is healthy",
    ],
    videoSummary:
      "Equity Multiplier — leverage is rocket fuel, but too much of it explodes in a downturn.",
  },
  netMargin: {
    friendly: "Bottom-Line Strength",
    techName: "Net Margin",
    formula: "Net Income / Revenue",
    hint: "How much of every sale you actually keep.",
    icon: "💰",
    steps: [
      "Increase prices where customers are loyal",
      "Eliminate waste in operations and shipping",
      "Renegotiate recurring expenses annually",
      "Drop unprofitable customers and channels",
      "Track gross margin per product weekly",
    ],
    sop: [
      "Produce a 1-page monthly P&L with prior-month comparison",
      "Set a minimum acceptable net margin per channel",
      "Drop or re-price any customer below that floor",
      "Bonus managers on net margin, not revenue",
      "Review the top 5 cost lines every month for creep",
    ],
    videoSummary:
      "Net Margin — the truest single number of business health, and how to drag it upward.",
  },
  roa: {
    friendly: "Asset Productivity",
    techName: "Return on Assets",
    formula: "Net Margin × Asset Engine",
    hint: "Profit produced per R1 of assets owned.",
    icon: "🏭",
    steps: [
      "Sell underperforming assets",
      "Improve product mix toward higher-margin lines",
      "Reduce inventory sitting on shelves",
      "Use asset-light models (drop-shipping, leasing)",
      "Train staff to get more output per machine-hour",
    ],
    sop: [
      "Quarterly asset audit: keep, fix, sell, redeploy",
      "Maintain a target ROA in your annual plan",
      "Reward operations for output-per-asset improvement",
      "Lease, don't buy, equipment used <60% of the time",
      "Cut SKUs that drag down asset turns",
    ],
    videoSummary: "ROA — the operator's scorecard, blending margin and efficiency into one number.",
  },
  roe: {
    friendly: "Shareholder Return",
    techName: "Return on Equity",
    formula: "Asset Productivity × Leverage Level",
    hint: "What every R1 of your money earns each year.",
    icon: "👑",
    steps: [
      "Raise margins (price, mix, cost control)",
      "Increase sales velocity from current assets",
      "Use measured leverage to amplify returns",
      "Buy back equity when stock/shares are cheap",
      "Reinvest in your highest-ROIC projects only",
    ],
    sop: [
      "Decompose ROE monthly into the 5 DuPont levers",
      "Set a target ROE above your cost of equity",
      "Rank every project by ROIC before funding it",
      "Buy back equity when trading below book value",
      "Never let leverage alone drive ROE — operations must lead",
    ],
    videoSummary:
      "Return on Equity & the 5-step DuPont decomposition — see exactly which lever drives owner returns.",
  },
  debtorDays: {
    friendly: "Customer Pay Speed",
    techName: "Debtor / Receivable Days",
    formula: "AR / Revenue × 365",
    hint: "How long customers take to pay you.",
    icon: "📨",
    steps: [
      "Invoice the same day work is done",
      "Offer 2% discount for paying within 10 days",
      "Charge late fees and enforce them",
      "Require deposits on large orders",
      "Use automated reminders & online payment links",
    ],
    sop: [
      "Send the invoice within 24 hours of delivery — no exceptions",
      "Auto-reminder at days 7, 14, 21 past due",
      "Run a credit check on any customer over R5k order",
      "Phone-call follow-up at day 30 — humans pay humans",
      "Stop further work for any account over 60 days due",
    ],
    videoSummary:
      "Debtor Days — why the #1 cash crunch in SMEs is slow customer payment, and the playbook to fix it.",
  },
  inventoryDays: {
    friendly: "Stock Sitting Time",
    techName: "Inventory Days",
    formula: "Inventory / COGS × 365",
    hint: "How long stock sits before it sells.",
    icon: "📦",
    steps: [
      "Move to just-in-time ordering",
      "Run promos to clear slow movers",
      "Forecast demand with last year's sales data",
      "Drop SKUs that turn over less than 4× a year",
      "Negotiate consignment stock with suppliers",
    ],
    sop: [
      "Categorise inventory ABC by turn rate every month",
      "Set max stock-on-hand by SKU and enforce it",
      "Hold a 90-day clearance event on slow C-grade stock",
      "Reorder only when below the safety-stock threshold",
      "Match supplier MOQs to actual sell-through, not gut feel",
    ],
    videoSummary:
      "Inventory Days — find dead stock fast, free trapped cash, and run a leaner warehouse.",
  },
  creditorDays: {
    friendly: "Supplier Pay Window",
    techName: "Creditor / Payable Days",
    formula: "AP / COGS × 365",
    hint: "How long you take to pay suppliers.",
    icon: "🤝",
    steps: [
      "Negotiate Net-60 or Net-90 terms with key suppliers",
      "Use a business credit card for an extra 30-day float",
      "Consolidate spending with fewer suppliers for leverage",
      "Pay on the last day terms allow — not earlier",
      "Avoid early-pay if no real discount is offered",
    ],
    sop: [
      "Maintain a supplier-terms register with every contract date",
      "Default payment date = the last day of agreed terms",
      "Bundle small suppliers into one bigger contract for leverage",
      "Always benchmark new vendor terms vs. existing ones",
      "Never miss agreed terms — protect your trade reference",
    ],
    videoSummary:
      "Creditor Days — supplier credit is the cheapest financing on earth; here's how to use it without burning trust.",
  },
  workingCapitalDays: {
    friendly: "Cash Trapped Days",
    techName: "Working Capital Days",
    formula: "Customer Pay + Stock Time − Supplier Pay",
    hint: "Days your cash is locked in the business cycle.",
    icon: "💎",
    steps: [
      "Get customers to pay faster (deposits, autopay)",
      "Hold less inventory — order smaller, more often",
      "Stretch supplier payments to the agreed limit",
      "Use invoice financing for short cash gaps",
      "Review your cash conversion cycle every month",
    ],
    sop: [
      "Run the cash-conversion cycle report monthly",
      "Set a target WC-days number in the annual plan",
      "Tie team bonuses partly to WC-days improvement",
      "Always demand 30–50% deposits on big custom orders",
      "Use a credit line only for genuine seasonal swings",
    ],
    videoSummary:
      "Working Capital Days — the #1 silent killer of profitable companies, and the playbook to free your cash.",
  },
  fixedCostRatio: {
    friendly: "Fixed-Cost Burden",
    techName: "Fixed Costs / Revenue",
    formula: "Fixed Costs / Revenue",
    hint: "Share of revenue chewed up before you sell anything.",
    icon: "🏗️",
    steps: [
      "Move fixed contracts to variable / usage-based pricing",
      "Sub-let unused office or warehouse space",
      "Replace permanent hires with fractional / contract roles",
      "Renegotiate lease and insurance every renewal",
      "Lift revenue without adding overhead — scale into the base",
    ],
    sop: [
      "List every fixed cost > R500/month in one register",
      "Mark each as 'truly fixed' or 'fixable' in the next 12 months",
      "Renegotiate or kill 1 fixed line per month",
      "Never sign multi-year leases without an exit clause",
      "Set a fixed-cost-to-revenue ceiling in the annual plan",
    ],
    videoSummary:
      "Fixed Cost Ratio — when overhead becomes anchor, and how to either cut it or out-grow it.",
  },
  dol: {
    friendly: "Downturn Risk",
    techName: "Degree of Operating Leverage",
    formula: "Contribution Margin / EBIT",
    hint: "How much a small sales drop crushes profit. Lower = safer.",
    icon: "⚖️",
    steps: [
      "Convert fixed costs into variable where possible",
      "Build a recurring-revenue base to smooth swings",
      "Hold a 6-month operating cash reserve",
      "Diversify revenue across customer segments",
      "Stress-test profit at −20% revenue every quarter",
    ],
    sop: [
      "Calculate DOL every month — track the trend",
      "Run a downturn drill: model −20% and −40% revenue",
      "Pre-agree which costs cut first and how fast",
      "Convert at least 30% of cost base to variable",
      "Maintain 6 months of fixed-cost cash reserve",
    ],
    videoSummary:
      "Operating Leverage — why fixed costs amplify both wins and losses, and the survival playbook for downturns.",
  },
  customerConcentration: {
    friendly: "Customer Dependency",
    techName: "Top-5 Customer Share",
    formula: "Top 5 Cust. Revenue / Total Revenue",
    hint: "How exposed you are to losing a few key accounts.",
    icon: "🎯",
    steps: [
      "Run a deliberate small-customer acquisition campaign",
      "Cap any single customer at 15% of revenue",
      "Productise services so smaller buyers can self-serve",
      "Diversify into a second industry or geography",
      "Lock big customers into multi-year contracts to reduce loss risk",
    ],
    sop: [
      "Track customer-share monthly in a 1-page report",
      "Set a max-share rule (e.g. no client > 15%)",
      "Run quarterly outreach to add 5+ smaller logos",
      "Sign multi-year contracts with the top 3 accounts",
      "Build a churn-risk early-warning checklist for big accounts",
    ],
    videoSummary:
      "Customer Concentration — the silent killer when one big logo walks; how to measure and reduce dependency.",
  },
  gpToLabor: {
    friendly: "Labor ROI",
    techName: "Gross Profit / Labor Cost",
    formula: "(Revenue − COGS) / Labor Cost",
    hint: "Gross profit produced per R1 of payroll. Higher = leaner team.",
    icon: "💪",
    steps: [
      "Automate repeat tasks to free people for higher-value work",
      "Tie variable pay to gross-profit contribution",
      "Cross-train staff so few people cover more functions",
      "Cut roles that don't directly drive GP",
      "Outsource non-core support functions (admin, IT)",
    ],
    sop: [
      "Calculate GP-per-employee monthly and post it openly",
      "Set a minimum GP-per-employee target by team",
      "Replace low-output roles with automation tools",
      "Bonus 20% of pay tied to team GP improvement",
      "Annual workforce review: keep, train, redeploy, exit",
    ],
    videoSummary:
      "Gross Profit / Labor — the ratio that tells you if your team is paying for itself.",
  },
  salesPerEmployee: {
    friendly: "Sales per Employee",
    techName: "Sales-per-Employee Ratio (SER)",
    formula: "Revenue / Headcount",
    hint: "Top-line revenue every employee carries. Higher = leaner.",
    icon: "🧑‍💼",
    steps: [
      "Use AI / software to extend the output of every employee",
      "Lift average deal size before adding sales heads",
      "Standardise processes so 1 person handles more accounts",
      "Cut departments with low revenue contribution",
      "Hire only when current team is at 90%+ utilisation",
    ],
    sop: [
      "Track revenue-per-employee monthly vs. industry benchmark",
      "Freeze hiring until SER hits the target",
      "Map every role to a measurable revenue or savings line",
      "Invest in tooling before adding the next hire",
      "Run a 90-day onboarding plan with revenue milestones",
    ],
    videoSummary:
      "Sales per Employee — the productivity benchmark that tells you when to hire and when to tool up.",
  },
  ocfToEbitda: {
    friendly: "Cash Quality",
    techName: "Operating Cash Flow / EBITDA",
    formula: "OCF / EBITDA",
    hint: "How much accounting profit actually becomes cash. ~1.0 ideal.",
    icon: "💧",
    steps: [
      "Tighten receivables collection to release trapped cash",
      "Cut inventory to convert stock into bank balance",
      "Stretch payables to the agreed limit",
      "Re-time capex outside peak seasons",
      "Audit revenue recognition — avoid booking 'profit on paper'",
    ],
    sop: [
      "Reconcile cash to EBITDA every month and explain the gap",
      "Set an OCF/EBITDA target of ≥0.85 in the annual plan",
      "Investigate any month where the ratio drops <0.6",
      "Build a 13-week cash-flow forecast and update weekly",
      "Hold a monthly cash huddle with the owner + finance",
    ],
    videoSummary:
      "Operating Cash Flow vs EBITDA — separates real businesses from accounting illusions.",
  },
  revenuePerFounderHour: {
    friendly: "Founder Reliance",
    techName: "Revenue / Founder Hours",
    formula: "Revenue / Founder Operational Hours",
    hint: "Revenue produced per hour the founder works. Higher = less dependent.",
    icon: "🦸",
    steps: [
      "Document every founder-only task into an SOP",
      "Hire or promote a #2 to own daily operations",
      "Replace founder time with software wherever possible",
      "Move founder hours to growth, capital, M&A — not delivery",
      "Set a target founder workweek and enforce it",
    ],
    sop: [
      "Track founder hours weekly in a single timesheet",
      "Identify the top 5 tasks consuming founder time",
      "Build an SOP for each, then delegate or automate",
      "Cap founder operational hours per week (e.g. 25h)",
      "Re-measure revenue-per-founder-hour monthly",
    ],
    videoSummary:
      "Founder Reliance — why the business can't be sold (or scaled) until the founder isn't the engine.",
  },
  grossMargin: {
    friendly: "Gross Profit Margin",
    techName: "Gross Margin",
    formula: "(Revenue − COGS) / Revenue",
    hint: "How much revenue remains after direct production costs.",
    icon: "📊",
    steps: [
      "Raise prices by 3–5% on your top-selling product lines",
      "Renegotiate your top 3 supplier contracts for volume discounts",
      "Eliminate low-margin products that dilute the average",
      "Shift mix toward higher-value, higher-margin offerings",
      "Reduce production waste and material spoilage",
    ],
    sop: [
      "Track gross margin per product line and channel every month",
      "Flag any SKU below your minimum GM floor immediately",
      "Re-cost every product annually against current supplier pricing",
      "Review pricing every 6 months — cost inflation erodes margin silently",
      "Kill or re-price any SKU below the floor for 3 consecutive months",
    ],
    videoSummary:
      "Gross Margin — the foundation of all profitability and the first lever to pull when bottom-line results disappoint.",
  },
  directCostsRatio: {
    friendly: "Direct Cost Burden",
    techName: "COGS Ratio",
    formula: "COGS / Revenue",
    hint: "What fraction of every sale is consumed by direct production costs.",
    icon: "🏗️",
    steps: [
      "Audit and renegotiate your top 5 supplier contracts",
      "Consolidate purchasing across product lines for volume pricing",
      "Reduce wastage and defect rates in production",
      "Substitute materials with cost-equivalent alternatives",
      "Move to direct-manufacturer sourcing and cut intermediaries",
    ],
    sop: [
      "Pull a COGS line-item breakdown every month against budget",
      "Benchmark your COGS ratio against industry peers quarterly",
      "Put every major supplier contract out to re-tender every 18 months",
      "Track production waste as a % of COGS monthly",
      "Set a COGS ceiling as % of revenue and escalate any breach immediately",
    ],
    videoSummary:
      "COGS Ratio — controlling direct costs is the fastest path to widening gross margin without raising prices.",
  },
  fundingStructure: {
    friendly: "Equity Solvency",
    techName: "Equity Ratio",
    formula: "Equity / Total Assets",
    hint: "How much of the business is funded by owners vs creditors.",
    icon: "🏦",
    steps: [
      "Retain more profit instead of drawing dividends until ratio improves",
      "Raise equity capital rather than additional debt",
      "Pay down long-term liabilities from retained earnings",
      "Convert shareholder loans to permanent equity",
      "Avoid new borrowing until equity ratio is above 30%",
    ],
    sop: [
      "Track equity ratio on the balance sheet every month",
      "Set a minimum equity floor (e.g. 30%) and never let it breach",
      "Stress-test the balance sheet at −20% revenue every quarter",
      "Require board approval for any borrowing above a set threshold",
      "Present funding structure to all directors at every board meeting",
    ],
    videoSummary:
      "Funding Structure — the balance between debt and equity determines your resilience and long-term cost of capital.",
  },
  workingCapitalUtilization: {
    friendly: "WC Efficiency",
    techName: "Working Capital Turnover",
    formula: "Revenue / Net Working Capital",
    hint: "How many rands of sales each rand of working capital generates.",
    icon: "🔄",
    steps: [
      "Shorten debtor days — invoice same-day and collect earlier",
      "Reduce inventory levels using tighter demand forecasting",
      "Negotiate extended payment terms with key suppliers",
      "Use invoice financing to unlock receivables immediately",
      "Drop slow-moving stock lines that inflate working capital",
    ],
    sop: [
      "Calculate WC turnover ratio in the monthly management pack",
      "Flag any month-on-month deterioration at the weekly ops meeting",
      "Review the full debtors list every week for accounts over 30 days",
      "Run a monthly WC optimisation meeting with ops and finance leads",
      "Set WC turnover targets in the annual budget by quarter",
    ],
    videoSummary:
      "Working Capital Efficiency — how hard your short-term capital is working, and the daily disciplines that improve it.",
  },
  fixedCapitalUtilization: {
    friendly: "Fixed Asset Productivity",
    techName: "Fixed Asset Turnover",
    formula: "Revenue / Fixed Assets",
    hint: "How efficiently your long-term assets generate revenue.",
    icon: "⚙️",
    steps: [
      "Increase utilisation hours or shifts on existing equipment",
      "Dispose of or lease out assets with low utilisation rates",
      "Drive more revenue from current capacity before buying more assets",
      "Switch from ownership to operating leases for underused assets",
      "Outsource non-core work rather than carrying idle capital",
    ],
    sop: [
      "Track utilisation % for every major fixed asset monthly",
      "Flag any asset below 50% utilisation for 90 consecutive days",
      "Run a fixed asset review at every quarterly board meeting",
      "Enforce a 'rent before buy' policy for all capital expenditure decisions",
      "Calculate revenue per R1 of fixed assets in the monthly management pack",
    ],
    videoSummary:
      "Fixed Asset Productivity — making your plant, equipment and property earn their keep every single month.",
  },
  workingCapitalFunding: {
    friendly: "WC Funding Intensity",
    techName: "WC-to-Revenue",
    formula: "(Debtors + Inventory − Creditors) / Revenue",
    hint: "How much working capital is tied up per rand of revenue earned.",
    icon: "💧",
    steps: [
      "Reduce debtor days — invoice faster and collect more aggressively",
      "Slim inventory to 20–30 days cover maximum",
      "Extend creditor days within supplier relationship limits",
      "Use supply-chain financing to defer payables without relationship risk",
      "Factor debtors to release trapped cash quickly during tight periods",
    ],
    sop: [
      "Calculate WC/Revenue monthly and compare to prior month and budget",
      "Hold weekly debtor collection calls during any period of cash pressure",
      "Set maximum inventory cover targets by product category",
      "Negotiate 45–60 day terms with all strategic suppliers",
      "Alert the CFO if WC funding intensity exceeds 25% of monthly revenue",
    ],
    videoSummary:
      "WC Funding Intensity — the hidden cash drain inside your balance sheet that grows as revenue grows.",
  },
  revenueGrowth: {
    friendly: "Revenue Momentum",
    techName: "Revenue Growth Rate",
    formula: "(Revenue − Prior Revenue) / Prior Revenue",
    hint: "Are sales growing faster than costs and peers?",
    icon: "📈",
    steps: [
      "Set a quarterly revenue target and track weekly progress",
      "Identify your top 3 growth levers (price, volume, mix) and test one per quarter",
      "Re-activate dormant customers with a targeted winback campaign",
      "Upsell existing clients to higher-margin product tiers",
      "Open one adjacent market or geography per 12 months",
    ],
    sop: [
      "Track revenue weekly vs. same week last year in a visible dashboard",
      "Hold a monthly 30-min revenue review with the full commercial team",
      "Maintain a pipeline CRM — flag deals stalling beyond 45 days",
      "Survey churned customers quarterly to uncover fixable reasons",
      "Price-test a 5% increase on one SKU each quarter",
    ],
    videoSummary:
      "Revenue Growth Rate — why momentum matters more than absolute size, and the five moves that compound growth fastest.",
  },
  capexIntensity: {
    friendly: "Growth Investment",
    techName: "Capex Intensity",
    formula: "Capital Expenditure / Revenue",
    hint: "How much of each rand of revenue is ploughed back into assets?",
    icon: "🏗️",
    steps: [
      "Benchmark capex ratio against your sector before every major purchase",
      "Prioritise revenue-generating capex over maintenance capex",
      "Use lease/finance arrangements to spread capex over asset life",
      "Sell or dispose of idle assets to free capital",
      "Review every purchase >R50k in a formal capex approval process",
    ],
    sop: [
      "Maintain a 12-month capex forecast updated quarterly",
      "Require a payback-period calculation for every capex > R25k",
      "Separate maintenance capex from growth capex in the ledger",
      "Compare capex/revenue monthly to prior year and budget",
      "Conduct a post-implementation review 12 months after each major capex",
    ],
    videoSummary:
      "Capex Intensity — how to tell when you're under-investing in growth vs. over-spending on assets.",
  },
  assetReinvestmentRatio: {
    friendly: "Asset Reinvestment",
    techName: "Asset Reinvestment Ratio",
    formula: "Capex / Depreciation",
    hint: "Below 1× you're consuming assets; above 1× you're expanding them.",
    icon: "🔄",
    steps: [
      "Aim for a ratio >1× in growth phases to outpace asset wear",
      "In mature phases hold ratio near 1× to sustain capacity",
      "Prioritise reinvestment in your highest-return asset classes",
      "Use depreciation charges as a minimum reinvestment trigger",
      "Review the ratio before any dividend or owner-draw decision",
    ],
    sop: [
      "Calculate capex/depreciation each quarter alongside the income statement",
      "Flag to the board if ratio falls below 0.7× for two consecutive quarters",
      "Tie capex budgets to depreciation charges as a floor",
      "Segment ratio by asset class (plant, vehicles, IT) for better insight",
      "Include ratio in annual bank covenant reporting pack",
    ],
    videoSummary:
      "Asset Reinvestment Ratio — the ratio that tells you whether the business is growing, maintaining, or slowly running down its asset base.",
  },
  currentRatio: {
    friendly: "Cash Stability",
    techName: "Current Ratio",
    formula: "Current Assets / Current Liabilities",
    hint: "How easily can the business cover short-term obligations?",
    icon: "💵",
    steps: [
      "Target a current ratio between 1.5× and 3× for healthy liquidity",
      "Reduce short-term debt by refinancing into longer-term facilities",
      "Speed up receivables collection to boost current assets",
      "Negotiate extended supplier terms to reduce current liabilities",
      "Hold a minimum cash reserve equal to 30 days of operating costs",
    ],
    sop: [
      "Calculate current ratio monthly from the balance sheet",
      "Alert the CFO if ratio drops below 1.2× at any month-end",
      "Review aged debtors weekly — remove bad debt from current assets",
      "Keep a 13-week cash flow forecast updated every Friday",
      "Never pay non-urgent creditors early when ratio is below 1.5×",
    ],
    videoSummary:
      "Current Ratio — the single fastest snapshot of short-term financial health, and why anything below 1 is a danger signal.",
  },
  debtToEquity: {
    friendly: "Debt-to-Equity",
    techName: "D/E Ratio",
    formula: "Total Debt / Equity",
    hint: "How much of the business is funded by creditors vs. owners?",
    icon: "🏦",
    steps: [
      "Bring debt-to-equity under the target",
      "Target a D/E below 1× for conservative businesses, below 2× for growth",
      "Redirect free cash flow to debt repayment before paying dividends",
      "Refinance short-term debt into longer-term facilities to reduce pressure",
      "Raise equity via retained earnings or investor capital to rebalance",
      "Avoid new debt while D/E exceeds your sector average",
    ],
    sop: [
      "Calculate D/E from the balance sheet every month-end",
      "Include D/E in bank covenant monitoring — flag breaches immediately",
      "Present D/E trend to the board at every quarterly meeting",
      "Model the impact of each new loan on D/E before signing",
      "Set a target D/E range and make it part of the annual budget",
    ],
    videoSummary:
      "Debt-to-Equity — understanding how leveraged your business is and the 5 levers to bring it back to a safer level.",
  },
  debtToAssets: {
    friendly: "Debt-to-Assets",
    techName: "D/A Ratio",
    formula: "Total Debt / Total Assets",
    hint: "What share of your asset base is financed by borrowed money?",
    icon: "⚖️",
    steps: [
      "Keep D/A below 50% to maintain a buffer for lenders and creditors",
      "Grow equity through retained profits rather than more debt",
      "Dispose of underperforming assets to right-size the denominator",
      "Match asset financing to asset life — long assets with long debt",
      "Use off-balance-sheet leasing only where it improves the ratio meaningfully",
    ],
    sop: [
      "Calculate D/A monthly alongside the balance sheet review",
      "Trigger a debt-reduction plan if D/A exceeds 60% for two quarters",
      "Include D/A in any lender, investor, or M&A due-diligence pack",
      "Segment debt by secured vs. unsecured for a cleaner picture",
      "Review D/A when considering any asset acquisition or disposal",
    ],
    videoSummary:
      "Debt-to-Assets — how creditors view the safety of your balance sheet and what moves shift the needle fastest.",
  },
};

type RiskProfile = "conservative" | "balanced" | "aggressive";

// Each profile retunes the targets used in the health calculations.
// Conservative = stricter on safety (debt, days, margins must be higher).
// Aggressive   = tolerant of leverage and longer cycles in pursuit of growth.
const RISK_TUNING: Record<
  RiskProfile,
  {
    label: string;
    blurb: string;
    chip: string;
    opMarginTarget: number;
    netMarginTarget: number;
    assetTurnoverTarget: number;
    roaTarget: number;
    roeTarget: number;
    leverageMax: number; // equity multiplier ceiling that still scores well
    debtorDaysMax: number;
    inventoryDaysMax: number;
    creditorRange: [number, number];
    wcDaysMax: number;
    taxBurdenFloor: number; // (val-floor)/range
    taxBurdenRange: number;
    interestBurdenFloor: number;
    interestBurdenRange: number;
  }
> = {
  conservative: {
    label: "Conservative",
    blurb: "Low risk · protect cash, minimise debt, prize safety",
    chip: "🛡️",
    opMarginTarget: 0.25,
    netMarginTarget: 0.18,
    assetTurnoverTarget: 1.3,
    roaTarget: 0.12,
    roeTarget: 0.18,
    leverageMax: 2.5,
    debtorDaysMax: 60,
    inventoryDaysMax: 60,
    creditorRange: [30, 50],
    wcDaysMax: 60,
    taxBurdenFloor: 0.35,
    taxBurdenRange: 0.45,
    interestBurdenFloor: 0.5,
    interestBurdenRange: 0.5,
  },
  balanced: {
    label: "Balanced",
    blurb: "Medium risk · steady growth with measured leverage",
    chip: "⚖️",
    opMarginTarget: 0.2,
    netMarginTarget: 0.15,
    assetTurnoverTarget: 1.5,
    roaTarget: 0.1,
    roeTarget: 0.2,
    leverageMax: 4,
    debtorDaysMax: 90,
    inventoryDaysMax: 90,
    creditorRange: [30, 60],
    wcDaysMax: 90,
    taxBurdenFloor: 0.3,
    taxBurdenRange: 0.5,
    interestBurdenFloor: 0.3,
    interestBurdenRange: 0.6,
  },
  aggressive: {
    label: "Aggressive",
    blurb: "High risk · maximum expansion, leverage tolerated",
    chip: "🔥",
    opMarginTarget: 0.15,
    netMarginTarget: 0.1,
    assetTurnoverTarget: 1.8,
    roaTarget: 0.08,
    roeTarget: 0.25,
    leverageMax: 6,
    debtorDaysMax: 120,
    inventoryDaysMax: 120,
    creditorRange: [40, 80],
    wcDaysMax: 120,
    taxBurdenFloor: 0.25,
    taxBurdenRange: 0.55,
    interestBurdenFloor: 0.2,
    interestBurdenRange: 0.7,
  },
};

// =====================================================================
// Business-type → underlying economic model → benchmark adjustments.
// We never use universal SME benchmarks. Each economic model multiplies
// the risk-profile targets so that, e.g., a SaaS company is judged on
// SaaS-like margin/turnover/cash expectations, not retail ones.
// =====================================================================
type EconomicModel =
  | "service"
  | "product"
  | "saas"
  | "marketplace"
  | "asset_heavy"
  | "distribution"
  | "retail"
  | "manufacturing"
  | "project"
  | "franchise"
  | "subscription"
  | "agency"
  | "logistics"
  | "hospitality"
  | "healthcare"
  | "construction"
  | "hybrid";

type ModelTuning = {
  // Multipliers applied to RISK_TUNING targets. 1 = no change.
  opMargin: number;
  netMargin: number;
  assetTurnover: number;
  roa: number;
  roe: number;
  leverageMax: number;
  debtorDaysMax: number;
  inventoryDaysMax: number;
  creditorMax: number;
  wcDaysMax: number;
  // For new ratios:
  fcrMax: number;
  dolMax: number;
  ccMax: number;
  gplMin: number;
  speMin: number;
  ocf: number;
  rphMin: number;
  // Narrative
  note: string;
};

const MODEL_TUNING: Record<EconomicModel, ModelTuning> = {
  // High-margin, asset-light, fast cash → expect strong margins, low inventory.
  service: {
    opMargin: 1.1,
    netMargin: 1.1,
    assetTurnover: 1.3,
    roa: 1.3,
    roe: 1.1,
    leverageMax: 0.7,
    debtorDaysMax: 1.0,
    inventoryDaysMax: 0.2,
    creditorMax: 0.8,
    wcDaysMax: 0.7,
    fcrMax: 1.1,
    dolMax: 1.0,
    ccMax: 0.9,
    gplMin: 1.2,
    speMin: 1.2,
    ocf: 1.0,
    rphMin: 1.2,
    note: "Asset-light, people-driven. Strong margin, low inventory, low leverage tolerated.",
  },
  product: {
    opMargin: 0.85,
    netMargin: 0.85,
    assetTurnover: 1.0,
    roa: 1.0,
    roe: 1.0,
    leverageMax: 1.1,
    debtorDaysMax: 1.0,
    inventoryDaysMax: 1.2,
    creditorMax: 1.1,
    wcDaysMax: 1.1,
    fcrMax: 1.0,
    dolMax: 1.1,
    ccMax: 1.0,
    gplMin: 1.0,
    speMin: 1.0,
    ocf: 0.95,
    rphMin: 1.0,
    note: "Inventory and COGS-heavy. Margins thinner, working-capital cycle longer.",
  },
  saas: {
    opMargin: 1.4,
    netMargin: 1.4,
    assetTurnover: 0.8,
    roa: 1.2,
    roe: 1.3,
    leverageMax: 0.6,
    debtorDaysMax: 0.6,
    inventoryDaysMax: 0.05,
    creditorMax: 0.7,
    wcDaysMax: 0.4,
    fcrMax: 1.3,
    dolMax: 1.4,
    ccMax: 0.8,
    gplMin: 1.4,
    speMin: 1.5,
    ocf: 1.1,
    rphMin: 1.4,
    note: "Recurring revenue, high gross margin, high fixed costs. Cash-strong at scale.",
  },
  marketplace: {
    opMargin: 0.9,
    netMargin: 0.9,
    assetTurnover: 1.6,
    roa: 1.2,
    roe: 1.2,
    leverageMax: 0.7,
    debtorDaysMax: 0.5,
    inventoryDaysMax: 0.1,
    creditorMax: 0.7,
    wcDaysMax: 0.4,
    fcrMax: 1.2,
    dolMax: 1.3,
    ccMax: 0.7,
    gplMin: 1.3,
    speMin: 1.6,
    ocf: 1.0,
    rphMin: 1.3,
    note: "Take-rate model. Asset-light but margins compressed by both sides of the platform.",
  },
  asset_heavy: {
    opMargin: 0.9,
    netMargin: 0.85,
    assetTurnover: 0.5,
    roa: 0.6,
    roe: 0.9,
    leverageMax: 1.5,
    debtorDaysMax: 1.1,
    inventoryDaysMax: 1.1,
    creditorMax: 1.2,
    wcDaysMax: 1.2,
    fcrMax: 1.4,
    dolMax: 1.6,
    ccMax: 1.0,
    gplMin: 0.8,
    speMin: 0.8,
    ocf: 0.9,
    rphMin: 0.9,
    note: "Capital-intensive. Lower asset turnover, higher leverage, longer cycles are normal.",
  },
  distribution: {
    opMargin: 0.45,
    netMargin: 0.45,
    assetTurnover: 1.8,
    roa: 1.0,
    roe: 1.1,
    leverageMax: 1.2,
    debtorDaysMax: 1.1,
    inventoryDaysMax: 1.2,
    creditorMax: 1.2,
    wcDaysMax: 1.2,
    fcrMax: 0.9,
    dolMax: 0.9,
    ccMax: 1.1,
    gplMin: 0.9,
    speMin: 1.3,
    ocf: 0.95,
    rphMin: 1.0,
    note: "Thin margin, high turnover. Volume game; tight working-capital control critical.",
  },
  retail: {
    opMargin: 0.6,
    netMargin: 0.6,
    assetTurnover: 1.5,
    roa: 1.0,
    roe: 1.0,
    leverageMax: 1.2,
    debtorDaysMax: 0.4,
    inventoryDaysMax: 1.3,
    creditorMax: 1.1,
    wcDaysMax: 1.0,
    fcrMax: 1.1,
    dolMax: 1.2,
    ccMax: 0.9,
    gplMin: 1.0,
    speMin: 1.1,
    ocf: 1.0,
    rphMin: 1.0,
    note: "Cash-on-sale but inventory-heavy. Stock turn drives the business.",
  },
  manufacturing: {
    opMargin: 0.75,
    netMargin: 0.75,
    assetTurnover: 0.8,
    roa: 0.7,
    roe: 0.9,
    leverageMax: 1.4,
    debtorDaysMax: 1.1,
    inventoryDaysMax: 1.4,
    creditorMax: 1.2,
    wcDaysMax: 1.3,
    fcrMax: 1.4,
    dolMax: 1.5,
    ccMax: 1.0,
    gplMin: 0.9,
    speMin: 0.9,
    ocf: 0.9,
    rphMin: 0.9,
    note: "High fixed costs, long cash cycle. DOL and break-even discipline are critical.",
  },
  project: {
    opMargin: 1.0,
    netMargin: 1.0,
    assetTurnover: 1.0,
    roa: 1.0,
    roe: 1.0,
    leverageMax: 1.0,
    debtorDaysMax: 1.4,
    inventoryDaysMax: 1.3,
    creditorMax: 1.2,
    wcDaysMax: 1.4,
    fcrMax: 1.0,
    dolMax: 1.0,
    ccMax: 1.2,
    gplMin: 1.0,
    speMin: 1.0,
    ocf: 0.85,
    rphMin: 1.0,
    note: "Lumpy revenue, milestone billing. WIP and debtor days dominate cash flow.",
  },
  franchise: {
    opMargin: 0.8,
    netMargin: 0.8,
    assetTurnover: 1.1,
    roa: 0.9,
    roe: 1.1,
    leverageMax: 1.2,
    debtorDaysMax: 0.7,
    inventoryDaysMax: 1.0,
    creditorMax: 1.0,
    wcDaysMax: 0.9,
    fcrMax: 1.2,
    dolMax: 1.2,
    ccMax: 0.9,
    gplMin: 1.0,
    speMin: 1.0,
    ocf: 1.0,
    rphMin: 1.1,
    note: "Standardised playbook, multi-unit. Per-unit benchmarks matter more than aggregate.",
  },
  subscription: {
    opMargin: 1.2,
    netMargin: 1.2,
    assetTurnover: 1.0,
    roa: 1.1,
    roe: 1.2,
    leverageMax: 0.8,
    debtorDaysMax: 0.6,
    inventoryDaysMax: 0.6,
    creditorMax: 0.8,
    wcDaysMax: 0.6,
    fcrMax: 1.2,
    dolMax: 1.3,
    ccMax: 0.8,
    gplMin: 1.2,
    speMin: 1.2,
    ocf: 1.05,
    rphMin: 1.2,
    note: "Predictable recurring revenue. Cash leads profit; churn discipline matters.",
  },
  agency: {
    opMargin: 1.0,
    netMargin: 1.0,
    assetTurnover: 1.3,
    roa: 1.2,
    roe: 1.1,
    leverageMax: 0.7,
    debtorDaysMax: 1.1,
    inventoryDaysMax: 0.1,
    creditorMax: 0.8,
    wcDaysMax: 0.9,
    fcrMax: 1.0,
    dolMax: 1.0,
    ccMax: 0.7,
    gplMin: 1.3,
    speMin: 1.3,
    ocf: 0.95,
    rphMin: 1.2,
    note: "People-driven, project-billed. Customer concentration and utilisation are king.",
  },
  logistics: {
    opMargin: 0.55,
    netMargin: 0.55,
    assetTurnover: 1.2,
    roa: 0.8,
    roe: 1.0,
    leverageMax: 1.4,
    debtorDaysMax: 1.0,
    inventoryDaysMax: 0.5,
    creditorMax: 1.1,
    wcDaysMax: 1.0,
    fcrMax: 1.4,
    dolMax: 1.5,
    ccMax: 1.0,
    gplMin: 0.8,
    speMin: 1.0,
    ocf: 0.9,
    rphMin: 0.9,
    note: "Asset and fuel heavy. Thin margin, high fixed cost, route economics decisive.",
  },
  hospitality: {
    opMargin: 0.7,
    netMargin: 0.6,
    assetTurnover: 0.9,
    roa: 0.7,
    roe: 0.9,
    leverageMax: 1.3,
    debtorDaysMax: 0.3,
    inventoryDaysMax: 0.5,
    creditorMax: 1.1,
    wcDaysMax: 0.7,
    fcrMax: 1.3,
    dolMax: 1.5,
    ccMax: 0.9,
    gplMin: 0.9,
    speMin: 0.7,
    ocf: 0.95,
    rphMin: 0.8,
    note: "Cash-on-sale, perishable inventory. High fixed costs and seasonality dominate.",
  },
  healthcare: {
    opMargin: 1.0,
    netMargin: 0.9,
    assetTurnover: 0.9,
    roa: 0.9,
    roe: 1.0,
    leverageMax: 1.1,
    debtorDaysMax: 1.4,
    inventoryDaysMax: 0.7,
    creditorMax: 1.0,
    wcDaysMax: 1.2,
    fcrMax: 1.3,
    dolMax: 1.3,
    ccMax: 0.9,
    gplMin: 1.0,
    speMin: 1.0,
    ocf: 0.9,
    rphMin: 1.0,
    note: "Insurance/payor cycle drags receivables. Compliance overhead lifts fixed costs.",
  },
  construction: {
    opMargin: 0.6,
    netMargin: 0.55,
    assetTurnover: 1.0,
    roa: 0.7,
    roe: 0.9,
    leverageMax: 1.3,
    debtorDaysMax: 1.5,
    inventoryDaysMax: 1.4,
    creditorMax: 1.3,
    wcDaysMax: 1.5,
    fcrMax: 1.1,
    dolMax: 1.2,
    ccMax: 1.1,
    gplMin: 0.9,
    speMin: 0.9,
    ocf: 0.85,
    rphMin: 0.9,
    note: "Retentions, milestone billing, WIP. Long cash cycle is structural.",
  },
  hybrid: {
    opMargin: 1.0,
    netMargin: 1.0,
    assetTurnover: 1.0,
    roa: 1.0,
    roe: 1.0,
    leverageMax: 1.0,
    debtorDaysMax: 1.0,
    inventoryDaysMax: 1.0,
    creditorMax: 1.0,
    wcDaysMax: 1.0,
    fcrMax: 1.0,
    dolMax: 1.0,
    ccMax: 1.0,
    gplMin: 1.0,
    speMin: 1.0,
    ocf: 1.0,
    rphMin: 1.0,
    note: "Mixed model — neutral baseline. Refine once dominant revenue stream is clear.",
  },
};

type BusinessType = {
  id: string;
  label: string;
  icon: string;
  model: EconomicModel;
  blurb: string;
};

const BUSINESS_TYPES: BusinessType[] = [
  {
    id: "service",
    label: "Service Business",
    icon: "🛠️",
    model: "service",
    blurb: "Sells time, expertise or labor (e.g. cleaning, repair, professional services).",
  },
  {
    id: "product",
    label: "Product Business",
    icon: "📦",
    model: "product",
    blurb: "Designs and sells physical products to end customers or resellers.",
  },
  {
    id: "saas",
    label: "SaaS / Software",
    icon: "💻",
    model: "saas",
    blurb: "Recurring software subscriptions delivered over the internet.",
  },
  {
    id: "marketplace",
    label: "Marketplace",
    icon: "🛍️",
    model: "marketplace",
    blurb: "Connects buyers and sellers, takes a commission per transaction.",
  },
  {
    id: "asset_heavy",
    label: "Asset-Based Business",
    icon: "🏗️",
    model: "asset_heavy",
    blurb: "Income generated from owning and renting assets (real estate, equipment).",
  },
  {
    id: "distribution",
    label: "Distribution / Wholesale",
    icon: "🚚",
    model: "distribution",
    blurb: "Buys in bulk, sells to retailers/businesses on thin margin.",
  },
  {
    id: "retail",
    label: "Retail / Ecommerce",
    icon: "🏬",
    model: "retail",
    blurb: "Sells finished goods directly to consumers in-store or online.",
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    icon: "🏭",
    model: "manufacturing",
    blurb: "Converts raw materials into finished products on owned plant.",
  },
  {
    id: "project",
    label: "Project-Based Business",
    icon: "📐",
    model: "project",
    blurb: "Discrete client projects with milestone billing (e.g. dev shops, AV install).",
  },
  {
    id: "franchise",
    label: "Franchise / Multi-Branch",
    icon: "🏪",
    model: "franchise",
    blurb: "Repeatable unit economics across many physical locations.",
  },
  {
    id: "subscription",
    label: "Subscription Business",
    icon: "🔁",
    model: "subscription",
    blurb: "Recurring physical or service deliveries (boxes, memberships).",
  },
  {
    id: "agency",
    label: "Agency / Consulting",
    icon: "🎩",
    model: "agency",
    blurb: "Sells client engagements billed by retainer or project (creative, consulting).",
  },
  {
    id: "logistics",
    label: "Logistics / Transport",
    icon: "🛻",
    model: "logistics",
    blurb: "Moves goods or people on owned/leased fleet.",
  },
  {
    id: "hospitality",
    label: "Hospitality / Restaurant",
    icon: "🍽️",
    model: "hospitality",
    blurb: "Hotels, restaurants, cafés, venues — cash-on-sale, perishable stock.",
  },
  {
    id: "healthcare",
    label: "Healthcare Practice",
    icon: "🩺",
    model: "healthcare",
    blurb: "Clinics and practices billing patients, insurers or payors.",
  },
  {
    id: "construction",
    label: "Construction / Engineering",
    icon: "🏗️",
    model: "construction",
    blurb: "Site-based builds with retentions, WIP and long cash cycles.",
  },
  {
    id: "hybrid",
    label: "Hybrid Business",
    icon: "🧩",
    model: "hybrid",
    blurb: "Mixed economic model — multiple streams (e.g. product + service + SaaS).",
  },
];

// ─── CSV/Excel flat-extraction → MergedExtractionResult ──────────────────────
// Converts the legacy flat key-value map from extractFinancials into the nested
// MergedExtractionResult shape so CSV/Excel uploads can reuse ExtractionReviewModal.
function flatExtractionToMergedResult(
  financials: Record<string, string>,
  fileName: string,
  meta?: StatementMeta | null,
): import("@/lib/extraction-types").MergedExtractionResult {
  const n = (key: string): number | null => {
    const v = financials[key];
    if (!v) return null;
    const num = parseFloat(v);
    return isFinite(num) ? num : null;
  };
  const kind =
    meta?.kind && meta.kind !== "unknown"
      ? meta.kind
      : n("revenue") != null && n("totalAssets") == null && n("cash") == null
        ? "income_statement"
        : (n("totalAssets") != null || n("cash") != null) && n("revenue") == null
          ? "balance_sheet"
          : "unknown";
  const income = kind !== "balance_sheet";
  const balance = kind !== "income_statement";
  return {
    document_metadata: {
      company_name: meta?.companyName ?? null,
      registration_number: null,
      period_start_date: meta?.periodStart ?? null,
      period_end_date: meta?.periodEnd ?? null,
      period_months: meta?.periodMonths ?? null,
      period_label: meta?.periodLabel ?? null,
      prior_period_start_date: null,
      prior_period_end_date: null,
      document_type: kind === "income_statement" || kind === "balance_sheet" ? kind : "unknown",
      financial_statement_type: "unknown",
      prepared_by: null,
      auditor_firm: null,
      approval_date: null,
      industry_description: null,
      functional_currency: fileCurrencyFromExtraction({ currency: meta?.currency }) ?? "other",
      foreign_currency_exposure: null,
      headcount: n("employees"),
      accounting_basis: "unknown",
      values_appear_in_thousands: false,
      contains_income_statement: income && kind !== "unknown" ? true : kind === "unknown",
      contains_balance_sheet: balance && kind !== "unknown" ? true : kind === "unknown",
      contains_cash_flow_statement: n("operatingCashflow") != null,
      contains_notes: false,
    },
    current_period: {
      income_statement: {
        revenue: income ? n("revenue") : null,
        cogs: income ? n("cogs") : null,
        gross_profit: income ? n("grossProfit") : null,
        other_income: null,
        fixed_costs: income ? n("fixedCosts") : null,
        labor_cost: income ? n("laborCost") : null,
        depreciation: income ? n("depreciation") : null,
        amortisation: null,
        depreciation_amortisation_total: null,
        ebitda: income ? n("ebitda") : null,
        ebit: income ? n("ebit") : null,
        interest_expense: income ? n("interestExpense") : null,
        interest_income: null,
        ebt: income ? n("ebt") : null,
        tax: income ? n("tax") : null,
        net_income: income ? n("netIncome") : null,
        director_remuneration: null,
        dividends_declared: null,
      },
      balance_sheet: {
        total_assets: balance ? n("totalAssets") : null,
        fixed_assets: balance ? n("fixedAssets") : null,
        goodwill: null,
        intangible_assets: null,
        right_of_use_assets: null,
        current_assets: balance ? n("currentAssets") : null,
        inventory: balance ? n("inventory") : null,
        wip: null,
        debtors: balance ? n("receivables") : null,
        provision_bad_debts: null,
        cash: balance ? n("cash") : null,
        other_current_assets: null,
        total_liabilities: balance ? n("totalLiabilities") : null,
        current_liabilities: balance ? n("currentLiabilities") : null,
        creditors: balance ? n("payables") : null,
        short_term_debt: balance ? n("shortTermDebt") : null,
        lease_liabilities_current: null,
        other_current_liabilities: null,
        non_current_liabilities: null,
        long_term_debt: balance ? n("longTermDebt") : null,
        lease_liabilities_non_current: null,
        deferred_tax_liability: null,
        deferred_tax_asset: null,
        equity: balance ? n("equity") : null,
        share_capital: null,
        retained_earnings_opening: null,
        retained_earnings_closing: null,
        shareholder_loans_asset: null,
        shareholder_loans_liability: null,
        contingent_liabilities_notes: null,
      },
      cash_flow_statement: {
        operating_cash_flow: n("operatingCashflow"),
        working_capital_movement_debtors: null,
        working_capital_movement_inventory: null,
        working_capital_movement_creditors: null,
        capex: null,
        asset_disposal_proceeds: null,
        investing_cash_flow: null,
        debt_drawdowns: null,
        debt_repayments: null,
        dividends_paid: null,
        financing_cash_flow: null,
        net_cash_movement: null,
        cash_opening_balance: null,
        cash_closing_balance: null,
      },
    },
    prior_period: {
      revenue: null,
      gross_profit: null,
      net_income: null,
      total_assets: null,
      equity: null,
      cash: null,
      debtors: null,
      inventory: null,
      creditors: null,
      operating_cash_flow: null,
    },
    top_expenses: [],
    top_income_sources: [],
    data_quality: {
      gross_profit_reconciles: null,
      net_income_reconciles: null,
      balance_sheet_balances: null,
      cash_flow_reconciles: null,
      retained_earnings_reconciles: null,
      prior_period_available: false,
      confidence_by_section: {
        income_statement: "medium",
        balance_sheet: "medium",
        cash_flow: "not_found",
        expenses_detail: "not_found",
        income_detail: "not_found",
        notes: "not_found",
      },
      overall_confidence: "medium",
      extraction_notes:
        "Extracted from CSV / Excel using pattern matching and AI. Please verify all values.",
    },
    source_map: {},
    conflicts: [],
    normalisation_applied: false,
    document_count: 1,
    file_names: [fileName],
    derived_fields: (meta?.derived ?? [])
      .map((key) => (key === "ebitda" ? "income_statement.ebitda" : ""))
      .filter((path) => path.length > 0),
  };
}

function Index() {
  const { viewMode, setViewMode } = useViewMode();
  const { user, loading: authLoading, signOut, restoreFailed } = useAuth();
  const { reportOwnerBoardReady } = useOwnerBoardGate();
  const navigate = useNavigate();
  const [ownerBootTimedOut, setOwnerBootTimedOut] = useState(false);
  const [ownerBootAttempt, setOwnerBootAttempt] = useState(0);
  const [criticalBootFailed, setCriticalBootFailed] = useState(false);
  const [workspaceLoadFailed, setWorkspaceLoadFailed] = useState(false);
  const [workspaceMarket, setWorkspaceMarket] = useState<MarketSelection | null>(null);
  const [storedClientMarket, setStoredClientMarket] = useState<unknown>(null);
  const [marketNeedsGate, setMarketNeedsGate] = useState(false);

  // Redirect unauthenticated users to the landing page. After invite accept,
  // React auth state can lag the real Supabase session — don't bounce yet.
  useEffect(() => {
    if (!shouldRedirectToAuth({ loading: authLoading, hasUser: !!user, restoreFailed })) {
      if (user) consumeInviteHandoffFlag();
      return;
    }
    let cancelled = false;
    void (async () => {
      if (hasInviteHandoffFlag()) return;
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session?.user) return;
      navigate({ to: "/" });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, restoreFailed, navigate]);

  // Handle QBO / Xero OAuth callback: ?qbo= / ?xero= connected|error
  const oauthReturn = Route.useSearch();
  useEffect(() => {
    const qbo = oauthReturn.qbo;
    const xero = oauthReturn.xero;
    if (!qbo && !xero) return;
    if (qbo === "connected") {
      toast.success("QuickBooks Online connected — tap Sync to import P&L and balance sheet");
      setShowQboDialog(true);
    } else if (qbo === "error") {
      toast.error(`QuickBooks connection failed: ${oauthReturn.reason ?? "unknown error"}`);
      setShowQboDialog(true);
    }
    if (xero === "connected") {
      toast.success("Xero connected — tap Sync to import P&L and balance sheet");
      setShowXeroDialog(true);
    } else if (xero === "error")
      toast.error(`Xero connection failed: ${oauthReturn.reason ?? "unknown error"}`);
    navigate({
      to: "/app",
      search: (prev) => {
        const next = { ...prev };
        delete next.qbo;
        delete next.xero;
        delete next.reason;
        return next;
      },
      replace: true,
    });
  }, [oauthReturn.qbo, oauthReturn.xero, oauthReturn.reason, navigate]);

  const doExtract = useServerFn(extractFinancials);
  const doExtractPdf = useServerFn(extractPDFsWithAI);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [extractionForReview, setExtractionForReview] = useState<MergedExtractionResult | null>(
    null,
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pastPeriodOpen, setPastPeriodOpen] = useState(false);
  const [historyUpload, setHistoryUpload] = useState(false);
  const [replaceLiveOnHistory, setReplaceLiveOnHistory] = useState(false);
  // Extra CSV/Excel-only fields not carried through MergedExtractionResult (applied alongside modal confirm)
  const [pendingCsvExtras, setPendingCsvExtras] = useState<Partial<Inputs> | null>(null);
  const [showInputs, setShowInputs] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Move key to focus in the Action Plan tab (set by Next Moves → Assign)
  const [planFocusKey, setPlanFocusKey] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleResolved, setRoleResolved] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const track = useTrack();
  const [v, setV] = useState<Inputs>(defaults);
  const [weeklyInputs, setWeeklyInputs] = useState<WeeklyInputs>({ weeks: {} });
  const [productMix, setProductMix] = useState<ProductMix>(emptyProductMix);
  const [showFinData, setShowFinData] = useState(false);
  const [planTick, setPlanTick] = useState(0);
  // Owner Home reloads each action row from this event. Hand to flips the card
  // to Working on the click. A run that started before that click does not clear
  // it. The stored run settles it once it is newer than the click, the same read as client Home.
  // Both Homes share one poll. A tick reads a fresh snapshot and keeps going while a run
  // is queued or running, or for about two minutes after a hand-off note if its run has not appeared.
  // Each action keeps its own click. Working follows that action's run id.
  // A queued or running run on a card beats Found something. Same runs as the row.
  useEffect(() => {
    const bump = () => setPlanTick((n) => n + 1);
    window.addEventListener("milon-action-plan-refresh", bump);
    return () => window.removeEventListener("milon-action-plan-refresh", bump);
  }, []);
  const [bankLedgerBlocked, setBankLedgerBlocked] = useState(false);
  const [rejectedBankFile, setRejectedBankFile] = useState<File | null>(null);
  const [pendingCashBankFile, setPendingCashBankFile] = useState<File | null>(null);
  // Per-upload visibility the owner picks in the Financial Data dialog. Every
  // owner upload path (statement, bank pack, cash pack) starts from it, and
  // the drafters keep it in sync when the owner changes it inside them.
  const [uploadVisibility, setUploadVisibility] =
    useState<UploadVisibility>(DEFAULT_UPLOAD_VISIBILITY);
  // Read at upload time by handleStatementUpload; kept in a ref so the
  // callback never captures a stale client or choice.
  const archiveTargetRef = useRef<{ clientId: string | null; visibility: UploadVisibility }>({
    clientId: null,
    visibility: DEFAULT_UPLOAD_VISIBILITY,
  });

  const archiveStatementUpload = useCallback(async (file: File, storagePath?: string) => {
    const { clientId, visibility } = archiveTargetRef.current;
    if (!clientId) return;
    const archived = await archiveUploads({
      clientId,
      visibility,
      source: "financial_statement",
      items: [{ file, storagePath }],
    });
    const problem = describeArchiveFailures(archived);
    if (problem) toast.warning(problem);
  }, []);

  const handleStatementUpload = useCallback(
    async (file: File) => {
      // A bank ledger must be stopped before the size gate and before review,
      // so a short CSV is not waved through as a financial statement.
      const spreadsheetText =
        isTextFile(file) || isSpreadsheetFile(file) ? await fileToText(file) : null;
      if (spreadsheetText != null && looksLikeBankLedger(spreadsheetText)) {
        setRejectedBankFile(file);
        setShowFinData(false);
        setBankLedgerBlocked(true);
        if (uploadRef.current) uploadRef.current.value = "";
        return;
      }
      const pre = preflightUploadFile(file);
      if (pre) {
        toast.error(pre);
        return;
      }
      setUploading(true);
      let staged: PdfTransport | null = null;
      try {
        let payload: { fileName: string; mimeType?: string; text?: string; base64?: string };

        if (spreadsheetText != null) {
          payload = { fileName: file.name, text: spreadsheetText };
        } else if (isPdfFile(file)) {
          staged = await pdfTransport(file);
          const extraction = (await doExtractPdf({
            data: {
              files: [{ ...staged, fileName: file.name }],
              market: selectionPayload(coerceMarketSelection(workspaceMarket)),
              retainStaged: true,
            },
          })) as MergedExtractionResult;
          await archiveStatementUpload(file, staged.storagePath);
          // Open review modal — user confirms before values are applied
          setExtractionForReview(extraction);
          setShowFinData(false);
          setReviewOpen(true);
          return;
        } else {
          toast.error("Unsupported file type. Use PDF, Excel, OpenDocument (.ods) or CSV.");
          return;
        }

        const result = await doExtract({
          data: {
            ...payload,
            market: selectionPayload(coerceMarketSelection(workspaceMarket)),
          },
        });
        const extracted =
          (result as { financials?: Record<string, string>; statement?: StatementMeta })
            ?.financials ?? {};
        const statementMeta = (result as { statement?: StatementMeta }).statement ?? null;
        const filledKeys = Object.keys(extracted);
        if (filledKeys.length === 0) {
          toast.warning(
            "Couldn't extract figures from that file. Try a text-based PDF, an Excel/ODS export, or CSV.",
          );
        } else {
          // Capture fields not surfaced in MergedExtractionResult so they aren't lost
          const csvExtras: Partial<Inputs> = {};
          if (extracted.variableCosts) csvExtras.variableCosts = extracted.variableCosts;
          if (extracted.top5Revenue) csvExtras.top5Revenue = extracted.top5Revenue;
          if (extracted.founderHours) csvExtras.founderHours = extracted.founderHours;
          if (Object.keys(csvExtras).length) setPendingCsvExtras(csvExtras);
          await archiveStatementUpload(file);
          // Open review modal so owner can verify values before they are applied
          const reviewResult = flatExtractionToMergedResult(extracted, file.name, statementMeta);
          setExtractionForReview(reviewResult);
          setShowFinData(false);
          setReviewOpen(true);
        }
      } catch (e) {
        toast.error(`Upload failed: ${(e as Error).message}`);
      } finally {
        setUploading(false);
        if (uploadRef.current) uploadRef.current.value = "";
        await unstage([staged?.storagePath]);
      }
    },
    [doExtract, doExtractPdf, workspaceMarket, archiveStatementUpload],
  );

  const [actingClientId, setActingClientId] = useState<string | null>(null);
  const [actingClientName, setActingClientName] = useState<string | null>(null);

  const [hydratedClientId, setHydratedClientId] = useState<string | null>(null);
  // True only when the DB returned non-null financials — prevents demo defaults from masquerading as real data
  const [hasRealFinancials, setHasRealFinancials] = useState(false);
  const [history, setHistory] = useState<
    Array<{
      period_label: string;
      period_date: string;
      ratios: Record<string, number>;
      source?: string | null;
      financials?: Record<string, unknown> | null;
      created_at?: string | null;
    }>
  >([]);

  const [effectiveClientId, setEffectiveClientId] = useState<string | null>(null);
  const [ownerWorkspaces, setOwnerWorkspaces] = useState<OwnerWorkspace[]>([]);
  archiveTargetRef.current = { clientId: effectiveClientId, visibility: uploadVisibility };
  const [clientLinkResolved, setClientLinkResolved] = useState(false);
  /** Fresh invite accept or metadata-stamped invited workspace — not self-signup. */
  const [invitedOwnerEntry, setInvitedOwnerEntry] = useState(() =>
    typeof window !== "undefined" ? hasInviteHandoffFlag() : false,
  );

  useEffect(() => {
    let cancelled = false;
    setClientLinkResolved(false);
    setWorkspaceLoadFailed(false);
    setCriticalBootFailed(false);
    setOwnerBootTimedOut(false);
    (async () => {
      try {
        if (actingClientId) {
          if (!cancelled) {
            setOwnerWorkspaces([]);
            setEffectiveClientId(actingClientId);
          }
          return;
        }
        const account = user;
        if (!account) {
          if (!cancelled) {
            setOwnerWorkspaces([]);
            setEffectiveClientId(null);
          }
          return;
        }
        // Session user is routing and UI only. Server functions and RLS still verify the JWT.
        const u = { user: account };

        const pendingInvite =
          typeof localStorage !== "undefined"
            ? localStorage.getItem(PENDING_INVITE_CLIENT_KEY)
            : null;
        const metaInvite = (u.user.user_metadata?.invite_client_id as string | null) ?? null;
        const inviteClientId = [pendingInvite, metaInvite].find((v) => isClientUuid(v)) ?? null;

        const giveUp = (retryable: boolean) => {
          if (cancelled) return;
          if (retryable) setCriticalBootFailed(true);
          else setWorkspaceLoadFailed(true);
        };

        const listWorkspaces = async (): Promise<
          { ok: true; workspaces: OwnerWorkspace[] } | { ok: false; retryable: boolean }
        > => {
          const [ownedRes, memRes] = await Promise.all([
            bootSelect(
              (signal) =>
                supabase
                  .from("clients")
                  .select("id, name, firm_id")
                  .eq("owner_user_id", u.user.id)
                  .abortSignal(signal),
              { critical: true },
            ),
            bootSelect(
              (signal) =>
                supabase
                  .from("client_memberships")
                  .select("client_id, role")
                  .eq("user_id", u.user.id)
                  .abortSignal(signal),
              { critical: true },
            ),
          ]);
          if (!ownedRes.ok) return { ok: false, retryable: ownedRes.retryable };
          if (!memRes.ok) return { ok: false, retryable: memRes.retryable };
          if (ownedRes.value.error || memRes.value.error) return { ok: false, retryable: false };
          const owned = ownedRes.value.data;
          const mems = memRes.value.data;
          const ownedRows = (owned ?? []).map((c) => ({
            id: c.id as string,
            name: c.name as string | null,
            firmId: (c.firm_id as string | null) ?? null,
          }));
          const ownedIds = new Set(ownedRows.map((c) => c.id));
          const extraIds = [
            ...new Set(
              (mems ?? [])
                .map((m) => m.client_id as string)
                .filter((id) => id && !ownedIds.has(id)),
            ),
          ];
          const extraNames = new Map<string, string | null>();
          if (extraIds.length) {
            const extraRes = await bootSelect(
              (signal) =>
                supabase.from("clients").select("id, name").in("id", extraIds).abortSignal(signal),
              { critical: true },
            );
            if (!extraRes.ok) return { ok: false, retryable: extraRes.retryable };
            if (extraRes.value.error) return { ok: false, retryable: false };
            for (const row of extraRes.value.data ?? [])
              extraNames.set(row.id as string, row.name as string | null);
          }
          return {
            ok: true,
            workspaces: mergeOwnerWorkspaces(
              ownedRows,
              (mems ?? []).map((m) => ({
                client_id: m.client_id as string,
                role: m.role as string | null,
                name:
                  ownedRows.find((o) => o.id === m.client_id)?.name ??
                  extraNames.get(m.client_id as string) ??
                  null,
              })),
            ),
          };
        };

        const openInvitedClient = async (
          clientId: string,
        ): Promise<{ ok: true; id: string | null } | { ok: false; retryable: boolean }> => {
          const claimed = await bootSelect(
            (signal) =>
              supabase
                .from("clients")
                .select("id")
                .eq("id", clientId)
                .eq("owner_user_id", u.user.id)
                .abortSignal(signal)
                .maybeSingle(),
            { critical: true },
          );
          if (!claimed.ok) return { ok: false, retryable: claimed.retryable };
          if (claimed.value.error) return { ok: false, retryable: false };
          if (claimed.value.data?.id) return { ok: true, id: claimed.value.data.id };
          const existingMem = await bootSelect(
            (signal) =>
              supabase
                .from("client_memberships")
                .select("client_id, role")
                .eq("client_id", clientId)
                .eq("user_id", u.user.id)
                .abortSignal(signal)
                .maybeSingle(),
            { critical: true },
          );
          if (!existingMem.ok) return { ok: false, retryable: existingMem.retryable };
          if (existingMem.value.error) return { ok: false, retryable: false };
          return { ok: true, id: existingMem.value.data?.client_id ?? null };
        };

        const storedClientId = readStoredOwnerClientId(u.user.id);
        const applyWorkspaces = (workspaces: OwnerWorkspace[], preferInvite?: string | null) => {
          const access = decideStoredClientAccess({
            storedClientId,
            workspaces,
          });
          if (access.phase === "revoked") clearStoredOwnerClientId(u.user.id);
          const active = pickActiveOwnerWorkspace({
            workspaces,
            inviteClientId: preferInvite ?? inviteClientId,
            storedClientId: access.phase === "revoked" ? null : storedClientId,
          });
          if (active) writeStoredOwnerClientId(u.user.id, active);
          if (!cancelled) {
            setOwnerWorkspaces(workspaces);
            setEffectiveClientId(active);
          }
        };

        // Shell only until this list returns. Do not point effectiveClientId at
        // the stored id while memberships are still in flight.
        if (!cancelled) {
          setOwnerWorkspaces([]);
          setEffectiveClientId(null);
        }

        const WORKSPACE_LIST_ATTEMPTS = 5;

        // Just-accepted invite: prefer that workspace over any older client
        // this email already owns (existing-account redeem). The older
        // business stays on the list so they can switch back.
        // Retry only a successful empty read. A PostgREST error is not empty.
        if (inviteClientId) {
          const known = await listWorkspaces();
          if (!known.ok) {
            giveUp(known.retryable);
            return;
          }
          if (inviteWorkspaceAlreadyKnown(known.workspaces, inviteClientId)) {
            try {
              localStorage.removeItem(PENDING_INVITE_CLIENT_KEY);
            } catch {
              /* ignore */
            }
            if (!cancelled) setInvitedOwnerEntry(true);
            applyWorkspaces(known.workspaces, inviteClientId);
            return;
          }
          for (let i = 0; i < WORKSPACE_LIST_ATTEMPTS; i++) {
            const opened = await openInvitedClient(inviteClientId);
            if (!opened.ok) {
              giveUp(opened.retryable);
              return;
            }
            if (!opened.id) {
              const step = nextWorkspaceListStep({
                inviting: true,
                outcome: "empty",
                attempt: i,
                maxAttempts: WORKSPACE_LIST_ATTEMPTS,
              });
              if (step === "retry") {
                await new Promise((r) => setTimeout(r, 250));
                continue;
              }
              break;
            }
            const listed = await listWorkspaces();
            if (!listed.ok) {
              giveUp(listed.retryable);
              return;
            }
            const step = nextWorkspaceListStep({
              inviting: true,
              outcome: listed.workspaces.length ? "rows" : "empty",
              attempt: i,
              maxAttempts: WORKSPACE_LIST_ATTEMPTS,
            });
            if (step === "retry") {
              await new Promise((r) => setTimeout(r, 250));
              continue;
            }
            try {
              localStorage.removeItem(PENDING_INVITE_CLIENT_KEY);
            } catch {
              /* ignore */
            }
            if (!cancelled) setInvitedOwnerEntry(true);
            applyWorkspaces(listed.workspaces, opened.id);
            return;
          }
        }

        // No invite: one read. Empty falls through to provision. An error does not.
        {
          const listed = await listWorkspaces();
          if (!listed.ok) {
            giveUp(listed.retryable);
            return;
          }
          const step = nextWorkspaceListStep({
            inviting: false,
            outcome: listed.workspaces.length ? "rows" : "empty",
            attempt: 0,
            maxAttempts: 1,
          });
          if (step === "error") {
            giveUp(false);
            return;
          }
          if (step === "apply") {
            try {
              localStorage.removeItem(PENDING_INVITE_CLIENT_KEY);
            } catch {
              /* ignore */
            }
            applyWorkspaces(listed.workspaces);
            return;
          }
          const access = decideStoredClientAccess({
            storedClientId,
            workspaces: listed.workspaces,
          });
          if (access.phase === "revoked") clearStoredOwnerClientId(u.user.id);
        }

        // 3. Process a pending invite stored after accept (UUID only — never the opaque token).
        if (inviteClientId) {
          // Staff invite / legacy path — membership only. Never upsert client_member
          // over an existing client_owner membership row.
          const existingMemRead = await bootSelect(
            (signal) =>
              supabase
                .from("client_memberships")
                .select("client_id, role")
                .eq("client_id", inviteClientId)
                .eq("user_id", u.user.id)
                .abortSignal(signal)
                .maybeSingle(),
            { critical: true },
          );
          if (!existingMemRead.ok) {
            giveUp(existingMemRead.retryable);
            return;
          }
          if (existingMemRead.value.error) {
            giveUp(false);
            return;
          }
          const existingMem = existingMemRead.value.data;
          if (!existingMem) {
            await supabase
              .from("client_memberships")
              .upsert(
                { client_id: inviteClientId, user_id: u.user.id, role: "client_member" },
                { onConflict: "client_id,user_id" },
              );
          }
          localStorage.removeItem(PENDING_INVITE_CLIENT_KEY);
          const listed = await listWorkspaces();
          if (!listed.ok) {
            giveUp(listed.retryable);
            return;
          }
          if (!cancelled) setInvitedOwnerEntry(true);
          applyWorkspaces(
            listed.workspaces.length
              ? listed.workspaces
              : [
                  {
                    clientId: inviteClientId,
                    name: "Invited business",
                    role: "member",
                  },
                ],
            inviteClientId,
          );
          return;
        }

        // 4. Self-signup with no invite — create a client record from their profile.
        // Uses ensure_own_client() (SECURITY DEFINER RPC) because the direct INSERT
        // RLS policy "clients insert own" does not evaluate correctly via PostgREST
        // for INSERT WITH CHECK in this Supabase project configuration.
        // Never do this while an invite token is still pending — that would mint a
        // blank second client and skip the invited workspace.
        if (pendingInvite && !isClientUuid(pendingInvite)) {
          if (!cancelled) {
            toast.error("We couldn't open the invited workspace yet. Refresh to try again.");
            setOwnerWorkspaces([]);
            setEffectiveClientId(null);
          }
          return;
        }
        const meta = u.user.user_metadata as {
          full_name?: string;
          name?: string;
          business_name?: string;
          signup_type?: string;
          firm_name?: string;
        } | null;
        const roleRead = await bootSelect(
          (signal) =>
            supabase.from("user_roles").select("role").eq("user_id", u.user.id).abortSignal(signal),
          { critical: true },
        );
        if (!roleRead.ok) {
          if (roleRead.retryable) {
            giveUp(true);
            return;
          }
        }
        const roleRows = roleRead.ok && !roleRead.value.error ? roleRead.value.data : null;
        const roles = (roleRows ?? []).map((r) => r.role as string);
        const hasPracticeRole = roles.includes("firm_admin") || roles.includes("accountant");
        const isGoogleIdentity =
          u.user.app_metadata?.provider === "google" ||
          (Array.isArray(u.user.identities) &&
            u.user.identities.some((identity) => identity.provider === "google"));
        // A practice signup that has not chosen a location yet has no firm row.
        // Sending them through the owner seat would mint a blank client.
        if (
          accountantWithoutFirm({
            signupType: meta?.signup_type,
            firmName: meta?.firm_name,
            firmCount: (await listUserFirms(u.user.id)).length,
          })
        ) {
          if (!cancelled) navigate({ to: "/auth/callback", replace: true });
          return;
        }
        // Google owner sign-in has no password signup_type until the callback stamps it.
        const shouldProvisionOwner =
          meta?.signup_type === "customer" ||
          Boolean(isGoogleIdentity && !hasPracticeRole && !meta?.firm_name);
        if (shouldProvisionOwner) {
          const clientName =
            meta?.business_name || meta?.full_name || meta?.name || u.user.email || "My Business";
          const visitorMarket = readVisitorMarket();
          const { data: clientId, error: rpcErr } = await withMarketRpcFallback(
            () =>
              supabase.rpc("ensure_own_client", {
                p_name: clientName,
                p_market: visitorMarket,
              }),
            () => supabase.rpc("ensure_own_client", { p_name: clientName }),
          );
          if (!cancelled) {
            if (rpcErr) {
              // Surface the failure so the owner isn't left with a silent blank dashboard.
              // They can refresh to retry; the RPC is idempotent (returns existing record if any).
              console.error("[effectiveClientId] ensure_own_client failed:", rpcErr.message);
              toast.error(
                "We couldn't finish setting up your account. Refresh the page to try again.",
                { duration: 10000 },
              );
            }
            if (clientId) {
              writeStoredOwnerClientId(u.user.id, clientId);
              setOwnerWorkspaces([{ clientId, name: clientName, role: "owner" }]);
            } else {
              setOwnerWorkspaces([]);
            }
            setEffectiveClientId(clientId ?? null);
          }
          return;
        }

        if (!cancelled) {
          setOwnerWorkspaces([]);
          setEffectiveClientId(null);
        }
      } finally {
        if (!cancelled) setClientLinkResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actingClientId, navigate, user?.id, ownerBootAttempt]);

  useEffect(() => {
    if (!effectiveClientId) {
      setHistory([]);
      return;
    }
    supabase
      .from("client_financial_snapshots")
      .select("period_label, period_date, ratios, source, financials, created_at")
      .eq("client_id", effectiveClientId)
      .order("period_date", { ascending: true })
      .limit(24)
      .then(({ data }) => {
        if (data) setHistory(data as never);
      });
  }, [effectiveClientId]);

  const [clientMeta, setClientMeta] = useState<{
    business_type: string | null;
    cash_runway_weeks: number | null;
    cashflow?: SavedCashflowLike | null;
    financials_updated_at?: string | null;
    last_forecast_at?: string | null;
    budget_updated_at?: string | null;
    operating_profile?: ClientOperatingProfile | null;
    /** P1: a firm attached means the accountant seat signs off the advisory pack. */
    firm_id?: string | null;
    is_demo?: boolean | null;
  } | null>(null);
  const [onboardingGateReady, setOnboardingGateReady] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("today");
  // Declared before the client-meta effect: that effect's dependency array
  // reads firstRunStep on every render. A later const is a TDZ crash
  // (ReferenceError: Cannot access 'v'/'V' before initialization) and
  // white-screens /app after sign-in.
  const [businessTypeId, setBusinessTypeId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // Which questions the (non-first-run) profile dialog asks: the six deferred
  // ones after a four-question first run, or all ten on a retake.
  const [profileDialogMode, setProfileDialogMode] = useState<"retake" | "complete">("retake");
  const openProfileDialog = useCallback((mode: "retake" | "complete") => {
    setProfileDialogMode(mode);
    setShowOnboarding(true);
  }, []);
  // firstRunStep: null = not first run (or done); 'pick-type' = must complete profile funnel; 'first-data' = nudge to upload data
  const [firstRunStep, setFirstRunStep] = useState<null | "pick-type" | "first-data">(null);
  const [operatingProfile, setOperatingProfile] = useState<ClientOperatingProfile | null>(null);

  // ?tab= deep link (Next Step routes / emails). Applied whenever it changes;
  // the board otherwise keeps its own tab state.
  const { tab: searchTab } = Route.useSearch();
  useEffect(() => {
    if (searchTab) setActiveTab(searchTab);
  }, [searchTab]);

  // Next Step (P0.4): the card resolves the step; the board performs the CTA.
  const handleNextStepAct = useCallback(
    (step: NextStep, target?: NextStepTarget) => {
      const key = target ?? step.key;
      switch (key) {
        case "profile":
          openProfileDialog(operatingProfile ? "complete" : "retake");
          return;
        case "upload":
        case "restart":
          setFirstRunStep("first-data");
          return;
        default: {
          const tab = nextStepRoute(key, "owner", effectiveClientId ?? "").tab ?? "today";
          setActiveTab(tab);
          window.setTimeout(() => {
            document
              .getElementById("owner-board-tabs")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 80);
        }
      }
    },
    [openProfileDialog, operatingProfile, effectiveClientId],
  );
  const boardMarket = useMemo(
    () => marketForClient({ market: workspaceMarket }),
    [workspaceMarket],
  );
  const ownerCanonicalRatios = useMemo(
    () =>
      numberRatioRecord(
        scorecardRatiosFromFinancials(v as unknown as Record<string, unknown>, {
          fyStartMonth: boardMarket.fyStartMonthDefault,
        }),
      ),
    [v, boardMarket.fyStartMonthDefault],
  );
  const fetchReviewSignoffs = useServerFn(listClientReviewSignoffs);
  const [reviewSignoffs, setReviewSignoffs] = useState<
    Partial<Record<ReviewScope, ClientReviewSignoff>>
  >({});
  const financialsSignoff = reviewSignoffs.financials ?? null;
  const [ownerScoreHistory, setOwnerScoreHistory] = useState<
    { period_date: string; score: number | string | null }[]
  >([]);
  const profitabilitySignoff = reviewSignoffs.profitability ?? null;
  const cashForecastSignoff = reviewSignoffs.cash_forecast ?? null;
  const budgetSignoff = reviewSignoffs.budget ?? null;
  const actionPlanSignoff = reviewSignoffs.action_plan ?? null;
  const advisorySignoff = reviewSignoffs.advisory ?? null;
  useEffect(() => {
    if (!effectiveClientId) {
      setReviewSignoffs({});
      setOwnerScoreHistory([]);
      return;
    }
    fetchReviewSignoffs({ data: { clientId: effectiveClientId } })
      .then(({ signoffs }) => {
        setReviewSignoffs(indexReviewSignoffs(signoffs));
      })
      .catch(() => {
        // Sign-off state is a trust-signal enhancement, never block the dashboard.
      });
    supabase
      .from("client_score_history")
      .select("period_date, score")
      .eq("client_id", effectiveClientId)
      .order("period_date", { ascending: false })
      .limit(24)
      .then(({ data, error }) => {
        if (error) {
          setOwnerScoreHistory([]);
          return;
        }
        setOwnerScoreHistory(
          (data ?? []).map((row) => ({
            period_date: row.period_date,
            score: row.score,
          })),
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveClientId]);
  useEffect(() => {
    if (!effectiveClientId) {
      setClientMeta(null);
      setOnboardingGateReady(false);
      return;
    }
    // Role decides whether the profile funnel opens. Wait so we do not paint
    // the empty board and then swap to the funnel a moment later.
    if (!roleResolved) return;
    let cancelled = false;
    const loadMeta = async () => {
      const fullSelect =
        "business_type, cash_runway_weeks, cashflow, financials_updated_at, last_forecast_at, budget_updated_at, operating_profile, financial_year_start_month, market, firm_id, is_demo";
      const legacySelect =
        "business_type, cash_runway_weeks, cashflow, financials_updated_at, last_forecast_at, budget_updated_at, operating_profile, financial_year_start_month, firm_id, is_demo";
      const full = await bootSelect(
        (signal) =>
          supabase
            .from("clients")
            .select(fullSelect)
            .eq("id", effectiveClientId)
            .abortSignal(signal)
            .maybeSingle(),
        { critical: true },
      );
      if (!full.ok) {
        if (!cancelled) {
          setCriticalBootFailed(true);
          setOnboardingGateReady(false);
        }
        return;
      }
      let res = full.value;
      let marketColumnMissing = false;
      if (res.error && isMissingMarketSupport(res.error)) {
        marketColumnMissing = true;
        const legacy = await bootSelect(
          (signal) =>
            supabase
              .from("clients")
              .select(legacySelect)
              .eq("id", effectiveClientId)
              .abortSignal(signal)
              .maybeSingle(),
          { critical: true },
        );
        if (!legacy.ok) {
          if (!cancelled) {
            setCriticalBootFailed(true);
            setOnboardingGateReady(false);
          }
          return;
        }
        res = legacy.value;
      }
      if (cancelled) return;
      try {
        const data = res.data as {
          business_type: string | null;
          cash_runway_weeks: number | null;
          cashflow?: SavedCashflowLike | null;
          financials_updated_at: string | null;
          last_forecast_at: string | null;
          budget_updated_at: string | null;
          operating_profile?: unknown;
          financial_year_start_month?: number | null;
          market?: unknown;
          firm_id?: string | null;
          is_demo?: boolean | null;
        } | null;
        const profile = parseOperatingProfile(data?.operating_profile);
        const parsedMarket = parseMarketSelection(data?.market);
        setStoredClientMarket(marketColumnMissing ? null : (data?.market ?? null));
        if (!marketColumnMissing && data && data.market == null && res.error == null) {
          setMarketNeedsGate(true);
          setWorkspaceMarket(null);
        } else {
          setMarketNeedsGate(false);
          setWorkspaceMarket(parsedMarket ?? coerceMarketSelection(data?.market ?? null));
        }
        setClientMeta(
          data
            ? {
                business_type: data.business_type,
                cash_runway_weeks: data.cash_runway_weeks,
                cashflow: data.cashflow ?? null,
                financials_updated_at: data.financials_updated_at,
                last_forecast_at: data.last_forecast_at,
                budget_updated_at: data.budget_updated_at,
                operating_profile: profile,
                firm_id: data.firm_id ?? null,
                is_demo: Boolean(data.is_demo),
              }
            : null,
        );
        if (profile) {
          setOperatingProfile(profile);
          setBusinessTypeId(profile.businessTypeId);
        } else if (
          shouldShowOwnerProfileFunnel({
            hasOperatingProfile: false,
            actingClientId,
            userRole,
            isInvitedOwnerWithFigures: isInvitedOwnerWithFigures({
              isInvitedOwner: invitedOwnerEntry,
              hasRealFinancials,
              financialsUpdatedAt: data?.financials_updated_at,
            }),
          }) &&
          firstRunStep === null
        ) {
          if (data?.business_type) setBusinessTypeId(data.business_type as string);
          setFirstRunStep("pick-type");
          setShowOnboarding(!ownerProfileDeferred(effectiveClientId));
        } else if (data?.business_type) {
          setBusinessTypeId(data.business_type as string);
        }
      } catch (err) {
        console.warn("[founder] client meta fetch failed:", err);
        if (!cancelled) setClientMeta(null);
      } finally {
        if (!cancelled) setOnboardingGateReady(true);
      }
    };
    void loadMeta();
    return () => {
      cancelled = true;
    };
  }, [
    effectiveClientId,
    userRole,
    actingClientId,
    firstRunStep,
    roleResolved,
    invitedOwnerEntry,
    hasRealFinancials,
    ownerBootAttempt,
  ]);

  // Returning invite accept: user_metadata still points at the invited workspace.
  useEffect(() => {
    if (!effectiveClientId || invitedOwnerEntry) return;
    const metaInvite = (user?.user_metadata?.invite_client_id as string | null) ?? null;
    if (isClientUuid(metaInvite) && metaInvite === effectiveClientId) {
      setInvitedOwnerEntry(true);
    }
  }, [effectiveClientId, invitedOwnerEntry, user]);

  // Settings → Business profile deep-link
  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (sessionStorage.getItem("milon_open_profile") !== "1") return;
    sessionStorage.removeItem("milon_open_profile");
    openProfileDialog("retake");
  }, [openProfileDialog]);

  const switchOwnerWorkspace = useCallback(
    (clientId: string) => {
      if (!user?.id || clientId === effectiveClientId) return;
      if (!canOpenOwnerWorkspace(ownerWorkspaces, clientId)) return;
      writeStoredOwnerClientId(user.id, clientId);
      setReviewOpen(false);
      setExtractionForReview(null);
      setShowFinData(false);
      setShowOnboarding(false);
      setFirstRunStep(null);
      setInvitedOwnerEntry(false);
      setHydratedClientId(null);
      setEffectiveClientId(clientId);
    },
    [user?.id, effectiveClientId, ownerWorkspaces],
  );

  // Resolve the app role only after the client link settles. A freshly
  // confirmed self-signup has no user_roles row until ensure_own_client runs
  // in the client-link effect; resolving in parallel used to land on
  // userRole=null, which silently skipped the profile funnel and started the
  // feature tour on an empty board.
  useEffect(() => {
    if (!clientLinkResolved) return;
    let cancelled = false;
    setRoleResolved(false);
    const account = user;
    void (async () => {
      try {
        if (!account) return;
        const u = account;
        const activeWs = ownerWorkspaces.find((w) => w.clientId === effectiveClientId);
        if (!actingClientId && activeWs) {
          setUserRole(boardRoleForWorkspace(activeWs.role));
          return;
        }
        const { summarizeRoles, ownerBoardRole, peekForcePortal, getPortalIntent } =
          await import("@/lib/user-roles");
        const listed = await bootSelect(
          (signal) =>
            supabase.from("user_roles").select("role").eq("user_id", u.id).abortSignal(signal),
          { critical: true },
        );
        if (cancelled) return;
        if (!listed.ok) {
          setCriticalBootFailed(true);
          return;
        }
        if (listed.value.error) {
          console.warn("[user-roles] list failed", listed.value.error.message);
        }
        const roles = (listed.value.error ? [] : (listed.value.data ?? []))
          .map((row) => row.role)
          .filter(
            (role): role is "accountant" | "firm_admin" | "client_owner" | "client_member" =>
              role === "accountant" ||
              role === "firm_admin" ||
              role === "client_owner" ||
              role === "client_member",
          );
        const portal = summarizeRoles(roles);
        const boardRole = ownerBoardRole({
          roles: portal.roles,
          force: peekForcePortal(),
          intent: getPortalIntent(),
        });
        if (boardRole) {
          setUserRole(boardRole);
          return;
        }

        // Fallback for existing users who predate the role-normalisation migration:
        // infer the app role from ownership / membership tables.
        const owned = await bootSelect(
          (signal) =>
            supabase
              .from("clients")
              .select("id, firm_id")
              .eq("owner_user_id", u.id)
              .limit(20)
              .abortSignal(signal),
          { critical: true },
        );
        if (cancelled) return;
        if (!owned.ok) {
          setCriticalBootFailed(true);
          return;
        }
        const memRead = await bootSelect(
          (signal) =>
            supabase
              .from("client_memberships")
              .select("client_id, role")
              .eq("user_id", u.id)
              .limit(20)
              .abortSignal(signal),
          { critical: true },
        );
        if (cancelled) return;
        if (!memRead.ok) {
          setCriticalBootFailed(true);
          return;
        }
        // Infer only. Do not write user_roles — RLS removed authenticated INSERT.
        // On a firm file, owner_user_id is the accountant who added the client.
        const ownedRows = owned.value.error ? [] : (owned.value.data ?? []);
        const memberships = memRead.value.error ? [] : (memRead.value.data ?? []);
        const inferred = fallbackOwnerAppRole({
          hasSelfServeOwned: ownedRows.some((row) => !row.firm_id),
          membershipRoles: memberships.map((row) => row.role),
        });
        if (inferred) setUserRole(inferred);
      } finally {
        if (!cancelled) setRoleResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // ownerBootAttempt is Retry. The client-link effect also restarts, but a
    // link that is already resolved can stay true, so a role-only hang would
    // not run again unless this effect lists the attempt.
  }, [user?.id, clientLinkResolved, effectiveClientId, ownerWorkspaces, actingClientId, ownerBootAttempt]);

  useEffect(() => {
    if (user) {
      track("tab_viewed", {
        tab: activeTab,
        surface: "owner_app",
        clientId: effectiveClientId,
        path: "/app",
      });
    }
  }, [activeTab, effectiveClientId, track, user]);

  const seriesFor = (k: RatioKey, live?: number): number[] => {
    const snapKey = RATIO_KEY_TO_SNAPSHOT[k];
    if (!snapKey) return [];
    return buildRatioSeries(history, snapKey, live);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    setActingClientId(sessionStorage.getItem("acting_as_client_id"));
    setActingClientName(sessionStorage.getItem("acting_as_client_name"));
  }, []);

  // Keys that indicate real user-entered financials (excludes weeklyInputs, productMix, and other metadata)
  const FINANCIAL_INPUT_KEYS = Object.keys(defaults) as (keyof Inputs)[];

  // Guards against the autosave effect firing the instant hydration finishes —
  // otherwise merely opening the dashboard bumps financials_updated_at and
  // falsely invalidates an accountant's sign-off with no real data change.
  const skipNextFinancialsAutosave = useRef(false);
  const ownerWriteGen = useRef(0);

  // Load financials for whoever is the effective client (owner or impersonation)
  useEffect(() => {
    if (!effectiveClientId) return;
    const clientId = effectiveClientId;
    let cancelled = false;
    setHasRealFinancials(false); // reset on client switch until confirmed
    setV(defaults); // reset inputs so no previous client's data bleeds through
    setWeeklyInputs({ weeks: {} });
    setProductMix(emptyProductMix());
    void (async () => {
      const read = await bootSelect(
        (signal) =>
          supabase
            .from("clients")
            .select("financials")
            .eq("id", clientId)
            .abortSignal(signal)
            .maybeSingle(),
        { critical: true },
      );
      if (cancelled) return;
      if (!read.ok) {
        setCriticalBootFailed(true);
        return;
      }
      const data = read.value.error ? null : read.value.data;
      try {
        if (data?.financials) {
          const fin = data.financials as Partial<Inputs> & {
            weeklyInputs?: WeeklyInputs;
            productMix?: unknown;
          };
          // Only treat as real data if at least one recognised financial key is present and non-empty.
          // Empty objects ({}) or objects containing only weeklyInputs do not qualify.
          const hasRealKeys = FINANCIAL_INPUT_KEYS.some(
            (k) => fin[k] !== undefined && fin[k] !== "",
          );
          // Hydrate weeks even when period P&L keys are absent so the waterfall
          // matches the accountant portal (which reads the same weeklyInputs blob).
          if (fin.weeklyInputs) {
            setWeeklyInputs(parseWeeklyInputs(fin.weeklyInputs));
            skipNextFinancialsAutosave.current = true;
          }
          if (fin.productMix) {
            setProductMix(parseProductMix(fin.productMix));
            skipNextFinancialsAutosave.current = true;
          }
          if (hasRealKeys) {
            const plugged = readTimeEquity(fin as Record<string, unknown>);
            setV({
              ...defaults,
              ...fin,
              ...(plugged.derived ? { equity: plugged.equity, equityDerived: "1" } : {}),
            });
            setHasRealFinancials(true);
            // Only arm the skip flag when hydration actually populated real data —
            // that's the only case where the autosave effect will run right after
            // hydration. Arming it unconditionally leaves a stale flag that
            // swallows the FIRST genuine save on an empty client (e.g. figures
            // applied from the bank-statement drafter would never persist).
            skipNextFinancialsAutosave.current = true;
          }
          // else: keep defaults + hasRealFinancials=false (unscored empty state)
        }
      } catch {
        /* a settled row still opens the board; a hang does not */
      }
      if (!cancelled) setHydratedClientId(clientId);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveClientId, ownerBootAttempt]);

  // Debounced autosave — fires for both owners and firm impersonation.
  // Period P&L is gated on hasRealFinancials so demo defaults are never written.
  // Weekly inputs still persist (merged onto the existing blob) so the
  // accountant waterfall can read the same weeks the owner just typed.
  useEffect(() => {
    if (!effectiveClientId || hydratedClientId !== effectiveClientId) return;
    if (skipNextFinancialsAutosave.current) {
      skipNextFinancialsAutosave.current = false;
      return;
    }
    if (!hasRealFinancials && !hasWeeklyActivity(weeklyInputs) && !hasProductMixAnswer(productMix))
      return;
    setSaveStatus("saving");
    const gen = ownerWriteGen.current;
    const t = setTimeout(async () => {
      if (gen !== ownerWriteGen.current) return;
      const financialsUpdatedAt = new Date().toISOString();
      const { data: row } = await supabase
        .from("clients")
        .select("financials")
        .eq("id", effectiveClientId)
        .maybeSingle();
      if (gen !== ownerWriteGen.current) return;
      const serverFinancials = (row?.financials as Record<string, unknown> | null) ?? null;
      const seenRev = financialsWriteRev(serverFinancials);
      let blob: Record<string, unknown>;
      if (hasRealFinancials) {
        blob = autosaveKeepsLedgerSync(serverFinancials, { ...v, weeklyInputs, productMix });
      } else {
        blob = overlayProductMix(
          overlayWeeklyInputs(serverFinancials ?? {}, weeklyInputs),
          productMix,
        );
      }
      if (gen !== ownerWriteGen.current) return;
      const pending = guardFinancialsWrite(
        supabase
          .from("clients")
          .update({
            financials: blob as never,
            financials_updated_at: financialsUpdatedAt,
          })
          .eq("id", effectiveClientId),
        seenRev,
      );
      const { data: updated, error } = await pending.select("id");
      if (gen !== ownerWriteGen.current) {
        setSaveStatus("idle");
      } else if (error) {
        toast.error(`Save failed: ${error.message}`);
        setSaveStatus("idle");
      } else if (!updated?.length) {
        const { data: again } = await supabase
          .from("clients")
          .select("financials")
          .eq("id", effectiveClientId)
          .maybeSingle();
        if (!financialsWriteSuperseded(seenRev, again?.financials)) {
          // RLS silently rejects writes that fail the policy — 0 rows returned means
          // the update was blocked (no owner_user_id match or missing client record).
          toast.error(
            "Save failed: your changes were not written to the database. Please refresh and try again.",
          );
        }
        setSaveStatus("idle");
      } else {
        setClientMeta((m) => (m ? { ...m, financials_updated_at: financialsUpdatedAt } : m));
        // G20: upsert this month's snapshot so deliveries / movement aren't snapshot-less.
        void upsertCurrentPeriodSnapshot({
          clientId: effectiveClientId,
          financials: blob,
          source: "autosave",
        }).then(({ id }) => {
          if (id) {
            const periodLabel = currentPeriodLabel();
            const periodDate = currentPeriodDate();
            const ratios = computeRatios(blob as never);
            setHistory((h) => {
              const next = { period_label: periodLabel, period_date: periodDate, ratios };
              const idx = h.findIndex(
                (s) => s.period_label === periodLabel || s.period_date === periodDate, // date-ok: snapshot identity match, not printed copy
              );
              if (idx >= 0) {
                const copy = h.slice();
                copy[idx] = { ...copy[idx], ...next };
                return copy;
              }
              return [...h, next].slice(-24);
            });
          }
        });
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2500);
      }
    }, 700);
    return () => clearTimeout(t);
  }, [v, weeklyInputs, productMix, effectiveClientId, hydratedClientId, hasRealFinancials]);

  useAskAiMount({
    effectiveClientId,
    activeTab,
    viewMode,
    hasRealFinancials,
    forecastKey: forecastPlFingerprint(clientMeta?.cashflow, v),
  });

  const exitImpersonation = async () => {
    if (actingClientId && user?.id) {
      const { data: rows } = await supabase
        .from("impersonation_audit")
        .select("id")
        .eq("firm_user_id", user.id)
        .eq("client_id", actingClientId)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1);
      if (rows?.[0]) {
        await supabase
          .from("impersonation_audit")
          .update({ ended_at: new Date().toISOString() })
          .eq("id", rows[0].id);
      }
    }
    sessionStorage.removeItem("acting_as_client_id");
    sessionStorage.removeItem("acting_as_client_name");
    navigate({ to: "/dashboard" });
  };

  const [openRatio, setOpenRatio] = useState<RatioKey | null>(null);
  const [openSop, setOpenSop] = useState<RatioKey | null>(null);
  const [doneSteps, setDoneSteps] = useState<Set<RatioKey>>(new Set());
  const toggleDone = (k: RatioKey) =>
    setDoneSteps((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const [risk, setRisk] = useState<RiskProfile>("balanced");

  const [benchmarks, setBenchmarks] = useState<Record<string, Benchmark>>({});
  useEffect(() => {
    const bt = benchmarkBusinessType(businessTypeId);
    if (!bt) {
      setBenchmarks({});
      return;
    }
    supabase
      .from("industry_benchmarks")
      .select("metric_key, p25, p50, p75, unit, higher_is_better")
      .eq("business_type", bt)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, Benchmark> = {};
        for (const r of data) {
          map[r.metric_key] = {
            p25: Number(r.p25),
            p50: Number(r.p50),
            p75: Number(r.p75),
            unit: r.unit,
            higher_is_better: r.higher_is_better,
          };
        }
        setBenchmarks(map);
      });
  }, [businessTypeId]);

  const benchmarkFor = (k: RatioKey): Benchmark | null => {
    const b = benchmarks[k] ?? null;
    if (!b) return null;
    if (!canShowIndustryMedian(boardMarket, { metricKey: k, unit: b.unit })) return null;
    return b;
  };
  const [btSaving, setBtSaving] = useState(false);
  const [btSaveError, setBtSaveError] = useState<string | null>(null);
  const [showQboDialog, setShowQboDialog] = useState(false);
  const [showXeroDialog, setShowXeroDialog] = useState(false);
  const [showSageDialog, setShowSageDialog] = useState(false);
  const [showBankDrafter, setShowBankDrafter] = useState(false);
  const [showCashFromBanks, setShowCashFromBanks] = useState(false);
  const [bankCashDraft, setBankCashDraft] = useState<
    import("@/lib/cash-from-banks.types").CashFromBanksDraftResult | null
  >(null);
  const [cashForecastReloadToken, setCashForecastReloadToken] = useState(0);
  const [budgetReloadToken, setBudgetReloadToken] = useState(0);
  // First-upload vs remembered checkboxes for the upload dialogs; reloaded
  // after every upload so the second one shows checkboxes, not the notice.
  const [autoPopulateState, setAutoPopulateState] = useState<AutoPopulateState | null>(null);
  const refreshAutoPopulateState = useCallback(async () => {
    if (!effectiveClientId) {
      setAutoPopulateState(null);
      return;
    }
    try {
      setAutoPopulateState(await loadAutoPopulateState(effectiveClientId));
    } catch (e) {
      console.warn("auto-populate state:", e);
    }
  }, [effectiveClientId]);
  useEffect(() => {
    void refreshAutoPopulateState();
  }, [refreshAutoPopulateState]);
  const applyAutoPopulateResult = useCallback(
    (r: Awaited<ReturnType<typeof runAutoPopulate>>) => {
      const now = new Date().toISOString();
      setClientMeta((m) =>
        m
          ? {
              ...m,
              ...(r.applied.includes("profitability") ? { financials_updated_at: now } : {}),
              ...(r.applied.includes("cash_forecast")
                ? {
                    last_forecast_at: now,
                    cashflow: (r.cashflow as never) ?? m.cashflow,
                    ...(r.runwayWeeks != null ? { cash_runway_weeks: r.runwayWeeks } : {}),
                  }
                : {}),
              ...(r.applied.includes("budget") ? { budget_updated_at: now } : {}),
            }
          : m,
      );
      if (r.applied.includes("cash_forecast")) setCashForecastReloadToken((n) => n + 1);
      if (r.applied.includes("budget")) setBudgetReloadToken((n) => n + 1);
      track("upload_auto_populated", {
        surface: "owner_app",
        clientId: effectiveClientId,
        firstUpload: r.firstUpload,
        applied: r.applied.join(","),
      });
      toast.success(summariseAutoPopulate(r, r.firstUpload), { duration: 7000 });
      void refreshAutoPopulateState();
    },
    [effectiveClientId, refreshAutoPopulateState, track],
  );
  const [existingCashflowForBanks, setExistingCashflowForBanks] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const businessType = businessTypeId
    ? (BUSINESS_TYPES.find((b) => b.id === businessTypeId) ?? null)
    : null;
  const model: ModelTuning = businessType ? MODEL_TUNING[businessType.model] : MODEL_TUNING.hybrid;
  const industryLabel = clientIndustryDisplay(
    actingClientName,
    operatingProfile,
    businessTypeId ?? businessType?.label ?? null,
  ) || profileIndustryLabel(operatingProfile, businessType?.label ?? "General SME");
  // Marks real financials so autosave and the scored view activate after first user edit
  const markRealFinancials = () => setHasRealFinancials(true);
  const set = (k: keyof Inputs) => (val: string) => {
    setV((s) => ({ ...s, [k]: val, ...(k === "equity" ? { equityDerived: "" } : {}) }));
    markRealFinancials();
  };

  // ── Sample business ─────────────────────────────────────────────────────
  // Lets a first-time owner see a scored board before uploading anything.
  // Sample figures live only in `v`; autosave stays gated on hasRealFinancials
  // so nothing is written, and any route to real figures drops the sample first.
  const [sampleMode, setSampleMode] = useState(false);
  const showScoredBoard = hasRealFinancials || sampleMode;
  // Bumped by the recommendations panel after a decision / action so the
  // Next Step card re-resolves without a reload.
  const [advisoryBump, setAdvisoryBump] = useState(0);
  const skipInvitedSetupChrome = useMemo(
    () =>
      isInvitedOwnerWithFigures({
        isInvitedOwner: invitedOwnerEntry,
        hasRealFinancials,
        financialsUpdatedAt: clientMeta?.financials_updated_at,
      }),
    [invitedOwnerEntry, hasRealFinancials, clientMeta?.financials_updated_at],
  );
  const [ownerFirstUploadHandled, setOwnerFirstUploadHandled] = useState(false);
  const [generationTrialOpen, setGenerationTrialOpen] = useState(false);
  useEffect(() => {
    if (!effectiveClientId) {
      setOwnerFirstUploadHandled(false);
      return;
    }
    setOwnerFirstUploadHandled(hasOwnerFirstUploadHandled(effectiveClientId));
  }, [effectiveClientId]);
  // After the first upload the board is scored and Profit / Cash / Budget are
  // auto-drafted (#175). Clear the bring-in-your-numbers chrome, but leave
  // OWNER_TOUR_KEY untouched so the scored tour runs and explains that those
  // deliverables await accountant sign-off.
  const clearFirstRunAfterUpload = useMemo(
    () =>
      shouldClearFirstRunAfterFirstUpload({
        isInvitedOwner: invitedOwnerEntry,
        isInvitedOwnerWithFigures: skipInvitedSetupChrome,
        firstUploadHandled: ownerFirstUploadHandled,
      }),
    [invitedOwnerEntry, skipInvitedSetupChrome, ownerFirstUploadHandled],
  );
  const handleOwnerFirstRealFinancialsUpload = useCallback(async () => {
    if (
      !shouldAutoProposeAfterFirstUpload({
        isInvitedOwner: invitedOwnerEntry,
        firstUploadHandled: ownerFirstUploadHandled,
        clientId: effectiveClientId,
        actingAsClient: Boolean(actingClientId),
      })
    ) {
      return;
    }
    if (!effectiveClientId) return;
    markOwnerFirstUploadHandled(effectiveClientId);
    setOwnerFirstUploadHandled(true);
    try {
      await invokeBrainPropose(effectiveClientId);
    } catch (e) {
      if (isStarterTrialEndedMessage(messageFromUnknown(e))) {
        setGenerationTrialOpen(true);
        return;
      }
      console.warn("[owner first upload] brain propose failed:", e);
    }
  }, [actingClientId, effectiveClientId, invitedOwnerEntry, ownerFirstUploadHandled]);
  useEffect(() => {
    const onTrialEnded = () => setGenerationTrialOpen(true);
    window.addEventListener("milon-starter-trial-ended", onTrialEnded);
    return () => window.removeEventListener("milon-starter-trial-ended", onTrialEnded);
  }, []);
  useEffect(() => {
    if (!skipInvitedSetupChrome) return;
    markOnboardingDone(OWNER_TOUR_KEY);
    if (firstRunStep === "pick-type") {
      setFirstRunStep(null);
      setShowOnboarding(false);
    } else if (firstRunStep === "first-data") {
      setFirstRunStep(null);
    }
  }, [skipInvitedSetupChrome, firstRunStep]);
  useEffect(() => {
    if (!clearFirstRunAfterUpload) return;
    if (firstRunStep === "pick-type") {
      setFirstRunStep(null);
      setShowOnboarding(false);
    } else if (firstRunStep === "first-data") {
      setFirstRunStep(null);
    }
  }, [clearFirstRunAfterUpload, firstRunStep]);
  const enterSampleMode = useCallback(() => {
    setV({ ...defaults, ...sampleFinancialsFor(boardMarket.country) } as Inputs);
    setSampleMode(true);
    setFirstRunStep(null);
    setActiveTab("today");
    track("sample_board_opened", { surface: "owner_app", market: boardMarket.country });
  }, [boardMarket.country, track]);
  const exitSampleMode = useCallback(() => {
    setSampleMode(false);
    setV(defaults);
  }, []);
  useEffect(() => {
    if (!sampleMode) return;
    // Real figures arriving, or any figures-entry surface opening, ends the sample.
    if (
      hasRealFinancials ||
      showFinData ||
      showBankDrafter ||
      showQboDialog ||
      showXeroDialog ||
      showSageDialog ||
      showCashFromBanks ||
      reviewOpen
    ) {
      setSampleMode(false);
      if (!hasRealFinancials) setV(defaults);
    }
  }, [
    sampleMode,
    hasRealFinancials,
    showFinData,
    showBankDrafter,
    showQboDialog,
    showXeroDialog,
    showSageDialog,
    showCashFromBanks,
    reviewOpen,
  ]);
  useEffect(() => {
    setSampleMode(false);
  }, [effectiveClientId]);

  const fyStartMonth = operatingProfile?.fyStartMonth ?? boardMarket.fyStartMonthDefault;
  const ownerProfitPeriod = useMemo(
    () => fiscalWaterfallFallback(v as unknown as Record<string, unknown>, fyStartMonth),
    [v, fyStartMonth],
  );
  const ownerWaterfallFallback =
    ownerProfitPeriod?.fallback ??
    derivePeriodWaterfallFallback(v as unknown as Record<string, unknown>);
  const ownerProfitPeriodLabel =
    ownerProfitPeriod?.slice.label ?? readStatementMeta(v, boardMarket).periodLabel;
  const coveredMonths = effectivePeriodMonths(v as unknown as Record<string, unknown>, {
    fyStartMonth,
  });
  const ratioSource = useMemo(
    () => ({ ...v, periodMonths: String(coveredMonths) }),
    [v, coveredMonths],
  );
  const n = useMemo(() => {
    const num = (s: string) => (s === "" ? 0 : parseFloat(s) || 0);
    // Flow figures scaled to 12 months (same rule as computeRatios) so a
    // quarter of actuals does not read as a small year.
    const av = annualiseFinancials(ratioSource);
    return {
      netIncome: num(av.netIncome),
      ebt: num(av.ebt),
      ebit: num(av.ebit),
      revenue: num(av.revenue),
      totalAssets: num(av.totalAssets),
      equity: num(av.equity),
      cogs: num(av.cogs),
      receivables: num(av.receivables),
      inventory: num(av.inventory),
      payables: num(av.payables),
      fixedCosts: num(av.fixedCosts),
      variableCosts: num(av.variableCosts),
      top5Revenue: num(av.top5Revenue),
      laborCost: num(av.laborCost),
      employees: num(av.employees),
      operatingCashflow: num(av.operatingCashflow),
      ebitda: num(av.ebitda),
      founderHours: num(av.founderHours),
      priorRevenue: num(av.priorRevenue),
      currentAssets: num(av.currentAssets),
      currentLiabilities: num(av.currentLiabilities),
      capex: num(av.capex),
      ppeGross: num(av.ppeGross),
      accumulatedDepreciation: num(av.accumulatedDepreciation),
      priorPpeGross: num(av.priorPpeGross),
      priorAccumDep: num(av.priorAccumDep),
      totalLiabilities: (() => {
        const raw = String((av as { totalLiabilities?: string }).totalLiabilities ?? "").trim();
        if (!raw) return Number.NaN;
        const parsed = parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : Number.NaN;
      })(),
    };
  }, [ratioSource]);

  const safe = (a: number, b: number) => (b === 0 ? 0 : a / b);

  const computedRatios = useMemo(
    () =>
      withCanonicalDebtorCreditorDays(
        computeRatios(ratioSource),
        v as unknown as Record<string, unknown>,
      ),
    [ratioSource, v],
  );

  const taxBurden = computedRatios["Tax Burden"];
  const interestBurden = computedRatios["Interest Burden"];
  const operatingMargin = computedRatios["Operating Margin"];
  const assetTurnover = computedRatios["Asset Turnover"];
  const equityMultiplier = computedRatios["Equity Multiplier"];
  const netMargin = computedRatios["Net Margin"];
  const roa = computedRatios["Return on Assets"];
  const roe = computedRatios["Return on Equity"];
  const roeDirect = safe(n.netIncome, n.equity);

  const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
  const hHigher = (val: number, target: number) => clamp((val / target) * 100);
  const hLower = (val: number, max: number) => clamp(((max - val) / max) * 100);
  const hRange = (val: number, lo: number, hi: number) => {
    if (val < lo) return clamp((val / lo) * 100);
    if (val > hi) return clamp(100 - ((val - hi) / hi) * 100);
    return 100;
  };

  const debtorDays = computedRatios["Debtor Days"];
  const inventoryDays = computedRatios["Inventory Days"];
  const creditorDays = computedRatios["Creditor Days"];
  const workingCapitalDays = computedRatios["Working Capital Days"];

  const fixedCostRatio = computedRatios["Fixed Cost Ratio"];
  const contributionMargin = n.revenue - n.variableCosts;
  const dol = computedRatios["Degree of Operating Leverage"];
  const customerConcentration = computedRatios["Top-5 Customer Share"];
  const grossProfit = n.revenue - n.cogs;
  const grossMarginRatioBE = safe(grossProfit, n.revenue);
  const breakevenRevenue = grossMarginRatioBE > 0 ? n.fixedCosts / grossMarginRatioBE : 0;
  const gpToLabor = computedRatios["Gross Profit / Labor"];
  const salesPerEmployee = computedRatios["Sales-per-Employee Ratio"];
  const ocfToEbitda = computedRatios["OCF / EBITDA"];
  const revenuePerFounderHour = safe(n.revenue, n.founderHours);

  // Six new ratios — all derivable from existing inputs, no new form fields needed
  const grossMarginRatio = computedRatios["Gross Margin"];
  const directCostsRatio = safe(n.cogs, n.revenue);
  const wcNet = n.receivables + n.inventory - n.payables;
  const workingCapitalUtilization = safe(n.revenue, Math.max(wcNet, 1));
  const fixedCapitalProxy = Math.max(n.totalAssets - n.receivables - n.inventory, 1);
  const fixedCapitalUtilization = safe(n.revenue, fixedCapitalProxy);
  const fundingStructureRatio = safe(n.equity, n.totalAssets);
  const workingCapitalFunding = safe(wcNet, n.revenue);

  // New ratios — require priorRevenue, currentAssets, currentLiabilities, capex inputs
  const revenueGrowth = n.priorRevenue > 0 ? safe(n.revenue - n.priorRevenue, n.priorRevenue) : NaN;
  const capexIntensity = safe(n.capex, n.revenue);
  const depreciation = Math.max(0, n.ebitda - n.ebit); // EBITDA − EBIT ≈ D&A
  const assetReinvestmentRatio = depreciation > 0 ? safe(n.capex, depreciation) : NaN;
  const currentRatio = currentRatioValue(n.currentAssets, n.currentLiabilities);

  // PPE movement
  const netPpe = n.ppeGross > 0 ? n.ppeGross - n.accumulatedDepreciation : NaN;
  const priorNetPpe = n.priorPpeGross > 0 ? n.priorPpeGross - n.priorAccumDep : NaN;
  const ppeMovement = isFinite(netPpe) && isFinite(priorNetPpe) ? netPpe - priorNetPpe : NaN;
  const impliedCapex = isFinite(ppeMovement) && depreciation > 0 ? ppeMovement + depreciation : NaN;

  const totalDebt = Number.isFinite(n.totalLiabilities)
    ? Math.max(0, n.totalLiabilities)
    : Math.max(0, n.totalAssets - n.equity);
  const debtToEquity = safe(totalDebt, n.equity);
  const debtToAssets = safe(totalDebt, n.totalAssets);

  // Risk tunings for new ratios — same per profile (kept simple).
  const baseNewTargets = {
    conservative: {
      fcrMax: 0.35,
      dolMax: 2,
      ccMax: 0.35,
      gplMin: 3,
      speMin: 250,
      ocfRange: [0.85, 1.2] as [number, number],
      rphMin: 1,
    },
    balanced: {
      fcrMax: 0.45,
      dolMax: 3,
      ccMax: 0.5,
      gplMin: 2.5,
      speMin: 200,
      ocfRange: [0.75, 1.3] as [number, number],
      rphMin: 0.6,
    },
    aggressive: {
      fcrMax: 0.6,
      dolMax: 5,
      ccMax: 0.65,
      gplMin: 2,
      speMin: 150,
      ocfRange: [0.6, 1.5] as [number, number],
      rphMin: 0.4,
    },
  }[risk];

  // Apply business-model multipliers so benchmarks are model-specific, not universal.
  const newTargets = {
    fcrMax: baseNewTargets.fcrMax * model.fcrMax,
    dolMax: baseNewTargets.dolMax * model.dolMax,
    ccMax: baseNewTargets.ccMax * model.ccMax,
    gplMin: baseNewTargets.gplMin * model.gplMin,
    speMin: baseNewTargets.speMin * model.speMin,
    ocfRange: [baseNewTargets.ocfRange[0] * model.ocf, baseNewTargets.ocfRange[1] * model.ocf] as [
      number,
      number,
    ],
    rphMin: baseNewTargets.rphMin * model.rphMin,
  };

  const RBase = RISK_TUNING[risk];
  const R = {
    ...RBase,
    opMarginTarget: RBase.opMarginTarget * model.opMargin,
    netMarginTarget: RBase.netMarginTarget * model.netMargin,
    assetTurnoverTarget: RBase.assetTurnoverTarget * model.assetTurnover,
    roaTarget: RBase.roaTarget * model.roa,
    roeTarget: RBase.roeTarget * model.roe,
    leverageMax: Math.max(1.05, RBase.leverageMax * model.leverageMax),
    debtorDaysMax: RBase.debtorDaysMax * model.debtorDaysMax,
    inventoryDaysMax: RBase.inventoryDaysMax * model.inventoryDaysMax,
    creditorRange: [RBase.creditorRange[0], RBase.creditorRange[1] * model.creditorMax] as [
      number,
      number,
    ],
    wcDaysMax: RBase.wcDaysMax * model.wcDaysMax,
  };

  // Per-ratio scores — shared scoreRatio SSOT (same as accountant client / scorecard).
  // Owner-only extras use scoreRatio aliases; missing inputs stay NaN (never invent 50).
  const inputFilled = (...keys: (keyof Inputs)[]) =>
    keys.every((k) => {
      const s = String(v[k] ?? "").trim();
      return s !== "" && Number.isFinite(parseFloat(s));
    });
  const ssotHealth = healthMapFromRatios(computedRatios as Record<string, number>, boardMarket);
  const healthMap: Record<RatioKey, number> = {
    taxBurden:
      ssotHealth.taxBurden ??
      (isFinite(taxBurden) ? Math.round(scoreRatio("Tax Burden", taxBurden, boardMarket)) : NaN),
    interestBurden:
      ssotHealth.interestBurden ??
      (isFinite(interestBurden)
        ? Math.round(scoreRatio("Interest Burden", interestBurden, boardMarket))
        : NaN),
    operatingMargin: ssotHealth.operatingMargin ?? NaN,
    assetTurnover: ssotHealth.assetTurnover ?? NaN,
    equityMultiplier: ssotHealth.equityMultiplier ?? NaN,
    netMargin: ssotHealth.netMargin ?? NaN,
    roa: ssotHealth.roa ?? NaN,
    roe: ssotHealth.roe ?? NaN,
    debtorDays: ssotHealth.debtorDays ?? NaN,
    inventoryDays: ssotHealth.inventoryDays ?? NaN,
    creditorDays: ssotHealth.creditorDays ?? NaN,
    workingCapitalDays: ssotHealth.workingCapitalDays ?? NaN,
    fixedCostRatio: ssotHealth.fixedCostRatio ?? NaN,
    dol: ssotHealth.dol ?? NaN,
    customerConcentration: ssotHealth.customerConcentration ?? NaN,
    gpToLabor: ssotHealth.gpToLabor ?? NaN,
    salesPerEmployee: ssotHealth.salesPerEmployee ?? NaN,
    ocfToEbitda: ssotHealth.ocfToEbitda ?? NaN,
    revenuePerFounderHour:
      inputFilled("revenue", "founderHours") && isFinite(revenuePerFounderHour)
        ? Math.round(clamp((revenuePerFounderHour / 2500) * 100))
        : NaN,
    grossMargin: ssotHealth.grossMargin ?? NaN,
    directCostsRatio:
      inputFilled("cogs", "revenue") && isFinite(directCostsRatio)
        ? Math.round(clamp(((0.65 - directCostsRatio) / 0.65) * 100))
        : NaN,
    fundingStructure:
      inputFilled("equity", "totalAssets") && isFinite(fundingStructureRatio)
        ? Math.round(clamp((fundingStructureRatio / 0.3) * 100))
        : NaN,
    workingCapitalUtilization:
      inputFilled("revenue", "receivables", "inventory", "payables") &&
      isFinite(workingCapitalUtilization)
        ? Math.round(clamp((workingCapitalUtilization / 2.0) * 100))
        : NaN,
    fixedCapitalUtilization:
      inputFilled("revenue", "totalAssets") && isFinite(fixedCapitalUtilization)
        ? Math.round(clamp((fixedCapitalUtilization / 1.5) * 100))
        : NaN,
    workingCapitalFunding:
      inputFilled("revenue", "receivables", "inventory", "payables") &&
      isFinite(workingCapitalFunding)
        ? Math.round(clamp(((0.25 - workingCapitalFunding) / 0.25) * 100))
        : NaN,
    revenueGrowth:
      inputFilled("revenue", "priorRevenue") && isFinite(revenueGrowth)
        ? Math.round(scoreRatio("Revenue Growth", revenueGrowth, boardMarket))
        : NaN,
    capexIntensity:
      inputFilled("capex", "revenue") && isFinite(capexIntensity)
        ? Math.round(hRange(capexIntensity, 0.02, 0.1))
        : NaN,
    assetReinvestmentRatio: isFinite(assetReinvestmentRatio)
      ? Math.round(hRange(assetReinvestmentRatio, 0.8, 1.5))
      : NaN,
    currentRatio:
      inputFilled("currentAssets", "currentLiabilities") && isFinite(currentRatio)
        ? Math.round(scoreRatio("Current Ratio", currentRatio, boardMarket))
        : NaN,
    debtToEquity:
      inputFilled("totalAssets", "equity") && isFinite(debtToEquity)
        ? Math.round(scoreRatio("Debt-to-Equity", debtToEquity, boardMarket))
        : NaN,
    debtToAssets:
      inputFilled("totalAssets", "equity") && isFinite(debtToAssets)
        ? Math.round(scoreRatio("Debt-to-Assets", debtToAssets, boardMarket))
        : NaN,
  };

  // Overall + pillars — liveHealthFromBooks, the same call as the accountant Health page.
  // Local healthMap above stays for next-steps / sphere drivers; it must not drive the overall.
  const ownerPrior = useMemo(
    () =>
      resolvePriorSnapshot(history, new Date(), {
        periodEnd: v.periodEnd ?? null,
        financials: v as unknown as Record<string, unknown>,
      }),
    [history, v],
  );
  const ownerMetrics = assessClientMetrics({
    financials: v as unknown as Record<string, unknown>,
    cashflow: clientMeta?.cashflow ?? null,
    financialsUpdatedAt: clientMeta?.financials_updated_at ?? null,
    priorFinancials: ownerPrior?.financials ?? null,
    timeZone: boardMarket.timezone,
    fyStartMonth,
  });
  const effectiveRunway =
    ownerMetrics.runway.kind === "weeks" || ownerMetrics.runway.kind === "zero"
      ? ownerMetrics.runway.weeks
      : null;
  const ownerOutlook = ownerMetrics.outlook;
  const openOwnerFm = () => {
    void navigate({
      to: "/app",
      search: (prev) => ({ ...prev, bot: "financial_manager" as const }),
    });
  };
  const cashBalance = ownerMetrics.cash.amount;
  const ownerCashOnFile = cashBalance != null || forecastOpeningIsKnown(clientMeta?.cashflow);
  const ownerEvidence = hasFinancialEvidence({
    financials: v as unknown as Record<string, unknown>,
    cashflow: clientMeta?.cashflow ?? null,
  });
  const ownerOpeningMissing = storedOpeningIsMissing(clientMeta?.cashflow);
  // Same reading as the Financial Manager card. An outlook uses its stored
  // floor. With no outlook, the card's cashflow is included so Health cannot
  // drop the line the card already shows. A missing opening is not cash under
  // the floor, so this line stays off.
  const ownerDoorOutlook =
    ownerEvidence && ownerCashOnFile && cashBalance != null
      ? {
          opening: ownerOutlook.opening,
          closing: ownerOutlook.closing,
          floor: ownerOutlook.floor,
          dipsBelowFloorWeek: ownerOutlook.dipsBelowFloorWeek,
        }
      : null;
  const ownerCashFloorCue =
    cashFloorForHome({
      openingMissing: ownerOpeningMissing,
      cashOnFile: ownerCashOnFile,
      cashOutlook: ownerDoorOutlook,
      cashflow: clientMeta?.cashflow ?? null,
      market: boardMarket,
      money: (amount) => formatMoney(amount, boardMarket),
    })?.healthCue ?? null;
  const grossImplausible = grossMarginLooksImplausible(grossMarginRatio, industryLabel);
  const scoredHealth = liveHealthFromBooks({
    financials: v as unknown as Record<string, unknown>,
    cashflow: clientMeta?.cashflow ?? null,
    financialsUpdatedAt: clientMeta?.financials_updated_at ?? null,
    priorFinancials: ownerPrior?.financials ?? null,
    fyStartMonth,
    market: boardMarket,
    industry: industryLabel,
    timeZone: boardMarket.timezone,
  });
  const overallHealth = ownerEvidence ? scoredHealth : healthWithoutEvidence(scoredHealth);
  const liveScoreSnapshot = healthSnapshotFromBooks({
    health: overallHealth,
    periodLabel: figuresPeriodLabelFrom(v as unknown as object, null, boardMarket),
  });
  const figuresUpdatedAt = latestFiguresStamp(history.map((row) => ({ at: row.created_at, source: row.source })));
  const financialsSignoffStale = healthSignoffIsStale({
    signoff: financialsSignoff,
    dataUpdatedAt: clientMeta?.financials_updated_at ?? null,
    liveHealth: overallHealth.overall,
    scoreHistory: ownerScoreHistory,
  });
  const ownerStatusWord = clientListStatusWord({
    healthLabel: overallHealth.displayLabel,
    healthOverall: overallHealth.overall,
    source: ownerOutlook.source,
    opening: ownerOutlook.opening,
    floor: ownerOutlook.floor,
    dipsBelowFloorWeek: ownerOutlook.dipsBelowFloorWeek,
    totalInflow: ownerOutlook.totalInflow,
    totalOutflow: ownerOutlook.totalOutflow,
    openingMissing: ownerOpeningMissing,
    cashOnFile: ownerCashOnFile,
  });
  const ownerStatusCritical = ownerStatusWord.startsWith("Critical");
  const ownerCashBelowFloor = cashOutlookIsCritical({
    opening: ownerOutlook.opening,
    floor: ownerOutlook.floor,
    dipsBelowFloorWeek: ownerOutlook.dipsBelowFloorWeek,
    openingMissing: ownerOpeningMissing,
    cashOnFile: ownerCashOnFile,
  });
  const pillarById = Object.fromEntries(
    overallHealth.pillars.map((p) => [p.id, p.score ?? NaN]),
  ) as Record<"profit" | "assets" | "financing" | "cash", number>;
  const pillarHealths = {
    profit: pillarById.profit,
    assets: pillarById.assets,
    financing: pillarById.financing,
    cash: pillarById.cash,
  };
  const pillarStatus = {
    profit: overallHealth.pillars.find((p) => p.id === "profit")?.status,
    assets: overallHealth.pillars.find((p) => p.id === "assets")?.status,
    financing: overallHealth.pillars.find((p) => p.id === "financing")?.status,
    cash: overallHealth.pillars.find((p) => p.id === "cash")?.status,
  };
  const avgHealth = overallHealth.overall ?? NaN;

  const valueMap: Record<RatioKey, { value: number | null; format: "x" | "pct" | "days" | "money" }> = {
    taxBurden: { value: taxBurden, format: "x" },
    interestBurden: { value: interestBurden, format: "x" },
    operatingMargin: { value: operatingMargin, format: "pct" },
    assetTurnover: { value: assetTurnover, format: "x" },
    equityMultiplier: { value: equityMultiplier, format: "x" },
    netMargin: { value: netMargin, format: "pct" },
    roa: { value: roa, format: "pct" },
    roe: { value: roe, format: "pct" },
    debtorDays: { value: debtorDays, format: "days" },
    inventoryDays: { value: inventoryDays, format: "days" },
    creditorDays: { value: creditorDays, format: "days" },
    workingCapitalDays: { value: workingCapitalDays, format: "days" },
    fixedCostRatio: { value: fixedCostRatio, format: "pct" },
    dol: { value: dol, format: "x" },
    customerConcentration: { value: customerConcentration, format: "pct" },
    gpToLabor: { value: gpToLabor, format: "x" },
    salesPerEmployee: { value: salesPerEmployee, format: "money" },
    ocfToEbitda: { value: ocfToEbitda, format: "x" },
    revenuePerFounderHour: { value: revenuePerFounderHour, format: "money" },
    grossMargin: { value: grossMarginRatio, format: "pct" },
    directCostsRatio: { value: directCostsRatio, format: "pct" },
    fundingStructure: { value: fundingStructureRatio, format: "pct" },
    workingCapitalUtilization: { value: workingCapitalUtilization, format: "x" },
    fixedCapitalUtilization: { value: fixedCapitalUtilization, format: "x" },
    workingCapitalFunding: { value: workingCapitalFunding, format: "pct" },
    revenueGrowth: { value: revenueGrowth, format: "pct" },
    capexIntensity: { value: capexIntensity, format: "pct" },
    assetReinvestmentRatio: { value: assetReinvestmentRatio, format: "x" },
    currentRatio: { value: currentRatio, format: "x" },
    debtToEquity: { value: debtToEquity, format: "x" },
    debtToAssets: { value: debtToAssets, format: "pct" },
  };

  const spherePillars = buildSpherePillars({
    overallHealth: avgHealth,
    pillarHealths,
    pillarStatus,
    pillarNotes: Object.fromEntries(
      overallHealth.pillars.map((pillar) => [pillar.id, pillar.note ?? null]),
    ),
    healthMap,
    ratioMeta: RATIO_META,
    inventoryApplies: stockSittingApplies(operatingProfile),
    dayCounts: cashDriverDayFigures(v as unknown as Record<string, unknown>),
    driverNotes: grossImplausible ? { grossMargin: GROSS_MARGIN_MAPPING_NOTE } : undefined,
  });

  // Same ranker as the accountant Moves tab and Action Plan import.
  const profitBridge = periodProfitBridge(v as unknown as Record<string, unknown>);
  const nextSteps = rankStrategicMoves({
    healthByKey: healthMap,
    profile: operatingProfile,
    suppressKeys: profitBridge.interestBurdenUsable ? undefined : ["interestBurden"],
    debtorDays: ratiosStatementFigures(v as unknown as Record<string, unknown>).debtorDays,
    financingHealth: pillarHealths.financing,
    weakestPillar: overallHealth.weakestPillar?.id ?? null,
    hasEvidence: ownerEvidence,
    market: boardMarket,
  }).map((step) => ({ ...step, key: step.key as RatioKey }));

  const positionPercentile = computePositionPercentile(showScoredBoard, avgHealth);
  const healthBand =
    showScoredBoard && Number.isFinite(avgHealth) ? computeHealthBand(avgHealth) : null;
  const weekChanges = computeWeekChanges({
    revenueGrowth,
    cashHealth: pillarHealths.cash,
    profitHealth: pillarHealths.profit,
    grossMarginRatio,
  });
  const cashTrajectory = computeCashTrajectory({
    hasRealFinancials: showScoredBoard,
    revenue: n.revenue,
    operatingCashflow: n.operatingCashflow,
    currentAssets: n.currentAssets,
    currentLiabilities: n.currentLiabilities,
  });
  const overviewCaption = computeOverviewCaption({
    hasRealFinancials: showScoredBoard,
    avgHealth,
    cashHealth: pillarHealths.cash,
    displayStatus: ownerStatusCritical ? "critical" : overallHealth.displayStatus,
  });
  const nextMoveImpactLabel = computeNextMoveImpactLabel({
    topKey: nextSteps[0]?.key,
    revenue: n.revenue,
    receivables: n.receivables,
    currency: currencySymbol(boardMarket),
  });

  // Auto-clear the globe highlight after 2s and scroll the row into view.
  // Small delay lets the tab re-render before we query the DOM.
  useEffect(() => {
    if (!highlightId) return;
    const scrollTimer = setTimeout(() => {
      const el = document.querySelector(`[data-row-id="${highlightId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    const clearTimer = setTimeout(() => setHighlightId(null), 2000);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [highlightId]);

  const updateWeek = useCallback((weekKey: string, field: keyof WeeklyRow, value: number) => {
    setWeeklyInputs((prev) => ({
      weeks: {
        ...prev.weeks,
        [weekKey]: { ...(prev.weeks[weekKey] ?? DEFAULT_WEEKLY_ROW), [field]: value },
      },
    }));
    // Weekly cash data feeds the forecast panel only — it does not feed ratio scoring,
    // so it must not mark real financials or trigger the scored dashboard.
  }, []);

  const saveProductMix = useCallback((mix: ProductMix) => {
    setProductMix(mix);
  }, []);

  const saveDripProfile = useCallback(
    async (profile: ClientOperatingProfile) => {
      setOperatingProfile(profile);
      setBusinessTypeId(profile.businessTypeId);
      if (!effectiveClientId) return;
      const { error } = await supabase
        .from("clients")
        .update({
          business_type: profile.businessTypeId,
          operating_profile: profile as unknown as Record<string, unknown>,
          financial_year_start_month: profile.fyStartMonth,
        } as never)
        .eq("id", effectiveClientId);
      if (error) throw error;
    },
    [effectiveClientId],
  );

  const saveDripWeekly = useCallback((next: WeeklyInputs) => {
    setWeeklyInputs(next);
  }, []);

  const financialInputsCtxValue = useMemo(
    () => ({ weeklyInputs, updateWeek, productMix, saveProductMix }),
    [weeklyInputs, updateWeek, productMix, saveProductMix],
  );

  const handleTourTabChange = useCallback((tab: string) => {
    if (tab === "today-complex") {
      setViewMode("complex");
      setActiveTab("today");
    } else {
      setActiveTab(tab);
    }
  }, []);

  // Warm lazy tab chunks before the user (or tour) opens them. A stale hashed
  // file after a fresh deploy used to throw through the root error page.
  useEffect(() => {
    void import("@/components/action-plan");
  }, []);
  useEffect(() => {
    if (firstRunStep !== null || showOnboarding || showBankDrafter || showCashFromBanks) return;
    void import("@/components/cash-forecast");
    void import("@/components/budget/budget-panel");
  }, [firstRunStep, showOnboarding, showBankDrafter, showCashFromBanks]);

  // Don't flash empty-score / "add your financials" copy while auth, the
  // client link, or the operating profile is still resolving.
  const boardReady = ownerBoardReady({
    roleResolved,
    clientLinkResolved,
    effectiveClientId,
    onboardingGateReady,
    firstRunStep,
    profileFunnelOpen: showOnboarding || firstRunStep === "pick-type",
    financialsHydrated: !!effectiveClientId && hydratedClientId === effectiveClientId,
  });
  const ownerGateSettled =
    boardReady || ownerBootTimedOut || workspaceLoadFailed || criticalBootFailed;
  useEffect(() => {
    reportOwnerBoardReady(boardReady && !workspaceLoadFailed && !criticalBootFailed);
  }, [boardReady, workspaceLoadFailed, criticalBootFailed, reportOwnerBoardReady]);
  // Role guard — a real firm membership belongs on My practice, not the owner app.
  // An invite redeem (owner force) and impersonating a client stay on /app.
  // user_roles and firm_memberships wait until this gate has settled.
  useEffect(() => {
    if (!user || !ownerGateSettled) return;
    const acting =
      actingClientId ||
      (typeof sessionStorage !== "undefined"
        ? sessionStorage.getItem("acting_as_client_id")
        : null);
    if (acting) return;
    if (hasInviteHandoffFlag()) return;
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      const { shouldBounceFromOwnerApp, clearForcePortal, shouldOpenItInbox } =
        await import("@/lib/user-roles");
      if (await shouldOpenItInbox(user.id, controller.signal)) {
        if (!cancelled) navigate({ to: "/ops", search: { tab: "it" } });
        return;
      }
      const bounce = await shouldBounceFromOwnerApp(user.id, false, controller.signal);
      if (!cancelled && bounce) {
        clearForcePortal();
        navigate({ to: "/practice" });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [user, actingClientId, navigate, ownerGateSettled]);
  useEffect(() => {
    if (authLoading || !user?.id || boardReady || criticalBootFailed) {
      setOwnerBootTimedOut(false);
      return;
    }
    return bindShellBackstop(() => setOwnerBootTimedOut(true));
  }, [authLoading, user?.id, boardReady, ownerBootAttempt, criticalBootFailed]);
  if (user && (workspaceLoadFailed || criticalBootFailed)) {
    return (
      <div
        className="grid min-h-screen place-items-center bg-background px-4 text-foreground"
        role="alert"
        data-owner-boot="load-error"
      >
        <div className="w-full max-w-md">
          <h1 className="text-xl font-semibold">Couldn't load your workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">The books didn't load. Retry.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setWorkspaceLoadFailed(false);
                setCriticalBootFailed(false);
                setOwnerBootTimedOut(false);
                setOwnerBootAttempt((n) => n + 1);
              }}
              className="inline-flex h-10 items-center rounded-full bg-foreground px-4 text-xs font-bold uppercase tracking-wider text-background"
            >
              Retry
            </button>
            <Link to="/" className="inline-flex h-10 items-center px-4 text-sm underline">
              Back
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (user && !authLoading && !boardReady && ownerBootTimedOut) {
    return (
      <div
        className="grid min-h-screen place-items-center bg-background px-4 text-foreground"
        role="alert"
        data-owner-boot="timeout"
      >
        <div className="w-full max-w-md">
          <h1 className="text-xl font-semibold">Couldn't open your workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The books didn't finish loading. Retry, or go back.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setCriticalBootFailed(false);
                setOwnerBootTimedOut(false);
                setOwnerBootAttempt((n) => n + 1);
              }}
              className="inline-flex h-10 items-center rounded-full bg-foreground px-4 text-xs font-bold uppercase tracking-wider text-background"
            >
              Retry
            </button>
            <Link to="/" className="inline-flex h-10 items-center px-4 text-sm underline">
              Back
            </Link>
          </div>
        </div>
      </div>
    );
  }
  const storedForShell = user?.id ? readStoredOwnerClientId(user.id) : null;
  const provisionalWhileAuth =
    Boolean(storedForShell && !clientLinkResolved && !workspaceLoadFailed) &&
    !sampleMode &&
    !isLegacyOwnerBoardTab(oauthReturn.tab);
  if (!user || (authLoading && !provisionalWhileAuth && !clientLinkResolved)) {
    return <AppBootSpinner />;
  }

  // The rail is real navigation, not a loading state. While the books are
  // still resolving, only the content pane is a skeleton.
  if (!boardReady && !sampleMode && !isLegacyOwnerBoardTab(oauthReturn.tab)) {
    const bootScreen = ownerDoorScreen(oauthReturn);
    const shellScreen = bootScreen === "chat" ? "home" : bootScreen;
    const rememberedId = readStoredOwnerClientId(user.id);
    const access = decideStoredClientAccess({
      storedClientId: rememberedId,
      workspaces: clientLinkResolved ? ownerWorkspaces : null,
      failed: false,
    });
    const provisional = access.phase === "provisional";
    const bootName = ownerBootShellName({
      phase: access.phase,
      rememberedName: null,
      confirmedName: ownerWorkspaces.find((w) => w.clientId === effectiveClientId)?.name ?? null,
    });
    const bootInitials =
      bootName
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0] ?? "")
        .join("")
        .toUpperCase() || "OW";
    const booksKnown =
      !provisional && !!effectiveClientId && hydratedClientId === effectiveClientId;
    const bootPeriod = provisional
      ? { pending: true as const, label: null }
      : ownerBootPeriodPill({
      booksKnown,
      periodEnd: v.periodEnd ?? null,
      periodLabel: statementSpanLabel({
        periodStart: v.periodStart,
        periodEnd: v.periodEnd,
        periodLabel: readStatementMeta(v, boardMarket).periodLabel,
        market: boardMarket,
      }),
    });
    return (
      <div
        className="contents"
        data-owner-boot={provisional ? "provisional" : "pending"}
      >
      <OwnerShell
        screen={shellScreen}
        businessName={bootName}
        initials={bootInitials}
        workspaces={provisional ? [] : ownerWorkspaces}
        activeClientId={provisional ? null : effectiveClientId}
        onSwitch={switchOwnerWorkspace}
        onNavigate={(screen) => {
          void navigate({
            to: "/app",
            search: (prev) => ownerDoorSearch(prev, screen) as typeof oauthReturn,
          });
        }}
        onSignOut={() => {
          void signOut().then(() => {
            window.location.href = "/";
          });
        }}
        onSettings={() => {
          openOwnerSettings();
          void navigate({
            to: "/app",
            search: (prev) => ownerDoorSearch(prev, "settings") as typeof oauthReturn,
          });
        }}
        onProfile={() => openProfileDialog("retake")}
        periodPending={bootPeriod.pending}
        periodLabel={bootPeriod.label}
      >
        <PanelSkeleton rows={4} />
      </OwnerShell>
      </div>
    );
  }
  if (!boardReady) {
    return <AppBootSpinner />;
  }

  if (marketNeedsGate && effectiveClientId) {
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
            .eq("id", effectiveClientId);
          if (error) throw error;
          setWorkspaceMarket(sel);
          setMarketNeedsGate(false);
        }}
      />
    );
  }

  const showOwnerDoor = !sampleMode && !isLegacyOwnerBoardTab(searchTab);
  const OwnerHealthOrb = SphereHero;

  return (
    <MarketProvider selection={workspaceMarket}>
      <FinancialInputsContext.Provider value={financialInputsCtxValue}>
        <main className="min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
          {generationTrialOpen ? (
            <div className="mx-auto max-w-3xl px-4 pt-4">
              <TrialEndedPlanBlock firmId={clientMeta?.firm_id ?? null} />
            </div>
          ) : null}
          <SplashScreen />
          {!actingClientId && !showOwnerDoor && (
            <TabErrorBoundary label="Walkthrough">
              {/* Empty board: a two-step nudge to the one action. The full board
                  tour only runs once a real score exists, so nothing it points at
                  ("one health score", Milōn Bot, seeded budget) is a promise.
                  A self-signup first upload flips this to the scored tour — it is
                  not skipped (#175: auto-built deliverables await sign-off). */}
              <WalkthroughWizard
                key={showScoredBoard ? "owner" : "owner-empty"}
                variant={showScoredBoard ? "owner" : "owner-empty"}
                ready={
                  ownerWalkthroughReady({
                    firstRunStep,
                    showOnboarding,
                    showBankDrafter,
                    showCashFromBanks,
                    onboardingGateReady,
                  }) &&
                  !skipInvitedSetupChrome &&
                  !showFinData &&
                  !reviewOpen &&
                  !showQboDialog &&
                  !showXeroDialog &&
                  !showSageDialog &&
                  hydratedClientId === effectiveClientId
                }
                onTabChange={handleTourTabChange}
                onFinish={showScoredBoard ? undefined : () => setFirstRunStep("first-data")}
                userRole={userRole ?? undefined}
              />
            </TabErrorBoundary>
          )}
          {actingClientId && (
            <div className="border-b border-amber-600/40 bg-amber-500/15 print:hidden">
              <div className="founder-shell mx-auto flex flex-wrap items-center justify-between gap-2 py-2 text-xs text-amber-100">
                <div>
                  <span className="font-semibold">Acting as client:</span>{" "}
                  <span className="text-amber-200">{actingClientName ?? "Client"}</span>
                  <span className="ml-2 text-amber-200/70">
                    (audited — changes save to this client)
                  </span>
                </div>
                <BackLink
                  onClick={exitImpersonation}
                  className="rounded-md border border-amber-400/40 bg-amber-500/20 px-2 py-1 text-amber-50 hover:bg-amber-500/30 hover:text-amber-50"
                >
                  Back to firm dashboard
                </BackLink>
              </div>
            </div>
          )}
          <div id="board-pack" className="founder-shell mx-auto py-5 lg:py-7">
            {showOwnerDoor ? (
              // Demo clients keep the sample card. Real clients get the preview card.
              // A reused hand-off stays Working on the run already open. The Handed-to line waits until noted.
              <OwnerDoor
                routeScreen={ownerDoorScreen(oauthReturn)}
                onOpenScreen={(screen) => {
                  void navigate({
                    to: "/app",
                    search: (prev) => ownerDoorSearch(prev, screen) as typeof oauthReturn,
                  });
                }}
                bot={oauthReturn.bot ?? null}
                planTick={planTick}
                onBotChange={(next, mode) => {
                  void navigate({
                    to: "/app",
                    search: (prev) => {
                      const out = { ...prev };
                      if (next) out.bot = next;
                      else delete out.bot;
                      return out;
                    },
                    replace: mode === "replace",
                  });
                }}
                clientId={effectiveClientId}
                businessName={
                  actingClientName ??
                  ownerWorkspaces.find((w) => w.clientId === effectiveClientId)?.name ??
                  "Your business"
                }
                hasBooks={hasRealFinancials}
                revenue={v.revenue}
                priorRevenue={v.priorRevenue}
                cogs={v.cogs}
                receivables={v.receivables}
                netIncome={v.netIncome}
                periodEnd={v.periodEnd ?? null}
                statementSpan={statementSpanLabel({
                  periodStart: v.periodStart,
                  periodEnd: v.periodEnd,
                  periodLabel: readStatementMeta(v, boardMarket).periodLabel,
                  market: boardMarket,
                })}
                history={history}
                cashflow={clientMeta?.cashflow ?? null}
                financials={v as unknown as Record<string, unknown>}
                sampleNotice={
                  statementSampleImplausible(v as unknown as Record<string, unknown>)
                    ? implausibleSampleNote(boardMarket)
                    : null
                }
                cashOutlook={ownerDoorOutlook}
                openingMissing={ownerOpeningMissing}
                hasEvidence={ownerEvidence}
                cashOnFile={ownerCashOnFile}
                cashPillarStatus={ownerEvidence && ownerCashOnFile ? (pillarStatus.cash ?? null) : null}
                cashRunwayWeeks={ownerEvidence && cashBalance != null ? effectiveRunway : null}
                cashDebtorScore={
                  ownerEvidence && Number.isFinite(healthMap.debtorDays) ? healthMap.debtorDays : null
                }
                cashBurnScore={
                  ownerEvidence && Number.isFinite(healthMap.ocfToEbitda) ? healthMap.ocfToEbitda : null
                }
                liveHealth={liveScoreSnapshot}
                market={boardMarket}
                marketCountry={parseMarketSelection(workspaceMarket)?.country ?? null}
                signoffs={Object.values(reviewSignoffs).flatMap((row) =>
                  row
                    ? [
                        {
                          id: row.id,
                          scope: row.scope,
                          signed_off_by_name: row.signed_off_by_name,
                          signed_off_at: row.signed_off_at,
                          firm_name: row.firm_name,
                        },
                      ]
                    : [],
                )}
                firmId={clientMeta?.firm_id ?? null}
                sampleClient={Boolean(clientMeta?.is_demo)}
                workspaces={ownerWorkspaces}
                onSwitch={switchOwnerWorkspace}
                onConnect={() => setShowFinData(true)}
                onQuickBooks={() => setShowQboDialog(true)}
                onXero={() => setShowXeroDialog(true)}
                profileResume={ownerProfileResumeVisible({
                  unfinished: firstRunStep === "pick-type",
                  open: showOnboarding,
                })}
                onResumeProfile={() => setShowOnboarding(true)}
                onProfile={() => openProfileDialog("retake")}
                settingsOpen={oauthReturn.screen === "settings"}
                openAccountant={oauthReturn.screen === "accountant"}
                openPlan={oauthReturn.screen === "plan"}
                checkoutNotice={
                  oauthReturn.screen === "plan" ? (oauthReturn.checkout ?? null) : null
                }
                focusSigned={oauthReturn.section === "signed"}
                onSettings={() => {
                  openOwnerSettings();
                  void navigate({
                    to: "/app",
                    search: (prev) => ownerDoorSearch(prev, "settings") as typeof oauthReturn,
                    replace: oauthReturn.screen === "settings",
                  });
                }}
                onLeaveSettings={() => {
                  void navigate({
                    to: "/app",
                    search: (prev) => {
                      const next = { ...prev };
                      delete next.screen;
                      return next;
                    },
                    replace: true,
                  });
                }}
                onAccount={() => {
                  openOwnerSettings();
                  void navigate({ to: "/settings" });
                }}
                onSignOut={() => {
                  void signOut().then(() => {
                    window.location.href = "/";
                  });
                }}
                topMove={
                  showScoredBoard && nextSteps[0]?.title
                    ? rewriteDraftMonthStamp(nextSteps[0].title)
                    : null
                }
                boards={(go) => ({
                  health: (
                    <section className="owner-pane" data-owner-page="health">
                      <OwnerPageHead
                        eyebrow="Health"
                        title="Business health"
                        lede="One score built from profit, assets, financing and cash."
                      />
                      {showScoredBoard ? (
                        <div className="owner-health-hero">
                          <OwnerSignoffMark
                            signoff={financialsSignoff}
                            isStale={financialsSignoffStale}
                            scopeLabel={signoffScopeLabel("financials")}
                            className="mb-2"
                          />
                          <OwnerHealthOrb
                            variant="ring"
                            overallHealth={ownerEvidence && Number.isFinite(avgHealth) ? avgHealth : Number.NaN}
                            displayStatus={ownerEvidence ? (ownerStatusCritical ? "critical" : overallHealth.displayStatus) : undefined}
                            statusLabel={ownerEvidence ? (ownerStatusCritical ? ownerStatusWord : null) : NOT_SCORED_YET_LABEL}
                            pillars={spherePillars}
                            caption={HEALTH_RING_CAPTION}
                            cashFloorCue={ownerCashFloorCue}
                            onCashFloor={openOwnerFm}
                            onTopPriority={() => go("moves")}
                            onDriverClick={(key) => {
                              if (key in RATIO_META) setOpenRatio(key as RatioKey);
                            }}
                          />
                        </div>
                      ) : (
                        <>
                          <p className="owner-lede">Your accountant sets this up</p>
                          <button
                            type="button"
                            className="btn gold owner-ask owner-ask-inline"
                            onClick={() => go("accountant")}
                          >
                            Invite your accountant
                          </button>
                        </>
                      )}
                    </section>
                  ),
                  cash: (
                    <section className="owner-pane" data-owner-page="cash">
                      <Suspense fallback={<p className="owner-lede">Loading cash forecast…</p>}>
                        <CashForecastPanel
                          clientId={effectiveClientId ?? undefined}
                          clientName={actingClientName ?? undefined}
                          simplified
                          canSign={false}
                          hideReadOnlyStamp
                          readOnly
                          onInvite={() => go("accountant")}
                          reloadToken={cashForecastReloadToken}
                        />
                      </Suspense>
                    </section>
                  ),
                  budget: (
                    <section className="owner-pane" data-owner-page="budget">
                      <OwnerPageHead
                        eyebrow="Budget"
                        title="Budget vs actual"
                        lede="The plan for the year, next to what actually happened."
                      />
                      <Suspense fallback={<p className="owner-lede">Loading budget…</p>}>
                        <BudgetPanel
                          clientId={effectiveClientId ?? undefined}
                          clientName={actingClientName ?? undefined}
                          simplified
                          role="owner"
                          canSign={false}
                          hideReadOnlyStamp
                          readOnly
                          onInvite={() => go("accountant")}
                          priorYear={
                            ownerPrior?.financials
                              ? yearMoneyFromFinancials(
                                  ownerPrior.financials as Record<string, unknown>,
                                )
                              : null
                          }
                          priorYearLabel={
                            ownerPrior
                              ? statementSpanLabel({
                                  periodStart: readStatementMeta(ownerPrior.financials, boardMarket).periodStart,
                                  periodEnd: readStatementMeta(ownerPrior.financials, boardMarket).periodEnd,
                                  periodLabel: ownerPrior.period_label,
                                  market: boardMarket,
                                })
                              : null
                          }
                          priorYearMonths={
                            ownerPrior?.financials
                              ? statementCoverMonthCount(
                                  ownerPrior.financials as Record<string, unknown>,
                                )
                              : null
                          }
                          businessTypeId={businessTypeId}
                          operatingProfile={operatingProfile}
                          fyStartMonthDefault={
                            operatingProfile?.fyStartMonth ??
                            resolveMarket(coerceMarketSelection(workspaceMarket))
                              .fyStartMonthDefault
                          }
                          firstActualsMonth={
                            hasRealFinancials
                              ? (history[0]?.period_date?.slice(0, 7) ?? null)
                              : null
                          }
                          financials={{
                            revenue: v.revenue,
                            cogs: v.cogs,
                            fixedCosts: v.fixedCosts,
                            laborCost: v.laborCost,
                            receivables: v.receivables,
                            payables: v.payables,
                            inventory: v.inventory,
                            operatingCashflow: v.operatingCashflow,
                            [PERIOD_MONTHS_KEY]: v[PERIOD_MONTHS_KEY] ?? "",
                            ...(v.periodStart ? { periodStart: v.periodStart } : {}),
                            ...(v.periodEnd ? { periodEnd: v.periodEnd } : {}),
                            ...budgetProfitFields(v),
                          }}
                          reloadToken={budgetReloadToken}
                        />
                      </Suspense>
                    </section>
                  ),
                  tasks: (
                    <section className="owner-pane" data-owner-page="tasks">
                      <Suspense fallback={<p className="owner-lede">Loading tasks…</p>}>
                        {effectiveClientId ? (
                          <ActionPlanPanel
                            clientId={effectiveClientId}
                            clientName={actingClientName ?? undefined}
                            simplified
                            isOwner={userRole !== "client_member"}
                            canonicalRatios={ownerCanonicalRatios}
                            healthSnapshot={liveScoreSnapshot}
                            figuresUpdatedAt={figuresUpdatedAt}
                            cashBelowFloor={ownerCashBelowFloor}
                            ownerSignoff={actionPlanSignoff}
                            ownerSignoffStale={computeIsStale(
                              actionPlanSignoff,
                              clientMeta?.financials_updated_at ?? null,
                            )}
                            pillars={overallHealth.pillars}
                            moves={nextSteps.map((s) =>
                              attachPillarScore(
                                {
                                  key: s.key,
                                  title: rewriteDraftMonthStamp(s.title),
                                  ratioName: s.ratioName,
                                  impactLine: s.impactLine,
                                  health: Number.isFinite(s.health) ? s.health : Number.NaN,
                                },
                                overallHealth.pillars,
                              ),
                            )}
                            onViewAnalysis={() => go("health")}
                            onOpenDraft={(id) => {
                              const node = document.querySelector(`[data-draft="${CSS.escape(id)}"]`);
                              if (node instanceof HTMLElement) node.scrollIntoView({ block: "center" });
                            }}
                          />
                        ) : (
                          <p className="owner-lede">Your accountant sets this up</p>
                        )}
                      </Suspense>
                    </section>
                  ),
                  profit: (
                    <section className="owner-pane" data-owner-page="profit">
                      {showScoredBoard ? (
                        <>
                          {statementSampleImplausible(v as unknown as Record<string, unknown>) ? (
                            <p className="owner-lede" role="status" data-sample-notice="">
                              {implausibleSampleNote(boardMarket)}
                            </p>
                          ) : null}
                          <ProfitLead periodLabel={ownerProfitPeriodLabel} />
                          <ProfitabilityWaterfall
                            appearance="premium"
                            previousMargins={priorMarginsFromFinancials(
                              (ownerPrior?.financials as Record<string, unknown> | null) ?? null,
                            )}
                            headerAside={
                              <OwnerSignoffMark
                                signoff={profitabilitySignoff}
                                isStale={computeIsStale(
                                  profitabilitySignoff,
                                  clientMeta?.financials_updated_at ?? null,
                                )}
                              />
                            }
                            negative="minus"
                            clientName={actingClientName ?? undefined}
                            clientId={effectiveClientId ?? undefined}
                            reviewSignoff={stampFromSignoff(
                              profitabilitySignoff,
                              computeIsStale(
                                profitabilitySignoff,
                                clientMeta?.financials_updated_at ?? null,
                              ),
                            )}
                            fallback={ownerWaterfallFallback}
                            periodLabel={ownerProfitPeriodLabel}
                            preferPeriod={preferStatementPeriod(v)}
                            yearToDate={statementYearLine(v, boardMarket)}
                            statementSource={readStatementMeta(v, boardMarket).statementSource}
                          />
                        </>
                      ) : (
                        <>
                          <h1 className="owner-title">Profit</h1>
                          <p className="owner-lede">Your accountant sets this up</p>
                          <button
                            type="button"
                            className="btn gold owner-ask owner-ask-inline"
                            onClick={() => go("accountant")}
                          >
                            Invite your accountant
                          </button>
                        </>
                      )}
                    </section>
                  ),
                  moves: (
                    <section className="owner-pane" data-owner-page="moves">
                      <OwnerPageHead
                        eyebrow="Next moves"
                        title="Your action plan"
                        lede="What to do next, and who is on it."
                      />
                      <Suspense fallback={<p className="owner-lede">Loading next moves…</p>}>
                        {effectiveClientId ? (
                          <ActionPlanPanel
                            clientId={effectiveClientId}
                            clientName={actingClientName ?? undefined}
                            simplified
                            isOwner={userRole !== "client_member"}
                            canonicalRatios={ownerCanonicalRatios}
                            healthSnapshot={liveScoreSnapshot}
                            figuresUpdatedAt={figuresUpdatedAt}
                            cashBelowFloor={ownerCashBelowFloor}
                            ownerView
                            pillars={overallHealth.pillars}
                            moves={nextSteps.map((s) =>
                              attachPillarScore(
                                {
                                  key: s.key,
                                  title: rewriteDraftMonthStamp(s.title),
                                  ratioName: s.ratioName,
                                  impactLine: s.impactLine,
                                  health: Number.isFinite(s.health) ? s.health : Number.NaN,
                                },
                                overallHealth.pillars,
                              ),
                            )}
                            onViewAnalysis={() => go("health")}
                            onInviteAccountant={() => go("accountant")}
                            ownerSignoff={actionPlanSignoff}
                            ownerSignoffStale={computeIsStale(
                              actionPlanSignoff,
                              clientMeta?.financials_updated_at ?? null,
                            )}
                            onOpenApproved={(target) => {
                              if (target.screen === "accountant") {
                                go("accountant");
                                requestRevealDataRequests();
                                return;
                              }
                              go("moves");
                            }}
                            focusDraftId={oauthReturn.draft ?? null}
                            onOpenDraft={(id) => {
                              const node = document.querySelector(`[data-draft="${CSS.escape(id)}"]`);
                              if (node instanceof HTMLElement) node.scrollIntoView({ block: "center" });
                            }}
                          />
                        ) : (
                          <p className="owner-lede">Your accountant sets this up</p>
                        )}
                      </Suspense>
                    </section>
                  ),
                })}
              />
            ) : (
              <header className="founder-app-bar relative mb-3 overflow-visible rounded-xl border border-slate-200/80 bg-white/90 px-2.5 py-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.05)] backdrop-blur-xl dark:border-slate-800/90 dark:bg-[#0d1420]/90 dark:shadow-[0_10px_28px_rgba(0,0,0,0.2)] sm:px-3">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#d4a550]/80 to-transparent" />
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <img
                      src="/milon-wordmark.png"
                      alt="Milōn"
                      className="founder-app-bar__logo h-4 w-auto shrink-0 dark:brightness-110 sm:h-[18px]"
                      style={{ filter: "brightness(0.85) saturate(1.2)" }}
                    />
                    <div className="founder-app-bar__brand-text hidden min-w-0 truncate text-[9px] font-medium uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500 md:block">
                      {actingClientName ??
                        ownerWorkspaces.find((w) => w.clientId === effectiveClientId)?.name ??
                        "Operating finance"}
                    </div>
                    {!actingClientId ? (
                      <OwnerBusinessSwitcher
                        workspaces={ownerWorkspaces}
                        activeClientId={effectiveClientId}
                        onSelect={switchOwnerWorkspace}
                        loading={!clientLinkResolved}
                      />
                    ) : null}
                  </div>
                  <div className="founder-app-bar__actions flex shrink-0 items-center gap-1 print:hidden">
                    {/* Keep primary actions visible on phones; park the rest in More */}
                    {userRole !== "client_member" && (
                      <>
                        <button
                          onClick={() => setShowFinData(true)}
                          className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[#b7872a]/50 bg-gradient-to-b from-[#d4a550]/20 to-[#b7872a]/10 px-2.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#8a6508] shadow-[0_1px_6px_rgba(212,165,80,0.16)] transition-colors hover:border-[#b7872a]/80 hover:from-[#d4a550]/30 hover:to-[#b7872a]/20 dark:text-[#e1b85e]"
                          title={
                            isUsCopy(boardMarket)
                              ? "Connect QuickBooks or Xero, or upload statements"
                              : "Upload financial statements or connect Xero"
                          }
                        >
                          <Upload className="h-3 w-3 shrink-0" />
                          <span className="founder-app-bar__upload-label hidden sm:inline">
                            Upload
                          </span>
                        </button>
                        <button
                          type="button"
                          id="owner-header-qbo"
                          onClick={() => setShowQboDialog(true)}
                          className="hidden h-7 items-center rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition-colors hover:border-[#b7872a]/50 hover:bg-[#d4a550]/10 dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-200 sm:inline-flex"
                          title="Connect QuickBooks Online"
                        >
                          QuickBooks
                        </button>
                        <button
                          type="button"
                          id="owner-header-xero"
                          onClick={() => setShowXeroDialog(true)}
                          className="hidden h-7 items-center rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition-colors hover:border-[#b7872a]/50 hover:bg-[#d4a550]/10 dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-200 sm:inline-flex"
                          title="Connect Xero"
                        >
                          Xero
                        </button>
                        {!isUsCopy(boardMarket) ? (
                          <button
                            type="button"
                            id="owner-header-sage"
                            onClick={() => setShowSageDialog(true)}
                            className="hidden h-7 items-center rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition-colors hover:border-[#b7872a]/50 hover:bg-[#d4a550]/10 dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-200 sm:inline-flex"
                            title="Connect Sage Accounting"
                          >
                            Sage
                          </button>
                        ) : null}
                      </>
                    )}
                    <FeatureFinder audience="owner" clientId={effectiveClientId} chrome="owner" />
                    <ThemeToggle />
                    <HeaderShareButton />

                    <div className="hidden items-center gap-1 sm:flex">
                      {userRole !== "client_member" ? (
                        <button
                          onClick={() => openProfileDialog("retake")}
                          className="inline-flex h-7 max-w-[14rem] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-[#b7872a]/50 hover:bg-[#d4a550]/10 dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-200"
                          title={
                            operatingProfile
                              ? `${profileShortLabel(operatingProfile)} — update your business profile`
                              : "Set up your business profile"
                          }
                        >
                          <Building2 className="h-3 w-3 shrink-0" />
                          <span className="truncate">Business profile</span>
                          <Pencil className="h-2.5 w-2.5 shrink-0 opacity-40" />
                        </button>
                      ) : operatingProfile || businessType ? (
                        <div
                          className="inline-flex h-7 max-w-[14rem] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 text-[11px] font-semibold text-slate-700 dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-200"
                          title={profileShortLabel(operatingProfile) || businessType?.label}
                        >
                          <Building2 className="h-3 w-3 shrink-0" />
                          <span className="truncate">Business profile</span>
                        </div>
                      ) : null}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-[#b7872a]/50 hover:bg-[#d4a550]/10 dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-200"
                            title={`Risk profile — currently ${RISK_TUNING[risk].label}`}
                          >
                            <Shield className="h-3 w-3 shrink-0" />
                            <span>Risk profile</span>
                            <span className="hidden font-medium text-slate-500 dark:text-slate-400 lg:inline">
                              · {RISK_TUNING[risk].label}
                            </span>
                            <ChevronDown className="h-3 w-3 opacity-50" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-44 border border-slate-700 bg-slate-900 p-2 shadow-xl"
                          align="end"
                        >
                          <p className="mb-2 px-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                            Risk Profile
                          </p>
                          <div className="flex flex-col gap-1">
                            {(["conservative", "balanced", "aggressive"] as RiskProfile[]).map(
                              (r) => (
                                <button
                                  key={r}
                                  onClick={() => setRisk(r)}
                                  className={`rounded px-2 py-1.5 text-left text-[11px] font-medium capitalize transition-colors ${
                                    risk === r
                                      ? "border border-[#b7872a]/40 bg-[#b7872a]/15 text-[#d4a550]"
                                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                                  }`}
                                >
                                  {RISK_TUNING[r].label}
                                </button>
                              ),
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                      {userRole === "firm_admin" && (
                        <button
                          onClick={() => setAdminOpen(true)}
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#d4a550]/30 bg-[#d4a550]/10 px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#8a6508] transition-colors hover:border-[#d4a550]/60 hover:bg-[#d4a550]/20 dark:text-[#d4a550]"
                          title="Admin Dashboard"
                        >
                          ⬡ Admin
                        </button>
                      )}
                      <SettingsMenu
                        className="milon-settings-btn"
                        onSettings={() => {
                          openOwnerSettings();
                          void navigate({ to: "/settings" });
                        }}
                        onPlan={() => {
                          void navigate({ to: "/app", search: { screen: "plan" } });
                        }}
                      />
                      <button
                        onClick={() =>
                          signOut().then(() => {
                            window.location.href = "/";
                          })
                        }
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:border-[#b7872a]/50 hover:bg-[#d4a550]/10 dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-300"
                        title="Sign out"
                      >
                        Sign out
                      </button>
                    </div>

                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className="founder-app-bar__more inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50/80 text-slate-600 transition-colors hover:border-[#b7872a]/50 hover:bg-[#d4a550]/10 dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-300 sm:hidden"
                          title="More"
                          aria-label="More actions"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="z-50 w-56 border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
                        align="end"
                        side="bottom"
                        collisionPadding={12}
                      >
                        <div className="flex flex-col gap-1">
                          {userRole !== "client_member" && (
                            <button
                              onClick={() => openProfileDialog("retake")}
                              className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              <Building2 className="h-3.5 w-3.5" /> Business profile
                            </button>
                          )}
                          {userRole !== "client_member" && (
                            <>
                              <button
                                type="button"
                                onClick={() => setShowQboDialog(true)}
                                className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Plug2 className="h-3.5 w-3.5" /> Connect QuickBooks
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowXeroDialog(true)}
                                className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                              >
                                <Plug2 className="h-3.5 w-3.5" /> Connect Xero
                              </button>
                              {!isUsCopy(boardMarket) ? (
                                <button
                                  type="button"
                                  onClick={() => setShowSageDialog(true)}
                                  className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                  <Plug2 className="h-3.5 w-3.5" /> Connect Sage
                                </button>
                              ) : null}
                            </>
                          )}
                          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Risk profile · {RISK_TUNING[risk].label}
                          </div>
                          {(["conservative", "balanced", "aggressive"] as RiskProfile[]).map(
                            (r) => (
                              <button
                                key={r}
                                onClick={() => setRisk(r)}
                                className={`rounded-md px-2 py-1.5 text-left text-xs capitalize ${
                                  risk === r
                                    ? "bg-[#b7872a]/15 font-semibold text-[#8a6508] dark:text-[#d4a550]"
                                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                                }`}
                              >
                                {RISK_TUNING[r].label}
                              </button>
                            ),
                          )}
                          {userRole === "firm_admin" && (
                            <button
                              onClick={() => setAdminOpen(true)}
                              className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              Admin
                            </button>
                          )}
                          <SettingsNavButton
                            className="milon-settings-btn w-full justify-start"
                            onClick={() => {
                              openOwnerSettings();
                              navigate({ to: "/settings" });
                            }}
                          />
                          <button
                            onClick={() =>
                              signOut().then(() => {
                                window.location.href = "/";
                              })
                            }
                            className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <LogOut className="h-3.5 w-3.5" /> Sign out
                          </button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </header>
            )}

            {/* Business profile funnel — required on first run, retakeable thereafter */}
            <Dialog
              open={showOnboarding}
              modal={false}
              onOpenChange={(open) => {
                if (!open && firstRunStep === "pick-type" && effectiveClientId) {
                  deferOwnerProfile(effectiveClientId);
                }
                setShowOnboarding(open);
              }}
            >
              <DialogContent
                overlayClassName="profile-funnel-overlay"
                data-profile-funnel=""
                className="profile-funnel-sheet flex h-[min(80vh,calc(100dvh-6rem))] max-h-[min(80vh,calc(100dvh-6rem))] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden border border-[#DBEAFE] bg-white p-4 text-[#102A43] sm:p-6"
              >
                <DialogHeader className="sr-only">
                  <DialogTitle>Business profile</DialogTitle>
                  <DialogDescription>
                    Quick questions that tune Milōn to your business
                  </DialogDescription>
                </DialogHeader>
                <ProfileFunnel
                  mode={
                    (firstRunStep === "pick-type"
                      ? "first-run"
                      : profileDialogMode) satisfies ProfileFunnelMode
                  }
                  initial={operatingProfile}
                  initialFyStartMonth={
                    operatingProfile?.fyStartMonth ?? boardMarket.fyStartMonthDefault
                  }
                  figuresReady={hasRealFinancials}
                  onCancel={() => {
                    if (firstRunStep === "pick-type" && effectiveClientId) {
                      deferOwnerProfile(effectiveClientId);
                    }
                    setShowOnboarding(false);
                  }}
                  onComplete={async (profile) => {
                    setBtSaveError(null);
                    const stamped = stampProfileProvenance(profile, "owner", undefined);
                    setOperatingProfile(stamped);
                    setBusinessTypeId(stamped.businessTypeId);
                    if (effectiveClientId) {
                      setBtSaving(true);
                      const { error } = await supabase
                        .from("clients")
                        .update({
                          business_type: stamped.businessTypeId,
                          operating_profile: stamped as unknown as Record<string, unknown>,
                          financial_year_start_month: stamped.fyStartMonth,
                        } as never)
                        .eq("id", effectiveClientId);
                      setBtSaving(false);
                      if (error) {
                        setBtSaveError("Could not save your profile — please try again.");
                        return;
                      }
                    }
                    setShowOnboarding(false);
                    if (effectiveClientId) clearOwnerProfileDefer(effectiveClientId);
                    if (firstRunStep === "pick-type") {
                      // Invited owner whose accountant already loaded figures:
                      // nothing to bring in — land on the scored board.
                      setFirstRunStep(hasRealFinancials ? null : "first-data");
                    } else if (profileDialogMode === "complete") {
                      toast.success("Profile complete — score, budget and advice re-tuned");
                    } else {
                      toast.success("Business profile updated");
                    }
                  }}
                />
                {btSaveError && (
                  <p className="mt-2 rounded-md border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
                    {btSaveError}
                  </p>
                )}
                {btSaving && (
                  <p className="flex items-center gap-2 text-xs text-slate-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d4a550]" /> Saving profile…
                  </p>
                )}
              </DialogContent>
            </Dialog>

            {/* First-data nudge — after profile: 3 months of bank statements first */}
            <Dialog open={firstRunStep === "first-data"} onOpenChange={() => setFirstRunStep(null)}>
              <DialogContent className="border border-slate-800 bg-slate-950 text-slate-50 max-w-md">
                <DialogHeader>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d4a550]">
                    Step 2 of 2 · Bring in your numbers
                  </p>
                  <DialogTitle className="text-xl text-slate-100 mt-1">
                    {isUsCopy(boardMarket)
                      ? "Upload your financials"
                      : "Upload 3 months of bank statements"}
                  </DialogTitle>
                  <DialogDescription className="text-slate-400">
                    {isUsCopy(boardMarket)
                      ? "Fastest US path: upload a P&L and balance sheet — Excel, OpenDocument, CSV or PDF, straight from QuickBooks, Xero or your accountant. Connect QuickBooks or Xero for live sync, or use bank statements if that is what you have."
                      : "Fastest path: drop the last ~3 months of statements (add every bank account), or connect Xero. We draft your P&L, pre-fill budget, build a cash forecast, and show movements in balances."}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3 pt-2">
                  {(isUsCopy(boardMarket)
                    ? (["files", "qbo", "xero", "bank"] as const)
                    : (["bank", "xero", "sage", "files", "qbo"] as const)
                  ).map((id) => {
                    const hero =
                      (isUsCopy(boardMarket) && id === "files") ||
                      (!isUsCopy(boardMarket) && id === "bank");
                    const onClick =
                      id === "qbo"
                        ? () => {
                            setFirstRunStep(null);
                            setShowQboDialog(true);
                          }
                        : id === "xero"
                          ? () => {
                              setFirstRunStep(null);
                              setShowXeroDialog(true);
                            }
                          : id === "sage"
                            ? () => {
                                setFirstRunStep(null);
                                setShowSageDialog(true);
                              }
                            : id === "files"
                              ? () => {
                                  setFirstRunStep(null);
                                  setShowFinData(true);
                                  setTimeout(() => uploadRef.current?.click(), 150);
                                }
                              : () => {
                                  setFirstRunStep(null);
                                  setShowBankDrafter(true);
                                };
                    const title =
                      id === "qbo"
                        ? "Connect QuickBooks Online"
                        : id === "xero"
                          ? "Connect Xero"
                          : id === "sage"
                            ? "Connect Sage"
                            : id === "files"
                              ? isUsCopy(boardMarket)
                                ? "Upload Excel, ODS, CSV or PDF financials (recommended)"
                                : "Upload a financial statement instead"
                              : isUsCopy(boardMarket)
                                ? "Have bank statements instead? Upload those"
                                : "Upload bank statements (recommended)";
                    const sub =
                      id === "qbo"
                        ? "Live sync from QuickBooks Online"
                        : id === "xero"
                          ? "Live sync of P&L and balance sheet"
                          : id === "sage"
                            ? "Sage Business Cloud Accounting (South Africa)"
                            : id === "files"
                              ? "P&L and balance sheet · Excel, OpenDocument, CSV or PDF · you confirm before saving"
                              : "PDF, CSV or Excel exports · ~3 months · AI drafts your figures";
                    const icon =
                      id === "qbo" || id === "xero" || id === "sage" ? (
                        <Plug2 className="h-4 w-4" />
                      ) : id === "files" ? (
                        <Database className="h-4 w-4" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      );
                    return (
                      <button
                        key={id}
                        onClick={onClick}
                        className={
                          hero
                            ? "flex items-center gap-3 rounded-lg border border-[#d4a550]/40 bg-[#d4a550]/10 p-4 text-left hover:border-[#d4a550]/70 hover:bg-[#d4a550]/15 transition-all"
                            : "flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 p-4 text-left hover:border-[#d4a550]/50 hover:bg-slate-800 transition-all"
                        }
                      >
                        <span
                          className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                            hero
                              ? "bg-[#d4a550]/20 text-[#d4a550]"
                              : id === "qbo"
                                ? "bg-emerald-500/10 text-emerald-400"
                                : id === "xero"
                                  ? "bg-sky-500/10 text-sky-400"
                                  : id === "sage"
                                    ? "bg-emerald-500/10 text-emerald-300"
                                    : "bg-slate-700 text-slate-300"
                          }`}
                        >
                          {icon}
                        </span>
                        <div>
                          <p className="font-semibold text-slate-100 text-sm">{title}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
                        </div>
                      </button>
                    );
                  })}
                  <button
                    onClick={() => {
                      setFirstRunStep(null);
                      setShowFinData(true);
                      setShowInputs(true);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-400 underline pt-1 text-center"
                  >
                    Enter figures manually
                  </button>
                  <button
                    onClick={enterSampleMode}
                    className="text-xs text-sky-400 hover:text-sky-300 pt-0.5 text-center"
                  >
                    Not ready? See the board with a sample business first
                  </button>
                  <button
                    onClick={() => setFirstRunStep(null)}
                    className="text-xs text-slate-600 hover:text-slate-400 pt-0.5 text-center"
                  >
                    Skip for now — the board will point you back here
                  </button>
                </div>
              </DialogContent>
            </Dialog>

            {!actingClientId && (
              <VerifyEmailBanner
                email={user.email}
                pending={user.user_metadata?.email_verify_pending === true}
              />
            )}

            {!showOwnerDoor && sampleMode && (
              <SampleBoardBanner
                blurb={SAMPLE_BUSINESS_BLURB}
                onUseMyFigures={() => {
                  exitSampleMode();
                  setFirstRunStep("first-data");
                }}
                onExit={exitSampleMode}
              />
            )}

            {/* Next Step (P0.4): first screen is action, not ratios. Hidden in
                sample mode — the sample business has no advisory state. */}
            {!showOwnerDoor && effectiveClientId && !sampleMode ? (
              <div className="mb-3">
                <NextStepCard
                  clientId={effectiveClientId}
                  audience="owner"
                  surface="owner_app"
                  refreshKey={`${activeTab}|${firstRunStep ?? ""}|${showOnboarding ? 1 : 0}|${
                    clientMeta?.budget_updated_at ?? ""
                  }|${advisoryBump}`}
                  onAct={handleNextStepAct}
                />
                {needsBalanceSheetPrompt(v) ? (
                  <BalanceSheetPrompt onUpload={() => setShowFinData(true)} />
                ) : null}
                {/* P0.6 — tracked asks for missing / stale data; hidden when nothing is open. */}
                {userRole !== "client_member" ? (
                  <DataRequestsPanel
                    className="mt-3"
                    clientId={effectiveClientId}
                    audience="owner"
                    financials={v as unknown as Record<string, unknown>}
                    refreshKey={`${activeTab}|${advisoryBump}|${firstRunStep ?? ""}`}
                    onUpload={() => setFirstRunStep("first-data")}
                    onOpenForecast={() => setActiveTab("cash")}
                    onChanged={() => setAdvisoryBump((n) => n + 1)}
                  />
                ) : null}
              </div>
            ) : null}

            {!showOwnerDoor &&
            userRole === "client_owner" &&
            !actingClientId &&
            effectiveClientId ? (
              <div className="mb-3">
                <InviteAccountantCard clientId={effectiveClientId} tone="board" />
              </div>
            ) : null}

            {!showOwnerDoor ? (
              <Tabs
                id="owner-board-tabs"
                value={activeTab}
                onValueChange={setActiveTab}
                className="w-full"
              >
                <TabsList className="mb-2 flex h-auto w-full gap-0 overflow-x-auto rounded-none border-0 border-b border-[#b7872a]/20 bg-transparent p-0 [-ms-overflow-style:none] [scrollbar-width:none] sm:grid sm:grid-cols-6 [&::-webkit-scrollbar]:hidden">
                  {[
                    { value: "today", label: "Business Health", short: "Health" },
                    { value: "waterfall", label: "Profit", short: "Profit" },
                    { value: "cash", label: "Cash Forecast", short: "Cash" },
                    { value: "budget", label: "Budget", short: "Budget" },
                    { value: "next", label: "Next moves", short: "Moves" },
                    { value: "tasks", label: "Action Plan", short: "Plan" },
                  ].map((t) => (
                    <TabsTrigger
                      key={t.value}
                      value={t.value}
                      className="min-w-[4.5rem] flex-1 whitespace-nowrap rounded-none border-0 border-b-2 border-transparent bg-transparent px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 shadow-none transition-all data-[state=active]:border-[#d4a550] data-[state=active]:bg-transparent data-[state=active]:text-[#b8860b] data-[state=active]:shadow-none dark:text-slate-500 dark:data-[state=active]:text-[#d4a550] sm:min-w-0 sm:px-1 sm:text-[10px] sm:tracking-[0.18em]"
                    >
                      <span className="sm:hidden">{t.short}</span>
                      <span className="hidden sm:inline">{t.label}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>

                {/* View mode only changes Health, Cash, and Next moves. Budget's control is in its drawer. */}
                {["today", "cash", "next"].includes(activeTab) && (
                  <div className="relative z-10 mb-4 mt-1 flex justify-center">
                    <div className="flex items-center gap-0.5 rounded-full border border-slate-200/80 bg-slate-100/80 p-[3px] dark:border-white/10 dark:bg-white/5">
                      {(["simplified", "complex"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            setViewMode(m);
                            track("view_mode_toggled", {
                              mode: m,
                              surface: "owner_app",
                              clientId: effectiveClientId,
                            });
                          }}
                          className={`rounded-full px-4 py-[5px] text-[11px] font-semibold uppercase tracking-[0.08em] transition-all ${
                            viewMode === m
                              ? "bg-[#d4a550] text-[#0a0e1a] shadow-[0_2px_8px_rgba(212,165,80,0.35)]"
                              : "bg-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400/70 dark:hover:text-slate-300"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <TabsContent value="today" className="mt-0">
                  <TabErrorBoundary label="Business Health">
                    {needsTrialBalanceRefresh({
                      live: v as unknown as Record<string, unknown>,
                      snapshots: history,
                    }) ? (
                      <TrialBalanceRefreshPrompt onImport={() => setFirstRunStep("first-data")} />
                    ) : null}
                    {viewMode === "simplified" ? (
                      <div className="pb-6">
                        {/* Page header — aligned with rail top */}
                        <PageHeader
                          compact
                          className="mb-3 !items-start dark:[&_.milon-page-header__title]:text-white [&_.milon-page-header__title]:text-slate-900 [&_.milon-page-header__subtitle]:text-slate-500 dark:[&_.milon-page-header__subtitle]:text-slate-400"
                          title="Business Health"
                          subtitle="Your financial pulse at a glance."
                          meta={
                            <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-start">
                              {hasRealFinancials ? (
                                <StatusPill
                                  variant="live"
                                  pulse
                                  className="!text-[9px] !tracking-[0.16em]"
                                >
                                  Live ·{" "}
                                  {formatDate(new Date(), boardMarket).toUpperCase()}
                                </StatusPill>
                              ) : sampleMode ? (
                                <StatusPill
                                  variant="sample"
                                  className="!text-[9px] !tracking-[0.16em]"
                                >
                                  Sample · illustrative
                                </StatusPill>
                              ) : (
                                <StatusPill
                                  variant="neutral"
                                  className="!text-[9px] !tracking-[0.16em]"
                                >
                                  No data yet
                                </StatusPill>
                              )}
                            </div>
                          }
                        />

                        {/* No-data empty state — shown until owner uploads or enters real financials */}
                        {!showScoredBoard && !actingClientId ? (
                          <div>
                            <div className="founder-overview-grid grid w-full items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_300px]">
                              <div className="flex w-full flex-col gap-3">
                                {profileNeedsCompletion(operatingProfile) &&
                                  userRole !== "client_member" && (
                                    <ProfileCompletionNote
                                      onFinish={() => openProfileDialog("complete")}
                                    />
                                  )}
                                <OwnerBrainDrip
                                  clientId={effectiveClientId}
                                  operatingProfile={operatingProfile}
                                  productMix={productMix}
                                  weeklyInputs={weeklyInputs}
                                  snapshotCount={history.length}
                                  hasLiveFigures={hasRealFinancials}
                                  onAddPastPeriod={
                                    firstRunStep === null
                                      ? () => setPastPeriodOpen(true)
                                      : undefined
                                  }
                                  onSaveProfile={saveDripProfile}
                                  onSaveProductMix={saveProductMix}
                                  onSaveWeekly={saveDripWeekly}
                                  enabled={firstRunStep === null}
                                />
                                <EmptyState
                                  id="wizard-empty-score"
                                  dashed
                                  className="w-full !gap-5 !px-4 !py-10 dark:[&_.milon-empty-state__title]:text-slate-100 [&_.milon-empty-state__title]:text-slate-800 [&_.milon-empty-state__desc]:text-slate-500"
                                  icon={
                                    <div className="relative flex h-36 w-36 items-center justify-center">
                                      <div className="absolute inset-0 rounded-full border-2 border-dashed border-[#d4a550]/25" />
                                      <div className="absolute inset-5 rounded-full border border-[#d4a550]/15" />
                                      <div className="flex flex-col items-center gap-1">
                                        <span className="text-3xl font-bold text-slate-400">—</span>
                                        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                          No score yet
                                        </span>
                                      </div>
                                    </div>
                                  }
                                  title={
                                    <>
                                      {userRole !== "client_member" && operatingProfile && (
                                        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b8860b] dark:text-[#d4a550]">
                                          Step 2 of 2 · Bring in your numbers
                                        </span>
                                      )}
                                      {userRole !== "client_member"
                                        ? "One upload and your board comes alive"
                                        : "Add your financials to see your score"}
                                    </>
                                  }
                                  description={
                                    isUsCopy(boardMarket)
                                      ? "Upload a P&L and balance sheet — Excel, OpenDocument, CSV or PDF — and MILŌN scores your business and ranks your first move. No invented numbers until then."
                                      : "Drop ~3 months of bank statements and MILŌN drafts your P&L, cash forecast and budget, then scores your business and ranks your first move — no invented numbers until then."
                                  }
                                  action={
                                    userRole !== "client_member" ? (
                                      <div className="flex w-full max-w-sm flex-col gap-2.5">
                                        <button
                                          id="wizard-first-figures"
                                          onClick={() => {
                                            if (isUsCopy(boardMarket)) {
                                              setShowFinData(true);
                                              setTimeout(() => uploadRef.current?.click(), 150);
                                            } else {
                                              setShowBankDrafter(true);
                                            }
                                          }}
                                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#b7872a] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[#d4a550]"
                                        >
                                          <Upload className="h-4 w-4" />
                                          {isUsCopy(boardMarket)
                                            ? "Upload Excel, ODS, CSV or PDF financials"
                                            : "Upload bank statements"}
                                        </button>
                                        <div className="flex w-full flex-col gap-2.5 sm:flex-row">
                                          {isUsCopy(boardMarket) ? (
                                            <button
                                              onClick={() => setShowQboDialog(true)}
                                              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                            >
                                              <Plug2 className="h-4 w-4" />
                                              Connect QuickBooks
                                            </button>
                                          ) : (
                                            <button
                                              onClick={() => {
                                                setShowFinData(true);
                                                setTimeout(() => uploadRef.current?.click(), 150);
                                              }}
                                              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                            >
                                              <Upload className="h-4 w-4" />
                                              Upload a financial statement
                                            </button>
                                          )}
                                          <button
                                            onClick={() => setShowXeroDialog(true)}
                                            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                          >
                                            <Plug2 className="h-4 w-4" />
                                            Connect Xero
                                          </button>
                                          {!isUsCopy(boardMarket) ? (
                                            <button
                                              type="button"
                                              id="owner-empty-sage"
                                              onClick={() => setShowSageDialog(true)}
                                              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                            >
                                              <Plug2 className="h-4 w-4" />
                                              Connect Sage
                                            </button>
                                          ) : null}
                                          <button
                                            onClick={() => {
                                              setShowFinData(true);
                                              setShowInputs(true);
                                            }}
                                            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                          >
                                            <Database className="h-4 w-4" />
                                            Enter manually
                                          </button>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-500">
                                          {isUsCopy(boardMarket) && (
                                            <button
                                              onClick={() => setShowBankDrafter(true)}
                                              className="underline hover:text-slate-700 dark:hover:text-slate-300"
                                            >
                                              Have bank statements instead? Upload those
                                            </button>
                                          )}
                                          <button
                                            onClick={() => setFirstRunStep("first-data")}
                                            className="underline hover:text-slate-700 dark:hover:text-slate-300"
                                          >
                                            See all ways to add figures
                                          </button>
                                        </div>
                                        <button
                                          id="wizard-sample-board"
                                          onClick={enterSampleMode}
                                          className="mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-sky-500/40 px-3 py-1.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-500/10 dark:text-sky-300"
                                        >
                                          <FlaskConical className="h-3.5 w-3.5" />
                                          Not ready? See the board with a sample business
                                        </button>
                                      </div>
                                    ) : (
                                      <p className="max-w-sm text-center text-sm text-slate-500">
                                        Financial data hasn't been added yet. The owner will set
                                        this up.
                                      </p>
                                    )
                                  }
                                />
                                {/* Same Milōn Bot mount as the scored board — before figures it
                                  carries a small "more relevant once your figures are in" note. */}
                                <div
                                  id="ask-ai-overview"
                                  className="min-h-[44px] w-full rounded-xl border border-[#b7872a]/25 bg-white dark:bg-[#0a1020]/80"
                                />
                              </div>
                              <OverviewRail
                                healthBand={null}
                                weekChanges={[]}
                                cashTrajectory={null}
                                onOpenCash={() => setActiveTab("cash")}
                                onOpenMoves={() => setActiveTab("next")}
                                onOpenBenchmarks={() => {
                                  setActiveTab("today");
                                  setViewMode("complex");
                                }}
                                industryPulse={<IndustryPulse industry={industryLabel} vertical />}
                              />
                            </div>
                            <IndustryNewsBand industry={industryLabel} />
                          </div>
                        ) : (
                          <div>
                            <div className="founder-overview-grid grid w-full items-start gap-4 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_300px]">
                              {/* Main column */}
                              <section className="flex min-w-0 flex-col gap-3">
                                {profileNeedsCompletion(operatingProfile) &&
                                  userRole !== "client_member" &&
                                  !actingClientId && (
                                    <ProfileCompletionNote
                                      onFinish={() => openProfileDialog("complete")}
                                    />
                                  )}
                                <OwnerBrainDrip
                                  clientId={effectiveClientId}
                                  operatingProfile={operatingProfile}
                                  productMix={productMix}
                                  weeklyInputs={weeklyInputs}
                                  snapshotCount={history.length}
                                  hasLiveFigures={hasRealFinancials}
                                  onAddPastPeriod={
                                    firstRunStep === null
                                      ? () => setPastPeriodOpen(true)
                                      : undefined
                                  }
                                  onSaveProfile={saveDripProfile}
                                  onSaveProductMix={saveProductMix}
                                  onSaveWeekly={saveDripWeekly}
                                  enabled={firstRunStep === null}
                                />
                                {needsPastPeriodPrompt({
                                  hasLiveFigures: hasRealFinancials,
                                  firstRunBusy: firstRunStep !== null,
                                  snapshots: history,
                                }) && userRole !== "client_member" ? (
                                  <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                                    Trend lines and comparison figures need another period.{" "}
                                    <AddPastPeriodLink onOpen={() => setPastPeriodOpen(true)} />
                                  </p>
                                ) : null}
                                <CollectionsOverdueNote
                                  clientId={effectiveClientId}
                                  market={boardMarket}
                                />
                                <PayablesOverdueNote
                                  clientId={effectiveClientId}
                                  market={boardMarket}
                                />
                                <div className="relative rounded-xl border border-[#DBEAFE] bg-white px-3 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-[#0f172a]/40 dark:shadow-none sm:px-5">
                                  <OwnerSignoffMark
                                    signoff={financialsSignoff}
                                    isStale={financialsSignoffStale}
                                    scopeLabel={signoffScopeLabel("financials")}
                                    className="mb-2"
                                  />
                                  <SphereHero
                                    compact
                                    overallHealth={ownerEvidence && Number.isFinite(avgHealth) ? avgHealth : Number.NaN}
                                    displayStatus={ownerEvidence ? (ownerStatusCritical ? "critical" : overallHealth.displayStatus) : undefined}
                                    statusLabel={ownerEvidence ? (ownerStatusCritical ? ownerStatusWord : null) : NOT_SCORED_YET_LABEL}
                                    pillars={spherePillars}
                                    cashFloorCue={ownerCashFloorCue}
                                    onCashFloor={openOwnerFm}
                                    caption={overviewCaption}
                                    topPriority={
                                      nextSteps[0]
                                        ? {
                                            title: nextSteps[0].title,
                                            description:
                                              nextSteps[0].key === "debtorDays"
                                                ? "Cash conversion is your biggest constraint."
                                                : (() => {
                                                    const pillarId = strategicMovePillar(nextSteps[0].key);
                                                    const pillar = pillarId
                                                      ? overallHealth.pillars.find((row) => row.id === pillarId)
                                                      : null;
                                                    const lever =
                                                      pillar?.score != null
                                                        ? `${pillar.label} ${Math.round(pillar.score)}`
                                                        : (pillar?.label ?? "Profit");
                                                    return `${lever} is your highest-impact lever right now.`;
                                                  })(),
                                            actions: nextSteps[0].actions,
                                            impactLabel: nextMoveImpactLabel,
                                          }
                                        : {
                                            title: "Upload your financial data",
                                            description:
                                              "Add your figures to get a personalised score and first move.",
                                          }
                                    }
                                    onTopPriority={() => setActiveTab("next")}
                                    onDriverClick={(key) => {
                                      if (key in RATIO_META) setOpenRatio(key as RatioKey);
                                    }}
                                  />
                                </div>

                                <div
                                  id="ask-ai-overview"
                                  className="min-h-[88px] w-full rounded-xl border border-[#b7872a]/35 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:bg-[#0a1020]/80"
                                />
                              </section>

                              {/* Insight rail — pulse metrics + compact cards only */}
                              <OverviewRail
                                healthBand={healthBand}
                                positionPercentile={positionPercentile}
                                weekChanges={weekChanges}
                                cashTrajectory={cashTrajectory}
                                onOpenCash={() => setActiveTab("cash")}
                                onOpenMoves={() => setActiveTab("next")}
                                onOpenBenchmarks={() => {
                                  setActiveTab("today");
                                  setViewMode("complex");
                                }}
                                industryPulse={<IndustryPulse industry={industryLabel} vertical />}
                              />
                            </div>
                            <IndustryNewsBand industry={industryLabel} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <div className="mb-3 flex min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                          <span className="text-[13px] font-semibold text-[#102A43]">
                            Financial ratios
                          </span>
                          <OwnerSignoffMark
                            signoff={financialsSignoff}
                            isStale={financialsSignoffStale}
                            scopeLabel={signoffScopeLabel("financials")}
                          />
                        </div>
                        {isUsCopy(boardMarket) && (
                          <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
                            {industryBenchmarkCaption(boardMarket)}
                          </p>
                        )}
                        {needsPastPeriodPrompt({
                          hasLiveFigures: hasRealFinancials,
                          firstRunBusy: firstRunStep !== null,
                          snapshots: history,
                        }) && userRole !== "client_member" ? (
                          <p className="mb-3 text-[12px] leading-relaxed text-slate-600 dark:text-slate-400">
                            The small trend on each row fills in once you add a past period — a
                            prior year or quarter. Until then you still see the graph slot; we do
                            not invent the history.{" "}
                            <AddPastPeriodLink onOpen={() => setPastPeriodOpen(true)} />
                          </p>
                        ) : null}
                        {!showScoredBoard && !actingClientId && (
                          <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-700/40 bg-amber-950/20 px-4 py-2.5 text-xs text-amber-300">
                            <span className="text-amber-400">⚠</span>
                            <span>
                              <span className="font-semibold">No financial data yet</span> — ratios
                              below show zero or undefined until figures are added.{" "}
                              {userRole !== "client_member" ? (
                                <>
                                  <button
                                    onClick={() => {
                                      setShowFinData(true);
                                      setTimeout(() => uploadRef.current?.click(), 150);
                                    }}
                                    className="underline hover:text-amber-200"
                                  >
                                    Upload your statement
                                  </button>{" "}
                                  or{" "}
                                  <button
                                    onClick={() => {
                                      setShowFinData(true);
                                      setShowInputs(true);
                                    }}
                                    className="underline hover:text-amber-200"
                                  >
                                    enter figures manually
                                  </button>{" "}
                                  to see your real score.
                                </>
                              ) : (
                                "The owner will add financial data."
                              )}
                            </span>
                          </div>
                        )}
                        <div className="space-y-3">
                          {/* Break-even callout */}
                          {isFinite(breakevenRevenue) && breakevenRevenue > 0 && (
                            <div className="rounded-md border border-amber-800/40 bg-amber-950/20 px-4 py-2 text-xs text-amber-200 flex items-center gap-2">
                              <span className="text-amber-400">⚡</span>
                              Estimated break-even revenue:{" "}
                              <span className="font-mono font-semibold ml-1">
                                {currencySymbol(boardMarket)}
                                {breakevenRevenue.toFixed(0)}
                              </span>
                            </div>
                          )}

                          {/* PPE movement callout — only shown when PPE inputs are provided */}
                          {isFinite(netPpe) && (
                            <div className="rounded-md border border-slate-700/60 bg-slate-800/30 px-4 py-3 text-xs text-slate-300">
                              <div className="mb-1.5 font-semibold text-slate-200 uppercase tracking-wide text-[10px]">
                                PPE Movement
                              </div>
                              <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                                <div>
                                  <span className="text-slate-500">Net PPE (current)</span>
                                  <div className="font-mono text-slate-200">
                                    {currencySymbol(boardMarket)}
                                    {netPpe.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                  </div>
                                </div>
                                {isFinite(priorNetPpe) && (
                                  <div>
                                    <span className="text-slate-500">Net PPE (prior)</span>
                                    <div className="font-mono text-slate-200">
                                      {currencySymbol(boardMarket)}
                                      {priorNetPpe.toLocaleString(undefined, {
                                        maximumFractionDigits: 0,
                                      })}
                                    </div>
                                  </div>
                                )}
                                {isFinite(ppeMovement) && (
                                  <div>
                                    <span className="text-slate-500">PPE Movement</span>
                                    <div
                                      className={`font-mono font-semibold ${ppeMovement >= 0 ? "text-emerald-400" : "text-red-400"}`}
                                    >
                                      {ppeMovement >= 0 ? "+" : ""}
                                      {currencySymbol(boardMarket)}
                                      {ppeMovement.toLocaleString(undefined, {
                                        maximumFractionDigits: 0,
                                      })}
                                    </div>
                                  </div>
                                )}
                                {isFinite(impliedCapex) && (
                                  <div>
                                    <span className="text-slate-500">Implied CAPEX</span>
                                    <div className="font-mono text-slate-200">
                                      {currencySymbol(boardMarket)}
                                      {impliedCapex.toLocaleString(undefined, {
                                        maximumFractionDigits: 0,
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Ratio section tables */}
                          {(
                            [
                              {
                                id: "profit",
                                title: PILLAR_LABELS.profit,
                                desc: "How your business converts sales into profit",
                                rows: [
                                  { sub: "Revenue" },
                                  { key: "revenueGrowth", indent: true },
                                  { key: "salesPerEmployee", indent: true },
                                  { sub: "Margins" },
                                  { key: "grossMargin", indent: true },
                                  { key: "directCostsRatio", indent: true },
                                  { key: "operatingMargin", indent: true },
                                  { key: "netMargin", indent: true },
                                  { sub: "Operating Expenses (OpEx)" },
                                  { key: "fixedCostRatio", indent: true },
                                  { key: "dol", indent: true },
                                  { sub: "Below-the-Line" },
                                  { key: "interestBurden", indent: true },
                                  { key: "taxBurden", indent: true },
                                ],
                              },
                              {
                                id: "asset",
                                title: PILLAR_LABELS.assets,
                                desc: "How efficiently assets generate revenue and return",
                                rows: [
                                  { sub: "Returns" },
                                  { key: "assetTurnover", indent: true },
                                  { key: "roa", indent: true },
                                  { sub: "Working Capital Utilisation" },
                                  { key: "workingCapitalUtilization", indent: true },
                                  { key: "workingCapitalDays", indent: true },
                                  { sub: "Fixed Capital Utilisation" },
                                  { key: "fixedCapitalUtilization", indent: true },
                                  { key: "inventoryDays", indent: true },
                                  { sub: "Capex" },
                                  { key: "capexIntensity", indent: true },
                                  { key: "assetReinvestmentRatio", indent: true },
                                ],
                              },
                              {
                                id: "leverage",
                                title: PILLAR_LABELS.financing,
                                desc: "Capital structure and shareholder return",
                                rows: [
                                  { sub: "Funding Structure" },
                                  { key: "fundingStructure", indent: true },
                                  { key: "debtToEquity", indent: true },
                                  { key: "debtToAssets", indent: true },
                                  { sub: "Shareholder Return" },
                                  { key: "equityMultiplier", indent: true },
                                  { key: "roe", indent: true },
                                ],
                              },
                              {
                                id: "cash",
                                title: PILLAR_LABELS.cash,
                                desc: "Working capital cycle and cash quality",
                                rows: [
                                  { sub: "Working Capital Cycle" },
                                  { key: "debtorDays", indent: true },
                                  { key: "creditorDays", indent: true },
                                  { sub: "Liquidity" },
                                  { key: "currentRatio", indent: true },
                                  { key: "workingCapitalFunding", indent: true },
                                  { sub: "Cash Quality" },
                                  { key: "ocfToEbitda", indent: true },
                                ],
                              },
                              {
                                id: "people",
                                title: "People & Systems",
                                desc: "Team productivity, customer dependency, and founder reliance",
                                rows: [
                                  { key: "customerConcentration" },
                                  { key: "gpToLabor" },
                                  { key: "revenuePerFounderHour" },
                                ],
                              },
                            ] as Array<{
                              id: string;
                              title: string;
                              desc: string;
                              rows: Array<{ key: RatioKey; indent?: boolean } | { sub: string }>;
                            }>
                          ).map((section) => (
                            <div
                              key={section.id}
                              className="overflow-hidden rounded-xl border border-amber-900/15 bg-white/80 shadow-[0_10px_30px_rgba(109,79,22,0.06)] dark:border-slate-800 dark:bg-slate-900/50 dark:shadow-none"
                            >
                              <div className="flex items-baseline gap-3 border-b border-amber-900/10 bg-amber-50/60 px-4 py-3 dark:border-slate-700/50 dark:bg-slate-800/60">
                                <span className="text-sm font-semibold text-slate-950 dark:text-slate-100">
                                  {section.title}
                                </span>
                                <span className="hidden text-xs text-slate-600 dark:text-slate-400 sm:inline">
                                  {section.desc}
                                </span>
                              </div>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b border-amber-900/10 bg-amber-50/25 dark:border-slate-800/80 dark:bg-slate-900/30">
                                    <th className="w-44 px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-500">
                                      Metric
                                    </th>
                                    <th className="hidden px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-500 md:table-cell">
                                      Description
                                    </th>
                                    <th className="w-20 px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-500">
                                      Trend
                                    </th>
                                    <th className="w-20 px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-500">
                                      {industryBenchmarkShortLabel(boardMarket)}
                                    </th>
                                    <th className="w-24 px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-500">
                                      Health
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {section.rows.map((row, ri) => {
                                    if ("sub" in row) {
                                      return (
                                        <tr
                                          key={`sub-${ri}`}
                                          className="border-t border-amber-900/10 bg-amber-50/30 dark:border-slate-700/20 dark:bg-slate-800/25"
                                        >
                                          <td
                                            colSpan={5}
                                            className="pl-8 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400"
                                          >
                                            ↳ {row.sub}
                                          </td>
                                        </tr>
                                      );
                                    }
                                    const k = row.key;
                                    const meta = RATIO_META[k];
                                    const storedVal = valueMap[k].value;
                                    const rawVal =
                                      typeof storedVal === "number" && Number.isFinite(storedVal)
                                        ? storedVal
                                        : Number.NaN;
                                    const fmt = valueMap[k].format;
                                    const daysMissing = fmt === "days" && !isFinite(rawVal);
                                    const health = daysMissing ? Number.NaN : healthMap[k];
                                    const series = seriesFor(k, rawVal);
                                    const delta = pctDelta(series);
                                    const bm = benchmarkFor(k);
                                    const fmtd = daysMissing
                                      ? "—"
                                      : !isFinite(rawVal)
                                        ? "Not enough data"
                                        : fmt === "pct"
                                          ? `${(rawVal * 100).toFixed(1)}%`
                                          : fmt === "x"
                                            ? `${rawVal.toFixed(2)}×`
                                            : fmt === "days"
                                              ? `${Math.round(rawVal)} d`
                                              : formatNumber(rawVal, boardMarket);
                                    const healthTier = scoreTier(health);
                                    const hCls = !isFinite(health)
                                      ? "text-slate-400"
                                      : healthTier === "healthy"
                                        ? "text-emerald-400"
                                        : healthTier === "at_risk"
                                          ? "text-amber-400"
                                          : "text-rose-400";
                                    const hLabelCls = !isFinite(health)
                                      ? "text-slate-500/70"
                                      : healthTier === "healthy"
                                        ? "text-emerald-500/70"
                                        : healthTier === "at_risk"
                                          ? "text-amber-500/70"
                                          : "text-rose-500/70";
                                    const actual = ratioActualLine(k, v, (amt) =>
                                      formatMoneyCompact(amt, boardMarket),
                                    );
                                    const actualLine =
                                      actual.calculation ??
                                      (actual.missing.length
                                        ? `Need: ${actual.missing.join(", ")}`
                                        : null);
                                    return (
                                      <tr
                                        key={k}
                                        data-row-id={k}
                                        onClick={() => setOpenRatio(k)}
                                        className={`cursor-pointer border-b border-amber-900/10 transition-colors dark:border-slate-800/40 ${row.indent ? "bg-amber-50/25 dark:bg-slate-800/10" : ""} ${k === highlightId ? "bg-[#f7d98a]/15 ring-2 ring-inset ring-[#b7872a] dark:bg-[rgba(247,217,138,0.08)]" : "hover:bg-amber-50/60 dark:hover:bg-slate-800/50"}`}
                                      >
                                        <td className="px-4 py-3">
                                          <div className="text-[13px] font-medium leading-tight text-slate-950 dark:text-slate-100">
                                            {meta.friendly}
                                          </div>
                                          <div className="mt-0.5 font-mono text-[10px] text-slate-600 dark:text-slate-500">
                                            {localizeCopy(meta.techName, boardMarket)}
                                          </div>
                                          {actualLine ? (
                                            <div className="mt-0.5 font-mono text-[10px] font-semibold tabular-nums leading-snug text-slate-700 dark:text-slate-300">
                                              {actualLine}
                                            </div>
                                          ) : null}
                                          <div
                                            className={`text-xs font-semibold tabular-nums mt-0.5 ${hCls}`}
                                          >
                                            {fmtd}
                                          </div>
                                        </td>
                                        <td
                                          className="hidden px-4 py-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400 md:table-cell"
                                          style={{ maxWidth: 240 }}
                                        >
                                          {meta.hint}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                          {series.length >= 2 ? (
                                            <div className="flex flex-col items-center gap-0.5">
                                              <KpiTrendline
                                                values={series}
                                                width={52}
                                                height={18}
                                              />
                                              {delta !== null && (
                                                <span
                                                  className={`text-[9px] tabular-nums ${delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                                                >
                                                  {delta >= 0 ? "+" : ""}
                                                  {(delta * 100).toFixed(1)}%
                                                </span>
                                              )}
                                            </div>
                                          ) : isFinite(rawVal) ? (
                                            <KpiTrendline
                                              values={series}
                                              width={52}
                                              height={18}
                                              placeholder
                                            />
                                          ) : (
                                            <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                              —
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-2 py-3 text-center">
                                          {bm && isFinite(rawVal) ? (
                                            <IndustryQuintile
                                              health={health}
                                              title={`${industryBenchmarkShortLabel(boardMarket)}: p25=${bm.p25} p50=${bm.p50} p75=${bm.p75}`}
                                            />
                                          ) : (
                                            <span className="text-[11px] text-slate-400 dark:text-slate-500">
                                              —
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                          <div className={`text-sm font-bold tabular-nums ${hCls}`}>
                                            {k === "grossMargin" && grossImplausible
                                              ? "—"
                                              : isFinite(health)
                                                ? `${Math.round(health)}`
                                                : "—"}
                                          </div>
                                          <div className={`text-[10px] ${hLabelCls}`}>
                                            {daysMissing
                                              ? HEALTH_NOT_ENOUGH_DATA
                                              : k === "grossMargin" && grossImplausible
                                                ? GROSS_MARGIN_MAPPING_NOTE
                                                : isFinite(health)
                                                  ? healthBandLabel(healthTier)
                                                  : "—"}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </TabErrorBoundary>
                </TabsContent>

                <TabsContent value="waterfall">
                  <TabErrorBoundary label="Profit">
                    <div
                      id="wizard-owner-signoff"
                      className="mb-3 flex min-w-0 flex-col items-stretch sm:items-end"
                    >
                      <OwnerSignoffMark
                        signoff={profitabilitySignoff}
                        isStale={computeIsStale(
                          profitabilitySignoff,
                          clientMeta?.financials_updated_at ?? null,
                        )}
                      />
                    </div>
                    {!showScoredBoard && !actingClientId && userRole !== "client_member" && (
                      <NoFiguresBanner
                        tabLabel="Profit"
                        detail="The waterfall below is an empty frame until revenue and costs land."
                        onAddFigures={() => setFirstRunStep("first-data")}
                      />
                    )}
                    {/* Milōn Bot first — same widget as Business Health, scoped to this client */}
                    <div
                      id="ask-ai-waterfall"
                      className="mb-4 w-full rounded-xl border border-[#b7872a]/30 bg-white dark:bg-[#0a1020]/80"
                    />
                    <div id="wizard-profit-walk">
                      <ProfitabilityWaterfall
                        clientName={actingClientName ?? undefined}
                        clientId={effectiveClientId ?? undefined}
                        reviewSignoff={stampFromSignoff(
                          profitabilitySignoff,
                          computeIsStale(
                            profitabilitySignoff,
                            clientMeta?.financials_updated_at ?? null,
                          ),
                        )}
                        fallback={ownerWaterfallFallback}
                        periodLabel={ownerProfitPeriodLabel}
                        preferPeriod={preferStatementPeriod(v)}
                        yearToDate={statementYearLine(v, boardMarket)}
                        statementSource={readStatementMeta(v, boardMarket).statementSource}
                      />
                    </div>
                    {/* Optional product-line mix — collapsed until the owner opts in */}
                    <div id="wizard-product-mix" className="mt-4">
                      <ProductMixPanel
                        totalRevenue={
                          resolveWaterfallFigures(weeklyInputs, ownerWaterfallFallback, {
                            preferPeriod: preferStatementPeriod(v),
                          }).revenue
                        }
                      />
                    </div>
                    {/* Weekly inputs feed the waterfall — sit below so the chart stays the focus */}
                    <div className="mt-4">
                      <WeeklyInputTable />
                    </div>
                  </TabErrorBoundary>
                </TabsContent>

                <TabsContent value="next">
                  <div className="mb-4 flex items-center gap-3 pb-3">
                    <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#b8860b] dark:text-[#d4a550]/80">
                      Next Moves
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-r from-[#b7872a]/30 to-transparent" />
                  </div>
                  {!showScoredBoard && !actingClientId && userRole !== "client_member" && (
                    <NoFiguresBanner
                      tabLabel="Next moves"
                      detail="The list below is the generic playbook — it is ranked for your business only once your figures are in."
                      onAddFigures={() => setFirstRunStep("first-data")}
                    />
                  )}
                  {/* P1 — the advisory pack frames the moves below; owner reads / accepts it here. */}
                  {effectiveClientId && !sampleMode && userRole !== "client_member" ? (
                    <AdvisoryPackPanel
                      className="mb-5"
                      clientId={effectiveClientId}
                      firmId={clientMeta?.firm_id ?? null}
                      signoff={advisorySignoff}
                      audience="owner"
                      liveHealth={liveScoreSnapshot}
                      canGenerate={hasRealFinancials}
                      hasFirm={Boolean(clientMeta?.firm_id)}
                      refreshKey={`${activeTab}|${advisoryBump}`}
                      onChanged={() => setAdvisoryBump((n) => n + 1)}
                      currentFigures={{
                        runwayLabel: clientListRunwayHeadline({
                          source: ownerOutlook.source,
                          opening: ownerOutlook.opening,
                          closings: ownerOutlook.closing,
                          floor: ownerOutlook.floor,
                          totalInflow: ownerOutlook.totalInflow,
                          totalOutflow: ownerOutlook.totalOutflow,
                          runwayLabel: runwayDisplayLabel(ownerMetrics.runway),
                          cashGenerative: ownerMetrics.runway.kind === "cash_generative",
                          healthOverall: overallHealth.overall,
                          openingMissing: ownerOpeningMissing,
                        }),
                        cash: ownerOutlook.opening,
                        healthScore: overallHealth.overall,
                      }}
                    />
                  ) : null}
                  {/* P3 — owner-only clients can ask a listed firm to review the pack; hidden once a firm is attached. */}
                  {effectiveClientId &&
                  !sampleMode &&
                  userRole !== "client_member" &&
                  !clientMeta?.firm_id ? (
                    <FindAccountantPanel
                      className="mb-5"
                      clientId={effectiveClientId}
                      hasFirm={Boolean(clientMeta?.firm_id)}
                      packStatus={null}
                      refreshKey={`${activeTab}|${advisoryBump}`}
                      onChanged={() => setAdvisoryBump((n) => n + 1)}
                    />
                  ) : null}
                  {/* P0.5 — recommendations the owner decides on directly; no accountant required. */}
                  {effectiveClientId && !sampleMode && userRole !== "client_member" ? (
                    <RecommendationsPanel
                      className="mb-5"
                      clientId={effectiveClientId}
                      firmId={clientMeta?.firm_id ?? null}
                      audience="owner"
                      canPropose={hasRealFinancials}
                      refreshKey={advisoryBump}
                      onChanged={() => setAdvisoryBump((n) => n + 1)}
                      onOpenActions={() => setActiveTab("tasks")}
                      onAddFigures={() => setFirstRunStep("first-data")}
                    />
                  ) : null}
                  {/* P2.1 — did the money move? measured from snapshots; manual where statements can't tell. */}
                  {effectiveClientId && !sampleMode && userRole !== "client_member" ? (
                    <OutcomesPanel
                      className="mb-5"
                      clientId={effectiveClientId}
                      audience="owner"
                      refreshKey={`${activeTab}|${advisoryBump}`}
                      onChanged={() => setAdvisoryBump((n) => n + 1)}
                    />
                  ) : null}
                  <div id="wizard-moves-list">
                    <NextStepsPanel
                      steps={nextSteps}
                      simplified={viewMode === "simplified"}
                      done={doneSteps}
                      onToggleDone={toggleDone}
                      onOpenSop={(k) => setOpenSop(k)}
                      clientId={effectiveClientId}
                      clientName={actingClientName ?? undefined}
                      isOwner={userRole !== "client_member"}
                      onGoToPlan={(k) => {
                        setPlanFocusKey(k);
                        setActiveTab("tasks");
                      }}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="cash">
                  <div id="wizard-cash-panel">
                    {!showScoredBoard && !actingClientId && userRole !== "client_member" && (
                      <NoFiguresBanner
                        tabLabel="Cash Forecast"
                        detail="Zeros below are placeholders, not a forecast. Bank statements can draft the 13 weeks for you."
                        onAddFigures={() => setFirstRunStep("first-data")}
                      />
                    )}
                    <TabErrorBoundary label="Cash Forecast">
                      <Suspense
                        fallback={
                          <div className="p-6 text-sm text-slate-400">Loading cash forecast…</div>
                        }
                      >
                        <CashForecastPanel
                          clientId={effectiveClientId ?? undefined}
                          clientName={actingClientName ?? undefined}
                          simplified={viewMode === "simplified"}
                          canSign={
                            (userRole === "accountant" || userRole === "firm_admin") &&
                            !!actingClientId
                          }
                          hideReadOnlyStamp
                          reloadToken={cashForecastReloadToken}
                        />
                      </Suspense>
                    </TabErrorBoundary>
                  </div>
                </TabsContent>

                <TabsContent value="budget">
                  <div id="wizard-budget-panel">
                    <TabErrorBoundary label="Budget">
                      <Suspense
                        fallback={<div className="p-6 text-sm text-slate-400">Loading budget…</div>}
                      >
                        <BudgetPanel
                          clientId={effectiveClientId ?? undefined}
                          clientName={actingClientName ?? undefined}
                          simplified={viewMode === "simplified"}
                          onViewModeChange={setViewMode}
                          role={
                            userRole === "accountant" || userRole === "firm_admin"
                              ? "accountant"
                              : "owner"
                          }
                          canSign={
                            (userRole === "accountant" || userRole === "firm_admin") &&
                            !!actingClientId
                          }
                          hideReadOnlyStamp
                          businessTypeId={businessTypeId}
                          operatingProfile={operatingProfile}
                          fyStartMonthDefault={
                            operatingProfile?.fyStartMonth ??
                            resolveMarket(coerceMarketSelection(workspaceMarket))
                              .fyStartMonthDefault
                          }
                          onRetakeProfile={() => openProfileDialog("retake")}
                          firstActualsMonth={
                            hasRealFinancials
                              ? (history[0]?.period_date?.slice(0, 7) ?? null)
                              : null
                          }
                          financials={{
                            revenue: v.revenue,
                            cogs: v.cogs,
                            fixedCosts: v.fixedCosts,
                            laborCost: v.laborCost,
                            receivables: v.receivables,
                            payables: v.payables,
                            inventory: v.inventory,
                            operatingCashflow: v.operatingCashflow,
                            // Months the P&L covers — without it a quarter seeds as a year.
                            [PERIOD_MONTHS_KEY]: v[PERIOD_MONTHS_KEY] ?? "",
                            ...(v.periodStart ? { periodStart: v.periodStart } : {}),
                            ...(v.periodEnd ? { periodEnd: v.periodEnd } : {}),
                            ...budgetProfitFields(v),
                          }}
                          onPushedToCash={() => setCashForecastReloadToken((n) => n + 1)}
                          reloadToken={budgetReloadToken}
                        />
                      </Suspense>
                    </TabErrorBoundary>
                  </div>
                </TabsContent>

                <TabsContent value="tasks">
                  <div id="wizard-tasks-panel">
                    <TabErrorBoundary label="Action Plan">
                      <Suspense
                        fallback={<div className="p-6 text-sm text-slate-400">Loading tasks…</div>}
                      >
                        {effectiveClientId ? (
                          <ActionPlanPanel
                            clientId={effectiveClientId}
                            clientName={actingClientName ?? undefined}
                            simplified={viewMode === "simplified"}
                            isOwner={userRole !== "client_member"}
                            canonicalRatios={ownerCanonicalRatios}
                            healthSnapshot={liveScoreSnapshot}
                            figuresUpdatedAt={figuresUpdatedAt}
                            cashBelowFloor={ownerCashBelowFloor}
                            ownerSignoff={actionPlanSignoff}
                            ownerSignoffStale={computeIsStale(
                              actionPlanSignoff,
                              clientMeta?.financials_updated_at ?? null,
                            )}
                            pillars={overallHealth.pillars}
                            moves={nextSteps.map((s) =>
                              attachPillarScore(
                                {
                                  key: s.key,
                                  title: rewriteDraftMonthStamp(s.title),
                                  ratioName: s.ratioName,
                                  impactLine: s.impactLine,
                                  health: Number.isFinite(s.health) ? s.health : Number.NaN,
                                },
                                overallHealth.pillars,
                              ),
                            )}
                            onViewAnalysis={() => {
                              setViewMode("complex");
                              setActiveTab("today");
                            }}
                            onOpenDraft={(id) => {
                              const node = document.querySelector(`[data-draft="${CSS.escape(id)}"]`);
                              if (node instanceof HTMLElement) node.scrollIntoView({ block: "center" });
                            }}
                            focusMoveKey={planFocusKey}
                            onFocusHandled={() => setPlanFocusKey(null)}
                          />
                        ) : (
                          <div className="p-6 text-sm text-slate-400">No client linked yet.</div>
                        )}
                      </Suspense>
                    </TabErrorBoundary>
                  </div>
                </TabsContent>
              </Tabs>
            ) : null}
          </div>

          {/* Contextual Notes overlay — fixed to viewport, tab-scoped, persisted per client */}
          <NoteLayer
            clientId={effectiveClientId}
            tab={activeTab}
            workspace="owner"
            clientName={actingClientName ?? undefined}
            authorName={
              (user?.user_metadata as { full_name?: string; name?: string } | null)?.full_name ??
              (user?.user_metadata as { full_name?: string; name?: string } | null)?.name ??
              user?.email ??
              "User"
            }
            onNeedTab={(next) => setActiveTab(next)}
          />

          {/* Admin Dashboard Dialog — firm_admin only */}
          <Dialog open={adminOpen} onOpenChange={setAdminOpen}>
            <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto border border-[#d4a550]/30 bg-[#0d1628] text-slate-100">
              <DialogHeader>
                <DialogTitle className="text-base font-bold tracking-wide text-[#d4a550]">
                  Admin · Activity Dashboard
                </DialogTitle>
                <DialogDescription className="text-[11px] text-slate-500">
                  This-session snapshot. Lasting usage lives in Lighthouse → Usage.
                </DialogDescription>
              </DialogHeader>
              <AdminDashboard />
            </DialogContent>
          </Dialog>

          <OwnerRatioBriefing
            ratioKey={openRatio}
            meta={openRatio ? RATIO_META[openRatio] : null}
            open={openRatio !== null}
            onClose={() => setOpenRatio(null)}
            market={boardMarket}
            figures={n}
            inputs={v}
            value={openRatio ? valueMap[openRatio].value : Number.NaN}
            format={openRatio ? valueMap[openRatio].format : "x"}
            health={openRatio ? healthMap[openRatio] : Number.NaN}
            p50={openRatio ? (benchmarkFor(openRatio)?.p50 ?? null) : null}
            higherIsBetter={openRatio ? (benchmarkFor(openRatio)?.higher_is_better ?? true) : true}
            clientId={effectiveClientId}
            canAddToPlan={userRole !== "client_member"}
            onGoToPlan={(k) => {
              setPlanFocusKey(k);
              setActiveTab("tasks");
            }}
            onSeeTab={(tab) => setActiveTab(tab)}
          />

          {/* Financial data dialog — upload financials or connect accounting software */}
          <Dialog open={showFinData} onOpenChange={setShowFinData}>
            <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto border border-amber-900/15 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <DialogTitle className="text-[15px] font-semibold uppercase tracking-[0.15em]">
                    Financial Data
                  </DialogTitle>
                  {saveStatus === "saving" && (
                    <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                      <Loader2 className="h-3 w-3 animate-spin" /> Saving…
                    </span>
                  )}
                  {saveStatus === "saved" && (
                    <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      <Check className="h-3 w-3" /> Saved
                    </span>
                  )}
                </div>
                <DialogDescription className="text-xs text-slate-600 dark:text-slate-400">
                  Bring in your figures — upload financial statements, or connect your accounting
                  software. {UPLOAD_QUALITY_DISCLAIMER}
                </DialogDescription>
              </DialogHeader>
              <input
                ref={uploadRef}
                type="file"
                accept={UPLOAD_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleStatementUpload(f);
                }}
              />
              {effectiveClientId && (
                <UploadVisibilityChoice
                  value={uploadVisibility}
                  onChange={setUploadVisibility}
                  name="financial-data-visibility"
                  disabled={uploading}
                />
              )}
              <div id="owner-accounting-connect" className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  id="owner-connect-qbo"
                  onClick={() => {
                    setShowFinData(false);
                    setShowQboDialog(true);
                  }}
                  className="flex flex-col items-start gap-1.5 rounded-lg border border-amber-700/30 bg-amber-50 p-4 text-left transition-colors hover:border-amber-700/60 hover:bg-amber-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-[#b7872a]/60 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-slate-100">
                    <Plug2 className="h-4 w-4" />
                    Connect QuickBooks Online
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {isUsCopy(boardMarket)
                      ? "Live sync from your books once QBO is switched on for this workspace. Until then, export a P&L and balance sheet and upload them below."
                      : "Sync live accounting data when QBO is configured for this workspace."}
                  </span>
                </button>
                <button
                  type="button"
                  id="owner-connect-xero"
                  onClick={() => {
                    setShowFinData(false);
                    setShowXeroDialog(true);
                  }}
                  className="flex flex-col items-start gap-1.5 rounded-lg border border-slate-300 bg-white p-4 text-left transition-colors hover:border-[#b7872a]/70 hover:bg-[#d4a550]/10 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-[#d4a550]/60 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <Plug2 className="h-4 w-4" />
                    Connect Xero
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    Live sync of P&amp;L and balance sheet, same path as QuickBooks.
                  </span>
                </button>
                {!isUsCopy(boardMarket) ? (
                  <button
                    type="button"
                    id="owner-connect-sage"
                    onClick={() => {
                      setShowFinData(false);
                      setShowSageDialog(true);
                    }}
                    className="flex flex-col items-start gap-1.5 rounded-lg border border-slate-300 bg-white p-4 text-left transition-colors hover:border-[#b7872a]/70 hover:bg-[#d4a550]/10 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-[#d4a550]/60 dark:hover:bg-slate-800"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <Plug2 className="h-4 w-4" />
                      Connect Sage
                    </span>
                    <span className="text-xs text-slate-600 dark:text-slate-400">
                      Sage Business Cloud Accounting (South Africa). Email, password, and Company
                      ID.
                    </span>
                  </button>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  disabled={uploading}
                  onClick={() => uploadRef.current?.click()}
                  className="flex flex-col items-start gap-1.5 rounded-lg border border-[#d4a550]/50 bg-[#d4a550]/10 p-4 text-left transition-colors hover:border-[#d4a550]/80 hover:bg-[#d4a550]/15 disabled:opacity-60 dark:border-[#b7872a]/60 dark:bg-[#d4a550]/10 dark:hover:border-[#d4a550]/80"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-slate-100">
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    {uploading ? "Reading…" : "Upload financial statements"}
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {UPLOAD_FORMATS_LABEL} (.xlsx, .xls, .ods, .csv, .pdf) — figures are read
                    automatically and you confirm them before anything is saved.
                  </span>
                </button>
                <button
                  onClick={() => {
                    setShowFinData(false);
                    setShowBankDrafter(true);
                  }}
                  className="flex flex-col items-start gap-1.5 rounded-lg border border-amber-700/30 bg-amber-50 p-4 text-left transition-colors hover:border-amber-700/60 hover:bg-amber-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-[#b7872a]/60 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-slate-100">
                    <Database className="h-4 w-4" />
                    Draft financials from bank statements
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    Upload statements and AI drafts a basic income statement for P&amp;L / ratios.
                  </span>
                </button>
                <button
                  onClick={async () => {
                    setShowFinData(false);
                    if (effectiveClientId) {
                      const { data } = await supabase
                        .from("clients")
                        .select("cashflow")
                        .eq("id", effectiveClientId)
                        .maybeSingle();
                      setExistingCashflowForBanks(
                        (data?.cashflow as Record<string, unknown> | null) ?? null,
                      );
                    } else {
                      setExistingCashflowForBanks(null);
                    }
                    setShowCashFromBanks(true);
                  }}
                  className="flex flex-col items-start gap-1.5 rounded-lg border border-amber-700/30 bg-amber-50 p-4 text-left transition-colors hover:border-amber-700/60 hover:bg-amber-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-[#b7872a]/60 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-slate-100">
                    <Database className="h-4 w-4" />
                    Build cash forecast from bank statements
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    Milōn groups repeating cash movements; classify cadence, then publish to Cash
                    Forecast.
                  </span>
                </button>
              </div>
              {effectiveClientId && (
                <OwnerUploadsPanel clientId={effectiveClientId} refreshKey={showFinData} />
              )}
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="px-2 text-xs text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100"
                  onClick={() => setShowInputs((s) => !s)}
                >
                  {showInputs ? "▲ Hide manual entry" : "▼ Enter figures manually"}
                </Button>
                {showInputs && (
                  <div className="mt-3 flex items-center gap-2">
                    <Label className="w-36 shrink-0 text-xs text-slate-700 dark:text-slate-400">
                      Figures cover
                    </Label>
                    <select
                      className="h-7 rounded-md border border-amber-900/15 bg-amber-50/40 px-2 text-xs text-slate-950 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
                      value={String(coveredMonths)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setV((s) => ({
                          ...s,
                          [PERIOD_MONTHS_KEY]: val,
                          [PERIOD_MONTHS_CHOSEN_KEY]: "1",
                        }));
                      }}
                      title="Profit and loss figures are stretched across a full year so the ratios can be compared. Balance-sheet figures stay as they are."
                    >
                      {PERIOD_MONTH_OPTIONS.map((o) => (
                        <option key={o.months} value={String(o.months)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {showInputs && (
                  <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                    {(
                      [
                        { k: "revenue", l: "Revenue" },
                        { k: "cogs", l: "COGS" },
                        { k: "ebit", l: "EBIT" },
                        { k: "ebt", l: "EBT" },
                        { k: "netIncome", l: "Net Income" },
                        { k: "ebitda", l: "EBITDA" },
                        { k: "operatingCashflow", l: "Operating Cash Flow" },
                        { k: "totalAssets", l: "Total Assets" },
                        { k: "equity", l: "Equity" },
                        { k: "receivables", l: "Receivables" },
                        { k: "inventory", l: "Inventory" },
                        { k: "payables", l: "Payables" },
                        { k: "fixedCosts", l: "Fixed Costs" },
                        { k: "variableCosts", l: "Variable Costs" },
                        { k: "laborCost", l: "Labor Cost" },
                        { k: "top5Revenue", l: "Top-5 Customer Rev." },
                        { k: "employees", l: "Employees" },
                        { k: "founderHours", l: "Founder Hours/yr" },
                        { k: "priorRevenue", l: "Prior Period Revenue" },
                        { k: "currentAssets", l: "Current Assets" },
                        { k: "currentLiabilities", l: "Current Liabilities" },
                        { k: "capex", l: "Capital Expenditure" },
                        { k: "ppeGross", l: "PPE at Cost (Gross)" },
                        { k: "accumulatedDepreciation", l: "Accumulated Depreciation" },
                        { k: "priorPpeGross", l: "Prior Year PPE (Gross)" },
                        { k: "priorAccumDep", l: "Prior Year Accum. Dep." },
                      ] as Array<{ k: keyof Inputs; l: string }>
                    ).map(({ k, l }) => (
                      <div key={k} className="flex items-center gap-2 min-w-0">
                        <Label
                          title={
                            k === "equity" && v.equityDerived === "1"
                              ? DERIVED_EQUITY_LABEL
                              : k === "laborCost"
                                ? laborCostLabel(boardMarket)
                                : l
                          }
                          className={`shrink-0 text-xs text-slate-700 dark:text-slate-400 ${
                            k === "equity" && v.equityDerived === "1"
                              ? "w-44 whitespace-normal leading-tight"
                              : "w-36 truncate"
                          }`}
                        >
                          {k === "equity" && v.equityDerived === "1"
                            ? DERIVED_EQUITY_LABEL
                            : k === "laborCost"
                              ? laborCostLabel(boardMarket)
                              : l}
                        </Label>
                        <Input
                          className="h-7 min-w-0 border-amber-900/15 bg-amber-50/40 text-slate-950 text-xs dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
                          value={v[k]}
                          onChange={(e) => set(k)(e.target.value)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          <Dialog
            open={bankLedgerBlocked}
            onOpenChange={(open) => {
              setBankLedgerBlocked(open);
              if (!open) setRejectedBankFile(null);
            }}
          >
            <DialogContent className="max-w-md border border-amber-900/20 bg-white text-slate-950 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-50">
              <DialogHeader>
                <DialogTitle>This is a bank statement</DialogTitle>
                <DialogDescription className="text-slate-600 dark:text-slate-300">
                  {BANK_LEDGER_MESSAGE}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => {
                    setPendingCashBankFile(rejectedBankFile);
                    setShowBankDrafter(false);
                    setActiveTab("cash");
                    setShowCashFromBanks(true);
                    setBankLedgerBlocked(false);
                  }}
                >
                  Go to bank statement upload
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setRejectedBankFile(null);
                    setBankLedgerBlocked(false);
                  }}
                >
                  Close
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Bank statement → draft financials (AI) */}
          <BankStatementDrafter
            open={showBankDrafter}
            onClose={() => setShowBankDrafter(false)}
            autoPopulate={autoPopulateState ? { ...autoPopulateState, role: "owner" } : null}
            documents={
              effectiveClientId
                ? {
                    clientId: effectiveClientId,
                    defaultVisibility: uploadVisibility,
                    onVisibilityChange: setUploadVisibility,
                  }
                : null
            }
            onApply={async ({ fields, annualised, cashDraft, draft, autoPopulate }) => {
              setV((prev) => ({ ...prev, ...fields }) as Inputs);
              setHasRealFinancials(true);
              void handleOwnerFirstRealFinancialsUpload();
              setShowBankDrafter(false);
              toast.success(
                annualised
                  ? "Draft figures applied (annualised) — saved automatically."
                  : "Draft figures applied for the statement period — saved automatically.",
              );

              if (!effectiveClientId) return;
              // Same pack drafts cash forecast + budget (first upload: always;
              // later: per the checkboxes). No second dialog, no re-upload.
              try {
                const result = await runAutoPopulate({
                  clientId: effectiveClientId,
                  fields,
                  cashDraft: cashDraft ?? null,
                  chosen: autoPopulate,
                  firstUpload: autoPopulateState?.firstUpload,
                  firstActualsMonth: draft.period_start?.slice(0, 7) ?? null,
                  fallbackMarket: workspaceMarket,
                  surface: "owner_app",
                  source: "bank_pack",
                });
                applyAutoPopulateResult(result);
              } catch (e) {
                console.warn("auto-populate after bank draft:", e);
                toast.error(
                  `Figures saved, but drafting the board failed: ${(e as Error).message}`,
                );
              }
            }}
          />

          {/* Bank statement → preliminary cash forecast (Phases 1–3) */}
          <CashFromBanksDrafter
            open={showCashFromBanks}
            onClose={() => {
              setShowCashFromBanks(false);
              setBankCashDraft(null);
              setPendingCashBankFile(null);
            }}
            initialDraft={bankCashDraft}
            initialFile={pendingCashBankFile}
            existingCashflow={existingCashflowForBanks as never}
            documents={
              effectiveClientId
                ? {
                    clientId: effectiveClientId,
                    defaultVisibility: uploadVisibility,
                    onVisibilityChange: setUploadVisibility,
                  }
                : null
            }
            onSaveDraft={async (draft) => {
              if (!effectiveClientId) return;
              await supabase
                .from("clients")
                .update({ cashflow_bank_draft: draft as never })
                .eq("id", effectiveClientId)
                .then(({ error }) => {
                  // Column may not exist until migration is applied — ignore quietly.
                  if (error && !/cashflow_bank_draft|42703/.test(error.message ?? "")) {
                    console.warn("cashflow_bank_draft save:", error.message);
                  }
                });
            }}
            onPublish={async (payload) => {
              if (!effectiveClientId) {
                toast.error("Save / select a client before publishing a cash forecast.");
                return;
              }
              const forecastUpdatedAt = new Date().toISOString();
              const runway = (await import("@/lib/cash-runway")).runwayWeeksFromCashflow(payload);
              const { error } = await supabase
                .from("clients")
                .update({
                  cashflow: payload as never,
                  cashflow_bank_draft: payload as never,
                  last_forecast_at: forecastUpdatedAt,
                  ...(runway != null ? { cash_runway_weeks: runway } : {}),
                })
                .eq("id", effectiveClientId);
              if (error) {
                // Retry without cashflow_bank_draft if column not migrated yet
                const retry = await supabase
                  .from("clients")
                  .update({
                    cashflow: payload as never,
                    last_forecast_at: forecastUpdatedAt,
                    ...(runway != null ? { cash_runway_weeks: runway } : {}),
                  })
                  .eq("id", effectiveClientId);
                if (retry.error) throw new Error(retry.error.message);
              }
              setShowCashFromBanks(false);
              setBankCashDraft(null);
              setCashForecastReloadToken((n) => n + 1);
              setActiveTab("cash");
              toast.success(
                "Cash forecast published — review classification on the Cash Forecast tab.",
              );
            }}
          />

          <PastPeriodUploadDialog
            open={pastPeriodOpen}
            onOpenChange={setPastPeriodOpen}
            onFiles={(files, opts) => {
              const file = files[0];
              if (!file) return;
              setHistoryUpload(true);
              setReplaceLiveOnHistory(opts.replaceLive);
              if (files.length > 1) {
                toast.message("Using the first file — add other periods one at a time.");
              }
              void handleStatementUpload(file);
            }}
          />

          {/* PDF extraction review modal — user reviews/corrects before values are applied */}
          {extractionForReview && (
            <ExtractionReviewModal
              result={extractionForReview}
              open={reviewOpen}
              booksHaveSpan={Boolean(liveStatementSpan(v))}
              onClose={() => {
                setReviewOpen(false);
                setExtractionForReview(null);
                setHistoryUpload(false);
                setReplaceLiveOnHistory(false);
              }}
              autoPopulate={autoPopulateState ? { ...autoPopulateState, role: "owner" } : null}
              storedMarket={storedClientMarket}
              onConfirm={async (mapped, autoPopulate, periodChoice, periodOverride) => {
                const currencyGate = statementCurrencyGate({
                  storedMarket: storedClientMarket,
                  extraction: extractionForReview,
                });
                const labelConfirm = extractionForReview?.currency_label_confirm ?? null;
                const currencyRefusal = currencyImportRefusal(currencyGate, labelConfirm);
                if (currencyRefusal) {
                  return { ok: false as const, message: importFailureMessage(currencyRefusal) };
                }
                const withLabel = <T extends Record<string, unknown>>(blob: T) =>
                  withCurrencyLabelConfirm(blob, labelConfirm);
                const entries = Object.entries(mapped).filter(
                  ([k, val]) => val !== undefined && k in defaults,
                );
                const reviewMeta = extractionForReview?.document_metadata;
                const resolvedStart = periodOverride?.periodStart ?? reviewMeta?.period_start_date ?? null;
                const resolvedEnd = periodOverride?.periodEnd ?? reviewMeta?.period_end_date ?? null;
                const resolvedMonths = periodOverride?.periodMonths ?? reviewMeta?.period_months ?? null;
                const periodEntries: [string, string][] = [];
                if (resolvedMonths)
                  periodEntries.push(["periodMonths", String(resolvedMonths)]);
                if (resolvedStart) periodEntries.push(["periodStart", resolvedStart]);
                if (resolvedEnd) periodEntries.push(["periodEnd", resolvedEnd]);
                // Merge CSV/Excel-only extras (variableCosts, top5Revenue, founderHours)
                // that aren't surfaced in the review modal but were extracted from the file
                const extras = pendingCsvExtras ?? {};
                const allEntries = [
                  ...entries,
                  ...Object.entries(extras).filter(([k]) => k in defaults),
                  ...periodEntries,
                ];
                if (
                  historyUpload &&
                  effectiveClientId &&
                  allEntries.length > 0 &&
                  !replaceLiveOnHistory
                ) {
                  const fields = Object.fromEntries(allEntries) as Record<string, string>;
                  const periodEnd = resolvedEnd;
                  const saved = await upsertPeriodSnapshot({
                    clientId: effectiveClientId,
                    financials: withLabel(fields),
                    periodDate: periodEnd,
                    source: "upload",
                    statementKind: statementKindFromMetadata(reviewMeta),
                  });
                  if (saved.error) {
                    return {
                      ok: false as const,
                      message: importFailureMessage(`Could not save the past period: ${saved.error}`),
                    };
                  }
                  const { data } = await supabase
                    .from("client_financial_snapshots")
                    .select("period_label, period_date, ratios, source, financials, created_at")
                    .eq("client_id", effectiveClientId)
                    .order("period_date", { ascending: true })
                    .limit(24);
                  if (data) setHistory(data as never);
                  setHistoryUpload(false);
                  setReplaceLiveOnHistory(false);
                  setPendingCsvExtras(null);
                  return {
                    ok: true as const,
                    message: importedUpdateMessage(`${saved.periodLabel} history`),
                  };
                }
                setHistoryUpload(false);
                setReplaceLiveOnHistory(false);
                if (allEntries.length === 0) {
                  return {
                    ok: false as const,
                    message: importFailureMessage("No matching fields found in the extraction result."),
                  };
                }
                if (!effectiveClientId) {
                  return {
                    ok: false as const,
                    message: importFailureMessage("No client is open for this upload."),
                  };
                }
                const periodEndForCash = resolvedEnd;
                const uploadKind = statementKindFromMetadata(reviewMeta);
                const healthBefore = liveHealthFromBooks({
                  financials: v as unknown as Record<string, unknown>,
                  cashflow: clientMeta?.cashflow ?? null,
                  fyStartMonth,
                  market: boardMarket,
                  timeZone: boardMarket.timezone,
                });
                const planned = confirmUploadedStatement({
                  existing: v,
                  incoming: Object.fromEntries(allEntries),
                  kind: uploadKind,
                  periodStart: resolvedStart,
                  periodEnd: resolvedEnd,
                  periodMonths: resolvedMonths,
                  choice: periodChoice ?? null,
                  pillarsBefore: healthBefore.pillars,
                  market: boardMarket,
                  fyStartMonth,
                });
                const fileSpan = planned.span;
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
                  const periodDate = fileSpan?.periodEnd ?? periodEndForCash ?? "";
                  const periodLabel = planned.periodLabel || periodDate;
                  const { data: rows } = await supabase
                    .from("client_financial_snapshots")
                    .select("id, financials")
                    .eq("client_id", effectiveClientId)
                    .order("period_date", { ascending: false })
                    .limit(24);
                  const match = snapshotCoveringSpan(rows, fileSpan);
                  const ratiosOut = computeRatios(planned.history as never);
                  const write = match?.id
                    ? supabase
                        .from("client_financial_snapshots")
                        .update({
                          financials: withLabel(planned.history as Record<string, unknown>) as never,
                          ratios: ratiosOut as never,
                          period_label: periodLabel,
                          period_date: periodDate,
                        })
                        .eq("id", match.id)
                    : supabase.from("client_financial_snapshots").insert({
                        client_id: effectiveClientId,
                        period_label: periodLabel,
                        period_date: periodDate,
                        financials: withLabel(planned.history as Record<string, unknown>) as never,
                        ratios: ratiosOut as never,
                        source: "upload",
                      });
                  const { error: historyError } = await write;
                  if (historyError) {
                    return {
                      ok: false as const,
                      message: importFailureMessage(historyError.message),
                    };
                  }
                  const { data } = await supabase
                    .from("client_financial_snapshots")
                    .select("period_label, period_date, ratios, source, financials, created_at")
                    .eq("client_id", effectiveClientId)
                    .order("period_date", { ascending: true })
                    .limit(24);
                  if (data) setHistory(data as never);
                  setPendingCsvExtras(null);
                  return { ok: true as const, message: planned.message };
                }
                const liveFields = planned.live ?? {};
                const next = {
                  ...v,
                  ...Object.fromEntries(
                    Object.entries(liveFields).flatMap(([key, value]) =>
                      value == null || typeof value === "object" ? [] : [[key, String(value)]],
                    ),
                  ),
                  ...(labelConfirm
                    ? { [CURRENCY_LABEL_CONFIRM_KEY]: JSON.stringify(labelConfirm) }
                    : {}),
                } as Inputs;
                ownerWriteGen.current += 1;
                setV(next);
                setHasRealFinancials(true);
                const financialsUpdatedAt = new Date().toISOString();
                const { data: savedLive, error: liveError } = await supabase
                  .from("clients")
                  .update({
                    financials: withFinancialsWriteRev(
                      withLabel({
                        ...next,
                        weeklyInputs,
                        productMix,
                      }),
                    ) as never,
                    financials_updated_at: financialsUpdatedAt,
                  })
                  .eq("id", effectiveClientId)
                  .select("id");
                if (liveError || !savedLive?.length) {
                  return {
                    ok: false as const,
                    message: importFailureMessage(
                      liveError?.message ?? "The figures were not written to this client.",
                    ),
                  };
                }
                setClientMeta((m) => (m ? { ...m, financials_updated_at: financialsUpdatedAt } : m));
                void handleOwnerFirstRealFinancialsUpload();
                track("financials_uploaded", {
                  surface: "owner_app",
                  clientId: effectiveClientId,
                  fields: allEntries.length,
                });
                const fields = Object.fromEntries(allEntries) as Record<string, string>;
                void runAutoPopulate({
                  clientId: effectiveClientId,
                  fields,
                  chosen: autoPopulate,
                  prefsToRemember: prefsToRemember(
                    autoPopulate,
                    uploadKind,
                    autoPopulateState?.prefs ?? defaultAutoPopulatePrefs(),
                  ),
                  firstUpload: autoPopulateState?.firstUpload,
                  statementKind: uploadKind,
                  cashOpeningDate: uploadKind === "balance_sheet" ? periodEndForCash : null,
                  firstActualsMonth: periodEndForCash ? periodEndForCash.slice(0, 7) : null,
                  fallbackMarket: workspaceMarket,
                  surface: "owner_app",
                  source: "financial_statement",
                })
                  .then(applyAutoPopulateResult)
                  .catch((e) => {
                    console.warn("auto-populate after statement upload:", e);
                    toast.error(
                      `Figures saved, but drafting the board failed: ${(e as Error).message}`,
                    );
                  });
                setPendingCsvExtras(null);
                return {
                  ok: true as const,
                  message: planned.message || importedUpdateMessage(statementImportWhat(uploadKind)),
                };
              }}
            />
          )}

          {/* QuickBooks connect dialog */}
          <Dialog open={showQboDialog} onOpenChange={setShowQboDialog}>
            <DialogContent className="max-w-2xl border border-slate-800 bg-slate-950 text-slate-50">
              <DialogHeader>
                <DialogTitle className="text-[15px] font-semibold uppercase tracking-[0.15em] text-slate-100">
                  QuickBooks Integration
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  Connect your QuickBooks Online account to auto-fill financial inputs from live
                  accounting data.
                </DialogDescription>
              </DialogHeader>
              <QboConnectCard
                clientId={effectiveClientId}
                returnPath="/app"
                onSyncComplete={(inputs) => {
                  setV((prev) => ({
                    ...prev,
                    ...inputs,
                  }));
                  setHasRealFinancials(true);
                  void handleOwnerFirstRealFinancialsUpload();
                  if (effectiveClientId) {
                    void runSyncAutoPopulate({
                      clientId: effectiveClientId,
                      fields: inputs,
                      chosen: autoPopulateState?.prefs ?? defaultAutoPopulatePrefs(),
                      firstUpload: autoPopulateState?.firstUpload ?? true,
                      firstActualsMonth: inputs.periodStart?.slice(0, 7) ?? null,
                      fallbackMarket: workspaceMarket,
                      surface: "owner_app",
                    })
                      .then(applyAutoPopulateResult)
                      .catch((e) => {
                        console.warn("auto-populate after QuickBooks sync:", e);
                        toast.error(
                          `Figures saved, but drafting the board failed: ${(e as Error).message}`,
                        );
                      });
                  }
                  setShowQboDialog(false);
                }}
              />
            </DialogContent>
          </Dialog>

          <Dialog open={showSageDialog} onOpenChange={setShowSageDialog}>
            <DialogContent className="max-w-2xl border border-slate-800 bg-slate-950 text-slate-50">
              <DialogHeader>
                <DialogTitle className="text-[15px] font-semibold uppercase tracking-[0.15em] text-slate-100">
                  Sage Accounting
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  Connect Sage Business Cloud Accounting (South Africa). Milōn checks the login and
                  stores it. Statement sync does not fill Health until figures are available.
                </DialogDescription>
              </DialogHeader>
              <SageConnectCard
                clientId={effectiveClientId}
                onSyncComplete={(inputs) => {
                  setV((prev) => ({
                    ...prev,
                    ...inputs,
                  }));
                  setHasRealFinancials(true);
                  void handleOwnerFirstRealFinancialsUpload();
                  setCashForecastReloadToken((n) => n + 1);
                  if (effectiveClientId) {
                    void runSyncAutoPopulate({
                      clientId: effectiveClientId,
                      fields: inputs,
                      chosen: autoPopulateState?.prefs ?? defaultAutoPopulatePrefs(),
                      firstUpload: autoPopulateState?.firstUpload ?? true,
                      firstActualsMonth: inputs.periodStart?.slice(0, 7) ?? null,
                      fallbackMarket: workspaceMarket,
                      surface: "owner_app",
                    })
                      .then(applyAutoPopulateResult)
                      .catch((e) => {
                        console.warn("auto-populate after Sage sync:", e);
                        toast.error(
                          `Figures saved, but drafting the board failed: ${(e as Error).message}`,
                        );
                      });
                  }
                  setShowSageDialog(false);
                }}
              />
            </DialogContent>
          </Dialog>

          <Dialog open={showXeroDialog} onOpenChange={setShowXeroDialog}>
            <DialogContent className="max-w-2xl border border-slate-800 bg-slate-950 text-slate-50">
              <DialogHeader>
                <DialogTitle className="text-[15px] font-semibold uppercase tracking-[0.15em] text-slate-100">
                  Xero Integration
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  Connect a Xero organisation to pull P&amp;L, the balance sheet and bank balances.
                  Existing connections need a reconnect once the bank summary scope is enabled.
                </DialogDescription>
              </DialogHeader>
              <XeroConnectCard
                clientId={effectiveClientId}
                returnPath="/app"
                onSyncComplete={(inputs) => {
                  setV((prev) => ({
                    ...prev,
                    ...inputs,
                  }));
                  setHasRealFinancials(true);
                  void handleOwnerFirstRealFinancialsUpload();
                  setCashForecastReloadToken((n) => n + 1);
                  if (effectiveClientId) {
                    void runSyncAutoPopulate({
                      clientId: effectiveClientId,
                      fields: inputs,
                      chosen: autoPopulateState?.prefs ?? defaultAutoPopulatePrefs(),
                      firstUpload: autoPopulateState?.firstUpload ?? true,
                      firstActualsMonth: inputs.periodStart?.slice(0, 7) ?? null,
                      fallbackMarket: workspaceMarket,
                      surface: "owner_app",
                    })
                      .then(applyAutoPopulateResult)
                      .catch((e) => {
                        console.warn("auto-populate after Xero sync:", e);
                        toast.error(
                          `Figures saved, but drafting the board failed: ${(e as Error).message}`,
                        );
                      });
                  }
                  setShowXeroDialog(false);
                }}
              />
            </DialogContent>
          </Dialog>

          {/* SOP playbook — add steps to Action Plan (not legacy employee_tasks assign) */}
          <Dialog open={openSop !== null} onOpenChange={(o) => !o && setOpenSop(null)}>
            <DialogContent className="max-w-lg border-2 border-emerald-500/50 bg-slate-900 text-slate-50">
              {openSop && (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-3 text-xl">
                      <span className="text-2xl">{RATIO_META[openSop].icon}</span>
                      <span>Playbook · {RATIO_META[openSop].friendly}</span>
                    </DialogTitle>
                    <DialogDescription className="text-slate-400">
                      Practical steps for this move. Add any step to your Action Plan — assign
                      owners and due dates there.
                    </DialogDescription>
                  </DialogHeader>
                  <ol className="space-y-2">
                    {RATIO_META[openSop].sop.map((s, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3 rounded-md border border-emerald-700/30 bg-slate-950/40 p-3"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/60 bg-emerald-500/10 font-mono text-xs font-bold text-emerald-300">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 text-sm text-slate-200">{s}</span>
                        {effectiveClientId && userRole !== "client_member" && (
                          <div onClick={(e) => e.stopPropagation()}>
                            <AddToPlanButton
                              clientId={effectiveClientId}
                              moveKey={`${openSop}:sop:${i}`}
                              title={s}
                              outcomeWhy={`${RATIO_META[openSop].friendly} · playbook step ${i + 1}`}
                              onAssign={(k) => {
                                setOpenSop(null);
                                setPlanFocusKey(k);
                                setActiveTab("tasks");
                              }}
                            />
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                  {effectiveClientId && userRole !== "client_member" && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#d4a550]/30 bg-[#d4a550]/10 px-3 py-2.5">
                      <p className="text-[11px] text-slate-300">
                        Prefer the whole move as one action?
                      </p>
                      <AddToPlanButton
                        clientId={effectiveClientId}
                        moveKey={openSop}
                        title={RATIO_META[openSop].friendly}
                        outcomeWhy={RATIO_META[openSop].hint}
                        onAssign={(k) => {
                          setOpenSop(null);
                          setPlanFocusKey(k);
                          setActiveTab("tasks");
                        }}
                      />
                    </div>
                  )}
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">
                    Tip: add one step this week — owners and dates live on the Action Plan tab.
                  </p>
                </>
              )}
            </DialogContent>
          </Dialog>
        </main>
      </FinancialInputsContext.Provider>
    </MarketProvider>
  );
}

function Ratio({
  rkey,
  value,
  format,
  health,
  onClick,
  className,
  series,
  benchmark,
  clientId,
  onGoToPlan,
}: {
  rkey: RatioKey;
  value: number;
  format: "x" | "pct" | "days" | "money";
  health: number;
  onClick: () => void;
  className?: string;
  series?: number[];
  benchmark?: Benchmark | null;
  clientId?: string | null;
  onGoToPlan?: (moveKey: string) => void;
}) {
  const { market } = useMarket();
  const meta = RATIO_META[rkey];
  const t = tierColor(health);
  const fullSeries = [...(series ?? []), value].filter((n) => isFinite(n));
  const delta = pctDelta(fullSeries);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-left transition-colors hover:border-slate-700 hover:bg-slate-900 cursor-pointer ${className ?? ""}`}
    >
      {clientId && onGoToPlan && (
        <div className="absolute right-2 top-2 z-10" onClick={(e) => e.stopPropagation()}>
          <AddToPlanButton
            clientId={clientId}
            moveKey={rkey}
            title={`Improve: ${meta.friendly}`}
            outcomeWhy={`${localizeCopy(meta.techName, market)} — ${localizeCopy(meta.hint, market)}`}
            onAssign={onGoToPlan}
          />
        </div>
      )}
      <div className="flex items-start justify-between gap-2 pr-16">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            <span>{meta.icon}</span>
            <span className="truncate">{meta.friendly}</span>
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-500">
            {localizeCopy(meta.techName, market)}
          </p>
        </div>
        <p className={`shrink-0 font-mono text-lg font-bold tabular-nums ${t.text}`}>
          {formatVal(value, format, market, meta.techName)}
        </p>
      </div>
      <p className="mt-2 text-xs text-slate-400">{localizeCopy(meta.hint, market)}</p>
      <div className="mt-3">
        <HealthBar health={health} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        {fullSeries.length >= 2 ? (
          <>
            <KpiTrendline values={fullSeries} />
            {delta !== null && (
              <span
                className={`text-[11px] font-semibold tabular-nums ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}
              >
                {delta >= 0 ? "+" : ""}
                {(delta * 100).toFixed(1)}% 6mo
              </span>
            )}
          </>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-slate-600">
            trend builds with snapshots
          </span>
        )}
      </div>
      {benchmark &&
        isFinite(value) &&
        canShowIndustryMedian(market, { metricKey: rkey, format }) && (
          <div className="mt-3 border-t border-slate-700/40 pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                {industryBenchmarkShortLabel(market)}
              </span>
              <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                25% {formatVal(benchmark.p25, format, market)} · 50%{" "}
                {formatVal(benchmark.p50, format, market)} · 75%{" "}
                {formatVal(benchmark.p75, format, market)}
              </span>
            </div>
            <div className="mt-1">
              <BenchmarkBar value={value} benchmark={benchmark} width={260} />
            </div>
          </div>
        )}
      <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-sky-500/0 transition-colors group-hover:text-sky-500/80">
        ▸ Tap for 5 strategic moves
      </p>
    </div>
  );
}
