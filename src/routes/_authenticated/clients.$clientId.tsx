import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback, lazy, Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { AdvisoryDrafter } from "@/components/advisory-drafter";
import { CashForecastPanel } from "@/components/cash-forecast";
import { BudgetPanel } from "@/components/budget/budget-panel";
import type { ExistingCashflow } from "@/lib/cash-from-banks.publish";
import { TasksPanel } from "@/components/tasks-panel";
import { UploadFinancials } from "@/components/upload-financials";
import { PlaybookDrawer } from "@/components/playbook-drawer";
import type { ExtractionResult } from "@/lib/financialSchema";
import { computeRatios, scoreTier } from "@/lib/ratios";
import type { RatioInputs, HealthTier } from "@/lib/ratios";
import {
  scoreRatio,
  scoreFromRatioInputs,
  healthFromRatioInputs,
  pillarForRatioName,
  type OverallHealth,
} from "@/lib/health-score";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import "@/styles/accountant-portal.css";
import { ThemeToggle } from "@/components/theme-toggle";
import { SphereHero } from "@/components/sphere-hero";
import { buildSpherePillars } from "@/components/sphere-hero-adapter";
import { SimplifiedRatios } from "@/components/simplified-ratios";
import { ProfitabilityWaterfall } from "@/components/profitability-waterfall";
import { useServerFn } from "@tanstack/react-start";
import { listClientReviewSignoffs } from "@/lib/review-signoffs.functions";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import { ReviewSignoffButton, computeIsStale } from "@/components/review-signoff";
import {
  parseOperatingProfile,
  stampProfileProvenance,
  type ClientOperatingProfile,
} from "@/lib/client-profile";
import { profileIndustryLabel } from "@/lib/profile-signals";
import { AccountantOperatingProfile } from "@/components/accountant-operating-profile";
import { NoteLayer } from "@/components/note-layer";
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
import {
  buildVarianceChips,
  resolvePriorSnapshot,
  type SnapshotRow,
} from "@/lib/prior-period";
import { AdvisorySentHistory } from "@/components/advisory-sent-history";
import {
  hashFigures,
  latestSnapshotId,
  recordDelivery,
} from "@/lib/advisory-deliveries";

const ActionPlanPanel = lazy(() => import("@/components/action-plan"));

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
function ratioHealthScore(name: string, val: number): number {
  return scoreRatio(name, val);
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
  component: ClientView,
});

type Client = {
  id: string;
  name: string;
  business_type: string | null;
  operating_profile?: unknown;
  cash_runway_weeks: number | null;
  last_forecast_at: string | null;
  open_queries_count: number;
  reports_issued_count?: number;
  financials?: Record<string, string | number | null> | null;
  financials_updated_at?: string | null;
  cashflow?: ExistingCashflow | null;
};

type ActiveTab =
  | "ratios"
  | "profit"
  | "cash"
  | "budget"
  | "reports"
  | "plan"
  | "tasks"
  | "advisory";

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
const RATIO_NAME_TO_KEY: Record<string, string> = {
  "Gross Margin": "grossMargin",
  "Operating Margin": "operatingMargin",
  "Net Margin": "netMargin",
  "Return on Assets": "roa",
  "Return on Equity": "roe",
  "Asset Turnover": "assetTurnover",
  "Equity Multiplier": "equityMultiplier",
  "Interest Burden": "interestBurden",
  "Tax Burden": "taxBurden",
  "Debtor Days": "debtorDays",
  "Inventory Days": "inventoryDays",
  "Creditor Days": "creditorDays",
  "Working Capital Days": "workingCapitalDays",
  "Fixed Cost Ratio": "fixedCostRatio",
  "Degree of Operating Leverage": "dol",
  "Top-5 Customer Share": "customerConcentration",
  "Gross Profit / Labor": "gpToLabor",
  "Sales-per-Employee Ratio": "salesPerEmployee",
  "OCF / EBITDA": "ocfToEbitda",
};

