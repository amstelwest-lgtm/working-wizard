import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { openPracticeSettings } from "@/lib/user-roles";
import { useEffect, useRef, useState, useCallback, useMemo, Suspense } from "react";
import { lazyPanel, TabErrorBoundary } from "@/components/lazy-panel";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { AdvisoryDrafter } from "@/components/advisory-drafter";
import { CashForecastPanel } from "@/components/cash-forecast";
import { BudgetPanel } from "@/components/budget/budget-panel";
import type { ExistingCashflow } from "@/lib/cash-from-banks.publish";
import { UploadFinancials } from "@/components/upload-financials";
import { BankStatementDrafter } from "@/components/bank-statement-drafter";
import { WalkthroughWizard } from "@/components/walkthrough-wizard";
import { seedBudgetFromFinancials } from "@/lib/budget.bridges";
import { normalizeBudgetDocument } from "@/lib/budget.compute";
import type { BudgetDocument } from "@/lib/budget.types";
import { createBudgetDocument, currentFyStart } from "@/lib/budget.months";
import { MarketProvider } from "@/contexts/market";
import {
  coerceMarketSelection,
  formatDate,
  isUsCopy,
  localizeCopy,
  parseMarketSelection,
  resolveMarket,
} from "@/lib/market";
import { PlaybookDrawer } from "@/components/playbook-drawer";
import type { ExtractionResult } from "@/lib/financialSchema";
import { computeRatios, scoreTier } from "@/lib/ratios";
import type { RatioInputs, HealthTier } from "@/lib/ratios";
import {
  scoreRatio,
  scoreFromRatioInputs,
  healthFromRatioInputs,
  healthMapFromRatios,
  pillarForRatioName,
  type OverallHealth,
} from "@/lib/health-score";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { FirmSwitcher } from "@/components/firm-switcher";
import "@/styles/accountant-portal.css";
import { ThemeToggle } from "@/components/theme-toggle";
import { SphereHero } from "@/components/sphere-hero";
import { buildSpherePillars } from "@/components/sphere-hero-adapter";
import { SimplifiedRatios } from "@/components/simplified-ratios";
import { ProfitabilityWaterfall } from "@/components/profitability-waterfall";
import { WeeklyInputTable } from "@/components/weekly-input-table";
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
} from "@/lib/weekly-inputs";
import { emptyProductMix, type ProductMix } from "@/lib/product-mix";
import { useServerFn } from "@tanstack/react-start";
import { listClientReviewSignoffs, indexReviewSignoffs } from "@/lib/review-signoffs.functions";
import type { ClientReviewSignoff, ReviewScope } from "@/lib/review-signoffs.functions";
import { ReviewSignoffButton, computeIsStale } from "@/components/review-signoff";
import {
  parseOperatingProfile,
  stampProfileProvenance,
  profileToBudgetQualification,
  type ClientOperatingProfile,
} from "@/lib/client-profile";
import { profileIndustryLabel } from "@/lib/profile-signals";
import { AccountantOperatingProfile } from "@/components/accountant-operating-profile";
import { NoteLayer } from "@/components/note-layer";
import { useNotes } from "@/contexts/notes";
import { useTrack } from "@/hooks/use-track";
import { QboConnectCard } from "@/components/qbo-connect";
import { effectiveCashRunwayWeeks, runwayWeeksFromCashflow } from "@/lib/cash-runway";
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
import { PeriodVarianceStrip } from "@/components/period-variance-strip";
import { buildVarianceChips, resolvePriorSnapshot, type SnapshotRow } from "@/lib/prior-period";
import { AdvisorySentHistory } from "@/components/advisory-sent-history";
import {
  hashFigures,
  latestSnapshotId,
  recordDelivery,
  warnIfDeliveryFailed,
  warnIfPdfArchiveFailed,
} from "@/lib/advisory-deliveries";
import { upsertCurrentPeriodSnapshot } from "@/lib/financial-snapshots";
import { stampFromSignoff } from "@/lib/review-signoff-stamp";

const ActionPlanPanel = lazyPanel(() => import("@/components/action-plan"), "Action Plan");
const ReportsStudioPanel = lazyPanel(
  () => import("@/routes/_authenticated/reports.index").then((m) => ({ default: m.ReportsStudio })),
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

function extractionToRatioInputs(r: ExtractionResult): RatioInputs {
  const is = r.current_period.figures.income_statement;
  const bs = r.current_period.figures.balance_sheet;
  const cf = r.current_period.figures.cash_flow;
  const str = (v: number | null | undefined) => (v != null ? String(v) : "");
  const ebitda =
    is.operating_profit != null && is.depreciation_amortisation != null
      ? String(is.operating_profit + is.depreciation_amortisation)
      : str(is.operating_profit);
  return {
    revenue: str(is.revenue),
    cogs: str(is.cost_of_sales),
    ebit: str(is.operating_profit),
    ebt: str(is.profit_before_tax),
    netIncome: str(is.profit_after_tax),
    ebitda,
    operatingCashflow: str(cf?.cash_from_operating),
    totalAssets: str(bs.total_assets),
    equity: str(bs.equity.total),
    receivables: str(bs.current_assets.trade_and_other_receivables),
    inventory: str(bs.current_assets.inventories),
    payables: str(bs.current_liabilities.trade_and_other_payables),
    fixedCosts: "",
    variableCosts: "",
    top5Revenue: "",
    laborCost: "",
    employees: "",
    founderHours: "",
  };
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

function bandLabel(band: "ok" | "warn" | "risk"): string {
  if (band === "ok") return "Healthy";
  if (band === "warn") return "At risk";
  return "Critical";
}

function bandColor(band: "ok" | "warn" | "risk"): string {
  if (band === "ok") return "var(--ok)";
  if (band === "warn") return "var(--warn)";
  return "var(--risk)";
}

/** Format a raw ratio value to display string */
function formatRatioValue(name: string, val: number): string {
  if (!Number.isFinite(val)) return "—";
  // Days-based ratios
  if (name.includes("Days") || name.includes("days")) {
    return `${Math.round(val)}d`;
  }
  // Multiplier ratios
  if (
    name === "Asset Turnover" ||
    name === "Equity Multiplier" ||
    name === "Degree of Operating Leverage" ||
    name === "OCF / EBITDA"
  ) {
    return `${val.toFixed(2)}×`;
  }
  // Percentage ratios — most
  return `${(val * 100).toFixed(1)}%`;
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
  score,
  status,
  size = 46,
  strokeWidth = 4,
}: {
  score: number;
  /** When set, drives ring colour (critical-pillar tell). */
  status?: HealthTier;
  size?: number;
  strokeWidth?: number;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const band = tierToBand(status ?? scoreTier(score));
  const color = bandColor(band);
  const off = c * (1 - score / 100);
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="tr"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
        />
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
      </svg>
      <b>{score}</b>
    </div>
  );
}

// ── route ──────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/clients/$clientId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    qbo?: string;
    reason?: string;
    onboard?: string;
    note?: string;
    tab?: string;
    filter?: string;
  } => {
    const out: {
      qbo?: string;
      reason?: string;
      onboard?: string;
      note?: string;
      tab?: string;
      filter?: string;
    } = {};
    if (typeof search.qbo === "string") out.qbo = search.qbo;
    if (typeof search.reason === "string") out.reason = search.reason;
    if (typeof search.onboard === "string") out.onboard = search.onboard;
    if (typeof search.note === "string") out.note = search.note;
    if (typeof search.tab === "string") out.tab = search.tab;
    if (
      search.filter === "overdue" ||
      search.filter === "at_risk" ||
      search.filter === "blocked" ||
      search.filter === "done" ||
      search.filter === "all"
    ) {
      out.filter = search.filter;
    }
    return out;
  },
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
};

