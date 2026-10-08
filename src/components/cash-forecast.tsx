import { useState, useMemo, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { forecastOpeningFromStored, isQboBalanceSheetHoldNote } from "@/lib/xero-opening";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import {
  CollapsibleGoldCard,
  COLLAPSIBLE_GOLD_SHELL,
  COLLAPSIBLE_GOLD_RULE,
} from "@/components/primitives/collapsible-gold-card";
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
  TrendingUp,
  TrendingDown,
  Table2,
  Settings2,
  Wallet,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { useMarketFormat } from "@/contexts/market";
import { currencySymbol } from "@/lib/market";
import { listClientReviewSignoffs } from "@/lib/review-signoffs.functions";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import { ReviewSignoffButton, computeIsStale } from "@/components/review-signoff";
import { CashFromBanksDrafter } from "@/components/cash-from-banks-drafter";
import { DeliverableInputConfig } from "@/components/deliverable-input-config";
import { ReviewInputsDrawer } from "@/components/review-inputs-drawer";
import { SignoffStatusChip } from "@/components/signoff-status-chip";
import {
  bankAccountsFromDraft,
  parseOperatingProfileUnknown,
} from "@/lib/deliverable-input-config";
import type { ClientOperatingProfile } from "@/lib/client-profile";
import { ScrollableTable } from "@/components/primitives/scrollable-table";
import type {
  CashForecastPublishPayload,
  CashFromBanksDraftResult,
} from "@/lib/cash-from-banks.types";
import { periodMonthsOf } from "@/lib/ratios";
import { balanceSheetCashAsOf } from "@/lib/statement-parse";
import { formatCalendarDay, formatMoneyChartTick } from "@/lib/market/format";
import { openingCashToConfirm } from "@/lib/cash-from-banks.publish";
import { PlBankDisagreeNotice } from "@/components/pl-bank-disagree-notice";
import {
  assessClientMetrics,
  baseCashflow,
  clientRunway,
  distributeForecastLine,
  forecastAnchorDate,
  forecastInTheBlack,
  forecastIsCashGenerative,
  forecastMinimumCash,
  forecastScenarioLabel,
  runwayFromForecastNet,
  periodOperatingOutflows,
  ledgerOpeningIsCashEvidence,
  persistedRunwayWeeks,
  plBankDisagreement,
  runwayDisplayLabel,
  resolveClientCash,
  resolveThirteenWeekForecast,
  weekDatesFrom,
  type ClientRunway,
} from "@/lib/client-metrics";
import {
  cashEmptyPresentation,
  forecastLinesSourceLabel,
  forecastLowestPoint,
  forecastRunwayHeadlineShared,
  forecastStatusSentence,
  openingSourceLabel,
} from "@/lib/cash-forecast-parity";
import {
  hashFigures,
  latestSnapshotId,
  recordDelivery,
  warnIfDeliveryFailed,
  warnIfPdfArchiveFailed,
} from "@/lib/advisory-deliveries";
import { stampFromSignoff } from "@/lib/review-signoff-stamp";
import {
  applyWeekOverrides,
  parseEditableAmount,
  setWeekOverride,
  type WeekOverrides,
} from "@/lib/cash-week-overrides";
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
  /** Absolute per-week amounts from the detailed grid. Formula still fills the rest. */
  weekOverrides?: WeekOverrides;
};

const WEEKS = 13;
const WEEK_DAY_LABEL = { day: "2-digit", month: "short" } as const;

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
  return distributeForecastLine(line, WEEKS);
}

// ── Brand palette (matches profitability waterfall / accountant reports) ─────
const GOLD = "#d4a550";
const GOLD_DARK = "#b8860b";
const RED = "#e05c5c";

// ── Shared card shell — light + dark, gold top rule ─────────────────────────
const CARD_SHELL = COLLAPSIBLE_GOLD_SHELL;
const GOLD_RULE = COLLAPSIBLE_GOLD_RULE;
const INPUT_CLS =
  "border-amber-900/15 bg-white/70 text-slate-900 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100";
const LABEL_CLS = "text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400";

