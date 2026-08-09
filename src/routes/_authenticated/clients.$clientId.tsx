import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { AdvisoryDrafter } from "@/components/advisory-drafter";
import { CashForecastPanel } from "@/components/cash-forecast";
import { CashFromBanksDrafter } from "@/components/cash-from-banks-drafter";
import type { ExistingCashflow } from "@/lib/cash-from-banks.publish";
import { TasksPanel } from "@/components/tasks-panel";
import { UploadFinancials } from "@/components/upload-financials";
import { PlaybookDrawer } from "@/components/playbook-drawer";
import type { ExtractionResult } from "@/lib/financialSchema";
import { computeRatios, scoreTier } from "@/lib/ratios";
import type { RatioInputs, HealthTier } from "@/lib/ratios";
import { scoreFromFlatFinancials, scoreFromRatioInputs } from "@/lib/health-score";
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
import { ReviewSignoffButton, ReviewSignoffBadge, computeIsStale } from "@/components/review-signoff";

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
    { onConflict: "client_id,period_date" }
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

// Score from ratio value (simple heuristic per-ratio)
function ratioHealthScore(name: string, val: number): number {
  if (!Number.isFinite(val)) return 50;
  // For margin-type ratios: scale 0-100 where 20% = 100
  if (name === "Net Margin") return Math.min(100, Math.max(0, (val / 0.15) * 100));
  if (name === "Operating Margin") return Math.min(100, Math.max(0, (val / 0.20) * 100));
  if (name === "Gross Margin") return Math.min(100, Math.max(0, (val / 0.40) * 100));
  if (name === "Return on Assets") return Math.min(100, Math.max(0, (val / 0.12) * 100));
  if (name === "Return on Equity") return Math.min(100, Math.max(0, (val / 0.20) * 100));
  if (name === "Asset Turnover") return Math.min(100, Math.max(0, (val / 1.5) * 100));
  // Days — lower is better, 90 days = 0 score
  if (name === "Debtor Days") return Math.min(100, Math.max(0, ((90 - val) / 90) * 100));
  if (name === "Inventory Days") return Math.min(100, Math.max(0, ((90 - val) / 90) * 100));
  if (name === "Creditor Days") return Math.min(100, Math.max(0, (val / 60) * 100));
  if (name === "Working Capital Days") return Math.min(100, Math.max(0, ((90 - val) / 90) * 100));
  if (name === "OCF / EBITDA") return Math.min(100, Math.max(0, val * 100));
  return 50;
}