// ── Report gallery definitions (names match Reports Studio / PDF titles) ──
const REPORT_TEMPLATES = [
  {
    key: "scorecard",
    name: "Financial Health Scorecard",
    desc: "Overall score, four pillars, and every tracked ratio with tier badges.",
    iconPath: "M9 17V9M13 17v-5M17 17v-8",
  },
  {
    key: "intervention",
    name: "Priority Intervention Plan",
    desc: "Ranked action steps for at-risk and critical ratios.",
    iconPath: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  },
  {
    key: "forecast",
    name: "13-Week Cash Flow Forecast",
    desc: "Weekly cash position, runway to the R50k floor, and assumptions.",
    iconPath: "M3 17l6-6 4 4 8-8",
  },
  {
    key: "cycle",
    name: "Cash Flow Cycle Report",
    desc: "Debtors, stock, creditors, and cash trapped in the cycle.",
    iconPath: "M21 12a9 9 0 1 1-6.2-8.6M21 3v6h-6",
  },
  {
    key: "waterfall",
    name: "Profitability Waterfall",
    desc: "Revenue through to net profit with margin bridges.",
    iconPath:
      "M12 8c-2 0-3 .9-3 2s1 1.6 3 2 3 1 3 2-1 2-3 2M12 6v2M12 16v2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  },
  {
    key: "leverage",
    name: "Leverage & Solvency",
    desc: "Debt structure, equity bridge, and financing ratios.",
    iconPath: "M4 10h16M4 14h16M7 10V7a5 5 0 0 1 10 0v3",
  },
  {
    key: "assets",
    name: "Asset Productivity",
    desc: "DuPont ROE tree, capex vs depreciation, and asset turns.",
    iconPath: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  },
  {
    key: "labor",
    name: "Labour Productivity",
    desc: "Revenue per employee, GP per labour rand, growth vs inflation.",
    iconPath: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  },
  {
    key: "movement",
    name: "Ratio Movement",
    desc: "Tracked ratios across four periods — declines highlighted.",
    iconPath: "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6",
  },
  {
    key: "benchmark",
    name: "Industry Benchmark Report",
    desc: "Each ratio vs sector median and top quartile.",
    iconPath: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  },
];

// ── Component ──────────────────────────────────────────────────────────────

function ClientView() {
  const { clientId } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { profile } = useAccountantProfile();

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>("ratios");
  const [finOpen, setFinOpen] = useState(true); // collapsible open by default
  const [profitFinOpen, setProfitFinOpen] = useState(true);
  const [autosaveStatus, setAutosaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [viewMode, setViewMode] = useState<"simplified" | "complex">("simplified");
  const [cashForecastReloadToken, setCashForecastReloadToken] = useState(0);
  const [cashBankUploadToken, setCashBankUploadToken] = useState(0);

  // Financials state (flat key-value for the fin-grid)
  const [financials, setFinancials] = useState<Record<string, string>>({});
  const [debtSchedule, setDebtSchedule] = useState<DebtSchedule>(emptyDebtSchedule());
  const [profileOpen, setProfileOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [deliveryRefresh, setDeliveryRefresh] = useState(0);

  // Accountant sign-off on this period's financials / cash forecast
  const fetchReviewSignoffs = useServerFn(listClientReviewSignoffs);
  const [financialsSignoff, setFinancialsSignoff] = useState<ClientReviewSignoff | null>(null);
  const [cashForecastSignoff, setCashForecastSignoff] = useState<ClientReviewSignoff | null>(null);
  const [budgetSignoff, setBudgetSignoff] = useState<ClientReviewSignoff | null>(null);
  const [budgetUpdatedAt, setBudgetUpdatedAt] = useState<string | null>(null);

  // Playbook drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  const overallHealth: OverallHealth = healthFromRatioInputs(
    ratioInputs,
    effectiveRunway,
  );
  const healthScoreRounded = overallHealth.overall ?? 0;

  // ── Health orb & pillar computation (same source as header / score history) ──
  const healthMap: Record<string, number> = {};
  Object.entries(ratios).forEach(([name, val]) => {
    const key = RATIO_NAME_TO_KEY[name];
    if (key) healthMap[key] = Math.round(scoreRatio(name, val as number));
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

  const avgHealth = overallHealth.overall ?? NaN;

  const spherePillars = buildSpherePillars({
    overallHealth: avgHealth,
    pillarHealths,
    healthMap,
    ratioMeta: SPHERE_RATIO_META,
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
    cashRunwayWeeks: client?.cash_runway_weeks ?? null,
  });

  // Waterfall fallback — derived from period financials.
  // PDF-extracted statements supply EBIT/EBT/netIncome but leave fixedCosts
  // blank, so derive operating expenses as the residual (gross profit − EBIT)
  // when no classified figure exists. Interest and tax stay signed so the
  // waterfall reconciles to the reported net income even in loss periods or
  // with non-operating income / tax credits.
  const finNum = (key: string) => parseFloat(financials[key] || "0") || 0;
  const hasFin = (key: string) => (financials[key] ?? "") !== "";
  const wfRevenue = finNum("revenue");
  const wfCogs = finNum("cogs");
  const wfGrossProfit = wfRevenue - wfCogs;
  const wfOpex = hasFin("fixedCosts")
    ? finNum("fixedCosts")
    : hasFin("ebit")
      ? wfGrossProfit - finNum("ebit")
      : 0;
  const wfInterest = hasFin("ebit") && hasFin("ebt") ? finNum("ebit") - finNum("ebt") : 0;
  const wfTax = hasFin("ebt") && hasFin("netIncome") ? finNum("ebt") - finNum("netIncome") : 0;
  const waterfallFallback = {
    revenue: wfRevenue,
    cogs: wfCogs,
    fixedCosts: wfOpex,
    interest: wfInterest,
    tax: wfTax,
  };

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
  }, [client, clientId]);

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
            "id, name, business_type, operating_profile, cash_runway_weeks, last_forecast_at, open_queries_count, financials, financials_updated_at, reports_issued_count, cashflow",
          )
          .eq("id", clientId)
          .maybeSingle();

        if (error) {
          // Check if error is due to missing column
          if (error.message?.includes("reports_issued_count") || error.code === "42703") {
            // Retry without the missing column
            const { data: data2, error: error2 } = await supabase
              .from("clients")
              .select(
                "id, name, business_type, operating_profile, cash_runway_weeks, last_forecast_at, open_queries_count, financials, financials_updated_at, cashflow",
              )
              .eq("id", clientId)
              .maybeSingle();
            if (error2) {
              toast.error(error2.message);
            } else {
              setClient((data2 as Client | null) ?? null);
              const fin = (data2 as Client | null)?.financials ?? {};
              const { scalars, debtSchedule: ds } = splitFinancialsBlob(
                fin as Record<string, unknown>,
              );
              setFinancials(scalars);
              setDebtSchedule(ds);
            }
          } else {
            toast.error(error.message);
          }
        } else {
          setClient((data as Client | null) ?? null);
          const fin = (data as Client | null)?.financials ?? {};
          const { scalars, debtSchedule: ds } = splitFinancialsBlob(
            fin as Record<string, unknown>,
          );
          setFinancials(scalars);
          setDebtSchedule(ds);
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
  }, [clientId, activeTab]);

  useEffect(() => {
    if (!clientId) return;
    fetchReviewSignoffs({ data: { clientId } })
      .then(({ signoffs }) => {
        setFinancialsSignoff(signoffs.find((s) => s.scope === "financials") ?? null);
        setCashForecastSignoff(signoffs.find((s) => s.scope === "cash_forecast") ?? null);
        setBudgetSignoff(signoffs.find((s) => s.scope === "budget") ?? null);
      })
      .catch(() => {
        // Sign-off state is a trust-signal enhancement, never block the page.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, activeTab, cashForecastReloadToken]);

  useEffect(() => {
    if (!clientId) return;
    supabase
      .from("clients")
      .select("budget_updated_at")
      .eq("id", clientId)
      .maybeSingle()
      .then(({ data }) => {
        setBudgetUpdatedAt(
          (data as { budget_updated_at?: string | null } | null)?.budget_updated_at ?? null,
        );
      });
  }, [clientId, activeTab]);

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

  const handleFinancialChange = useCallback(
    (key: string, value: string) => {
      setFinancials((prev) => ({ ...prev, [key]: value }));
      setAutosaveStatus("saving");
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(async () => {
        const updatedScalars = { ...financials, [key]: value };
        const updated = mergeFinancialsBlob(updatedScalars, debtSchedule);
        const updatedAt = new Date().toISOString();
        const { error } = await supabase
          .from("clients")
          .update({ financials: updated as never, financials_updated_at: updatedAt })
          .eq("id", clientId);
        if (error) {
          toast.error(`Autosave failed: ${error.message}`);
          setAutosaveStatus("idle");
        } else {
          setClient((c) => (c ? { ...c, financials_updated_at: updatedAt } : c));
          setAutosaveStatus("saved");
          setTimeout(() => setAutosaveStatus("idle"), 2000);
        }
      }, 600);
    },
    [financials, debtSchedule, clientId],
  );

  const handleDebtScheduleChange = useCallback(
    (next: DebtSchedule) => {
      setDebtSchedule(next);
      setAutosaveStatus("saving");
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      autosaveTimer.current = setTimeout(async () => {
        const updated = mergeFinancialsBlob(financials, next);
        const updatedAt = new Date().toISOString();
        const { error } = await supabase
          .from("clients")
          .update({ financials: updated as never, financials_updated_at: updatedAt })
          .eq("id", clientId);
        if (error) {
          toast.error(`Debt schedule save failed: ${error.message}`);
          setAutosaveStatus("idle");
        } else {
          setClient((c) => (c ? { ...c, financials_updated_at: updatedAt } : c));
          setAutosaveStatus("saved");
          setTimeout(() => setAutosaveStatus("idle"), 2000);
        }
      }, 600);
    },
    [financials, clientId],
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
          financials: mergeFinancialsBlob(financials, debtSchedule) as never,
          ratios: ratiosOut as never,
        })
        .eq("id", existing.id);
      saveError = error;
    } else {
      const { error } = await supabase.from("client_financial_snapshots").insert({
        client_id: clientId,
        period_label: periodLabel,
        period_date: periodDate,
        financials: mergeFinancialsBlob(financials, debtSchedule) as never,
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
      const blob = mergeFinancialsBlob(financials, debtSchedule);
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
      await recordScoreHistory(
        clientId,
        scoreFromRatioInputs(ratioInputs, effectiveRunway),
      );
    }
  }, [clientId, financials, debtSchedule, ratioInputs, effectiveRunway]);

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
      await supabase
        .from("clients")
        .update({ financials: inputs as never, financials_updated_at: financialsUpdatedAt })
        .eq("id", clientId);

      await recordScoreHistory(clientId, scoreFromRatioInputs(inputs, effectiveRunway));

      // Update local state with new financials
      setFinancials(
        Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v != null ? String(v) : ""])),
      );
      setClient((c) => (c ? { ...c, financials_updated_at: financialsUpdatedAt } : c));
      toast.success(`Financials saved for ${periodLabel}`);
      setUploadOpen(false);
    },
    [clientId, effectiveRunway],
  );

  // ── Deliverables bar actions ──────────────────────────────────────────────

  const handleGenerateReport = useCallback(() => {
    if (!client) return;
    navigate({
      to: "/reports",
      search: { client: client.name, clientId: client.id, report: undefined },
    });
  }, [client, navigate]);

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
          const score = Math.round(scoreRatio(name, val as number));
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
      const blob = await pdf(
        HealthScorecardPDF({
          smeData,
          ratioResults: ratioEntries,
          accountantProfile: profile,
          cashRunwayWeeks: client.cash_runway_weeks,
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
        await recordDelivery({
          clientId: client.id,
          channel: "pdf_download",
          kind: "report_pdf",
          reportKey: "scorecard",
          snapshotId: snapId,
          figuresHash: hashFigures({ financials, ratios, debtSchedule }),
          periodLabel: periodLabel,
          createdBy: user.id,
        });
        setDeliveryRefresh((n) => n + 1);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed");
    }
  }, [client, ratios, profile, user, financials, debtSchedule]);

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
    if (user) {
      const snapId = await latestSnapshotId(client.id);
      await recordDelivery({
        clientId: client.id,
        channel: "mailto",
        kind: "health_summary",
        subject: subjectText,
        body: bodyText,
        snapshotId: snapId,
        figuresHash: hashFigures({ financials, ratios, score }),
        periodLabel: new Date().toLocaleString("en-US", { month: "short", year: "numeric" }),
        createdBy: user.id,
      });
      setDeliveryRefresh((n) => n + 1);
    }
    window.open(
      `mailto:?subject=${encodeURIComponent(subjectText)}&body=${encodeURIComponent(bodyText)}`,
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
    if (user) {
      const snapId = await latestSnapshotId(client.id);
      await recordDelivery({
        clientId: client.id,
        channel: "whatsapp",
        kind: "health_summary",
        body: text,
        snapshotId: snapId,
        figuresHash: hashFigures({ financials, ratios, score }),
        periodLabel: new Date().toLocaleString("en-US", { month: "short", year: "numeric" }),
        createdBy: user.id,
      });
      setDeliveryRefresh((n) => n + 1);
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
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
  ]);

  // ── Playbook drawer ───────────────────────────────────────────────────────

  const openDrawer = useCallback((ratioName: string, score: number) => {
    const tier = scoreTier(score);
    const key = ratioName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    setDrawerRatioKey(key);
    setDrawerRatioName(ratioName);
    setDrawerTier(tier);
    setDrawerOpen(true);
  }, []);

  // ── Report navigation ─────────────────────────────────────────────────────

  const navigateToReport = useCallback(
    (reportKey?: string) => {
      if (!client) return;
      navigate({
        to: "/reports",
        search: {
          client: client.name,
          clientId: client.id,
          report: reportKey,
        },
      });
    },
    [client, navigate],
  );

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
    <div className="accountant-portal">
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
          {profile.firmName && (
            <span className="firm-chip">
              Practice · <b>{profile.firmName}</b>
            </span>
          )}
          <span className="spacer" />
          <ThemeToggle />
          <button className="tb-btn gold" onClick={handleGenerateReport}>
            <svg viewBox="0 0 24 24">
              <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
              <path d="M14 3v6h6" />
            </svg>
            Reports studio
          </button>
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
                  ? new Date(client.last_forecast_at).toLocaleDateString("en-ZA", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </b>
              <span>Last forecast</span>
            </div>
            <div>
              <b>{openQueriesCount}</b>
              <span>Open queries</span>
            </div>
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
          onOpenMovement={() =>
            navigate({
              to: "/reports",
              search: { client: client.name, clientId: client.id, report: "movement" } as never,
            })
          }
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
              { id: "ratios", label: "Health & Ratios" },
              { id: "profit", label: "Profitability" },
              { id: "cash", label: "13-Week Cash Forecast", star: true },
              { id: "budget", label: "Budget" },
              { id: "reports", label: "Reports", star: true },
              { id: "plan", label: "Action Plan", star: true },
              { id: "tasks", label: "Staff tasks" },
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

        {/* ===== RATIOS TAB ===== */}
        <div className={`tabpane${activeTab === "ratios" ? " on" : ""}`} id="pane-ratios">
          {/* Simplified / Complex toggle */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                borderRadius: 999,
                background: "rgba(255,255,255,0.05)",
                padding: 3,
              }}
            >
              {(["simplified", "complex"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setViewMode(m)}
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
                  overallHealth={isFinite(avgHealth) ? avgHealth : 0}
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

          {/* Ask AI — question widget scoped to this client */}
          <div className="card" style={{ marginBottom: 20, padding: "6px 8px" }}>
            <div id="ask-ai-accountant" />
          </div>

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
              onChange={setFinancialsSignoff}
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
                  const score = Math.round(ratioHealthScore(name, val as number));
                  const tier = scoreTier(score);
                  const band = tierToBand(tier);
                  const color = bandColor(band);
                  const formattedVal = formatRatioValue(name, val as number);
                  const cat =
                    name.includes("Margin") || name.includes("Income") || name.includes("Return")
                      ? "Profitability"
                      : name.includes("Days") || name.includes("Capital") || name.includes("OCF")
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
            How revenue converts to profit — step by step. Enter figures below or upload a statement
            PDF.
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
                Edit P&amp;L figures or upload a PDF — the waterfall updates live
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
                  <p style={{ margin: 0, fontSize: 12, color: "var(--ink-dim)", maxWidth: 420 }}>
                    Same period figures as Health &amp; Ratios. Upload an income statement PDF to
                    extract and review values.
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
          <div className="dark" style={{ colorScheme: "dark" }}>
            <ProfitabilityWaterfall fallback={waterfallFallback} clientName={client?.name} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <ReviewSignoffButton
              clientId={clientId}
              clientName={client?.name}
              scope="financials"
              signoff={financialsSignoff}
              isStale={computeIsStale(financialsSignoff, client?.financials_updated_at ?? null)}
              onChange={setFinancialsSignoff}
            />
          </div>
        </div>

        {/* ===== CASH TAB ===== */}
        <div className={`tabpane${activeTab === "cash" ? " on" : ""}`} id="pane-cash">
          <div className="card cf-wrap">
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
              onBankPublish={(payload) => {
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
          <span className="eyebrow">Living FY budget</span>
          <div className="h-sec">Driver-based monthly budget</div>
          <p className="sub" style={{ marginBottom: 24 }}>
            Volume × price first, then cash timing. Advanced pressure-testing is available after
            setup.
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
                parseOperatingProfile(client.operating_profile)?.fyStartMonth ?? 3
              }
              onRetakeProfile={() => setProfileOpen(true)}
              onPushedToCash={() => {
                setCashForecastReloadToken((n) => n + 1);
                setActiveTab("cash");
              }}
            />
          </div>
        </div>

        {/* ===== REPORTS TAB ===== */}
        <div className={`tabpane${activeTab === "reports" ? " on" : ""}`} id="pane-reports">
          <span className="eyebrow">White-label reports — this client</span>
          <div className="h-sec">Choose a deliverable</div>
          <p className="sub">
            Each report is generated from live figures and branded to your practice. Sign off
            financials, cash forecast, and budget so deliverables carry your endorsement.
          </p>
          <div
            className="card"
            style={{
              marginBottom: 20,
              padding: "16px 20px",
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <div style={{ flex: "1 1 220px" }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--ink-dim)",
                  marginBottom: 4,
                }}
              >
                Report sign-offs
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "var(--ink-dim)" }}>
                Logs your initials, name, date and time from your account. Stamped on generated PDFs
                until data changes.
              </p>
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}
            >
              <ReviewSignoffButton
                clientId={clientId}
                clientName={client?.name}
                scope="financials"
                signoff={financialsSignoff}
                isStale={computeIsStale(financialsSignoff, client?.financials_updated_at ?? null)}
                onChange={setFinancialsSignoff}
              />
              <ReviewSignoffButton
                clientId={clientId}
                clientName={client?.name}
                scope="cash_forecast"
                signoff={cashForecastSignoff}
                isStale={computeIsStale(cashForecastSignoff, client?.last_forecast_at ?? null)}
                onChange={setCashForecastSignoff}
              />
              <ReviewSignoffButton
                clientId={clientId}
                clientName={client?.name}
                scope="budget"
                signoff={budgetSignoff}
                isStale={computeIsStale(budgetSignoff, budgetUpdatedAt)}
                onChange={setBudgetSignoff}
              />
            </div>
          </div>
          <div className="rep-grid">
            {REPORT_TEMPLATES.map((r) => (
              <div key={r.key} className="rep-card">
                <span className="ic">
                  <svg viewBox="0 0 24 24">
                    <path d={r.iconPath} />
                  </svg>
                </span>
                <b>{r.name}</b>
                <p>{r.desc}</p>
                <div className="acts">
                  <button className="btn ghost mini" onClick={() => navigateToReport(r.key)}>
                    Preview
                  </button>
                  <button className="btn gold mini" onClick={() => navigateToReport(r.key)}>
                    Generate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ===== ACTION PLAN TAB ===== */}
        <div className={`tabpane${activeTab === "plan" ? " on" : ""}`} id="pane-plan">
          <span className="eyebrow">Live action plan</span>
          <div className="h-sec">What we agreed they&apos;d do</div>
          <p className="sub" style={{ marginBottom: 24 }}>
            Same plan the owner sees under Next Moves / Action Plan — edit here without
            impersonating.
          </p>
          <div className="dark" style={{ colorScheme: "dark" }}>
            <Suspense fallback={<div style={{ padding: 24, color: "var(--ink-dim)" }}>Loading plan…</div>}>
              <ActionPlanPanel
                clientId={client.id}
                clientName={client.name}
                simplified={viewMode === "simplified"}
                isOwner
              />
            </Suspense>
          </div>
        </div>

        {/* ===== STAFF TASKS TAB ===== */}
        <div className={`tabpane${activeTab === "tasks" ? " on" : ""}`} id="pane-tasks">
          <TasksPanel clientId={client.id} clientName={client.name} />
        </div>

        {/* ===== ADVISORY TAB ===== */}
        <div className={`tabpane${activeTab === "advisory" ? " on" : ""}`} id="pane-advisory">
          <AdvisoryDrafter
            clientId={client.id}
            clientName={client.name}
            onLogged={() => setDeliveryRefresh((n) => n + 1)}
          />
          <AdvisorySentHistory clientId={client.id} refreshToken={deliveryRefresh} />
        </div>

        <div className="footer-note">
          MILŌN Practice Portal · <span className="serif gold-text">The passion to perform.</span>
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
            (user?.user_metadata as { full_name?: string; name?: string } | null)?.full_name
            ?? (user?.user_metadata as { full_name?: string; name?: string } | null)?.name
            ?? user?.email
            ?? "Accountant"
          }
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
              Gemini reads the PDF and extracts the income statement and balance sheet. Review every
              figure before confirming.
            </p>
            <UploadFinancials onConfirm={handleConfirmFinancials} />
          </div>
        </div>
      )}

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="[display:flex] h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden border border-slate-800 bg-slate-950 p-4 text-slate-50 sm:h-auto sm:max-h-[90vh] sm:p-6">
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
  );
}