function ForecastAmountCell({
  symbol,
  value,
  display,
  onCommit,
}: {
  symbol: string;
  value: number;
  display: string;
  onCommit: (next: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const begin = () => {
    setDraft(value ? String(value) : "");
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    onCommit(parseEditableAmount(draft));
  };

  if (editing) {
    return (
      <span className="inline-flex items-baseline justify-end gap-0.5">
        <span className="text-[inherit] opacity-80">{symbol}</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          inputMode="decimal"
          aria-label="Edit amount"
          className="w-[4.75rem] border-0 border-b border-[#d4a550] bg-transparent p-0 text-right text-xs font-inherit tabular-nums text-inherit outline-none"
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      title="Double-click to edit"
      onDoubleClick={(e) => {
        e.preventDefault();
        begin();
      }}
      className="milon-forecast-amount w-full cursor-text border-0 bg-transparent p-0 text-right text-inherit decoration-[#d4a550]/70 decoration-dotted underline-offset-2 hover:underline"
    >
      {display}
    </button>
  );
}

function CashTileSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-200/70 p-3 dark:border-white/10"
          aria-hidden="true"
        >
          <div className="h-3 w-24 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800" />
          <div className="mt-2 h-7 w-28 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800" />
          <div className="mt-2 h-3 w-32 animate-pulse rounded bg-slate-200/70 dark:bg-slate-800" />
        </div>
      ))}
    </>
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
        className={`mt-1 text-xl font-extrabold leading-tight tracking-tight whitespace-normal ${
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
  const { market } = useMarketFormat();
  const cur = currencySymbol(market);
  const accent =
    tone === "revenue" ? "border-l-[3px] border-l-[#4caf82]" : "border-l-[3px] border-l-[#e05c5c]";
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
        <Label className={LABEL_CLS}>Amount ({cur})</Label>
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

function runwayFromOpening(
  opening: string | number | null | undefined,
  fin: Record<string, unknown> | null | undefined,
  opts?: { hasBankCashflow?: boolean },
): ClientRunway {
  const cash = typeof opening === "number" ? opening : parseFloat(String(opening ?? ""));
  const netRaw = fin?.netIncome;
  const net =
    typeof netRaw === "number"
      ? netRaw
      : parseFloat(String(netRaw ?? ""));
  const ocfRaw = fin?.operatingCashflow;
  const ocf = typeof ocfRaw === "number" ? ocfRaw : parseFloat(String(ocfRaw ?? ""));
  return clientRunway({
    cash: Number.isFinite(cash) ? cash : null,
    netIncome: Number.isFinite(net) ? net : null,
    periodExpenses: periodOperatingOutflows(fin),
    periodMonths: fin ? periodMonthsOf(fin) : null,
    operatingCashflow: Number.isFinite(ocf) ? ocf : null,
    hasBankCashflow: opts?.hasBankCashflow,
  });
}

export function CashForecastPanel({
  clientId,
  clientName,
  simplified,
  canSign,
  hideReadOnlyStamp,
  hideInlineSignOff,
  signoffStale,
  signoff: signoffProp,
  onSignoffChange,
  reloadToken,
  openBankUploadToken,
  pendingBankFile = null,
  onPendingBankFileConsumed,
  onBankPublish,
  initialBankDraft = null,
  statementChip = null,
}: {
  clientId?: string;
  clientName?: string;
  simplified?: boolean;
  /** Accountant view only: show the interactive sign-off control instead of the read-only badge. */
  canSign?: boolean;
  /** Owner board already stamps this deliverable in the tab header. */
  hideReadOnlyStamp?: boolean;
  /** Parent already renders Sign off in the tab header. */
  hideInlineSignOff?: boolean;
  /** Parent's figure check. Falls back to the forecast timestamp. */
  signoffStale?: boolean;
  signoff?: ClientReviewSignoff | null;
  onSignoffChange?: (next: ClientReviewSignoff | null) => void;
  /** Bump to re-load cashflow from Supabase (e.g. after bank→cash publish). */
  reloadToken?: number;
  /** Bump to open the bank-statement upload dialog (e.g. accountant Cash tab header). */
  openBankUploadToken?: number;
  /** Bank file rejected by the financial-statement upload, pre-loaded into this picker. */
  pendingBankFile?: File | null;
  onPendingBankFileConsumed?: () => void;
  /** Optional parent hook after a successful bank→cash publish (e.g. sync client cache). */
  onBankPublish?: (payload: CashForecastPublishPayload) => void;
  /** Pre-built cash draft from shared bank onboarding — skip re-upload. */
  initialBankDraft?: CashFromBanksDraftResult | null;
  /** QuickBooks / Uploaded statement / Xero / Sage chip from the statement file. */
  statementChip?: string | null;
} = {}) {
  const { profile, firmId } = useAccountantProfile();
  const { user } = useAuth();
  const { money: fmtR, moneyCompact: fmtCompact, date, market } = useMarketFormat();
  const cur = currencySymbol(market);
  const fetchReviewSignoffs = useServerFn(listClientReviewSignoffs);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [openingSourceChip, setOpeningSourceChip] = useState<string | null>(null);
  const [publishedBankEvidence, setPublishedBankEvidence] = useState(false);
  const [forecastSignoff, setForecastSignoff] = useState<ClientReviewSignoff | null>(
    signoffProp ?? null,
  );
  const [lastForecastAt, setLastForecastAt] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() =>
    forecastAnchorDate({ now: new Date(), timeZone: market.timezone }),
  );
  const [bankSeeded, setBankSeeded] = useState(false);
  const plEstimateRef = useRef(false);
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
  const [inputFinancials, setInputFinancials] = useState<Record<
    string,
    string | number | null | undefined
  > | null>(null);
  const [inputProfile, setInputProfile] = useState<ClientOperatingProfile | null>(null);
  const [inputBudgetWc, setInputBudgetWc] = useState<{
    debtorDays: number;
    creditorDays: number;
    inventoryDays: number;
  } | null>(null);
  const [inputBankAccounts, setInputBankAccounts] = useState(() =>
    bankAccountsFromDraft(initialBankDraft),
  );
  const [inputHasBankDraft, setInputHasBankDraft] = useState(Boolean(initialBankDraft));
  // Guards against the autosave effect firing the instant hydration finishes —
  // otherwise merely opening the forecast bumps last_forecast_at and falsely
  // invalidates an accountant's sign-off with no real data change.
  const skipNextAutosave = useRef(false);
  const loadedCashflowRef = useRef<Record<string, unknown> | null>(null);
  const [linesSourceChip, setLinesSourceChip] = useState<string | null>(null);
  const [forecastCycleNote, setForecastCycleNote] = useState<string | null>(null);
  const [xeroBankNote, setXeroBankNote] = useState<string | null>(null);
  const xeroBankNoteRef = useRef<string | null>(null);
  const xeroCashMarkers = useRef<{
    openingSource: "xero" | "qbo" | null;
    openingBalance: string | null;
    linesSource: "xero-bank-summary" | "qbo-bank-activity" | null;
    linesKey: string | null;
  }>({
    openingSource: null,
    openingBalance: null,
    linesSource: null,
    linesKey: null,
  });

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
    setInputHasBankDraft(true);
    setBankSeeded(true);
    plEstimateRef.current = false;
    if (xeroBankNoteRef.current === "Estimated from the P&L") {
      xeroBankNoteRef.current = null;
      setXeroBankNote(null);
    }

    if (!clientId) {
      onBankPublish?.(payload);
      return;
    }
    const forecastUpdatedAt = new Date().toISOString();
    const runway = runwayFromOpening(payload.openingBalance, inputFinancials, {
      hasBankCashflow: true,
    });
    const { error } = await supabase
      .from("clients")
      .update({
        cashflow: payload as never,
        cashflow_bank_draft: payload as never,
        last_forecast_at: forecastUpdatedAt,
        cash_runway_weeks: persistedRunwayWeeks(runway),
      })
      .eq("id", clientId);
    if (error) {
      const retry = await supabase
        .from("clients")
        .update({
          cashflow: payload as never,
          last_forecast_at: forecastUpdatedAt,
          cash_runway_weeks: persistedRunwayWeeks(runway),
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
    if (signoffProp !== undefined) setForecastSignoff(signoffProp);
  }, [signoffProp]);

  const patchForecastSignoff = (next: ClientReviewSignoff | null) => {
    setForecastSignoff(next);
    onSignoffChange?.(next);
  };

  useEffect(() => {
    if (!clientId) return;
    fetchReviewSignoffs({ data: { clientId } })
      .then(({ signoffs }) => {
        const row = signoffs.find((s) => s.scope === "cash_forecast") ?? null;
        setForecastSignoff(row);
        onSignoffChange?.(row);
      })
      .catch(() => {
        // Sign-off state is a trust-signal enhancement, never block the forecast itself.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    const applyRow = (data: Record<string, unknown> | null) => {
      setLastForecastAt((data?.last_forecast_at as string | null | undefined) ?? null);
      const cf = data?.cashflow as {
        startDate?: string;
        openingBalance?: string;
        openingBalanceSource?: string;
        forecastLinesSource?: string;
        forecastLinesNote?: string;
        revenue?: LineItem[];
        expenses?: LineItem[];
        other?: LineItem[];
        revAdj?: number;
        expAdj?: number;
        collectDelay?: number;
        headcountDelta?: number;
        avgSalary?: string;
        fixedCostDelta?: string;
        revGrowthPct?: number;
        capexAmount?: string;
        capexWeek?: number;
      } | null;
      const finRecord = (data?.financials ?? null) as Record<string, unknown> | null;
      const bankAt =
        cf && typeof (cf as { seededFromBanksAt?: unknown }).seededFromBanksAt === "string"
          ? (cf as { seededFromBanksAt: string }).seededFromBanksAt
          : null;
      const bankOpening = bankAt ? parseFloat(String(cf?.openingBalance ?? "")) : NaN;
      const periodRaw = finRecord?.cash;
      const periodCash =
        typeof periodRaw === "number"
          ? periodRaw
          : parseFloat(String(periodRaw ?? ""));
      const resolvedCash = resolveClientCash({
        publishedBankBalance: Number.isFinite(bankOpening) ? bankOpening : null,
        bankPublishedAt: bankAt,
        periodCash: Number.isFinite(periodCash) ? periodCash : null,
        periodUpdatedAt: (data?.financials_updated_at as string | null | undefined) ?? null,
      });
      const seededOpening = forecastOpeningFromStored(cf?.openingBalance, resolvedCash.amount);
      if (seededOpening) setOpeningBalance(seededOpening);
      const shownOpening =
        seededOpening ??
        (cf?.openingBalance != null && cf.openingBalance !== "" ? String(cf.openingBalance) : null);
      const openingSource =
        !seededOpening && (cf?.openingBalanceSource === "xero" || cf?.openingBalanceSource === "qbo")
          ? cf.openingBalanceSource
          : null;
      const linesSource =
        cf?.forecastLinesSource === "xero-bank-summary" || cf?.forecastLinesSource === "qbo-bank-activity"
          ? cf.forecastLinesSource
          : null;
      xeroCashMarkers.current = {
        openingSource,
        openingBalance: shownOpening,
        linesSource,
        linesKey: JSON.stringify({
          revenue: cf?.revenue ?? null,
          expenses: cf?.expenses ?? null,
          other: cf?.other ?? null,
        }),
      };
      const bankNote =
        (cf?.forecastLinesSource === "xero-bank-summary" ||
          cf?.forecastLinesSource === "qbo-bank-activity") &&
        typeof cf.forecastLinesNote === "string"
          ? cf.forecastLinesNote
          : null;
      xeroBankNoteRef.current = bankNote;
      setXeroBankNote(bankNote);
      loadedCashflowRef.current = cf ? { ...(cf as Record<string, unknown>) } : null;
      setOpeningSourceChip(openingSourceLabel(cf as Record<string, unknown> | null));
      setLinesSourceChip(forecastLinesSourceLabel(cf as Record<string, unknown> | null));
      const lineNames = [...(cf?.revenue ?? []), ...(cf?.expenses ?? []), ...(cf?.other ?? [])].map(
        (line) => String(line?.name ?? ""),
      );
      const budgetNamed = lineNames.some((name) => /\(from budget\)/i.test(name));
      setPublishedBankEvidence(
        (Boolean(bankAt) && !budgetNamed) ||
          ledgerOpeningIsCashEvidence(cf as Record<string, unknown> | null),
      );
      if (seededOpening && cf && clientId) {
        const corrected = runwayFromOpening(seededOpening, finRecord, {
          hasBankCashflow: Boolean(bankAt),
        });
        void supabase
          .from("clients")
          .update({
            cashflow: { ...cf, openingBalance: seededOpening } as never,
            cash_runway_weeks: persistedRunwayWeeks(corrected),
          })
          .eq("id", clientId);
      }
      setBankSeeded(Boolean(bankAt));
      const loadedProfile = parseOperatingProfileUnknown(data?.operating_profile);
      const outlook = resolveThirteenWeekForecast({
        financials: finRecord,
        cashflow: cf,
        openingCash: resolvedCash.amount,
        runway: runwayFromOpening(resolvedCash.amount ?? cf?.openingBalance, finRecord, {
          hasBankCashflow: Boolean(bankAt),
        }),
        periodEnd: typeof finRecord?.periodEnd === "string" ? finRecord.periodEnd : null,
        timeZone: market.timezone,
        fyStartMonth: loadedProfile?.fyStartMonth ?? market.fyStartMonthDefault,
      });
      setForecastCycleNote(outlook.cycleNote);
      setStartDate(outlook.startDate);
      setOpeningBalance(String(Math.round(outlook.opening * 100) / 100));
      if (outlook.estimateLabel) {
        setXeroBankNote(outlook.estimateLabel);
        xeroBankNoteRef.current = outlook.estimateLabel;
        plEstimateRef.current = true;
      } else if (outlook.anchorNote) {
        setXeroBankNote(outlook.anchorNote);
        xeroBankNoteRef.current = outlook.anchorNote;
        plEstimateRef.current = false;
      } else if (cf?.forecastLinesSource === "pl-estimate") {
        setXeroBankNote("Estimated from the P&L");
        xeroBankNoteRef.current = "Estimated from the P&L";
        plEstimateRef.current = true;
      }
      if (outlook.replaceStored) {
        setStartDate(outlook.startDate);
        setOpeningBalance(String(Math.round(outlook.opening * 100) / 100));
        setRevenue(outlook.lines.revenue);
        setExpenses(outlook.lines.expenses);
        setOther([
          {
            id: "derived-other",
            name: "Other",
            amount: "0",
            frequency: "once-off",
            startWeek: 1,
            splitCount: 1,
          },
        ]);
        setRevAdj(100);
        setExpAdj(100);
        setCollectDelay(0);
        setHeadcountDelta(0);
        setAvgSalary("0");
        setFixedCostDelta("0");
        setRevGrowthPct(0);
        setCapexAmount("0");
        setCapexWeek(1);
        if (!outlook.estimateLabel) {
          setXeroBankNote(null);
          xeroBankNoteRef.current = null;
          plEstimateRef.current = false;
        }
      } else if (cf) {
        if (!outlook.reanchored && !seededOpening && cf.openingBalance != null) {
          setOpeningBalance(cf.openingBalance);
        }
        if (cf.revenue) setRevenue(cf.revenue);
        if (cf.expenses) setExpenses(cf.expenses);
        if (cf.other) setOther(cf.other);
        // Scenario knobs (collection delay, growth, capex) are session-only.
        // A value saved before the base forecast ignored them is leakage, not
        // the base. Opening this tab always starts on the base.
        setRevAdj(100);
        setExpAdj(100);
        setCollectDelay(0);
        setHeadcountDelta(0);
        setAvgSalary("0");
        setFixedCostDelta("0");
        setRevGrowthPct(0);
        setCapexAmount("0");
        setCapexWeek(1);
      }
      setInputFinancials(
        (data?.financials as Record<string, string | number | null | undefined> | null) ?? null,
      );
      setInputProfile(parseOperatingProfileUnknown(data?.operating_profile));
      const wc = (
        data?.budget as {
          wc?: { debtorDays?: number; creditorDays?: number; inventoryDays?: number };
        } | null
      )?.wc;
      setInputBudgetWc(
        wc
          ? {
              debtorDays: wc.debtorDays ?? 0,
              creditorDays: wc.creditorDays ?? 0,
              inventoryDays: wc.inventoryDays ?? 0,
            }
          : null,
      );
      const fromDraft = bankAccountsFromDraft(data?.cashflow_bank_draft);
      setInputBankAccounts(fromDraft.length ? fromDraft : bankAccountsFromDraft(initialBankDraft));
      setInputHasBankDraft(Boolean(data?.cashflow_bank_draft) || Boolean(initialBankDraft));
      skipNextAutosave.current = true;
      setLoaded(true);
    };
    supabase
      .from("clients")
      .select(
        "cashflow, last_forecast_at, cashflow_bank_draft, operating_profile, financials, financials_updated_at, budget",
      )
      .eq("id", clientId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          return supabase
            .from("clients")
            .select("cashflow, last_forecast_at, operating_profile, financials, financials_updated_at")
            .eq("id", clientId)
            .maybeSingle()
            .then((retry) => applyRow((retry.data as Record<string, unknown> | null) ?? null));
        }
        applyRow((data as Record<string, unknown> | null) ?? null);
      });
  }, [clientId, reloadToken, initialBankDraft, market.timezone]);

  useEffect(() => {
    if (!clientId || !loaded) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    const t = setTimeout(async () => {
      const markers = xeroCashMarkers.current;
      const linesUntouched =
        markers.linesSource != null &&
        JSON.stringify({ revenue, expenses, other }) === markers.linesKey;
      const payload = {
        ...(loadedCashflowRef.current ?? {}),
        startDate,
        openingBalance,
        revenue,
        expenses,
        other,
        ...baseCashflow({}),
        ...(markers.openingSource && openingBalance === markers.openingBalance
          ? { openingBalanceSource: markers.openingSource }
          : {}),
        ...(linesUntouched && markers.linesSource
          ? {
              forecastLinesSource: markers.linesSource,
              ...(xeroBankNoteRef.current ? { forecastLinesNote: xeroBankNoteRef.current } : {}),
            }
          : plEstimateRef.current
            ? {
                forecastLinesSource: "pl-estimate" as const,
                forecastLinesNote: "Estimated from the P&L",
              }
            : {}),
      };
      const forecastUpdatedAt = new Date().toISOString();
      const assessed = assessClientMetrics({
        financials: inputFinancials,
        cashflow: payload,
        timeZone: market.timezone,
        fyStartMonth: inputProfile?.fyStartMonth ?? market.fyStartMonthDefault,
      });
      const { error } = await supabase
        .from("clients")
        .update({
          cashflow: payload as never,
          last_forecast_at: forecastUpdatedAt,
          cash_runway_weeks: persistedRunwayWeeks(assessed.runway),
        })
        .eq("id", clientId);
      if (error) toast.error(`Cash forecast save failed: ${error.message}`);
      else {
        setLastForecastAt(forecastUpdatedAt);
        loadedCashflowRef.current = payload;
      }
    }, 800);
    return () => clearTimeout(t);
  }, [
    clientId,
    loaded,
    startDate,
    openingBalance,
    revenue,
    expenses,
    other,
    inputFinancials,
    inputHasBankDraft,
    market.timezone,
  ]);

  const weekIsos = useMemo(() => weekDatesFrom(startDate, WEEKS), [startDate]);

  const weeks = useMemo(
    () => weekIsos.map((iso) => formatCalendarDay(iso, market, WEEK_DAY_LABEL)),
    [weekIsos, market],
  );
  // Same formatter as the week axis, so the start cannot read as an ISO date
  // beside a timezone-shifted week label. The forecast week stays on that
  // axis. Opening cash that came from a balance sheet is labelled with the
  // statement date (cashAsOf), not the Monday the 13 weeks begin.
  const startLabel = weeks[0] ?? formatCalendarDay(startDate, market, WEEK_DAY_LABEL);
  const openingAsOf = balanceSheetCashAsOf(inputFinancials, parseFloat(openingBalance) || 0);
  const openingLabel = openingAsOf
    ? formatCalendarDay(openingAsOf, market, WEEK_DAY_LABEL)
    : startLabel;

  const horizonLabel =
    weekIsos.length >= WEEKS
      ? `${formatCalendarDay(weekIsos[0]!, market, { day: "numeric", month: "short", year: "numeric" })} – ${formatCalendarDay(weekIsos[WEEKS - 1]!, market, { day: "numeric", month: "short", year: "numeric" })}`
      : "";

  const computeScenario = (opts: {
    rMul: number;
    eMul: number;
    shift: number;
    headcountDelta: number;
    avgSalary: number;
    fixedCostDelta: number;
    revGrowthPct: number;
    capexAmount: number;
    capexWeek: number;
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
      id: l.id,
      bucket: "revenue" as const,
      name: l.name,
      vals: applyWeekOverrides(
        shiftVals(distribute(l).map((v) => v * opts.rMul)).map((v, i) => v * growthMul(i)),
        l.weekOverrides,
      ),
    }));
    const mapExp = (l: LineItem, bucket: "expenses" | "other") => ({
      id: l.id,
      bucket,
      name: l.name,
      vals: applyWeekOverrides(
        distribute(l).map((v) => v * opts.eMul),
        l.weekOverrides,
      ),
    });
    const expRows = [
      ...expenses.map((l) => mapExp(l, "expenses")),
      ...other.map((l) => mapExp(l, "other")),
    ];
    const headcountWeekly = (opts.headcountDelta * opts.avgSalary) / 4.33;
    const fixedWeekly = opts.fixedCostDelta / 4.33;
    const scenarioRows: Array<{
      id?: string;
      bucket?: "expenses" | "other";
      name: string;
      vals: number[];
    }> = [];
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

  const calc = useMemo(
    () =>
      computeScenario({
        rMul: revAdj / 100,
        eMul: expAdj / 100,
        shift: collectDelay,
        headcountDelta,
        avgSalary: parseFloat(avgSalary) || 0,
        fixedCostDelta: parseFloat(fixedCostDelta) || 0,
        revGrowthPct,
        capexAmount: parseFloat(capexAmount) || 0,
        capexWeek,
      }),
    [
      revenue,
      expenses,
      other,
      openingBalance,
      revAdj,
      expAdj,
      collectDelay,
      headcountDelta,
      avgSalary,
      fixedCostDelta,
      revGrowthPct,
      capexAmount,
      capexWeek,
    ],
  );

  const commitWeekOverride = (
    bucket: "revenue" | "expenses" | "other",
    id: string,
    weekIndex: number,
    value: number | null,
  ) => {
    const patch = (list: LineItem[]) =>
      list.map((l) =>
        l.id === id
          ? { ...l, weekOverrides: setWeekOverride(l.weekOverrides, weekIndex, value) }
          : l,
      );
    if (bucket === "revenue") setRevenue(patch);
    else if (bucket === "expenses") setExpenses(patch);
    else setOther(patch);
  };

  const baseCalc = useMemo(
    () =>
      computeScenario({
        rMul: 1,
        eMul: 1,
        shift: 0,
        headcountDelta: 0,
        avgSalary: 0,
        fixedCostDelta: 0,
        revGrowthPct: 0,
        capexAmount: 0,
        capexWeek: 1,
      }),
    [revenue, expenses, other, openingBalance],
  );

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

  const publishedLowest = forecastLowestPoint(baseCalc.opening, baseCalc.closing);
  const lowestBal = publishedLowest.amount;
  const lowestWeek = publishedLowest.week;
  const closingW13 = calc.closing[WEEKS - 1];
  const trajectory = closingW13 - calc.opening;
  const screenRunway = useMemo(
    () =>
      runwayFromOpening(openingBalance, inputFinancials, {
        hasBankCashflow: publishedBankEvidence,
      }),
    [openingBalance, inputFinancials, publishedBankEvidence],
  );
  const minimumCash = useMemo(
    () => forecastMinimumCash({ weeklyOutflows: baseCalc.outflow }),
    [baseCalc.outflow],
  );
  const hasWeeklyOutflows = baseCalc.outflow.some((n) => n > 0);
  const liveFloorLabel = hasWeeklyOutflows
    ? `${fmtCompact(minimumCash)} · about 4 weeks of outflows`
    : null;
  const linesMatchLoaded =
    xeroCashMarkers.current.linesKey != null &&
    JSON.stringify({ revenue, expenses, other }) === xeroCashMarkers.current.linesKey;
  const shownLineSource = linesMatchLoaded ? linesSourceChip : null;
  const scenarioActive =
    revAdj !== 100 ||
    expAdj !== 100 ||
    collectDelay !== 0 ||
    headcountDelta !== 0 ||
    (parseFloat(fixedCostDelta) || 0) !== 0 ||
    revGrowthPct !== 0 ||
    (parseFloat(capexAmount) || 0) !== 0;

  const chartData = weeks.map((w, i) => ({
    week: `W${i + 1}`,
    label: w,
    closing: Math.round(baseCalc.closing[i]),
  }));

  /**
   * Professional PDF export — the base forecast, same series as Overview.
   * A scenario open on screen is labelled there and is not written into the PDF.
   */
  const exportPDF = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const loadPdf = () =>
        Promise.all([import("@react-pdf/renderer"), import("@/reports/cash-forecast")]);
      let pdfModules: Awaited<ReturnType<typeof loadPdf>>;
      try {
        pdfModules = await loadPdf();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/Failed to fetch dynamically imported module/i.test(message)) throw err;
        pdfModules = await loadPdf();
      }
      const [{ pdf }, { CashForecastPDF }] = pdfModules;

      const derivedRunway = screenRunway.weeks ?? 0;
      const forecastWeeks = weeks.map((_, i) => ({
        period_label: `Week ${i + 1}`,
        opening_balance: Math.round(i === 0 ? baseCalc.opening : baseCalc.closing[i - 1]),
        total_receipts: Math.round(baseCalc.inflow[i]),
        total_payments: Math.round(baseCalc.outflow[i]),
        net_movement: Math.round(baseCalc.net[i]),
        closing_balance: Math.round(baseCalc.closing[i]),
        scenario: "moderate" as const,
        runway_weeks: Math.max(0, derivedRunway - i),
      }));

      const baseInflow = baseCalc.inflow.reduce((sum, n) => sum + n, 0);
      const baseOutflow = baseCalc.outflow.reduce((sum, n) => sum + n, 0);
      const publishedDirection = runwayFromForecastNet({
        base: screenRunway,
        opening: baseCalc.opening,
        totalInflow: baseInflow,
        totalOutflow: baseOutflow,
      });
      const publishedGenerative =
        publishedDirection.kind === "cash_generative" &&
        forecastIsCashGenerative(baseInflow, baseOutflow);

      const assumptions = [
        `Forecast starts ${startLabel} with an opening bank balance of ${fmtR(baseCalc.opening)}${openingSourceChip ? ` (${openingSourceChip})` : ""}.`,
        "Revenue and expenses are the amounts entered, with no scenario adjustment.",
        "Customer collections land in the week they are invoiced.",
        "Collection delay in weeks is what shifts receipts. Days AR and Days AP are Ratios figures and are not applied.",
        ...(scenarioActive
          ? ["A scenario is open on screen. This PDF is the base forecast and does not include it."]
          : []),
      ];

      const period =
        horizonLabel || date(new Date(), { month: "long", year: "numeric" });
      const name = clientName?.trim() || "Your Business";

      const blob = await pdf(
        CashForecastPDF({
          smeData: { name, period },
          cashForecast: forecastWeeks,
          scenario: "base",
          accountantProfile: profile,
          market,
          minimumThreshold: minimumCash,
          runwayLabel: runwayDisplayLabel(publishedDirection),
          cashGenerative: publishedGenerative,
          assumptions,
          reviewSignoff: stampFromSignoff(forecastSignoff, forecastStale),
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
        const logged = await recordDelivery({
          clientId,
          firmId,
          channel: "pdf_download",
          kind: "report_pdf",
          reportKey: "forecast",
          snapshotId: snapId,
          figuresHash: hashFigures({
            opening: baseCalc.opening,
            closings: baseCalc.closing,
            runway: derivedRunway,
            threshold: minimumCash,
          }),
          periodLabel: period,
          createdBy: user.id,
          pdfBlob: blob,
        });
        warnIfDeliveryFailed(logged.error);
        warnIfPdfArchiveFailed(logged.pdfError);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Failed to fetch dynamically imported module/i.test(message)) {
        setExportError("This page is out of date. Reload to export the PDF.");
      } else {
        setExportError(`PDF export failed: ${message}`);
        toast.error(`PDF export failed: ${message}`);
      }
    } finally {
      setExporting(false);
    }
  };

  // ── Shared hero chart ──────────────────────────────────────────────────────
  const heroChart = (height: number) => (
    <div style={{ height }} className="w-full min-w-0 max-w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="cfGoldFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={GOLD} stopOpacity={0.35} />
              <stop offset="100%" stopColor={GOLD} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
          <XAxis
            dataKey="week"
            stroke="#94a3b8"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            interval={0}
            height={28}
          />
          <YAxis
            stroke="#94a3b8"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatMoneyChartTick(v, market)}
            width={68}
            tick={{ fill: "#94a3b8", fontSize: 10 }}
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
            formatter={(v: number) => [fmtR(v), "Closing"]}
            labelFormatter={(l, payload) => {
              const p = payload?.[0]?.payload as { label?: string } | undefined;
              return p?.label ? `${l} · ${p.label}` : String(l);
            }}
          />
          <ReferenceLine y={0} stroke={RED} strokeDasharray="3 3" strokeOpacity={0.7} />
          <ReferenceLine
            y={minimumCash}
            stroke={GOLD}
            strokeDasharray="4 4"
            strokeOpacity={0.85}
          />
          <Area
            type="monotone"
            dataKey="closing"
            name="closing"
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

  const totalInflow = calc.inflow.reduce((sum, n) => sum + n, 0);
  const totalOutflow = calc.outflow.reduce((sum, n) => sum + n, 0);
  const baseInflow = baseCalc.inflow.reduce((sum, n) => sum + n, 0);
  const baseOutflow = baseCalc.outflow.reduce((sum, n) => sum + n, 0);
  const publishedDirection = runwayFromForecastNet({
    base: screenRunway,
    opening: baseCalc.opening,
    totalInflow: baseInflow,
    totalOutflow: baseOutflow,
  });
  const publishedGenerative =
    publishedDirection.kind === "cash_generative" &&
    forecastIsCashGenerative(baseInflow, baseOutflow);
  const publishedStory = forecastRunwayHeadlineShared({
    opening: baseCalc.opening,
    closings: baseCalc.closing,
    floor: minimumCash,
    runwayLabel: runwayDisplayLabel(publishedDirection),
    cashGenerative: publishedGenerative,
  });
  const lowestUnderFloor = lowestBal < minimumCash;
  const direction = runwayFromForecastNet({
    base: screenRunway,
    opening: calc.opening,
    totalInflow,
    totalOutflow,
  });
  const seriesCashGenerative =
    direction.kind === "cash_generative" && forecastIsCashGenerative(totalInflow, totalOutflow);
  const scenarioLabel = forecastScenarioLabel({
    collectDelay,
    revAdj,
    expAdj,
    headcountDelta,
    capexAmount: parseFloat(capexAmount) || 0,
    fixedCostDelta: parseFloat(fixedCostDelta) || 0,
    revGrowthPct,
  });
  const shortfall = lowestBal < 0;
  const timingDriver =
    collectDelay > 0 ||
    (parseFloat(capexAmount) || 0) > 0 ||
    headcountDelta !== 0 ||
    (parseFloat(fixedCostDelta) || 0) !== 0;
  const showShortfall = shortfall && (!seriesCashGenerative || timingDriver);
  const shortfallExplain = showShortfall && timingDriver
    ? [
        collectDelay > 0 ? `collections delayed ${collectDelay} weeks` : null,
        (parseFloat(capexAmount) || 0) > 0 ? `capex in week ${capexWeek}` : null,
        headcountDelta !== 0 ? `headcount change of ${headcountDelta}` : null,
        (parseFloat(fixedCostDelta) || 0) !== 0 ? "a fixed-cost change" : null,
      ]
        .filter(Boolean)
        .join("; ")
    : null;
  const forecastStale = signoffStale ?? computeIsStale(forecastSignoff, lastForecastAt);
  // No forecast lines yet. A flat $0 trajectory must not be badged "In the black",
  // even when a hand-entered opening balance is already on the file.
  const linesBlank = [...revenue, ...expenses, ...other].every((l) => !(parseFloat(l.amount) || 0));
  const balanceSheetHold =
    isQboBalanceSheetHoldNote(xeroBankNote) && (parseFloat(openingBalance) || 0) !== 0;
  const forecastEmpty = loaded && linesBlank && !plEstimateRef.current && !balanceSheetHold;
  const emptyPresentation = cashEmptyPresentation({
    opening: parseFloat(openingBalance) || 0,
    linesBlank,
  });

  const forecastNotes =
    !forecastEmpty && (shortfallExplain || forecastCycleNote) ? (
      <p className="mb-4 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
        {shortfallExplain ? `Timing: ${shortfallExplain}. ` : ""}
        {forecastCycleNote}
      </p>
    ) : null;

  const bankDisagree = plBankDisagreement({
    financials: inputFinancials,
    cashflow: bankSeeded
      ? { revenue, expenses, other, seededFromBanksAt: "published" }
      : null,
  });
  const disagreeNotice = bankDisagree ? (
    <PlBankDisagreeNotice disagreement={bankDisagree} market={market} />
  ) : null;

  const emptyNotice = forecastEmpty ? (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d4a550]/40 bg-[#d4a550]/10 px-4 py-3 text-sm text-slate-800 dark:text-slate-100">
      <span>
        Nothing is forecast yet. This needs a bank statement or forecast inputs — the figures
        below stay at {cur}0 until then. Upload bank statements, or set the line items in
        Forecast Setup.
      </span>
    </div>
  ) : null;

  const configureInputs = (
    <DeliverableInputConfig
      className="mb-5"
      clientId={clientId}
      deliverableId="cash"
      context={{
        financials: inputFinancials,
        operatingProfile: inputProfile,
        bankAccounts: inputBankAccounts,
        hasBankDraft: inputHasBankDraft,
        hasCashLines: !forecastEmpty,
        budgetWc: inputBudgetWc,
        collectDelay,
        revGrowthPct,
        openingBalance,
        cashLineSource: shownLineSource as
          | "Statement"
          | "Bank"
          | "Sync"
          | "Manual"
          | "Estimate"
          | null,
        liveFloorLabel,
      }}
      onEngineBoundChange={(patch) => {
        if (typeof patch.collectDelay === "number") {
          setCollectDelay(Math.max(0, Math.min(6, Math.round(patch.collectDelay))));
        }
        if (typeof patch.revGrowthPct === "number") {
          setRevGrowthPct(patch.revGrowthPct);
        }
      }}
    />
  );

  const answerSentence =
    !loaded || forecastEmpty
      ? null
      : forecastStatusSentence({
          opening: baseCalc.opening,
          closings: baseCalc.closing,
          floor: minimumCash,
          floorText: fmtCompact(minimumCash),
          runwayLabel: runwayDisplayLabel(publishedDirection),
          cashGenerative: publishedGenerative,
        });
  const stripChip = !loaded ? null : shownLineSource === "Bank" ? "Bank" : statementChip?.trim() || null;

  const answerStrip = (
    <section className="answer-strip" data-answer-strip>
      <div className="answer-strip__lead">
        <h2 className="answer-strip__heading">13-week cash forecast</h2>
        {!loaded ? (
          <p className="answer-strip__sentence" data-answer-sentence aria-busy="true">
            <span className="inline-block h-4 w-72 max-w-full animate-pulse rounded bg-slate-200/80 dark:bg-slate-800" />
          </p>
        ) : answerSentence ? (
          <p className="answer-strip__sentence" data-answer-sentence>
            {answerSentence}
          </p>
        ) : null}
      </div>
      <div className="answer-strip__actions">
        {canSign && clientId ? (
          <ReviewSignoffButton
            hideStatus
            clientId={clientId}
            clientName={clientName}
            scope="cash_forecast"
            signoff={forecastSignoff}
            isStale={forecastStale}
            onChange={patchForecastSignoff}
          />
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="answer-strip__secondary"
          onClick={() => setShowBankUpload(true)}
        >
          Upload bank statements
        </Button>
        <button
          type="button"
          className="answer-strip__icon"
          aria-label="Export PDF"
          title="Export PDF"
          disabled={exporting}
          onClick={exportPDF}
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="answer-strip__meta">
        {stripChip ? (
          <span className="answer-strip__chip" data-source-chip>
            {stripChip}
          </span>
        ) : null}
        <SignoffStatusChip
          clientId={clientId}
          scope="cash_forecast"
          signoff={forecastSignoff}
          isStale={forecastStale}
        />
      </div>
    </section>
  );

  const reviewInputs = (
    <ReviewInputsDrawer hint="Inputs, what-ifs">
      <CollapsibleGoldCard
        icon={Settings2}
        title="Inputs"
        subtitle="Only collection delay and weekly growth change this forecast; other rows are kept as notes."
      >
        {openingSourceChip ? (
          <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
            Opening balance source: {openingSourceChip}
          </p>
        ) : null}
        {configureInputs}
      </CollapsibleGoldCard>

      {/* Scenario sliders */}
      <CollapsibleGoldCard
        id="wizard-cash-scenario"
        icon={SlidersHorizontal}
        title="Try a what-if"
        subtitle="See what happens if revenue drops or customers pay later. Nothing here is saved as the base."
        defaultOpen={false}
        headerRight={
          scenarioActive ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[10px] text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              onClick={(e) => {
                e.stopPropagation();
                setRevAdj(100);
                setExpAdj(100);
                setCollectDelay(0);
                setHeadcountDelta(0);
                setAvgSalary("0");
                setFixedCostDelta("0");
                setRevGrowthPct(0);
                setCapexAmount("0");
                setCapexWeek(1);
              }}
            >
              Reset to base
            </Button>
          ) : undefined
        }
      >
        {scenarioActive ? (
          <p className="mb-4 text-sm text-slate-700 dark:text-slate-300">
            {scenarioLabel}. Week 13 would close at {fmtCompact(closingW13)}, against{" "}
            {fmtCompact(baseCalc.closing[WEEKS - 1])} on the base. The chart and the signed
            forecast stay on the base until you choose Reset to base.
          </p>
        ) : (
          <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
            The figures above are the base forecast. These sliders stay on this page and are not
            saved.
          </p>
        )}
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
            <Slider
              value={[revAdj]}
              min={50}
              max={150}
              step={5}
              onValueChange={(v) => setRevAdj(v[0])}
            />
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
            <Slider
              value={[expAdj]}
              min={50}
              max={150}
              step={5}
              onValueChange={(v) => setExpAdj(v[0])}
            />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <Label className={LABEL_CLS}>Collection delay</Label>
              <span
                className={`font-bold ${collectDelay > 0 ? "text-[#c0392b] dark:text-[#ef6b6b]" : "text-slate-700 dark:text-slate-200"}`}
              >
                +{collectDelay}w
              </span>
            </div>
            <Slider
              value={[collectDelay]}
              min={0}
              max={6}
              step={1}
              onValueChange={(v) => setCollectDelay(v[0])}
            />
          </div>
          <div className="mt-2 grid gap-5 border-t border-amber-900/10 pt-4 dark:border-slate-800 md:col-span-3 md:grid-cols-3">
            <div>
              <Label className={LABEL_CLS}>Headcount Δ (people)</Label>
              <div className="mt-1 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-8 p-0"
                  onClick={() => setHeadcountDelta(headcountDelta - 1)}
                >
                  −
                </Button>
                <Input
                  type="number"
                  value={headcountDelta}
                  onChange={(e) => setHeadcountDelta(parseInt(e.target.value) || 0)}
                  className={`${INPUT_CLS} text-center`}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-8 p-0"
                  onClick={() => setHeadcountDelta(headcountDelta + 1)}
                >
                  +
                </Button>
              </div>
              <Label className={`mt-2 block ${LABEL_CLS}`}>Avg monthly salary ({cur})</Label>
              <Input
                type="number"
                value={avgSalary}
                onChange={(e) => setAvgSalary(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <Label className={LABEL_CLS}>Fixed cost Δ (monthly {cur}, +/-)</Label>
              <Input
                type="number"
                value={fixedCostDelta}
                onChange={(e) => setFixedCostDelta(e.target.value)}
                className={INPUT_CLS}
              />
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
                  {revGrowthPct > 0 ? "+" : ""}
                  {revGrowthPct}%
                </span>
              </div>
              <Slider
                value={[revGrowthPct]}
                min={-10}
                max={10}
                step={0.5}
                onValueChange={(v) => setRevGrowthPct(v[0])}
              />
            </div>
            <div>
              <Label className={LABEL_CLS}>One-off capex ({cur})</Label>
              <Input
                type="number"
                value={capexAmount}
                onChange={(e) => setCapexAmount(e.target.value)}
                className={INPUT_CLS}
              />
              <Label className={`mt-2 block ${LABEL_CLS}`}>In week #</Label>
              <Input
                type="number"
                min={1}
                max={WEEKS}
                value={capexWeek}
                onChange={(e) => setCapexWeek(parseInt(e.target.value) || 1)}
                className={INPUT_CLS}
              />
            </div>
          </div>
        </div>
      </CollapsibleGoldCard>

    </ReviewInputsDrawer>
  );

  // ── Simplified mode: glanceable hero ─────────────────────────────────────
  if (simplified) {
    return (
      <div className="space-y-0">
        {answerStrip}
        {reviewInputs}
        <Card id="wizard-cash-outlook" className={CARD_SHELL}>
          <div className={GOLD_RULE} />
          <CardContent className="pt-5">
            {scenarioLabel ? (
              <p className="mb-3 text-[11px] font-semibold text-[#b8860b]">{scenarioLabel}</p>
            ) : null}
            {xeroBankNote ? (
              <p
                id="xero-bank-forecast-note"
                className="mb-3 max-w-xl text-xs text-slate-600 dark:text-slate-400"
              >
                {xeroBankNote}
              </p>
            ) : null}
            {disagreeNotice}
            {emptyNotice}
            {forecastNotes}
            <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {!loaded ? (
                <CashTileSkeletons count={4} />
              ) : (
              <>
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
                value={emptyPresentation.lowestBlank ? "—" : fmtCompact(lowestBal)}
                tone={emptyPresentation.lowestBlank ? "neutral" : lowestUnderFloor ? "bad" : "good"}
                sub={
                  emptyPresentation.lowestBlank
                    ? "Add an opening balance"
                    : publishedLowest.isOpening
                      ? "Opening balance"
                      : `Week ${lowestWeek} · ${weeks[lowestWeek - 1]}`
                }
              />
              <Stat
                label="Cash runway"
                value={forecastEmpty ? "—" : publishedStory.headline}
                tone={
                  forecastEmpty
                    ? "neutral"
                    : publishedStory.note === "above the floor"
                      ? "good"
                      : "bad"
                }
                sub={forecastEmpty ? "Add a bank balance or lines" : publishedStory.note}
              />
              <Stat
                label="Net cash · next 4 weeks"
                value={fmtCompact(calc.net.slice(0, 4).reduce((a, b) => a + b, 0))}
                tone={calc.net.slice(0, 4).reduce((a, b) => a + b, 0) < 0 ? "bad" : "good"}
                sub="Inflows minus outflows"
              />
              </>
              )}
            </div>
            {emptyPresentation.showChart ? (
              heroChart(180)
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300/80 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                The 13-week chart appears once a forecast line is entered.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Complex mode ──────────────────────────────────────────────────────────
  return (
    <div id="wizard-cash-outlook" className="space-y-5">
      {answerStrip}
      {reviewInputs}
      {/* Hero: summary + chart */}
      <Card className={CARD_SHELL}>
        <div className={GOLD_RULE} />
        <CardContent className="pt-5">
          {scenarioLabel ? (
            <p className="mb-3 text-[11px] font-semibold text-[#b8860b]">{scenarioLabel}</p>
          ) : null}
          {disagreeNotice}
          {emptyNotice}
          {forecastNotes}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {!loaded ? (
              <CashTileSkeletons count={3} />
            ) : (
            <>
            <Stat
              label="Opening bank"
              value={fmtCompact(baseCalc.opening)}
              sub={openingLabel}
            />
            <Stat
              label="Lowest point"
              value={emptyPresentation.lowestBlank ? "—" : fmtCompact(lowestBal)}
              tone={emptyPresentation.lowestBlank ? "neutral" : lowestUnderFloor ? "bad" : "good"}
              sub={
                emptyPresentation.lowestBlank
                  ? "Add an opening balance"
                  : publishedLowest.isOpening
                    ? `Opening · ${lowestUnderFloor ? fmtCompact(minimumCash - lowestBal) + " under the floor" : fmtCompact(lowestBal - minimumCash) + " above the floor"}`
                    : `Week ${lowestWeek} · ${lowestUnderFloor ? fmtCompact(minimumCash - lowestBal) + " under the floor" : fmtCompact(lowestBal - minimumCash) + " above the floor"}`
              }
            />
            <Stat
              label="Runway"
              value={forecastEmpty ? "—" : publishedStory.headline}
              tone={forecastEmpty ? "neutral" : publishedStory.note === "above the floor" ? "good" : "bad"}
              sub={forecastEmpty ? "Add a bank balance or lines" : publishedStory.note}
            />
            </>
            )}
          </div>
          {exportError ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e05c5c]/50 bg-[#e05c5c]/10 px-4 py-3 text-sm text-[#c0392b] dark:text-[#ef6b6b]">
              <span>{exportError}</span>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => window.location.reload()}
              >
                Reload
              </Button>
            </div>
          ) : null}
          {emptyPresentation.showChart ? (
            <>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className={LABEL_CLS}>Closing balance</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  Gold line is the {fmtCompact(minimumCash)} floor
                </div>
              </div>
              {heroChart(240)}
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300/80 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              The 13-week chart appears once a forecast line is entered.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Weekly forecast table */}
      <CollapsibleGoldCard
        id="wizard-cash-table"
        icon={Table2}
        title="Detailed cashflow forecast"
        subtitle="Double-click a figure to edit · red = shortfall, act early"
      >
        <ScrollableTable hint="Swipe sideways to see weeks →">
          <table className="milon-data-table w-full min-w-[1180px] text-xs">
            <thead>
              <tr className="border-b border-amber-900/15 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="sticky left-0 z-10 whitespace-nowrap bg-[#fdfaf3] px-2 py-2 text-left dark:bg-[#101827]">
                  Item
                </th>
                {weeks.map((w, i) => (
                  <th key={i} className="whitespace-nowrap px-2 py-2 text-right">
                    W{i + 1}
                    <div className="text-[9px] font-normal text-slate-400 dark:text-slate-500">
                      {w}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {baseCalc.revRows.filter((r) => r.vals.some((v) => v)).map((r, i) => (
                <tr
                  key={`r${i}`}
                  className="border-b border-amber-900/10 text-slate-700 dark:border-slate-800 dark:text-slate-300"
                >
                  <td className="sticky left-0 bg-[#fdfaf3] px-2 py-1 dark:bg-[#101827]">
                    {r.name}
                  </td>
                  {r.vals.map((v, j) => (
                    <td key={j} className="px-2 py-1 text-right">
                      <ForecastAmountCell
                        symbol={cur}
                        value={v}
                        display={v ? fmtR(v) : "—"}
                        onCommit={(next) => commitWeekOverride("revenue", r.id, j, next)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-b border-amber-900/15 bg-[#4caf82]/10 font-semibold text-[#3f9c72] dark:border-slate-700 dark:text-[#5cc492]">
                <td className="sticky left-0 bg-[#f2f8f2] px-2 py-1 dark:bg-[#0e1a20]">
                  Total inflow
                </td>
                {baseCalc.inflow.map((v, j) => (
                  <td key={j} className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                    {v ? fmtR(v) : "—"}
                  </td>
                ))}
              </tr>
              {baseCalc.expRows.filter((r) => r.vals.some((v) => v)).map((r, i) => (
                <tr
                  key={`e${i}`}
                  className="border-b border-amber-900/10 text-slate-700 dark:border-slate-800 dark:text-slate-300"
                >
                  <td className="sticky left-0 bg-[#fdfaf3] px-2 py-1 dark:bg-[#101827]">
                    {r.name}
                  </td>
                  {r.vals.map((v, j) => (
                    <td key={j} className="px-2 py-1 text-right">
                      {"id" in r && r.id ? (
                        <ForecastAmountCell
                          symbol={cur}
                          value={v}
                          display={v ? `(${fmtR(v)})` : "—"}
                          onCommit={(next) => {
                            if (r.bucket && r.id) commitWeekOverride(r.bucket, r.id, j, next);
                          }}
                        />
                      ) : v ? (
                        `(${fmtR(v)})`
                      ) : (
                        "—"
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-b border-amber-900/15 bg-[#e05c5c]/10 font-semibold text-[#c0392b] dark:border-slate-700 dark:text-[#ef6b6b]">
                <td className="sticky left-0 bg-[#faf1f0] px-2 py-1 dark:bg-[#1a1216]">
                  Total outflow
                </td>
                {baseCalc.outflow.map((v, j) => (
                  <td key={j} className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                    {v ? `(${fmtR(v)})` : "—"}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-amber-900/15 font-semibold text-slate-900 dark:border-slate-700 dark:text-slate-100">
                <td className="sticky left-0 bg-[#fdfaf3] px-2 py-1 dark:bg-[#101827]">Net cash</td>
                {baseCalc.net.map((v, j) => (
                  <td
                    key={j}
                    className={`px-2 py-1 text-right ${v < 0 ? "text-[#c0392b] dark:text-[#ef6b6b]" : "text-[#3f9c72] dark:text-[#5cc492]"}`}
                  >
                    {fmtR(v)}
                  </td>
                ))}
              </tr>
              <tr className="bg-[#d4a550]/15 font-bold text-slate-950 dark:text-white">
                <td className="sticky left-0 bg-[#f7efdd] px-2 py-1 dark:bg-[#1c1a12]">
                  Closing balance
                </td>
                {baseCalc.closing.map((v, j) => (
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
        </ScrollableTable>
      </CollapsibleGoldCard>

      {/* Setup + inputs */}
      <CollapsibleGoldCard
        id="wizard-cash-setup"
        icon={Settings2}
        title="Forecast Setup"
        subtitle="Start date and opening balance"
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
            <Label className={LABEL_CLS}>Opening bank balance ({cur})</Label>
            <Input
              type="number"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
          {xeroBankNote ? (
            <p
              id="xero-bank-forecast-note"
              className="text-xs text-slate-600 md:col-span-2 dark:text-slate-400"
            >
              {xeroBankNote}
            </p>
          ) : null}
        </div>
      </CollapsibleGoldCard>

      <CollapsibleGoldCard
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
                onRemove={
                  revenue.length > 1
                    ? () => setRevenue(revenue.filter((_, x) => x !== i))
                    : undefined
                }
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
                onRemove={
                  other.length > 1 ? () => setOther(other.filter((_, x) => x !== i)) : undefined
                }
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
      </CollapsibleGoldCard>

      <CashFromBanksDrafter
        open={showBankUpload}
        onClose={() => {
          setShowBankUpload(false);
          onPendingBankFileConsumed?.();
        }}
        initialFile={pendingBankFile}
        existingCashflow={existingCashflowForBanks}
        currentOpening={
          bankSeeded
            ? openingCashToConfirm(openingBalance, null)
            : openingCashToConfirm(openingBalance, inputFinancials?.cash)
        }
        initialDraft={initialBankDraft}
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