/** Health ring SVG */
function HealthRing({
  score,
  size = 46,
  strokeWidth = 4,
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const band = tierToBand(scoreTier(score));
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
  cash_runway_weeks: number | null;
  last_forecast_at: string | null;
  open_queries_count: number;
  reports_issued_count?: number;
  financials?: Record<string, string | number | null> | null;
  financials_updated_at?: string | null;
  cashflow?: ExistingCashflow | null;
};

type ActiveTab = "ratios" | "profit" | "cash" | "reports" | "tasks" | "advisory";

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

// ── Report gallery definitions ──────────────────────────────────────────────
const REPORT_TEMPLATES = [
  {
    key: "scorecard",
    name: "Business Health Report",
    desc: "Full health score, four pillars, and the story of the numbers.",
    iconPath: "M9 17V9M13 17v-5M17 17v-8",
  },
  {
    key: "forecast",
    name: "Cash Runway Report",
    desc: "13-week forecast, dip analysis and reserve floor.",
    iconPath: "M3 17l6-6 4 4 8-8",
  },
  {
    key: "benchmark",
    name: "Ratio Benchmark Report",
    desc: "Every ratio vs sector median and top quartile.",
    iconPath: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  },
  {
    key: "intervention",
    name: "Action Plan Report",
    desc: "Ranked 10-step playbooks for at-risk ratios.",
    iconPath:
      "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  },
  {
    key: "waterfall",
    name: "Profitability Deep-dive",
    desc: "Margins, mix and pricing power in detail.",
    iconPath:
      "M12 8c-2 0-3 .9-3 2s1 1.6 3 2 3 1 3 2-1 2-3 2M12 6v2M12 16v2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  },
  {
    key: "cycle",
    name: "Working Capital Report",
    desc: "Debtors, creditors, stock and the cash cycle.",
    iconPath: "M21 12a9 9 0 1 1-6.2-8.6M21 3v6h-6",
  },
  {
    key: "leverage",
    name: "Debt & Financing Review",
    desc: "Facilities, cost of capital and leverage path.",
    iconPath: "M4 10h16M4 14h16M7 10V7a5 5 0 0 1 10 0v3",
  },
  {
    key: "movement",
    name: "Growth & Trends Report",
    desc: "Revenue trajectory and momentum indicators.",
    iconPath: "M23 6l-9.5 9.5-5-5L1 18M17 6h6v6",
  },
  {
    key: "assets",
    name: "Scenario Report",
    desc: "What-if models: hires, price moves, capex.",
    iconPath:
      "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  },
  {
    key: "labor",
    name: "Board Pack",
    desc: "Everything above, condensed for a board or bank.",
    iconPath:
      "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6",
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
  const [showCashFromBanks, setShowCashFromBanks] = useState(false);
  const [cashForecastReloadToken, setCashForecastReloadToken] = useState(0);

  // Financials state (flat key-value for the fin-grid)
  const [financials, setFinancials] = useState<Record<string, string>>({});

  // Accountant sign-off on this period's financials
  const fetchReviewSignoffs = useServerFn(listClientReviewSignoffs);
  const [financialsSignoff, setFinancialsSignoff] = useState<ClientReviewSignoff | null>(null);

  // Only accountants/firm admins may sign off — a client owner/member who lands on this
  // route (RLS allows them to read their own client) must see a read-only view, since the
  // server rejects their sign-off attempts anyway. Determine the viewer's own role once.
  const [viewerCanSign, setViewerCanSign] = useState(false);
  useEffect(() => {
    if (!user) return;
    supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle()
      .then(({ data }) => {
        setViewerCanSign(data?.role === "accountant" || data?.role === "firm_admin");
      });
  }, [user]);

  // Playbook drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRatioKey, setDrawerRatioKey] = useState<string | null>(null);
  const [drawerRatioName, setDrawerRatioName] = useState<string>("");
  const [drawerTier, setDrawerTier] = useState<HealthTier>("at_risk");

  // Upload financials modal
  const [uploadOpen, setUploadOpen] = useState(false);

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
  const healthScore =
    scoreFromFlatFinancials(financials, client?.cash_runway_weeks) ?? 0;
  const healthScoreRounded = Math.round(healthScore);

  // ── Health orb & pillar computation ────────────────────────────────────
  const healthMap: Record<string, number> = {};
  Object.entries(ratios).forEach(([name, val]) => {
    const key = RATIO_NAME_TO_KEY[name];
    if (key) healthMap[key] = Math.round(ratioHealthScore(name, val as number));
  });

  const avgPillar = (keys: string[]) => {
    const scores = keys.map((k) => healthMap[k]).filter((h) => h != null && isFinite(h));
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : NaN;
  };

  const pillarHealths = {
    profit: avgPillar(["grossMargin", "operatingMargin", "netMargin", "fixedCostRatio"]),
    assets: avgPillar(["assetTurnover", "roa", "inventoryDays", "salesPerEmployee"]),
    financing: avgPillar(["equityMultiplier", "interestBurden", "taxBurden", "roe"]),
    cash: avgPillar(["debtorDays", "creditorDays", "workingCapitalDays", "ocfToEbitda"]),
  };

  const avgHealth = (() => {
    const p = Object.values(pillarHealths).filter((h) => isFinite(h));
    return p.length ? p.reduce((a, b) => a + b, 0) / p.length : NaN;
  })();

  const spherePillars = buildSpherePillars({
    overallHealth: avgHealth,
    pillarHealths,
    healthMap,
    ratioMeta: SPHERE_RATIO_META,
  });

  const simplifiedSections = [
    { id: "profit", label: "Profitability", health: pillarHealths.profit, series: [] as number[] },
    { id: "assets", label: "Asset Efficiency", health: pillarHealths.assets, series: [] as number[] },
    { id: "financing", label: "Financing", health: pillarHealths.financing, series: [] as number[] },
    { id: "cash", label: "Cash & Working Capital", health: pillarHealths.cash, series: [] as number[] },
  ];

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
    import("../../lib/ask-ai.js").then((mod: { mountAskAi?: (el: HTMLElement, opts: unknown) => void }) => {
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
    }).catch(() => {
      // Widget module unavailable — silent fail
    });
    return () => { cancelled = true; };
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
            "id, name, business_type, cash_runway_weeks, last_forecast_at, open_queries_count, financials, financials_updated_at, reports_issued_count, cashflow"
          )
          .eq("id", clientId)
          .maybeSingle();

        if (error) {
          // Check if error is due to missing column
          if (
            error.message?.includes("reports_issued_count") ||
            error.code === "42703"
          ) {
            // Retry without the missing column
            const { data: data2, error: error2 } = await supabase
              .from("clients")
              .select(
                "id, name, business_type, cash_runway_weeks, last_forecast_at, open_queries_count, financials, financials_updated_at, cashflow"
              )
              .eq("id", clientId)
              .maybeSingle();
            if (error2) {
              toast.error(error2.message);
            } else {
              setClient((data2 as Client | null) ?? null);
              const fin = (data2 as Client | null)?.financials ?? {};
              setFinancials(
                Object.fromEntries(
                  Object.entries(fin).map(([k, v]) => [k, v != null ? String(v) : ""])
                )
              );
            }
          } else {
            toast.error(error.message);
          }
        } else {
          setClient((data as Client | null) ?? null);
          const fin = (data as Client | null)?.financials ?? {};
          setFinancials(
            Object.fromEntries(
              Object.entries(fin).map(([k, v]) => [k, v != null ? String(v) : ""])
            )
          );
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    fetchReviewSignoffs({ data: { clientId } })
      .then(({ signoffs }) => {
        setFinancialsSignoff(signoffs.find((s) => s.scope === "financials") ?? null);
      })
      .catch(() => {
        // Sign-off state is a trust-signal enhancement, never block the page.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

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
        const updated = { ...financials, [key]: value };
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
    [financials, clientId]
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
        .update({ financials: financials as never, ratios: ratiosOut as never })
        .eq("id", existing.id);
      saveError = error;
    } else {
      const { error } = await supabase.from("client_financial_snapshots").insert({
        client_id: clientId,
        period_label: periodLabel,
        period_date: periodDate,
        financials: financials as never,
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
      const { error: touchError } = await supabase
        .from("clients")
        .update({ financials: financials as never, financials_updated_at: financialsUpdatedAt })
        .eq("id", clientId);
      if (touchError) {
        toast.error(`Snapshot saved, but failed to mark financials updated: ${touchError.message}`);
      } else {
        setClient((c) => (c ? { ...c, financials_updated_at: financialsUpdatedAt } : c));
      }
      toast.success(`Snapshot saved for ${periodLabel}`);
      await recordScoreHistory(
        clientId,
        scoreFromRatioInputs(ratioInputs, client?.cash_runway_weeks)
      );
    }
  }, [clientId, financials, ratioInputs, client?.cash_runway_weeks]);

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

      await recordScoreHistory(
        clientId,
        scoreFromRatioInputs(inputs, client?.cash_runway_weeks)
      );

      // Update local state with new financials
      setFinancials(
        Object.fromEntries(
          Object.entries(inputs).map(([k, v]) => [k, v != null ? String(v) : ""])
        )
      );
      setClient((c) => (c ? { ...c, financials_updated_at: financialsUpdatedAt } : c));
      toast.success(`Financials saved for ${periodLabel}`);
      setUploadOpen(false);
    },
    [clientId, client?.cash_runway_weeks]
  );

  // ── Deliverables bar actions ──────────────────────────────────────────────

  const handleGenerateReport = useCallback(() => {
    if (!client) return;
    navigate({
      to: "/reports",
      search: { client: client.name, clientId: client.id } as never,
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
      // Build ratio results from computed ratios
      const ratioEntries = Object.entries(ratios).map(([name, val]) => {
        const score = Math.round(ratioHealthScore(name, val as number));
        const tier = scoreTier(score);
        // Map ratio names to pillars (RatioResult only allows these 4)
        const pillar: "profit" | "assets" | "financing" | "cash" =
          name.includes("Margin") || name.includes("Income") || name.includes("Leverage")
            ? "profit"
            : name.includes("Days") || name.includes("Capital") || name.includes("OCF")
            ? "cash"
            : name.includes("Equity") || name.includes("Multiplier") || name.includes("Burden")
            ? "financing"
            : "assets";
        return {
          ratio_key: name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
          ratio_name: name,
          pillar,
          current_value: Number.isFinite(val as number) ? (val as number) : 0,
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
        }) as Parameters<typeof pdf>[0]
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF export failed");
    }
  }, [client, ratios, profile]);

  const handleEmailDraft = useCallback(() => {
    if (!client) return;
    const score = healthScoreRounded;
    const tier = scoreTier(score);
    const tierLabel = tier === "healthy" ? "Healthy" : tier === "at_risk" ? "At Risk" : "Critical";
    const runway = client.cash_runway_weeks != null ? `${client.cash_runway_weeks} weeks` : "—";
    const subject = encodeURIComponent(`${client.name} — Financial Health Update`);
    const body = encodeURIComponent(
      `Hi,\n\nHere is a brief financial health summary for ${client.name}.\n\n` +
        `Overall Health Score: ${score}/100 (${tierLabel})\n` +
        `Cash Runway: ${runway}\n` +
        `Open Queries: ${client.open_queries_count}\n\n` +
        `Please review the attached report for detailed ratio analysis and recommended actions.\n\n` +
        `Best regards,\n${profile.accountantName || "Your Accountant"}\n${profile.firmName || ""}`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`);
  }, [client, healthScoreRounded, profile]);

  const handleWhatsApp = useCallback(() => {
    if (!client) return;
    const score = healthScoreRounded;
    const tier = scoreTier(score);
    const tierLabel = tier === "healthy" ? "Healthy" : tier === "at_risk" ? "At Risk" : "Critical";
    const text = encodeURIComponent(
      `${client.name} Financial Health Update\n` +
        `Health Score: ${score}/100 (${tierLabel})\n` +
        `Cash Runway: ${client.cash_runway_weeks != null ? `${client.cash_runway_weeks} wk` : "—"}\n` +
        `Prepared by ${profile.firmName || "your accountant"} via MILŌN Portal.`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  }, [client, healthScoreRounded, profile]);

  // ── Playbook drawer ───────────────────────────────────────────────────────

  const openDrawer = useCallback(
    (ratioName: string, score: number) => {
      const tier = scoreTier(score);
      const key = ratioName.toLowerCase().replace(/[^a-z0-9]/g, "_");
      setDrawerRatioKey(key);
      setDrawerRatioName(ratioName);
      setDrawerTier(tier);
      setDrawerOpen(true);
    },
    []
  );

  // ── Report navigation ─────────────────────────────────────────────────────

  const navigateToReport = useCallback(() => {
    if (!client) return;
    navigate({
      to: "/reports",
      search: { client: client.name, clientId: client.id } as never,
    });
  }, [client, navigate]);

  // ── Loading / error states ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="accountant-portal" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
        <span style={{ color: "var(--ink-dim)" }}>Loading…</span>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="accountant-portal" style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
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
            Acting as client:{" "}
            <b style={{ color: "var(--ink)" }}>{client.name}</b>
          </span>
          <span className="aud">Audited</span>
        </div>

        {/* ===== CLIENT HEADER ===== */}
        <div className="card client-head">
          <div className="idb">
            <div className="ring big-ring">
              <HealthRing score={healthScoreRounded} size={74} strokeWidth={5} />
            </div>
            <div>
              <h1>{client.name}</h1>
              <span className="ctype">{client.business_type ?? "—"}</span>
            </div>
          </div>
          <div className="meta">
            <div>
              <b>
                {client.cash_runway_weeks != null
                  ? `${client.cash_runway_weeks} wk`
                  : "—"}
              </b>
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
              <b>{client.open_queries_count}</b>
              <span>Open queries</span>
            </div>
            <div>
              <b>{reportsIssued}</b>
              <span>Reports issued</span>
            </div>
          </div>
        </div>

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
              { id: "reports", label: "Reports", star: true },
              { id: "tasks", label: "Tasks" },
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
            <div style={{ display: "flex", alignItems: "center", gap: 2, borderRadius: 999, background: "rgba(255,255,255,0.05)", padding: 3 }}>
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
              <div style={{ background: "#0a0e1a", borderRadius: 20, padding: "16px 8px", marginBottom: 20 }}>
                <SphereHero
                  overallHealth={isFinite(avgHealth) ? avgHealth : 0}
                  pillars={spherePillars}
                  topPriority={(() => {
                    const worst = Object.entries(pillarHealths)
                      .filter(([, h]) => isFinite(h))
                      .sort(([, a], [, b]) => a - b)[0];
                    if (!worst) return { title: "Upload financial data", description: "Add figures to see a health score and your highest-impact first move." };
                    const labels: Record<string, string> = { profit: "Profitability", assets: "Asset Efficiency", financing: "Financing", cash: "Cash & Working Capital" };
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
                  <button
                    className="btn ghost mini"
                    onClick={handleSaveSnapshot}
                  >
                    Save snapshot
                  </button>
                  <button
                    className="btn ghost mini"
                    onClick={() => setUploadOpen(true)}
                  >
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
                        onChange={(e) =>
                          handleFinancialChange(key, e.target.value)
                        }
                        onBlur={(e) =>
                          handleFinancialChange(key, e.target.value)
                        }
                        placeholder="—"
                        type="number"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Accountant sign-off on this period's financials — accountants/firm admins only;
              a client owner/member who somehow lands on this route sees the read-only badge. */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
            {viewerCanSign ? (
              <ReviewSignoffButton
                clientId={clientId}
                clientName={client?.name}
                scope="financials"
                signoff={financialsSignoff}
                isStale={computeIsStale(financialsSignoff, client?.financials_updated_at ?? null)}
                onChange={setFinancialsSignoff}
              />
            ) : (
              <ReviewSignoffBadge
                signoff={financialsSignoff}
                scope="financials"
                isStale={computeIsStale(financialsSignoff, client?.financials_updated_at ?? null)}
              />
            )}
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
                    : name.includes("Equity") || name.includes("Debt") || name.includes("Asset") || name.includes("Burden")
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
            How revenue converts to profit — step by step. Enter figures below or upload a statement PDF.
          </p>

          <div className={`card collapse${profitFinOpen ? " open" : ""}`} id="profitFinCollapse" style={{ marginBottom: 20 }}>
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
                    Same period figures as Health &amp; Ratios. Upload an income statement PDF to extract and review values.
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
            <ProfitabilityWaterfall
              fallback={waterfallFallback}
              clientName={client?.name}
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
              {viewerCanSign && (
                <button
                  type="button"
                  className="btn ghost mini"
                  onClick={() => setShowCashFromBanks(true)}
                >
                  Classify from bank statements
                </button>
              )}
            </div>
            <CashForecastPanel
              clientId={client.id}
              clientName={client.name}
              canSign={viewerCanSign}
              reloadToken={cashForecastReloadToken}
            />
          </div>
          <CashFromBanksDrafter
            open={showCashFromBanks}
            onClose={() => setShowCashFromBanks(false)}
            existingCashflow={client.cashflow ?? null}
            onSaveDraft={async (draft) => {
              await supabase
                .from("clients")
                .update({ cashflow_bank_draft: draft as never })
                .eq("id", client.id)
                .then(({ error }) => {
                  if (error && !/cashflow_bank_draft|42703/.test(error.message ?? "")) {
                    console.warn("cashflow_bank_draft save:", error.message);
                  }
                });
            }}
            onPublish={async (payload) => {
              const forecastUpdatedAt = new Date().toISOString();
              const { error } = await supabase
                .from("clients")
                .update({
                  cashflow: payload as never,
                  cashflow_bank_draft: payload as never,
                  last_forecast_at: forecastUpdatedAt,
                })
                .eq("id", client.id);
              if (error) {
                const retry = await supabase
                  .from("clients")
                  .update({
                    cashflow: payload as never,
                    last_forecast_at: forecastUpdatedAt,
                  })
                  .eq("id", client.id);
                if (retry.error) throw new Error(retry.error.message);
              }
              setClient((c) => (c ? { ...c, cashflow: payload, last_forecast_at: forecastUpdatedAt } : c));
              setShowCashFromBanks(false);
              setCashForecastReloadToken((n) => n + 1);
              toast.success("Cash forecast published from bank classification.");
            }}
          />
        </div>

        {/* ===== REPORTS TAB ===== */}
        <div className={`tabpane${activeTab === "reports" ? " on" : ""}`} id="pane-reports">
          <span className="eyebrow">White-label reports — this client</span>
          <div className="h-sec">Choose a deliverable</div>
          <p className="sub">
            Each report is generated from live figures and branded to your practice.
          </p>
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
                  <button
                    className="btn ghost mini"
                    onClick={navigateToReport}
                  >
                    Preview
                  </button>
                  <button
                    className="btn gold mini"
                    onClick={navigateToReport}
                  >
                    Generate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ===== TASKS TAB ===== */}
        <div className={`tabpane${activeTab === "tasks" ? " on" : ""}`} id="pane-tasks">
          <TasksPanel
            clientId={client.id}
            clientName={client.name}
          />
        </div>

        {/* ===== ADVISORY TAB ===== */}
        <div className={`tabpane${activeTab === "advisory" ? " on" : ""}`} id="pane-advisory">
          <AdvisoryDrafter clientId={client.id} clientName={client.name} />
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

      {/* ===== UPLOAD FINANCIALS MODAL ===== */}
      {uploadOpen && (
        <div
          className="veil open"
          onClick={() => setUploadOpen(false)}
          role="presentation"
        >
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
              <h3 style={{ fontSize: 20, fontWeight: 700 }}>
                Upload financial statement
              </h3>
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
              Gemini reads the PDF and extracts the income statement and balance
              sheet. Review every figure before confirming.
            </p>
            <UploadFinancials onConfirm={handleConfirmFinancials} />
          </div>
        </div>
      )}
    </div>
  );
}