type ActiveTab =
  | "ask"
  | "ratios"
  | "profit"
  | "cash"
  | "budget"
  | "reports"
  | "plan"
  | "advisory";

const ACCOUNTANT_TABS: ActiveTab[] = [
  "ask",
  "ratios",
  "profit",
  "cash",
  "budget",
  "reports",
  "plan",
  "advisory",
];

/** Old Staff tasks deep-links land on Action Plan. */
function resolveAccountantTab(tab: string | undefined): ActiveTab | null {
  if (!tab) return null;
  if (tab === "tasks") return "plan";
  return ACCOUNTANT_TABS.includes(tab as ActiveTab) ? (tab as ActiveTab) : null;
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
  const { notes: clientNotes, loading: notesLoading, openArchive, requestOpenNote } = useNotes();
  const navigate = useNavigate();
  const { profile, firmId } = useAccountantProfile();
  const track = useTrack();

  // QBO OAuth return (?qbo=connected|error) — callback lands here for accountants.
  useEffect(() => {
    if (!search.qbo) return;
    if (search.qbo === "connected") {
      toast.success("QuickBooks Online connected — tap Sync to import data");
    } else if (search.qbo === "error") {
      toast.error(`QuickBooks connection failed: ${search.reason ?? "unknown error"}`);
    }
    navigate({
      to: "/clients/$clientId",
      params: { clientId },
      search: (prev) => {
        const next = { ...prev };
        delete next.qbo;
        delete next.reason;
        return next;
      },
      replace: true,
    });
  }, [search.qbo, search.reason, clientId, navigate]);

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

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>("ask");
  const [studioDeepLink, setStudioDeepLink] = useState<{
    report?: string;
    action?: "preview" | "download";
  }>({});
  useEffect(() => {
    const next = resolveAccountantTab(search.tab);
    if (next) setActiveTab(next);
    if (search.note) requestOpenNote(search.note);
  }, [search.note, search.tab, requestOpenNote]);
  useEffect(() => {
    track("tab_viewed", {
      tab: activeTab,
      surface: "accountant_portal",
      clientId,
      firmId,
      path: `/clients/${clientId}`,
    });
  }, [activeTab, clientId, firmId, track]);
  const [finOpen, setFinOpen] = useState(true); // collapsible open by default
  const [profitFinOpen, setProfitFinOpen] = useState(true);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [viewMode, setViewMode] = useState<"simplified" | "complex">("simplified");
  const [cashForecastReloadToken, setCashForecastReloadToken] = useState(0);
  const [cashBankUploadToken, setCashBankUploadToken] = useState(0);
  const [bankCashDraft, setBankCashDraft] = useState<
    import("@/lib/cash-from-banks.types").CashFromBanksDraftResult | null
  >(null);

  // Financials state (flat key-value for the fin-grid)
  const [financials, setFinancials] = useState<Record<string, string>>({});
  const [debtSchedule, setDebtSchedule] = useState<DebtSchedule>(emptyDebtSchedule());
  const [weeklyInputs, setWeeklyInputs] = useState<WeeklyInputs>(emptyWeeklyInputs);
  const [productMix, setProductMix] = useState<ProductMix>(emptyProductMix);
  const financialsRef = useRef(financials);
  financialsRef.current = financials;
  const debtScheduleRef = useRef(debtSchedule);
  debtScheduleRef.current = debtSchedule;
  const weeklyInputsRef = useRef(weeklyInputs);
  weeklyInputsRef.current = weeklyInputs;
  const productMixRef = useRef(productMix);
  productMixRef.current = productMix;
  const [profileOpen, setProfileOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showBankDrafter, setShowBankDrafter] = useState(false);
  const [firstDataOpen, setFirstDataOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [deliveryRefresh, setDeliveryRefresh] = useState(0);
  const [queriesRefresh, setQueriesRefresh] = useState(0);

  // Accountant sign-off — one stamp per deliverable tab
  const fetchReviewSignoffs = useServerFn(listClientReviewSignoffs);
  const [reviewSignoffs, setReviewSignoffs] = useState<
    Partial<Record<ReviewScope, ClientReviewSignoff>>
  >({});
  const financialsSignoff = reviewSignoffs.financials ?? null;
  const profitabilitySignoff = reviewSignoffs.profitability ?? null;
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [drawerRatioKey, setDrawerRatioKey] = useState<string | null>(null);
  const [drawerRatioName, setDrawerRatioName] = useState<string>("");
  const [drawerTier, setDrawerTier] = useState<HealthTier>("at_risk");

  /** Unresolved client notes — live open-query count for triage. */
  const [openQueriesCount, setOpenQueriesCount] = useState(0);

  // Computed ratios
  const ratioInputs: RatioInputs = {
    revenue: financials["revenue"] ?? "",
    cogs: financials["cogs"] ?? "",
    ebit: financials["ebit"] ?? "",
    ebt: financials["ebt"] ?? "",
    netIncome: financials["netIncome"] ?? "",
    ebitda: financials["ebitda"] ?? "",
    operatingCashflow: financials["operatingCashflow"] ?? "",
    totalAssets: financials["totalAssets"] ?? "",
    equity: financials["equity"] ?? "",
    receivables: financials["receivables"] ?? "",
    inventory: financials["inventory"] ?? "",
    payables: financials["payables"] ?? "",
    fixedCosts: financials["fixedCosts"] ?? "",
    variableCosts: financials["variableCosts"] ?? "",
    top5Revenue: financials["top5Revenue"] ?? "",
    laborCost: financials["laborCost"] ?? "",
    employees: financials["employees"] ?? "",
    founderHours: financials["founderHours"] ?? "",
  };
  const ratios = computeRatios(ratioInputs);
  const effectiveRunway = effectiveCashRunwayWeeks(
    client?.cash_runway_weeks,
    client?.cashflow as Parameters<typeof effectiveCashRunwayWeeks>[1],
  );
  const clientMarket = useMemo(
    () =>
      resolveMarket(
        parseMarketSelection(client?.market) ?? coerceMarketSelection(client?.market ?? null),
      ),
    [client?.market],
  );
  const overallHealth: OverallHealth = healthFromRatioInputs(
    ratioInputs,
    effectiveRunway,
    clientMarket,
  );
  const healthScoreRounded = overallHealth.overall ?? 0;

  // ── Health orb & pillar computation (same source as header / score history) ──
  const healthMap = healthMapFromRatios(ratios as Record<string, number>, clientMarket);

  const pillarById = Object.fromEntries(
    overallHealth.pillars.map((p) => [p.id, p.score ?? NaN]),
  ) as Record<"profit" | "assets" | "financing" | "cash", number>;

  const pillarHealths = {
    profit: pillarById.profit,
    assets: pillarById.assets,
    financing: pillarById.financing,
    cash: pillarById.cash,
  };

  const avgHealth = overallHealth.overall ?? NaN;

  const sphereRatioMeta = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(SPHERE_RATIO_META).map(([k, v]) => [
          k,
          { friendly: localizeCopy(v.friendly, clientMarket) },
        ]),
      ),
    [clientMarket],
  );

  const spherePillars = buildSpherePillars({
    overallHealth: avgHealth,
    pillarHealths,
    healthMap,
    ratioMeta: sphereRatioMeta,
  });

  const simplifiedSections = [
    { id: "profit", label: "Profitability", health: pillarHealths.profit, series: [] as number[] },
    {
      id: "assets",
      label: "Asset Efficiency",
      health: pillarHealths.assets,
      series: [] as number[],
    },
    {
      id: "financing",
      label: "Financing",
      health: pillarHealths.financing,
      series: [] as number[],
    },
    {
      id: "cash",
      label: "Cash & Working Capital",
      health: pillarHealths.cash,
      series: [] as number[],
    },
  ];

  const priorSnapshot = resolvePriorSnapshot(snapshots);
  const varianceChips = buildVarianceChips({
    currentFinancials: financials,
    currentRatios: ratios,
    prior: priorSnapshot,
    healthScore: healthScoreRounded,
    cashRunwayWeeks: effectiveRunway,
  });

  const waterfallFallback = derivePeriodWaterfallFallback(financials);

  // ── Ask AI widget mount (same widget the owner app uses) ────────────────
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const el = document.getElementById("ask-ai-accountant");
    if (!el) return;
    // Always refresh the client context — submit() reads dataset.clientId at
    // request time, so a stale value would send questions for the wrong client.
    el.dataset.clientId = clientId;
    if (el.dataset.askAiMounted) return;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — plain JS module without type declarations
    import("../../lib/ask-ai.js")
      .then((mod: { mountAskAi?: (el: HTMLElement, opts: unknown) => void }) => {
        if (cancelled || typeof mod.mountAskAi !== "function") return;
        el.dataset.clientId = clientId;
        el.dataset.askAiMounted = "1";
        mod.mountAskAi(el, {
          endpoint: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-ai`,
          variant: "studio",
          audience: "accountant",
          getToken: async () => {
            const { data } = await supabase.auth.getSession();
            return data.session?.access_token ?? null;
          },
        });
      })
      .catch(() => {
        // Widget module unavailable — silent fail
      });
    return () => {
      cancelled = true;
    };
  }, [client, clientId, activeTab]);

  // Autosave debounce ref
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load client ──────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Defensive query: reports_issued_count may not exist yet
        const { data, error } = await supabase
          .from("clients")
          .select(
            "id, name, business_type, client_code, operating_profile, cash_runway_weeks, last_forecast_at, financials, financials_updated_at, reports_issued_count, cashflow, market",
          )
          .eq("id", clientId)
          .maybeSingle();

        if (error) {
          const msg = error.message ?? "";
          const missingMarket = /market/i.test(msg) || error.code === "42703";
          if (
            missingMarket ||
            msg.includes("reports_issued_count") ||
            msg.includes("client_code")
          ) {
            const withoutMarket =
              "id, name, business_type, client_code, operating_profile, cash_runway_weeks, last_forecast_at, financials, financials_updated_at, reports_issued_count, cashflow";
            const stripped =
              "id, name, business_type, operating_profile, cash_runway_weeks, last_forecast_at, financials, financials_updated_at, cashflow";
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
                setFinancials(scalars);
                setDebtSchedule(ds);
                setWeeklyInputs(weeks);
                setProductMix(mix);
                financialsRef.current = scalars;
                debtScheduleRef.current = ds;
                weeklyInputsRef.current = weeks;
                productMixRef.current = mix;
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
              setFinancials(scalars);
              setDebtSchedule(ds);
              setWeeklyInputs(weeks);
              setProductMix(mix);
              financialsRef.current = scalars;
              debtScheduleRef.current = ds;
              weeklyInputsRef.current = weeks;
              productMixRef.current = mix;
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
          setFinancials(scalars);
          setDebtSchedule(ds);
          setWeeklyInputs(weeks);
          setProductMix(mix);
          financialsRef.current = scalars;
          debtScheduleRef.current = ds;
          weeklyInputsRef.current = weeks;
          productMixRef.current = mix;
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [clientId]);

  // Load financial snapshots for variance / prior period
  useEffect(() => {
    if (!clientId) return;
    supabase
      .from("client_financial_snapshots")
      .select("id, period_label, period_date, financials, ratios")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(24)
      .then(({ data }) => {
        setSnapshots(
          (data ?? []).map((s) => ({
            id: s.id as string,
            period_label: s.period_label as string,
            period_date: s.period_date as string,
            financials: (s.financials as Record<string, unknown>) ?? null,
            ratios: (s.ratios as Record<string, number>) ?? null,
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
    fetchReviewSignoffs({ data: { clientId } })
      .then(({ signoffs }) => {
        setReviewSignoffs(indexReviewSignoffs(signoffs));
      })
      .catch(() => {
        // Sign-off state is a trust-signal enhancement, never block the page.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, activeTab, cashForecastReloadToken]);

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
      const updatedAt = new Date().toISOString();
      const { error } = await supabase
        .from("clients")
        .update({ financials: updated as never, financials_updated_at: updatedAt })
        .eq("id", clientId);
      if (error) {
        toast.error(`Autosave failed: ${error.message}`);
        setAutosaveStatus("idle");
        return false;
      }
      setClient((c) => (c ? { ...c, financials_updated_at: updatedAt } : c));
      void upsertCurrentPeriodSnapshot({
        clientId,
        financials: updated,
        source: "autosave",
      });
      setAutosaveStatus("saved");
      setTimeout(() => setAutosaveStatus("idle"), 2000);
      return true;
    },
    [clientId],
  );

  const handleFinancialChange = useCallback(
    (key: string, value: string) => {
      setFinancials((prev) => {
        const next = { ...prev, [key]: value };
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
    const periodLabel = now.toLocaleString("en-US", { month: "short", year: "numeric" });
    const ratiosOut = computeRatios(ratioInputs);

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
      await recordScoreHistory(clientId, scoreFromRatioInputs(ratioInputs, effectiveRunway));
    }
  }, [clientId, financials, debtSchedule, ratioInputs, effectiveRunway, mergeCurrentBlob]);

  // ── Upload confirm ────────────────────────────────────────────────────────

  const handleConfirmFinancials = useCallback(
    async (result: ExtractionResult) => {
      const inputs = extractionToRatioInputs(result);
      const ratiosOut = computeRatios(inputs);
      const rawDate = result.current_period.period_end;
      const periodDate = rawDate ?? new Date().toISOString().slice(0, 10);
      const d = new Date(periodDate);
      const periodLabel = d.toLocaleString("en-US", { month: "short", year: "numeric" });

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
          .update({ financials: inputs as never, ratios: ratiosOut as never })
          .eq("id", existing.id);
        saveError = error;
      } else {
        const { error } = await supabase.from("client_financial_snapshots").insert({
          client_id: clientId,
          period_label: periodLabel,
          period_date: periodDate,
          financials: inputs as never,
          ratios: ratiosOut as never,
          source: "pdf_upload",
        });
        saveError = error;
      }

      if (saveError) {
        toast.error(`Failed to save snapshot: ${saveError.message}`);
        return;
      }

      const financialsUpdatedAt = new Date().toISOString();
      const nextScalars = {
        ...financialsRef.current,
        ...Object.fromEntries(
          Object.entries(inputs).map(([k, v]) => [k, v != null ? String(v) : ""]),
        ),
      };
      financialsRef.current = nextScalars;
      const blob = mergeCurrentBlob(nextScalars);
      await supabase
        .from("clients")
        .update({ financials: blob as never, financials_updated_at: financialsUpdatedAt })
        .eq("id", clientId);

      await recordScoreHistory(clientId, scoreFromRatioInputs(inputs, effectiveRunway));

      // Update local state with new financials
      setFinancials(nextScalars);
      setClient((c) => (c ? { ...c, financials_updated_at: financialsUpdatedAt } : c));
      toast.success(`Financials saved for ${periodLabel}`);
      track("financials_uploaded", {
        surface: "accountant_portal",
        clientId,
        firmId,
      });
      setUploadOpen(false);
    },
    [clientId, effectiveRunway, mergeCurrentBlob, firmId, track],
  );

  // ── Deliverables bar actions ──────────────────────────────────────────────

  const handleGenerateReport = useCallback(() => {
    setStudioDeepLink({});
    setActiveTab("reports");
  }, []);

  const handleExportPDF = useCallback(async () => {
    if (!client) return;
    try {
      const { HealthScorecardPDF } = await import("@/reports/health-scorecard");
      const { pdf } = await import("@react-pdf/renderer");
      const periodLabel = new Date().toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      });
      // Build ratio results from computed ratios (shared scoring + pillars)
      const ratioEntries = Object.entries(ratios)
        .filter(([, val]) => Number.isFinite(val as number))
        .map(([name, val]) => {
          const score = Math.round(scoreRatio(name, val as number, clientMarket));
          const tier = scoreTier(score);
          return {
            ratio_key: name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
            ratio_name: name,
            pillar: pillarForRatioName(name),
            current_value: val as number,
            health_score: score,
            health_tier: tier,
            formatted_value: formatRatioValue(name, val as number),
          };
        });

      const smeData = {
        name: client.name,
        period: periodLabel,
      };
      const financialsStamp = stampFromSignoff(
        financialsSignoff,
        computeIsStale(financialsSignoff, client.financials_updated_at ?? null),
      );
      const blob = await pdf(
        HealthScorecardPDF({
          smeData,
          ratioResults: ratioEntries,
          accountantProfile: profile,
          cashRunwayWeeks: effectiveRunway,
          reviewSignoff: financialsStamp,
        }) as Parameters<typeof pdf>[0],
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${client.name.replace(/\s+/g, "_")}_Health_Scorecard.pdf`;
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
    profile,
    user,
    financials,
    debtSchedule,
    financialsSignoff,
    effectiveRunway,
    firmId,
  ]);

  const handleEmailDraft = useCallback(async () => {
    if (!client) return;
    const score = healthScoreRounded;
    const tierLabel = overallHealth.displayLabel;
    const runway = effectiveRunway != null ? `${effectiveRunway} weeks` : "—";
    const weak =
      overallHealth.weakestPillar != null
        ? `\nWeakest pillar: ${overallHealth.weakestPillar.label} (${overallHealth.weakestPillar.score})\n`
        : "\n";
    const subjectText = `${client.name} — Financial Health Update`;
    const bodyText =
      `Hi,\n\nHere is a brief financial health summary for ${client.name}.\n\n` +
      `Overall Health Score: ${score}/100 (${tierLabel})\n` +
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
        periodLabel: new Date().toLocaleString("en-US", { month: "short", year: "numeric" }),
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
    openQueriesCount,
    user,
    financials,
    ratios,
    firmId,
  ]);

  const handleWhatsApp = useCallback(async () => {
    if (!client) return;
    const score = healthScoreRounded;
    const tierLabel = overallHealth.displayLabel;
    const text =
      `${client.name} Financial Health Update\n` +
      `Health Score: ${score}/100 (${tierLabel})\n` +
      `Cash Runway: ${effectiveRunway != null ? `${effectiveRunway} wk` : "—"}\n` +
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
        periodLabel: new Date().toLocaleString("en-US", { month: "short", year: "numeric" }),
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
    openQueriesCount,
    user,
    financials,
    ratios,
    firmId,
  ]);

  // ── Playbook drawer ───────────────────────────────────────────────────────

  const openDrawer = useCallback(
    (ratioName: string, score: number) => {
      const tier = scoreTier(score);
      const key = ratioName.toLowerCase().replace(/[^a-z0-9]/g, "_");
      setDrawerRatioKey(key);
      setDrawerRatioName(ratioName);
      setDrawerTier(tier);
      setDrawerOpen(true);
      track("playbook_opened", {
        surface: "accountant_portal",
        clientId,
        firmId,
        ratioName,
      });
    },
    [clientId, firmId, track],
  );

  // ── Report navigation ─────────────────────────────────────────────────────

  const handleTourTabChange = useCallback((tab: string) => {
    const next = resolveAccountantTab(tab);
    if (next) setActiveTab(next);
  }, []);

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="accountant-portal"
        style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}
      >
        <span style={{ color: "var(--ink-dim)" }}>Loading…</span>
      </div>
    );
  }

  if (!client) {
    return (
      <div
        className="accountant-portal"
        style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}
      >
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "var(--ink-dim)", marginBottom: 16 }}>
            Client not found or you don't have access.
          </p>
          <button className="btn ghost" onClick={() => navigate({ to: "/dashboard" })}>
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  const reportsIssued = client.reports_issued_count ?? 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <MarketProvider
      selection={parseMarketSelection(client.market) ?? coerceMarketSelection(client.market)}
    >
      <FinancialInputsContext.Provider value={financialInputsCtxValue}>
        <div className="accountant-portal">
          <WalkthroughWizard
            variant="accountant-client"
            ready={!loading && !!client && !firstDataOpen && !showBankDrafter && !uploadOpen}
            onTabChange={handleTourTabChange}
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
              <span className="spacer" />
              <button
                type="button"
                className="topbar-menu-btn"
                aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileNavOpen}
                onClick={() => setMobileNavOpen((o) => !o)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {mobileNavOpen ? (
                    <path d="M18 6L6 18M6 6l12 12" />
                  ) : (
                    <path d="M4 7h16M4 12h16M4 17h16" />
                  )}
                </svg>
              </button>
              <div className={`topbar-actions${mobileNavOpen ? " open" : ""}`}>
                <ThemeToggle />
                <button
                  className="tb-btn"
                  type="button"
                  onClick={() => {
                    setMobileNavOpen(false);
                    openPracticeSettings();
                    navigate({ to: "/settings" });
                  }}
                >
                  Settings
                </button>
                <button
                  className="tb-btn gold"
                  onClick={() => {
                    setMobileNavOpen(false);
                    handleGenerateReport();
                  }}
                >
                  <svg viewBox="0 0 24 24">
                    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                    <path d="M14 3v6h6" />
                  </svg>
                  Reports studio
                </button>
              </div>
            </div>

            {/* ===== BREADCRUMB ===== */}
            <div className="crumb">
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  exitImpersonation();
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                Firm dashboard
              </a>
              <span>/</span>
              <span>
                Acting as client: <b style={{ color: "var(--ink)" }}>{client.name}</b>
              </span>
              <span className="aud">Audited</span>
            </div>

            {/* ===== CLIENT HEADER ===== */}
            <div className="card client-head">
              <div className="idb">
                <div className="ring big-ring">
                  <HealthRing
                    score={healthScoreRounded}
                    status={overallHealth.displayStatus}
                    size={74}
                    strokeWidth={5}
                  />
                </div>
                <div>
                  <h1>{client.name}</h1>
                  <span className="ctype">
                    {client.client_code ? (
                      <span
                        style={{
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                          letterSpacing: "0.06em",
                          marginRight: 8,
                        }}
                      >
                        {client.client_code}
                      </span>
                    ) : null}
                    {profileIndustryLabel(
                      parseOperatingProfile(client.operating_profile),
                      client.business_type ?? "—",
                    )}
                  </span>
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      alignItems: "center",
                    }}
                  >
                    <span
                      className={`chip ${
                        overallHealth.displayStatus === "healthy"
                          ? "ok"
                          : overallHealth.displayStatus === "at_risk"
                            ? "warn"
                            : "risk"
                      }`}
                      style={{ fontSize: 11 }}
                    >
                      <i />
                      {overallHealth.displayLabel}
                    </span>
                    {overallHealth.pillars
                      .filter((p) => p.score != null)
                      .map((p) => (
                        <span
                          key={p.id}
                          title={`${p.label}: ${p.score}`}
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: "var(--soft, #f1f5f9)",
                          }}
                        >
                          {p.label.split(" ")[0]}{" "}
                          <b
                            style={{
                              color:
                                p.status === "critical"
                                  ? "var(--risk)"
                                  : p.status === "at_risk"
                                    ? "var(--warn)"
                                    : "var(--ink)",
                            }}
                          >
                            {p.score}
                          </b>
                        </span>
                      ))}
                  </div>
                </div>
              </div>
              <div className="meta">
                <div>
                  <b>{effectiveRunway != null ? `${effectiveRunway} wk` : "—"}</b>
                  <span>Cash runway</span>
                </div>
                <div>
                  <b>
                    {client.last_forecast_at
                      ? formatDate(client.last_forecast_at, clientMarket, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </b>
                  <span>Last forecast</span>
                </div>
                <button
                  type="button"
                  className="meta-notes"
                  title="Open and resolved notes"
                  onClick={() => openArchive(openQueriesCount > 0 ? "open" : "resolved")}
                >
                  <b>
                    {notesLoading && clientNotes.length === 0
                      ? openQueriesCount
                      : clientNotes.filter((n) => !n.resolved).length}
                  </b>
                  <span>Open queries</span>
                </button>
                <div>
                  <b>{reportsIssued}</b>
                  <span>Reports issued</span>
                </div>
              </div>
            </div>

            <AccountantOperatingProfile
              profile={parseOperatingProfile(client.operating_profile)}
              fallbackType={client.business_type}
              onEdit={() => setProfileOpen(true)}
            />

            <PeriodVarianceStrip
              chips={varianceChips}
              priorLabel={priorSnapshot?.period_label ?? null}
              onOpenMovement={() => {
                setStudioDeepLink({ report: "movement", action: "preview" });
                setActiveTab("reports");
              }}
            />

            {/* ===== DELIVERABLES ACTION BAR ===== */}
            <div className="card hero-card action-bar">
              <span className="lbl">
                <b>Deliverables</b> — export, send, or draft for this client
              </span>
              <button className="btn gold mini" onClick={handleGenerateReport}>
                <svg viewBox="0 0 24 24">
                  <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <path d="M14 3v6h6" />
                </svg>
                Generate report
              </button>
              <button className="btn ghost mini" onClick={handleExportPDF}>
                <svg viewBox="0 0 24 24">
                  <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
                </svg>
                Export PDF
              </button>
              <button className="btn ghost mini" onClick={handleEmailDraft}>
                <svg viewBox="0 0 24 24">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M3 7l9 6 9-6" />
                </svg>
                Email draft
              </button>
              <button className="btn ghost mini" onClick={handleWhatsApp}>
                <svg viewBox="0 0 24 24">
                  <path d="M21 12a9 9 0 0 1-13.4 7.8L3 21l1.3-4.4A9 9 0 1 1 21 12z" />
                </svg>
                WhatsApp
              </button>
            </div>

            {/* ===== TABS ===== */}
            <div className="tabs">
              {(
                [
                  { id: "ask", label: "Ask AI", star: true },
                  { id: "ratios", label: "Health & Ratios" },
                  { id: "profit", label: "Profitability" },
                  { id: "cash", label: "13-Week Cash Forecast", star: true },
                  { id: "budget", label: "Budget" },
                  { id: "reports", label: "Reports", star: true },
                  { id: "plan", label: "Action Plan", star: true },
                  { id: "advisory", label: "Advisory Drafter" },
                ] as { id: ActiveTab; label: string; star?: boolean }[]
              ).map((t) => (
                <button
                  key={t.id}
                  className={`tab${activeTab === t.id ? " on" : ""}`}
                  data-tab={t.id}
                  onClick={() => setActiveTab(t.id)}
                >
                  {t.label}
                  {t.star && <span className="star">✦</span>}
                </button>
              ))}
            </div>

            {/* Simplified / Complex — Health, Budget, Action Plan (not Ask AI) */}
            <div
              style={{
                display: activeTab === "ask" ? "none" : "flex",
                justifyContent: "center",
                margin: "8px 0 20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.05)",
                  padding: 3,
                  border: "1px solid var(--line)",
                }}
              >
                {(["simplified", "complex"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setViewMode(m);
                      track("view_mode_toggled", {
                        mode: m,
                        surface: "accountant_portal",
                        clientId,
                        firmId,
                      });
                    }}
                    style={{
                      borderRadius: 999,
                      padding: "5px 18px",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      transition: "all 0.18s",
                      border: "none",
                      cursor: "pointer",
                      background: viewMode === m ? "#d4a550" : "transparent",
                      color: viewMode === m ? "#0a0e1a" : "var(--ink-dim)",
                      boxShadow: viewMode === m ? "0 2px 8px rgba(212,165,80,0.35)" : "none",
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* ===== ASK AI TAB ===== */}
            <div className={`tabpane${activeTab === "ask" ? " on" : ""}`} id="pane-ask">
              <div className="card hero-card pad ask-ai-studio-shell">
                <p className="ask-ai-studio-kicker">Ask AI · this client</p>
                <h2 className="ask-ai-studio-title">Ask about {client.name}</h2>
                <p className="ask-ai-studio-lede">
                  Same rules as the owner copilot: answers come from filled profile questions,
                  ratios, the profitability waterfall, cash-forecast outlook, product lines, next
                  moves, and planned or outstanding action-plan tasks — not the raw statements.
                </p>
                <div id="ask-ai-accountant" />
              </div>
            </div>

            {/* ===== RATIOS TAB ===== */}
            <div className={`tabpane${activeTab === "ratios" ? " on" : ""}`} id="pane-ratios">
              {/* Simplified view — health orb + pillar cards */}
              {viewMode === "simplified" && (
                <div style={{ marginBottom: 32 }}>
                  {/* Orb — always-dark container so sphere colours read correctly */}
                  <div
                    style={{
                      background: "#0a0e1a",
                      borderRadius: 20,
                      padding: "16px 8px",
                      marginBottom: 20,
                    }}
                  >
                    <SphereHero
                      overallHealth={isFinite(avgHealth) ? avgHealth : NaN}
                      displayStatus={overallHealth.displayStatus}
                      pillars={spherePillars}
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
                        const labels: Record<string, string> = {
                          profit: "Profitability",
                          assets: "Asset Efficiency",
                          financing: "Financing",
                          cash: "Cash & Working Capital",
                        };
                        return {
                          title: `Improve ${labels[worst[0]] ?? worst[0]}`,
                          description: `This pillar scores ${Math.round(worst[1])}% — your highest-impact area right now.`,
                        };
                      })()}
                    />
                  </div>
                  {/* Pillar summary cards */}
                  <div style={{ background: "#0a0e1a", borderRadius: 20, padding: 16 }}>
                    <SimplifiedRatios sections={simplifiedSections} />
                  </div>
                </div>
              )}

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
                    Edit figures or upload a statement — every ratio recalculates live
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
                        justifyContent: "flex-end",
                        marginBottom: 16,
                      }}
                    >
                      <button className="btn ghost mini" onClick={handleSaveSnapshot}>
                        Save snapshot
                      </button>
                      <button className="btn gold mini" onClick={() => setShowBankDrafter(true)}>
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
                    <div style={{ marginBottom: 16 }}>
                      <QboConnectCard
                        clientId={clientId}
                        onSyncComplete={(inputs) => {
                          const next = Object.fromEntries(
                            Object.entries(inputs).map(([k, val]) => [k, String(val)]),
                          );
                          const nextScalars = { ...financialsRef.current, ...next };
                          financialsRef.current = nextScalars;
                          setFinancials(nextScalars);
                          const updated = mergeCurrentBlob(nextScalars);
                          const updatedAt = new Date().toISOString();
                          void supabase
                            .from("clients")
                            .update({
                              financials: updated as never,
                              financials_updated_at: updatedAt,
                            })
                            .eq("id", clientId)
                            .then(({ error }) => {
                              if (error) {
                                toast.error(`QBO sync save failed: ${error.message}`);
                                return;
                              }
                              setClient((c) =>
                                c ? { ...c, financials_updated_at: updatedAt } : c,
                              );
                              void upsertCurrentPeriodSnapshot({
                                clientId,
                                financials: updated as Record<string, unknown>,
                                source: "qbo",
                              });
                              toast.success("Financials updated from QuickBooks");
                            });
                        }}
                      />
                    </div>
                    <div className="fin-grid">
                      {FIELD_LABELS.map(({ key, label }) => (
                        <div key={key}>
                          <label>{label}</label>
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
                    <DebtScheduleEditor value={debtSchedule} onChange={handleDebtScheduleChange} />
                  </div>
                </div>
              </div>

              {/* Practice portal: always show interactive sign-off (server still enforces access). */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
                <ReviewSignoffButton
                  clientId={clientId}
                  clientName={client?.name}
                  scope="financials"
                  signoff={financialsSignoff}
                  isStale={computeIsStale(financialsSignoff, client?.financials_updated_at ?? null)}
                  onChange={patchSignoff("financials")}
                />
              </div>

              {/* Ratio rows — complex mode only */}
              {viewMode === "complex" && (
                <div style={{ marginTop: 26 }}>
                  <span className="eyebrow">Ratios — accountant summary</span>
                  <p className="sub">
                    Tap any ratio for its definition and the ten-step repair playbook.
                  </p>
                  <div className="ratio-rows">
                    {Object.entries(ratios).map(([name, val]) => {
                      const score = Math.round(ratioHealthScore(name, val as number, clientMarket));
                      const tier = scoreTier(score);
                      const band = tierToBand(tier);
                      const color = bandColor(band);
                      const formattedVal = formatRatioValue(name, val as number);
                      const cat =
                        name.includes("Margin") ||
                        name.includes("Income") ||
                        name.includes("Return")
                          ? "Profitability"
                          : name.includes("Days") ||
                              name.includes("Capital") ||
                              name.includes("OCF")
                            ? "Cash & Working Capital"
                            : name.includes("Equity") ||
                                name.includes("Debt") ||
                                name.includes("Asset") ||
                                name.includes("Burden")
                              ? "Leverage & Assets"
                              : "Other";

                      return (
                        <button
                          key={name}
                          className="ratio-row"
                          onClick={() => openDrawer(name, score)}
                        >
                          <span>
                            <span className="rn">{name}</span>
                            <br />
                            <span className="rc">{cat}</span>
                          </span>
                          <span className="rv" style={{ color }}>
                            {formattedVal}
                          </span>
                          <span className="bar">
                            <i style={{ width: `${score}%`, background: color }} />
                          </span>
                          <span className={`chip ${band}`}>
                            <i />
                            {bandLabel(band)}
                          </span>
                          <span className="arr">→</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ===== PROFIT TAB ===== */}
            <div className={`tabpane${activeTab === "profit" ? " on" : ""}`} id="pane-profit">
              <span className="eyebrow">Profitability Waterfall</span>
              <p className="sub" style={{ marginBottom: 24 }}>
                How revenue converts to profit — step by step. Enter figures below or upload a
                statement PDF.
              </p>

              <div
                className={`card collapse${profitFinOpen ? " open" : ""}`}
                id="profitFinCollapse"
                style={{ marginBottom: 20 }}
              >
                <div
                  className="c-head"
                  onClick={() => setProfitFinOpen((v) => !v)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setProfitFinOpen((v) => !v)}
                >
                  <h3>
                    Profitability inputs{" "}
                    {autosaveStatus === "saving" && (
                      <span className="autosave" style={{ marginLeft: 10 }}>
                        Saving…
                      </span>
                    )}
                    {(autosaveStatus === "saved" || autosaveStatus === "idle") && (
                      <span className="autosave" style={{ marginLeft: 10 }}>
                        Auto-saved
                      </span>
                    )}
                  </h3>
                  <span className="hint">
                    Edit period P&amp;L or weekly inputs — the waterfall matches the owner board
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
                        flexWrap: "wrap",
                        gap: 10,
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 16,
                      }}
                    >
                      <p
                        style={{ margin: 0, fontSize: 12, color: "var(--ink-dim)", maxWidth: 420 }}
                      >
                        Same period figures as Health &amp; Ratios, plus the same weekly inputs the
                        owner enters on Profit. Weeks feed the waterfall when present.
                      </p>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn ghost mini"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveTab("ratios");
                            setFinOpen(true);
                          }}
                        >
                          Full financials
                        </button>
                        <button
                          type="button"
                          className="btn gold mini"
                          onClick={(e) => {
                            e.stopPropagation();
                            setUploadOpen(true);
                          }}
                        >
                          <svg viewBox="0 0 24 24">
                            <path d="M12 15V3M7 8l5-5 5 5M5 21h14" />
                          </svg>
                          Upload PDF statement
                        </button>
                      </div>
                    </div>
                    <div className="fin-grid">
                      {PROFIT_FIELD_LABELS.map(({ key, label }) => (
                        <div key={key}>
                          <label>{label}</label>
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
                  </div>
                </div>
              </div>

              {/* Wrap in a Tailwind dark context so the component's dark: variants fire */}
              <div className="dark" id="wizard-profit-walk" style={{ colorScheme: "dark" }}>
                <ProfitabilityWaterfall
                  fallback={waterfallFallback}
                  clientName={client?.name}
                  clientId={client?.id}
                  reviewSignoff={stampFromSignoff(
                    profitabilitySignoff,
                    computeIsStale(profitabilitySignoff, client?.financials_updated_at ?? null),
                  )}
                />
                <div style={{ marginTop: 16 }}>
                  <ProductMixPanel
                    totalRevenue={resolveWaterfallFigures(weeklyInputs, waterfallFallback).revenue}
                  />
                </div>
                {/* Same weekly grid as the owner Profit tab — weeks feed this waterfall. */}
                <div style={{ marginTop: 16 }}>
                  <WeeklyInputTable role="accountant" />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                <ReviewSignoffButton
                  clientId={clientId}
                  clientName={client?.name}
                  scope="profitability"
                  signoff={profitabilitySignoff}
                  isStale={computeIsStale(
                    profitabilitySignoff,
                    client?.financials_updated_at ?? null,
                  )}
                  onChange={patchSignoff("profitability")}
                />
              </div>
            </div>

            {/* ===== CASH TAB ===== */}
            <div className={`tabpane${activeTab === "cash" ? " on" : ""}`} id="pane-cash">
              <div className="card cf-wrap" id="wizard-cash-panel">
                <div className="cf-head">
                  <div>
                    <span className="eyebrow">Signature view</span>
                    <div className="h-sec">13-week cash forecast</div>
                  </div>
                  <button
                    type="button"
                    className="btn ghost mini"
                    onClick={() => setCashBankUploadToken((n) => n + 1)}
                  >
                    Upload bank statements
                  </button>
                </div>
                <CashForecastPanel
                  clientId={client.id}
                  clientName={client.name}
                  canSign
                  reloadToken={cashForecastReloadToken}
                  openBankUploadToken={cashBankUploadToken}
                  initialBankDraft={bankCashDraft}
                  onBankPublish={(payload) => {
                    setBankCashDraft(null);
                    const runway = runwayWeeksFromCashflow(payload);
                    setClient((c) =>
                      c
                        ? {
                            ...c,
                            cashflow: payload,
                            last_forecast_at: new Date().toISOString(),
                            ...(runway != null ? { cash_runway_weeks: runway } : {}),
                          }
                        : c,
                    );
                  }}
                />
              </div>
            </div>

            {/* ===== BUDGET TAB ===== */}
            <div className={`tabpane${activeTab === "budget" ? " on" : ""}`} id="pane-budget">
              <div id="wizard-budget-panel">
                <span className="eyebrow">Living FY budget</span>
                <div className="h-sec">Driver-based monthly budget</div>
                <p className="sub" style={{ marginBottom: 24 }}>
                  Use <b>Complex</b> for full driver grids, capex, and sensitivity.{" "}
                  <b>Simplified</b> keeps volume × price and cash timing front-and-centre.
                </p>
                <div className="dark" style={{ colorScheme: "dark" }}>
                  <BudgetPanel
                    clientId={client.id}
                    clientName={client.name}
                    simplified={viewMode === "simplified"}
                    role="accountant"
                    canSign
                    businessTypeId={client.business_type}
                    operatingProfile={parseOperatingProfile(client.operating_profile)}
                    financials={financials}
                    fyStartMonthDefault={
                      parseOperatingProfile(client.operating_profile)?.fyStartMonth ??
                      resolveMarket(coerceMarketSelection(client.market)).fyStartMonthDefault
                    }
                    onRetakeProfile={() => setProfileOpen(true)}
                    onPushedToCash={() => {
                      setCashForecastReloadToken((n) => n + 1);
                      setActiveTab("cash");
                    }}
                  />
                </div>
              </div>
            </div>

            {/* ===== REPORTS TAB — same Reports Studio as /reports ===== */}
            <div className={`tabpane${activeTab === "reports" ? " on" : ""}`} id="pane-reports">
              <p className="sub" style={{ marginBottom: 8 }}>
                Sign off Health, Profit, Cash or Budget so that deliverable&apos;s stamp appears on
                its PDF.
              </p>
              {activeTab === "reports" && (
                <TabErrorBoundary label="Reports">
                  <Suspense
                    fallback={
                      <div style={{ padding: 24, color: "var(--ink-dim)" }}>Loading reports…</div>
                    }
                  >
                    <ReportsStudioPanel
                      key={client.id}
                      client={client.name}
                      clientId={client.id}
                      report={studioDeepLink.report}
                      action={studioDeepLink.action}
                      embedded
                      onSearchCleared={() => setStudioDeepLink({})}
                    />
                  </Suspense>
                </TabErrorBoundary>
              )}
            </div>

            {/* ===== ACTION PLAN TAB ===== */}
            <div className={`tabpane${activeTab === "plan" ? " on" : ""}`} id="pane-plan">
              <span className="eyebrow">Live action plan</span>
              <div className="h-sec">What we agreed they&apos;d do</div>
              <p className="sub" style={{ marginBottom: 24 }}>
                Same plan the owner sees under Next Moves / Action Plan — chase overdue work from
                here, or edit without impersonating.
              </p>
              {/* Follow the portal theme. A nested `.dark` island made Tailwind
              light-on-dark copy fire while accountant `--card` stayed a
              near-transparent cream — titles vanished in light mode. */}
              <TabErrorBoundary label="Action Plan">
                <Suspense
                  fallback={
                    <div style={{ padding: 24, color: "var(--ink-dim)" }}>Loading plan…</div>
                  }
                >
                  {activeTab === "plan" && (
                    <ActionPlanPanel
                      key={`${client.id}-${search.filter === "overdue" ? "overdue" : "all"}`}
                      clientId={client.id}
                      clientName={client.name}
                      simplified={viewMode === "simplified"}
                      isOwner
                      initialFilter={search.filter === "overdue" ? "overdue" : undefined}
                    />
                  )}
                </Suspense>
              </TabErrorBoundary>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                <ReviewSignoffButton
                  clientId={clientId}
                  clientName={client?.name}
                  scope="action_plan"
                  signoff={actionPlanSignoff}
                  isStale={false}
                  onChange={patchSignoff("action_plan")}
                />
              </div>
            </div>

            {/* ===== ADVISORY TAB ===== */}
            <div className={`tabpane${activeTab === "advisory" ? " on" : ""}`} id="pane-advisory">
              <AdvisoryDrafter
                clientId={client.id}
                clientName={client.name}
                onLogged={() => setDeliveryRefresh((n) => n + 1)}
              />
              <AdvisorySentHistory clientId={client.id} refreshToken={deliveryRefresh} />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
                <ReviewSignoffButton
                  clientId={clientId}
                  clientName={client?.name}
                  scope="advisory"
                  signoff={advisorySignoff}
                  isStale={false}
                  onChange={patchSignoff("advisory")}
                />
              </div>
            </div>

            <div className="footer-note">
              MILŌN Practice Portal ·{" "}
              <span className="serif gold-text">The passion to perform.</span>
            </div>
          </div>

          {/* ===== PLAYBOOK DRAWER ===== */}
          <PlaybookDrawer
            ratioKey={drawerRatioKey}
            ratioName={drawerRatioName}
            healthTier={drawerTier}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            clientId={client.id}
            clientName={client.name}
            isAccountant={true}
          />

          {/* Contextual notes — shared with owner app, persisted per client */}
          {client && (
            <NoteLayer
              clientId={client.id}
              tab={activeTab}
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
                if (resolved) setActiveTab(resolved);
              }}
            />
          )}

          {/* ===== UPLOAD FINANCIALS MODAL ===== */}
          {uploadOpen && (
            <div className="veil open" onClick={() => setUploadOpen(false)} role="presentation">
              <div
                className="drawer open"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
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
                  <h3 style={{ fontSize: 20, fontWeight: 700 }}>Upload financial statement</h3>
                  <button
                    className="close"
                    onClick={() => setUploadOpen(false)}
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
                  Claude reads the PDF and extracts the income statement and balance sheet. Review
                  every figure before confirming. The quality of the financial information we
                  produce depends on the accuracy of the information you upload.
                </p>
                <UploadFinancials onConfirm={handleConfirmFinancials} />
              </div>
            </div>
          )}

          {/* First-client: bank statements nudge */}
          <Dialog open={firstDataOpen} onOpenChange={setFirstDataOpen}>
            <DialogContent className="border border-slate-800 bg-slate-950 text-slate-50 max-w-md">
              <DialogHeader>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d4a550]">
                  Practice client · Step 1
                </p>
                <DialogTitle className="text-xl text-slate-100 mt-1">
                  {isUsCopy(clientMarket)
                    ? "Upload Excel, CSV, or PDF — or bank statements"
                    : "Upload 3 months of bank statements"}
                </DialogTitle>
                <DialogDescription className="text-slate-400">
                  {isUsCopy(clientMarket)
                    ? "Fastest US path for this client: Excel, CSV, or a PDF pack. Bank statements also work. Connect QuickBooks from the financials panel when QBO is configured. Xero is also on the list, not the lead path."
                    : "Fastest path for this client: drop ~3 months of statements (every bank account). One pack drafts P&L, seeds budget, builds cash forecast, and shows movements in balances — then tour the workspace."}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 pt-2">
                {isUsCopy(clientMarket) ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setFirstDataOpen(false);
                        setUploadOpen(true);
                      }}
                      className="btn gold"
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      Upload Excel, CSV, or PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFirstDataOpen(false);
                        setShowBankDrafter(true);
                      }}
                      className="btn ghost"
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      Upload bank statements
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setFirstDataOpen(false);
                        setShowBankDrafter(true);
                      }}
                      className="btn gold"
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      Upload bank statements
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFirstDataOpen(false);
                        setUploadOpen(true);
                      }}
                      className="btn ghost"
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      Upload a financial statement instead
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setFirstDataOpen(false)}
                  className="text-xs text-slate-500 hover:text-slate-400 pt-1 text-center"
                  style={{ background: "none", border: "none", cursor: "pointer" }}
                >
                  Skip for now — tour the empty board
                </button>
              </div>
            </DialogContent>
          </Dialog>

          <BankStatementDrafter
            open={showBankDrafter}
            onClose={() => setShowBankDrafter(false)}
            onApply={async ({ fields, annualised, cashDraft }) => {
              const asStrings = Object.fromEntries(
                Object.entries(fields).map(([k, v]) => [k, v != null ? String(v) : ""]),
              );
              setFinancials((prev) => {
                const next = { ...prev, ...asStrings };
                financialsRef.current = next;
                return next;
              });
              setShowBankDrafter(false);
              setBankCashDraft(cashDraft ?? null);

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
              await recordScoreHistory(
                clientId,
                scoreFromRatioInputs({ ...ratioInputs, ...fields } as RatioInputs, effectiveRunway),
              );
              toast.success(
                annualised
                  ? "Draft figures applied (annualised) — saved."
                  : "Draft figures applied for the statement period — saved.",
              );

              try {
                const { data: row } = await supabase
                  .from("clients")
                  .select("budget, financial_year_start_month, operating_profile")
                  .eq("id", clientId)
                  .maybeSingle();
                const fyMonth =
                  (row as { financial_year_start_month?: number | null } | null)
                    ?.financial_year_start_month ?? 3;
                const profile = parseOperatingProfile(
                  (row as { operating_profile?: unknown } | null)?.operating_profile,
                );
                const budgetRaw = (row as { budget?: BudgetDocument | null } | null)?.budget;
                let doc =
                  budgetRaw?.version === 1
                    ? normalizeBudgetDocument(budgetRaw as BudgetDocument)
                    : null;
                if (!doc && profile) {
                  doc = createBudgetDocument({
                    templateId: profile.templateId,
                    qualification: profileToBudgetQualification(profile),
                    fyStartMonth: fyMonth,
                    fyStart: currentFyStart(fyMonth),
                    market: resolveMarket(coerceMarketSelection(client.market)),
                  });
                }
                if (doc) {
                  const seeded = seedBudgetFromFinancials(doc, fields);
                  const updatedAt = new Date().toISOString();
                  await supabase
                    .from("clients")
                    .update({
                      budget: { ...seeded.doc, updatedAt } as never,
                      budget_updated_at: updatedAt,
                    } as never)
                    .eq("id", clientId);
                  if (seeded.changes.length) {
                    toast.message("Budget pre-filled from bank draft", {
                      description: seeded.changes[0],
                    });
                  }
                }
              } catch (e) {
                console.warn("budget seed after bank draft:", e);
              }

              // Same statement pack → cash forecast (no re-upload).
              setTimeout(() => {
                setActiveTab("cash");
                setCashBankUploadToken((n) => n + 1);
              }, 400);
            }}
          />

          <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
            <DialogContent className="flex h-[min(90vh,calc(100dvh-1rem))] max-h-[min(90vh,calc(100dvh-1rem))] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden border border-slate-800 bg-slate-950 p-4 text-slate-50 sm:p-6">
              <DialogHeader className="sr-only">
                <DialogTitle>Business profile</DialogTitle>
                <DialogDescription>Ten questions that tune Milōn to this client</DialogDescription>
              </DialogHeader>
              <ProfileFunnel
                mode="retake"
                initial={parseOperatingProfile(client.operating_profile)}
                initialFyStartMonth={
                  parseOperatingProfile(client.operating_profile)?.fyStartMonth ?? 3
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
