import { useState, useMemo, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  Download,
  SlidersHorizontal,
  Upload,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Table2,
  Settings2,
  Wallet,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { listClientReviewSignoffs } from "@/lib/review-signoffs.functions";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import { ReviewSignoffBadge, ReviewSignoffButton, computeIsStale } from "@/components/review-signoff";
import { CashFromBanksDrafter } from "@/components/cash-from-banks-drafter";
import type { CashForecastPublishPayload } from "@/lib/cash-from-banks.types";
import {
  CASH_RUNWAY_THRESHOLD_RAND,
  runwayWeeksFromCashflow,
  runwayWeeksFromClosings,
} from "@/lib/cash-runway";
import { hashFigures, latestSnapshotId, recordDelivery } from "@/lib/advisory-deliveries";
// @react-pdf/renderer + the branded report are dynamically imported inside
// exportPDF to avoid blocking initial hydration.

type Frequency =
  | "recurring-weekly"
  | "recurring-monthly"
  | "once-off"
  | "split-weeks"
  | "split-months";

type LineItem = {
  id: string;
  name: string;
  amount: string;
  frequency: Frequency;
  startWeek: number;
  splitCount: number;
};

const WEEKS = 13;

const FREQ_LABEL: Record<Frequency, string> = {
  "recurring-weekly": "Recurring (weekly)",
  "recurring-monthly": "Recurring (monthly)",
  "once-off": "Once-off",
  "split-weeks": "Split over N weeks",
  "split-months": "Split over N months",
};

const newId = () => Math.random().toString(36).slice(2, 9);

const makeLine = (name: string): LineItem => ({
  id: newId(),
  name,
  amount: "",
  frequency: "recurring-monthly",
  startWeek: 1,
  splitCount: 3,
});

const DEFAULT_REVENUE: LineItem[] = [
  { ...makeLine("Recurring sales"), frequency: "recurring-monthly" },
  { ...makeLine("Once-off sales"), frequency: "once-off" },
  { ...makeLine("Project / milestone revenue"), frequency: "split-months" },
];

const EXPENSE_PRESETS = [
  "Cost of sales (COS)",
  "Interest",
  "Loan capital repayment",
  "Rent",
  "Salaries & wages",
];

const DEFAULT_EXPENSES: LineItem[] = EXPENSE_PRESETS.map((n) => makeLine(n));
const DEFAULT_OTHER: LineItem[] = [makeLine("Other expenses")];

function distribute(line: LineItem): number[] {
  const out = new Array(WEEKS).fill(0);
  const amt = parseFloat(line.amount) || 0;
  if (amt === 0) return out;
  const start = Math.max(1, Math.min(WEEKS, line.startWeek)) - 1;
  switch (line.frequency) {
    case "recurring-weekly":
      for (let i = start; i < WEEKS; i++) out[i] = amt;
      break;
    case "recurring-monthly":
      for (let i = start; i < WEEKS; i += 4) out[i] = amt;
      break;
    case "once-off":
      out[start] = amt;
      break;
    case "split-weeks": {
      const n = Math.max(1, line.splitCount);
      const per = amt / n;
      for (let i = start; i < Math.min(WEEKS, start + n); i++) out[i] = per;
      break;
    }
    case "split-months": {
      const n = Math.max(1, line.splitCount);
      const per = amt / n;
      for (let i = 0; i < n; i++) {
        const w = start + i * 4;
        if (w < WEEKS) out[w] = per;
      }
      break;
    }
  }
  return out;
}

function fmtR(n: number) {
  return `R ${n.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

function fmtCompact(n: number) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R\u00a0${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`;
  if (abs >= 1_000) return `${sign}R\u00a0${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  return `${sign}R\u00a0${Math.round(abs).toLocaleString("en-ZA")}`;
}

// ── Brand palette (matches profitability waterfall / accountant reports) ─────
const GOLD = "#d4a550";
const GOLD_DARK = "#b8860b";
const RED = "#e05c5c";

// ── Shared card shell — light + dark, gold top rule ─────────────────────────
const CARD_SHELL =
  "relative overflow-hidden border border-amber-900/15 bg-[radial-gradient(circle_at_90%_0%,rgba(212,165,80,0.13),transparent_34%),linear-gradient(135deg,#fffdf8,#f8f5ed)] shadow-[0_20px_60px_rgba(109,79,22,0.10)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_90%_0%,rgba(212,165,80,0.12),transparent_34%),linear-gradient(135deg,#111827,#0b1220)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.25)]";
const GOLD_RULE =
  "pointer-events-none absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-[#b7872a] via-[#f1d28b] to-transparent";
const INPUT_CLS =
  "border-amber-900/15 bg-white/70 text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100";
const LABEL_CLS =
  "text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400";

// ── Collapsible section card ─────────────────────────────────────────────────
function SectionCard({
  id,
  icon: Icon,
  title,
  subtitle,
  defaultOpen = false,
  headerRight,
  children,
}: {
  id?: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card id={id} className={CARD_SHELL}>
      <div className={GOLD_RULE} />
      <CardHeader className="border-b border-amber-900/10 pb-4 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="flex flex-1 items-center gap-3 text-left"
            onClick={() => setOpen((o) => !o)}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#d4a550]/15 text-[#b8860b] dark:text-[#d4a550]">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <CardTitle className="text-base font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                {title}
              </CardTitle>
              {subtitle && (
                <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">
                  {subtitle}
                </span>
              )}
            </span>
          </button>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              type="button"
              className="p-1 text-[#d4a550]"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? "Collapse" : "Expand"}
            >
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </CardHeader>
      {open && <CardContent className="pt-5">{children}</CardContent>}
    </Card>
  );
}

// ── KPI stat block ───────────────────────────────────────────────────────────
function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-amber-900/10 bg-white/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50">
      <div className={LABEL_CLS}>{label}</div>
      <div
        className={`mt-1 truncate text-xl font-extrabold tracking-tight ${
          tone === "good"
            ? "text-[#3f9c72] dark:text-[#5cc492]"
            : tone === "bad"
              ? "text-[#c0392b] dark:text-[#ef6b6b]"
              : "text-slate-950 dark:text-white"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}

function LineEditor({
  line,
  onChange,
  onRemove,
  tone,
}: {
  line: LineItem;
  onChange: (l: LineItem) => void;
  onRemove?: () => void;
  tone: "revenue" | "expense";
}) {
  const accent =
    tone === "revenue"
      ? "border-l-[3px] border-l-[#4caf82]"
      : "border-l-[3px] border-l-[#e05c5c]";
  const showSplit = line.frequency === "split-weeks" || line.frequency === "split-months";
  return (
    <div
      className={`grid gap-2 rounded-lg border border-amber-900/10 bg-white/60 p-3 dark:border-slate-800 dark:bg-slate-900/50 md:grid-cols-12 ${accent}`}
    >
      <div className="md:col-span-3">
        <Label className={LABEL_CLS}>Line item</Label>
        <Input
          value={line.name}
          onChange={(e) => onChange({ ...line, name: e.target.value })}
          className={INPUT_CLS}
        />
      </div>
      <div className="md:col-span-2">
        <Label className={LABEL_CLS}>Amount (R)</Label>
        <Input
          type="number"
          value={line.amount}
          onChange={(e) => onChange({ ...line, amount: e.target.value })}
          className={INPUT_CLS}
        />
      </div>
      <div className="md:col-span-3">
        <Label className={LABEL_CLS}>Frequency</Label>
        <Select
          value={line.frequency}
          onValueChange={(v) => onChange({ ...line, frequency: v as Frequency })}
        >
          <SelectTrigger className={INPUT_CLS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FREQ_LABEL) as Frequency[]).map((k) => (
              <SelectItem key={k} value={k}>
                {FREQ_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="md:col-span-2">
        <Label className={LABEL_CLS}>Start week</Label>
        <Input
          type="number"
          min={1}
          max={WEEKS}
          value={line.startWeek}
          onChange={(e) => onChange({ ...line, startWeek: parseInt(e.target.value) || 1 })}
          className={INPUT_CLS}
        />
      </div>
      <div className="md:col-span-2">
        {showSplit ? (
          <>
            <Label className={LABEL_CLS}>
              {line.frequency === "split-weeks" ? "# weeks" : "# months"}
            </Label>
            <Input
              type="number"
              min={1}
              value={line.splitCount}
              onChange={(e) => onChange({ ...line, splitCount: parseInt(e.target.value) || 1 })}
              className={INPUT_CLS}
            />
          </>
        ) : (
          <div />
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="mt-1 h-7 w-full text-[#c0392b] hover:bg-[#e05c5c]/10 hover:text-[#c0392b] dark:text-[#ef6b6b] dark:hover:text-[#ef6b6b]"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}

export function CashForecastPanel({
  clientId,
  clientName,
  simplified,
  canSign,
  reloadToken,
  openBankUploadToken,
  onBankPublish,
}: {
  clientId?: string;
  clientName?: string;
  simplified?: boolean;
  /** Accountant view only: show the interactive sign-off control instead of the read-only badge. */
  canSign?: boolean;
  /** Bump to re-load cashflow from Supabase (e.g. after bank→cash publish). */
  reloadToken?: number;
  /** Bump to open the bank-statement upload dialog (e.g. accountant Cash tab header). */
  openBankUploadToken?: number;
  /** Optional parent hook after a successful bank→cash publish (e.g. sync client cache). */
  onBankPublish?: (payload: CashForecastPublishPayload) => void;
} = {}) {
  const { profile } = useAccountantProfile();
  const { user } = useAuth();
  const fetchReviewSignoffs = useServerFn(listClientReviewSignoffs);
  const [exporting, setExporting] = useState(false);
  const [forecastSignoff, setForecastSignoff] = useState<ClientReviewSignoff | null>(null);
  const [lastForecastAt, setLastForecastAt] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [openingBalance, setOpeningBalance] = useState("0");
  const [revenue, setRevenue] = useState<LineItem[]>(DEFAULT_REVENUE);
  const [expenses, setExpenses] = useState<LineItem[]>(DEFAULT_EXPENSES);
  const [other, setOther] = useState<LineItem[]>(DEFAULT_OTHER);
  const [revAdj, setRevAdj] = useState(100); // %
  const [expAdj, setExpAdj] = useState(100); // %
  const [collectDelay, setCollectDelay] = useState(0); // weeks shift inflows right
  const [headcountDelta, setHeadcountDelta] = useState(0); // +/- people
  const [avgSalary, setAvgSalary] = useState("0"); // monthly per head
  const [fixedCostDelta, setFixedCostDelta] = useState("0"); // monthly +/- $
  const [revGrowthPct, setRevGrowthPct] = useState(0); // % per week, compounding
  const [capexAmount, setCapexAmount] = useState("0");
  const [capexWeek, setCapexWeek] = useState(1);
  const [loaded, setLoaded] = useState(!clientId);
  const [mounted, setMounted] = useState(false);
  const [showBankUpload, setShowBankUpload] = useState(false);
  // Guards against the autosave effect firing the instant hydration finishes —
  // otherwise merely opening the forecast bumps last_forecast_at and falsely
  // invalidates an accountant's sign-off with no real data change.
  const skipNextAutosave = useRef(false);

  useEffect(() => {
    if (openBankUploadToken == null || openBankUploadToken <= 0) return;
    setShowBankUpload(true);
  }, [openBankUploadToken]);

  const existingCashflowForBanks = {
    startDate,
    openingBalance,
    revenue,
    expenses,
    other,
    revAdj,
    expAdj,
    collectDelay,
    headcountDelta,
    avgSalary,
    fixedCostDelta,
    revGrowthPct,
    capexAmount,
    capexWeek,
  };

  const applyBankPublish = async (payload: CashForecastPublishPayload) => {
    // Persist explicitly below when clientId is set; skip the debounce autosave
    // that would otherwise fire from these state updates.
    skipNextAutosave.current = true;
    setStartDate(payload.startDate);
    setOpeningBalance(payload.openingBalance);
    setRevenue(payload.revenue as LineItem[]);
    setExpenses(payload.expenses as LineItem[]);
    setOther(payload.other as LineItem[]);
    setRevAdj(payload.revAdj);
    setExpAdj(payload.expAdj);
    setCollectDelay(payload.collectDelay);
    setHeadcountDelta(payload.headcountDelta);
    setAvgSalary(payload.avgSalary);
    setFixedCostDelta(payload.fixedCostDelta);
    setRevGrowthPct(payload.revGrowthPct);
    setCapexAmount(payload.capexAmount);
    setCapexWeek(payload.capexWeek);
    setShowBankUpload(false);
    toast.success("Cash forecast updated from bank statements.");

    if (!clientId) {
      onBankPublish?.(payload);
      return;
    }
    const forecastUpdatedAt = new Date().toISOString();
    const runway = runwayWeeksFromCashflow(payload);
    const { error } = await supabase
      .from("clients")
      .update({
        cashflow: payload as never,
        cashflow_bank_draft: payload as never,
        last_forecast_at: forecastUpdatedAt,
        ...(runway != null ? { cash_runway_weeks: runway } : {}),
      })
      .eq("id", clientId);
    if (error) {
      const retry = await supabase
        .from("clients")
        .update({
          cashflow: payload as never,
          last_forecast_at: forecastUpdatedAt,
          ...(runway != null ? { cash_runway_weeks: runway } : {}),
        })
        .eq("id", clientId);
      if (retry.error) {
        toast.error(`Cash forecast save failed: ${retry.error.message}`);
        return;
      }
    }
    setLastForecastAt(forecastUpdatedAt);
    onBankPublish?.(payload);
  };

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    fetchReviewSignoffs({ data: { clientId } })
      .then(({ signoffs }) => {
        setForecastSignoff(signoffs.find((s) => s.scope === "cash_forecast") ?? null);
      })
      .catch(() => {
        // Sign-off state is a trust-signal enhancement, never block the forecast itself.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    supabase.from("clients").select("cashflow, last_forecast_at").eq("id", clientId).maybeSingle()
      .then(({ data }) => {
        setLastForecastAt((data as { last_forecast_at?: string | null } | null)?.last_forecast_at ?? null);
        const cf = data?.cashflow as {
          startDate?: string; openingBalance?: string;
          revenue?: LineItem[]; expenses?: LineItem[]; other?: LineItem[];
          revAdj?: number; expAdj?: number; collectDelay?: number;
          headcountDelta?: number; avgSalary?: string; fixedCostDelta?: string;
          revGrowthPct?: number; capexAmount?: string; capexWeek?: number;
        } | null;
        if (cf) {
          if (cf.startDate) setStartDate(cf.startDate);
          if (cf.openingBalance != null) setOpeningBalance(cf.openingBalance);
          if (cf.revenue) setRevenue(cf.revenue);
          if (cf.expenses) setExpenses(cf.expenses);
          if (cf.other) setOther(cf.other);
          if (cf.revAdj != null) setRevAdj(cf.revAdj);
          if (cf.expAdj != null) setExpAdj(cf.expAdj);
          if (cf.collectDelay != null) setCollectDelay(cf.collectDelay);
          if (cf.headcountDelta != null) setHeadcountDelta(cf.headcountDelta);
          if (cf.avgSalary != null) setAvgSalary(cf.avgSalary);
          if (cf.fixedCostDelta != null) setFixedCostDelta(cf.fixedCostDelta);
          if (cf.revGrowthPct != null) setRevGrowthPct(cf.revGrowthPct);
          if (cf.capexAmount != null) setCapexAmount(cf.capexAmount);
          if (cf.capexWeek != null) setCapexWeek(cf.capexWeek);
        }
        skipNextAutosave.current = true;
        setLoaded(true);
      });
  }, [clientId, reloadToken]);

  useEffect(() => {
    if (!clientId || !loaded) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    const t = setTimeout(async () => {
      const payload = { startDate, openingBalance, revenue, expenses, other, revAdj, expAdj, collectDelay, headcountDelta, avgSalary, fixedCostDelta, revGrowthPct, capexAmount, capexWeek };
      const forecastUpdatedAt = new Date().toISOString();
      const runway = runwayWeeksFromCashflow(payload);
      const { error } = await supabase
        .from("clients")
        .update({
          cashflow: payload as never,
          last_forecast_at: forecastUpdatedAt,
          ...(runway != null ? { cash_runway_weeks: runway } : {}),
        })
        .eq("id", clientId);
      if (error) toast.error(`Cash forecast save failed: ${error.message}`);
      else setLastForecastAt(forecastUpdatedAt);
    }, 800);
    return () => clearTimeout(t);
  }, [clientId, loaded, startDate, openingBalance, revenue, expenses, other, revAdj, expAdj, collectDelay, headcountDelta, avgSalary, fixedCostDelta, revGrowthPct, capexAmount, capexWeek]);

  const weeks = useMemo(() => {
    const d = new Date(startDate);
    return Array.from({ length: WEEKS }, (_, i) => {
      const w = new Date(d);
      w.setDate(d.getDate() + i * 7);
      return w.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
    });
  }, [startDate]);

  const computeScenario = (opts: {
    rMul: number; eMul: number; shift: number;
    headcountDelta: number; avgSalary: number; fixedCostDelta: number;
    revGrowthPct: number; capexAmount: number; capexWeek: number;
  }) => {
    const shift = Math.max(0, Math.min(WEEKS - 1, Math.round(opts.shift)));
    const shiftVals = (vals: number[]) => {
      if (!shift) return vals;
      const out = new Array(WEEKS).fill(0);
      for (let i = 0; i < WEEKS; i++) {
        const j = i + shift;
        if (j < WEEKS) out[j] += vals[i];
      }
      return out;
    };
    const growthMul = (i: number) => Math.pow(1 + opts.revGrowthPct / 100, i);
    const revRows = revenue.map((l) => ({
      name: l.name,
      vals: shiftVals(distribute(l).map((v) => v * opts.rMul)).map((v, i) => v * growthMul(i)),
    }));
    const expRows = [...expenses, ...other].map((l) => ({
      name: l.name,
      vals: distribute(l).map((v) => v * opts.eMul),
    }));
    const headcountWeekly = (opts.headcountDelta * opts.avgSalary) / 4.33;
    const fixedWeekly = opts.fixedCostDelta / 4.33;
    const scenarioRows: { name: string; vals: number[] }[] = [];
    if (headcountWeekly !== 0) {
      scenarioRows.push({
        name: `Headcount Δ (${opts.headcountDelta > 0 ? "+" : ""}${opts.headcountDelta})`,
        vals: new Array(WEEKS).fill(headcountWeekly),
      });
    }
    if (fixedWeekly !== 0) {
      scenarioRows.push({ name: `Fixed cost Δ`, vals: new Array(WEEKS).fill(fixedWeekly) });
    }
    if (opts.capexAmount !== 0) {
      const w = Math.max(1, Math.min(WEEKS, opts.capexWeek)) - 1;
      const capvals = new Array(WEEKS).fill(0);
      capvals[w] = opts.capexAmount;
      scenarioRows.push({ name: `Capex (W${w + 1})`, vals: capvals });
    }
    const allExpRows = [...expRows, ...scenarioRows];
    const inflow = new Array(WEEKS).fill(0);
    const outflow = new Array(WEEKS).fill(0);
    revRows.forEach((r) => r.vals.forEach((v, i) => (inflow[i] += v)));
    allExpRows.forEach((r) => r.vals.forEach((v, i) => (outflow[i] += v)));
    const net = inflow.map((v, i) => v - outflow[i]);
    const opening = parseFloat(openingBalance) || 0;
    const closing: number[] = [];
    let bal = opening;
    for (let i = 0; i < WEEKS; i++) {
      bal += net[i];
      closing.push(bal);
    }
    return { revRows, expRows: allExpRows, inflow, outflow, net, closing, opening };
  };

  const calc = useMemo(() => computeScenario({
    rMul: revAdj / 100, eMul: expAdj / 100, shift: collectDelay,
    headcountDelta, avgSalary: parseFloat(avgSalary) || 0,
    fixedCostDelta: parseFloat(fixedCostDelta) || 0,
    revGrowthPct, capexAmount: parseFloat(capexAmount) || 0, capexWeek,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [revenue, expenses, other, openingBalance, revAdj, expAdj, collectDelay, headcountDelta, avgSalary, fixedCostDelta, revGrowthPct, capexAmount, capexWeek]);

  const baseCalc = useMemo(() => computeScenario({
    rMul: 1, eMul: 1, shift: 0,
    headcountDelta: 0, avgSalary: 0, fixedCostDelta: 0,
    revGrowthPct: 0, capexAmount: 0, capexWeek: 1,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [revenue, expenses, other, openingBalance]);

  const updateAt = (
    list: LineItem[],
    setList: (l: LineItem[]) => void,
    idx: number,
    next: LineItem,
  ) => {
    const c = [...list];
    c[idx] = next;
    setList(c);
  };

  const lowestBal = Math.min(...calc.closing);
  const lowestWeek = calc.closing.indexOf(lowestBal) + 1;
  const closingW13 = calc.closing[WEEKS - 1];
  const trajectory = closingW13 - calc.opening;
  const runwayWeeks = runwayWeeksFromClosings(calc.closing, CASH_RUNWAY_THRESHOLD_RAND);
  const scenarioActive =
    revAdj !== 100 || expAdj !== 100 || collectDelay !== 0 || headcountDelta !== 0 ||
    (parseFloat(fixedCostDelta) || 0) !== 0 || revGrowthPct !== 0 || (parseFloat(capexAmount) || 0) !== 0;

  const chartData = weeks.map((w, i) => ({
    week: `W${i + 1}`,
    label: w,
    base: Math.round(baseCalc.closing[i]),
    scenario: Math.round(calc.closing[i]),
  }));

  /**
   * Professional PDF export — renders the branded react-pdf CashForecastPDF
   * report (same one used on the accountant side) from the active scenario's
   * computed figures and downloads it.
   */
  const exportPDF = async () => {
    setExporting(true);
    try {
      const [{ pdf }, { CashForecastPDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/reports/cash-forecast"),
      ]);

      const derivedRunway = runwayWeeksFromClosings(calc.closing, CASH_RUNWAY_THRESHOLD_RAND);
      const forecastWeeks = weeks.map((_, i) => ({
        period_label: `Week ${i + 1}`,
        opening_balance: Math.round(i === 0 ? calc.opening : calc.closing[i - 1]),
        total_receipts: Math.round(calc.inflow[i]),
        total_payments: Math.round(calc.outflow[i]),
        net_movement: Math.round(calc.net[i]),
        closing_balance: Math.round(calc.closing[i]),
        scenario: "moderate" as const,
        runway_weeks: Math.max(0, derivedRunway - i),
      }));

      const assumptions = [
        `Forecast starts ${startDate} with an opening bank balance of ${fmtR(calc.opening)}.`,
        `Revenue assumed at ${revAdj}% of entered amounts${revGrowthPct !== 0 ? `, growing ${revGrowthPct > 0 ? "+" : ""}${revGrowthPct}% per week (compounding)` : ""}.`,
        `Expenses assumed at ${expAdj}% of entered amounts.`,
        collectDelay > 0
          ? `Customer collections are delayed by ${collectDelay} week${collectDelay === 1 ? "" : "s"}.`
          : "Customer collections land in the week they are invoiced.",
        ...(headcountDelta !== 0
          ? [`Headcount change of ${headcountDelta > 0 ? "+" : ""}${headcountDelta} at ${fmtR(parseFloat(avgSalary) || 0)} average monthly salary.`]
          : []),
        ...((parseFloat(capexAmount) || 0) !== 0
          ? [`One-off capex of ${fmtR(parseFloat(capexAmount) || 0)} in week ${capexWeek}.`]
          : []),
      ];

      const now = new Date();
      const period = now.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
      const name = clientName?.trim() || "Your Business";

      const blob = await pdf(
        CashForecastPDF({
          smeData: { name, period },
          cashForecast: forecastWeeks,
          scenario: "moderate",
          accountantProfile: profile,
          // Same R50k floor as on-screen runway — never 0.
          minimumThreshold: CASH_RUNWAY_THRESHOLD_RAND,
          assumptions,
        }) as Parameters<typeof pdf>[0],
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/\s+/g, "_")}_${period.replace(/\s+/g, "_")}_CashForecast.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      if (user && clientId) {
        const snapId = await latestSnapshotId(clientId);
        await recordDelivery({
          clientId,
          channel: "pdf_download",
          kind: "report_pdf",
          reportKey: "forecast",
          snapshotId: snapId,
          figuresHash: hashFigures({
            opening: calc.opening,
            closings: calc.closing,
            runway: derivedRunway,
            threshold: CASH_RUNWAY_THRESHOLD_RAND,
          }),
          periodLabel: period,
          createdBy: user.id,
        });
      }
    } catch (err) {
      toast.error(`PDF export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  // ── Shared hero chart ──────────────────────────────────────────────────────
  const heroChart = (height: number) => (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="cfGoldFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD} stopOpacity={0.35} />
              <stop offset="100%" stopColor={GOLD} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
          <XAxis dataKey="week" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis
            stroke="#94a3b8"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => fmtCompact(v)}
            width={54}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(17,24,39,0.95)",
              border: "1px solid rgba(212,165,80,0.4)",
              borderRadius: 10,
              fontSize: 12,
              color: "#f1f5f9",
            }}
            labelStyle={{ color: "#d4a550", fontWeight: 700 }}
            formatter={(v: number, name: string) => [fmtR(v), name === "base" ? "Base" : "Scenario"]}
            labelFormatter={(l, payload) => {
              const p = payload?.[0]?.payload as { label?: string } | undefined;
              return p?.label ? `${l} · ${p.label}` : String(l);
            }}
          />
          <ReferenceLine y={0} stroke={RED} strokeDasharray="3 3" strokeOpacity={0.7} />
          {scenarioActive && (
            <Line
              type="monotone"
              dataKey="base"
              name="base"
              stroke="#94a3b8"
              strokeDasharray="5 5"
              dot={false}
              strokeWidth={1.5}
              isAnimationActive
              animationDuration={900}
            />
          )}
          <Area
            type="monotone"
            dataKey="scenario"
            name="scenario"
            stroke={GOLD}
            strokeWidth={2.5}
            fill="url(#cfGoldFill)"
            dot={false}
            activeDot={{ r: 4, fill: GOLD_DARK, stroke: "#fff", strokeWidth: 1.5 }}
            isAnimationActive
            animationDuration={mounted ? 700 : 1100}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );

  const shortfall = lowestBal < 0;
  const forecastStale = computeIsStale(forecastSignoff, lastForecastAt);

  const heroBadge = (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ${
        shortfall
          ? "border-[#e05c5c] bg-[#e05c5c]/10 text-[#c0392b] dark:text-[#ef6b6b]"
          : "border-[#4caf82] bg-[#4caf82]/10 text-[#3f9c72] dark:text-[#5cc492]"
      }`}
    >
      {shortfall ? <AlertTriangle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
      {shortfall ? `Shortfall W${lowestWeek}` : "In the black"}
    </span>
  );

  // ── Simplified mode: glanceable hero ─────────────────────────────────────
  if (simplified) {
    return (
      <Card className={CARD_SHELL}>
        <div className={GOLD_RULE} />
        <CardHeader className="border-b border-amber-900/10 pb-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                Cash Outlook
              </CardTitle>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                13-week closing balance trajectory · opening {fmtR(calc.opening)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              {heroBadge}
              <ReviewSignoffBadge signoff={forecastSignoff} scope="cash_forecast" isStale={forecastStale} compact />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {canSign && clientId && (
            <div className="mb-4 flex justify-end">
              <ReviewSignoffButton
                clientId={clientId}
                clientName={clientName}
                scope="cash_forecast"
                signoff={forecastSignoff}
                isStale={forecastStale}
                onChange={setForecastSignoff}
              />
            </div>
          )}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Closing · Week 13"
              value={fmtCompact(closingW13)}
              tone={closingW13 < 0 ? "bad" : "neutral"}
              sub={
                <span className="inline-flex items-center gap-1">
                  {trajectory >= 0 ? (
                    <TrendingUp className="h-3 w-3 text-[#3f9c72]" />
                  ) : (
                    <TrendingDown className="h-3 w-3 text-[#c0392b]" />
                  )}
                  {trajectory >= 0 ? "+" : ""}
                  {fmtCompact(trajectory)} over 13 weeks
                </span>
              }
            />
            <Stat
              label="Lowest balance"
              value={fmtCompact(lowestBal)}
              tone={shortfall ? "bad" : "good"}
              sub={`Week ${lowestWeek} · ${weeks[lowestWeek - 1]}`}
            />
            <Stat
              label="Cash runway"
              value={runwayWeeks >= WEEKS ? `${WEEKS}+ wk` : `${runwayWeeks} wk`}
              tone={runwayWeeks < 8 ? "bad" : runwayWeeks < 13 ? "neutral" : "good"}
              sub={`Above R${(CASH_RUNWAY_THRESHOLD_RAND / 1000).toFixed(0)}k floor`}
            />
            <Stat
              label="Net cash · next 4 weeks"
              value={fmtCompact(calc.net.slice(0, 4).reduce((a, b) => a + b, 0))}
              tone={calc.net.slice(0, 4).reduce((a, b) => a + b, 0) < 0 ? "bad" : "good"}
              sub="Inflows minus outflows"
            />
          </div>
          {heroChart(180)}
        </CardContent>
      </Card>
    );
  }

  // ── Complex mode ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Hero: summary + chart */}
      <Card className={CARD_SHELL}>
        <div className={GOLD_RULE} />
        <CardHeader className="border-b border-amber-900/10 pb-4 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                13-Week Cash Forecast
              </CardTitle>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Forecast every cent in and out of the bank · catch a shortfall before it hits
              </p>
            </div>
            <div className="flex items-center gap-2">
              {heroBadge}
              <ReviewSignoffBadge signoff={forecastSignoff} scope="cash_forecast" isStale={forecastStale} compact />
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 border-[#d4a550]/40 bg-[#d4a550]/10 px-2.5 text-[10px] text-[#b8860b] hover:bg-[#d4a550]/20 dark:text-[#d4a550]"
                disabled={exporting}
                onClick={exportPDF}
              >
                <Download className="h-3 w-3" /> {exporting ? "Preparing…" : "Export PDF"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {canSign && clientId && (
            <div className="mb-4 flex justify-end">
              <ReviewSignoffButton
                clientId={clientId}
                clientName={clientName}
                scope="cash_forecast"
                signoff={forecastSignoff}
                isStale={forecastStale}
                onChange={setForecastSignoff}
              />
            </div>
          )}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Opening balance" value={fmtCompact(calc.opening)} sub={`Start ${startDate}`} />
            <Stat
              label="Closing · Week 13"
              value={fmtCompact(closingW13)}
              tone={closingW13 < 0 ? "bad" : "neutral"}
              sub={
                scenarioActive ? (
                  <span
                    className={
                      closingW13 - baseCalc.closing[WEEKS - 1] >= 0
                        ? "text-[#3f9c72] dark:text-[#5cc492]"
                        : "text-[#c0392b] dark:text-[#ef6b6b]"
                    }
                  >
                    {closingW13 - baseCalc.closing[WEEKS - 1] >= 0 ? "+" : ""}
                    {fmtCompact(closingW13 - baseCalc.closing[WEEKS - 1])} vs base
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    {trajectory >= 0 ? (
                      <TrendingUp className="h-3 w-3 text-[#3f9c72]" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-[#c0392b]" />
                    )}
                    {trajectory >= 0 ? "+" : ""}
                    {fmtCompact(trajectory)} over 13 weeks
                  </span>
                )
              }
            />
            <Stat
              label="Lowest balance"
              value={fmtCompact(lowestBal)}
              tone={shortfall ? "bad" : "good"}
              sub={`Week ${lowestWeek} · ${weeks[lowestWeek - 1]}`}
            />
            <Stat
              label="Total net movement"
              value={fmtCompact(calc.net.reduce((a, b) => a + b, 0))}
              tone={calc.net.reduce((a, b) => a + b, 0) < 0 ? "bad" : "good"}
              sub={`Inflows ${fmtCompact(calc.inflow.reduce((a, b) => a + b, 0))} · Outflows ${fmtCompact(calc.outflow.reduce((a, b) => a + b, 0))}`}
            />
          </div>
          <div className="mb-1 flex items-center justify-between">
            <div className={LABEL_CLS}>Closing balance trajectory</div>
            {scenarioActive && (
              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                Dashed = base · Gold = scenario
              </div>
            )}
          </div>
          {heroChart(240)}
        </CardContent>
      </Card>

      {/* Scenario sliders */}
      <SectionCard
        id="wizard-cash-scenario"
        icon={SlidersHorizontal}
        title="Scenario Studio"
        subtitle="Stress-test the forecast — what if revenue drops 20% or customers pay 2 weeks late?"
        defaultOpen
        headerRight={
          scenarioActive ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px] text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              onClick={(e) => {
                e.stopPropagation();
                setRevAdj(100); setExpAdj(100); setCollectDelay(0);
                setHeadcountDelta(0); setAvgSalary("0"); setFixedCostDelta("0");
                setRevGrowthPct(0); setCapexAmount("0"); setCapexWeek(1);
              }}
            >
              Reset all
            </Button>
          ) : undefined
        }
      >
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <Label className={LABEL_CLS}>Revenue</Label>
              <span
                className={`font-bold ${
                  revAdj < 100
                    ? "text-[#c0392b] dark:text-[#ef6b6b]"
                    : revAdj > 100
                      ? "text-[#3f9c72] dark:text-[#5cc492]"
                      : "text-slate-700 dark:text-slate-200"
                }`}
              >
                {revAdj}%
              </span>
            </div>
            <Slider value={[revAdj]} min={50} max={150} step={5} onValueChange={(v) => setRevAdj(v[0])} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <Label className={LABEL_CLS}>Expenses</Label>
              <span
                className={`font-bold ${
                  expAdj > 100
                    ? "text-[#c0392b] dark:text-[#ef6b6b]"
                    : expAdj < 100
                      ? "text-[#3f9c72] dark:text-[#5cc492]"
                      : "text-slate-700 dark:text-slate-200"
                }`}
              >
                {expAdj}%
              </span>
            </div>
            <Slider value={[expAdj]} min={50} max={150} step={5} onValueChange={(v) => setExpAdj(v[0])} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <Label className={LABEL_CLS}>Collection delay</Label>
              <span className={`font-bold ${collectDelay > 0 ? "text-[#c0392b] dark:text-[#ef6b6b]" : "text-slate-700 dark:text-slate-200"}`}>
                +{collectDelay}w
              </span>
            </div>
            <Slider value={[collectDelay]} min={0} max={6} step={1} onValueChange={(v) => setCollectDelay(v[0])} />
          </div>
          <div className="mt-2 grid gap-5 border-t border-amber-900/10 pt-4 dark:border-slate-800 md:col-span-3 md:grid-cols-3">
            <div>
              <Label className={LABEL_CLS}>Headcount Δ (people)</Label>
              <div className="mt-1 flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setHeadcountDelta(headcountDelta - 1)}>−</Button>
                <Input type="number" value={headcountDelta} onChange={(e) => setHeadcountDelta(parseInt(e.target.value) || 0)} className={`${INPUT_CLS} text-center`} />
                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setHeadcountDelta(headcountDelta + 1)}>+</Button>
              </div>
              <Label className={`mt-2 block ${LABEL_CLS}`}>Avg monthly salary (R)</Label>
              <Input type="number" value={avgSalary} onChange={(e) => setAvgSalary(e.target.value)} className={INPUT_CLS} />
            </div>
            <div>
              <Label className={LABEL_CLS}>Fixed cost Δ (monthly R, +/-)</Label>
              <Input type="number" value={fixedCostDelta} onChange={(e) => setFixedCostDelta(e.target.value)} className={INPUT_CLS} />
              <div className="mb-1 mt-3 flex items-center justify-between text-xs">
                <Label className={LABEL_CLS}>Revenue growth / week</Label>
                <span
                  className={`font-bold ${
                    revGrowthPct < 0
                      ? "text-[#c0392b] dark:text-[#ef6b6b]"
                      : revGrowthPct > 0
                        ? "text-[#3f9c72] dark:text-[#5cc492]"
                        : "text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {revGrowthPct > 0 ? "+" : ""}{revGrowthPct}%
                </span>
              </div>
              <Slider value={[revGrowthPct]} min={-10} max={10} step={0.5} onValueChange={(v) => setRevGrowthPct(v[0])} />
            </div>
            <div>
              <Label className={LABEL_CLS}>One-off capex (R)</Label>
              <Input type="number" value={capexAmount} onChange={(e) => setCapexAmount(e.target.value)} className={INPUT_CLS} />
              <Label className={`mt-2 block ${LABEL_CLS}`}>In week #</Label>
              <Input type="number" min={1} max={WEEKS} value={capexWeek} onChange={(e) => setCapexWeek(parseInt(e.target.value) || 1)} className={INPUT_CLS} />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Weekly forecast table */}
      <SectionCard
        id="wizard-cash-table"
        icon={Table2}
        title="Weekly Detail"
        subtitle="Full line-by-line forecast · red = shortfall, act early"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="border-b border-amber-900/15 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="sticky left-0 bg-[#fdfaf3] px-2 py-2 text-left dark:bg-[#101827]">Item</th>
                {weeks.map((w, i) => (
                  <th key={i} className="px-2 py-2 text-right">
                    W{i + 1}
                    <div className="text-[9px] font-normal text-slate-400 dark:text-slate-500">{w}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calc.revRows.map((r, i) => (
                <tr key={`r${i}`} className="border-b border-amber-900/10 text-slate-700 dark:border-slate-800 dark:text-slate-300">
                  <td className="sticky left-0 bg-[#fdfaf3] px-2 py-1 dark:bg-[#101827]">{r.name}</td>
                  {r.vals.map((v, j) => (
                    <td key={j} className="px-2 py-1 text-right">
                      {v ? fmtR(v) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-b border-amber-900/15 bg-[#4caf82]/10 font-semibold text-[#3f9c72] dark:border-slate-700 dark:text-[#5cc492]">
                <td className="sticky left-0 bg-[#f2f8f2] px-2 py-1 dark:bg-[#0e1a20]">Total inflow</td>
                {calc.inflow.map((v, j) => (
                  <td key={j} className="px-2 py-1 text-right">
                    {fmtR(v)}
                  </td>
                ))}
              </tr>
              {calc.expRows.map((r, i) => (
                <tr key={`e${i}`} className="border-b border-amber-900/10 text-slate-700 dark:border-slate-800 dark:text-slate-300">
                  <td className="sticky left-0 bg-[#fdfaf3] px-2 py-1 dark:bg-[#101827]">{r.name}</td>
                  {r.vals.map((v, j) => (
                    <td key={j} className="px-2 py-1 text-right">
                      {v ? `(${fmtR(v)})` : "—"}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-b border-amber-900/15 bg-[#e05c5c]/10 font-semibold text-[#c0392b] dark:border-slate-700 dark:text-[#ef6b6b]">
                <td className="sticky left-0 bg-[#faf1f0] px-2 py-1 dark:bg-[#1a1216]">Total outflow</td>
                {calc.outflow.map((v, j) => (
                  <td key={j} className="px-2 py-1 text-right">
                    ({fmtR(v)})
                  </td>
                ))}
              </tr>
              <tr className="border-b border-amber-900/15 font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">
                <td className="sticky left-0 bg-[#fdfaf3] px-2 py-1 dark:bg-[#101827]">Net cash</td>
                {calc.net.map((v, j) => (
                  <td
                    key={j}
                    className={`px-2 py-1 text-right ${v < 0 ? "text-[#c0392b] dark:text-[#ef6b6b]" : "text-[#3f9c72] dark:text-[#5cc492]"}`}
                  >
                    {fmtR(v)}
                  </td>
                ))}
              </tr>
              <tr className="bg-[#d4a550]/15 font-bold text-slate-950 dark:text-white">
                <td className="sticky left-0 bg-[#f7efdd] px-2 py-1 dark:bg-[#1c1a12]">Closing balance</td>
                {calc.closing.map((v, j) => (
                  <td
                    key={j}
                    className={`px-2 py-1 text-right ${v < 0 ? "text-[#c0392b] dark:text-[#ef6b6b]" : ""}`}
                  >
                    {fmtR(v)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* Setup + inputs */}
      <SectionCard
        id="wizard-cash-setup"
        icon={Settings2}
        title="Forecast Setup"
        subtitle="Start date, opening balance and bank statement upload"
        headerRight={
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 border-[#d4a550]/40 bg-[#d4a550]/10 px-2.5 text-[10px] text-[#b8860b] hover:bg-[#d4a550]/20 dark:text-[#d4a550]"
            onClick={(e) => {
              e.stopPropagation();
              setShowBankUpload(true);
            }}
          >
            <Upload className="h-3 w-3" /> Upload bank statements
          </Button>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className={LABEL_CLS}>Forecast start date</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <Label className={LABEL_CLS}>Opening bank balance (R)</Label>
            <Input
              type="number"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        icon={Wallet}
        title="Money In & Out"
        subtitle="Revenue and expense line items — pick how each lands across the 13 weeks"
      >
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#3f9c72] dark:text-[#5cc492]">
              Revenue inputs
            </div>
            {revenue.map((l, i) => (
              <LineEditor
                key={l.id}
                line={l}
                tone="revenue"
                onChange={(n) => updateAt(revenue, setRevenue, i, n)}
                onRemove={revenue.length > 1 ? () => setRevenue(revenue.filter((_, x) => x !== i)) : undefined}
              />
            ))}
            <Button
              variant="outline"
              onClick={() => setRevenue([...revenue, makeLine("New revenue line")])}
              className="w-full border-[#4caf82]/40 bg-[#4caf82]/5 text-[#3f9c72] hover:bg-[#4caf82]/15 dark:text-[#5cc492]"
            >
              <Plus className="h-4 w-4" /> Add revenue line
            </Button>
          </div>

          <div className="space-y-3 border-t border-amber-900/10 pt-5 dark:border-slate-800">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#c0392b] dark:text-[#ef6b6b]">
              Main expenses
            </div>
            {expenses.map((l, i) => (
              <LineEditor
                key={l.id}
                line={l}
                tone="expense"
                onChange={(n) => updateAt(expenses, setExpenses, i, n)}
              />
            ))}
            <div className="mt-4 text-[10px] font-bold uppercase tracking-wider text-[#c0392b] dark:text-[#ef6b6b]">
              Other expenses
            </div>
            {other.map((l, i) => (
              <LineEditor
                key={l.id}
                line={l}
                tone="expense"
                onChange={(n) => updateAt(other, setOther, i, n)}
                onRemove={other.length > 1 ? () => setOther(other.filter((_, x) => x !== i)) : undefined}
              />
            ))}
            <Button
              variant="outline"
              onClick={() => setOther([...other, makeLine("Other expense")])}
              className="w-full border-[#e05c5c]/40 bg-[#e05c5c]/5 text-[#c0392b] hover:bg-[#e05c5c]/15 dark:text-[#ef6b6b]"
            >
              <Plus className="h-4 w-4" /> Add other expense line
            </Button>
          </div>
        </div>
      </SectionCard>

      <CashFromBanksDrafter
        open={showBankUpload}
        onClose={() => setShowBankUpload(false)}
        existingCashflow={existingCashflowForBanks}
        onSaveDraft={
          clientId
            ? async (draft) => {
                await supabase
                  .from("clients")
                  .update({ cashflow_bank_draft: draft as never })
                  .eq("id", clientId)
                  .then(({ error }) => {
                    if (error && !/cashflow_bank_draft|42703/.test(error.message ?? "")) {
                      console.warn("cashflow_bank_draft save:", error.message);
                    }
                  });
              }
            : undefined
        }
        onPublish={applyBankPublish}
      />
    </div>
  );
}
