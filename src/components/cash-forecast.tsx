import { useState, useMemo, useEffect, useRef, useCallback, useId, type ReactNode } from "react";
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
  CalendarDays,
  Download,
  LineChart,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  TrendingUp,
  TrendingDown,
  Settings2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { EnlargeButton, EnlargeSheet } from "@/components/enlarge-sheet";
import { cashExplainerCopy, humanizeIsoDates } from "@/lib/cash-explainer";
import { Slider } from "@/components/ui/slider";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Line,
  ReferenceDot,
  ReferenceLine,
} from "recharts";
import { DEFAULT_PROFILE, useOptionalAccountantProfile } from "@/contexts/accountant-profile";
import { useAuth } from "@/hooks/use-auth";
import { useServerFn } from "@tanstack/react-start";
import { useMarketFormat } from "@/contexts/market";
import { currencySymbol } from "@/lib/market";
import { listClientReviewSignoffs } from "@/lib/review-signoffs.functions";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import { OwnerSignoffMark, ownerSignoffDate } from "@/components/owner-signoff-mark";
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
import { CashThirteenWeekGrid } from "@/components/cash-thirteen-week";
import {
  CASH_FORECAST_CARD_ID,
  cashBalanceSeries,
  cashGraphAxisTicks,
  cashYDomainIncludingFloor,
  cashGraphWeekTickInterval,
  stableCashChartWidth,
  forecastChipSource,
  hashIsCashDetailAnchor,
  lowestCashPoint,
  weeksBelowFloorCopy,
} from "@/lib/cash-forecast-view";
import type {
  CashForecastPublishPayload,
  CashFromBanksDraftResult,
} from "@/lib/cash-from-banks.types";
import { interestOfRevenueSentence } from "@/lib/cash-interest-note";
import { periodMonthsOf } from "@/lib/ratios";
import { balanceSheetCashAsOf } from "@/lib/statement-parse";
import { formatCalendarDay, formatMoneyChartTick, formatMoneyCompact } from "@/lib/market/format";
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
  storedOpeningIsMissing,
  ledgerOpeningIsCashEvidence,
  persistedRunwayWeeks,
  plBankDisagreement,
  runwayDisplayLabel,
  resolveClientCash,
  resolveCashScreenForecast,
  blankForecastLines,
  weekDatesFrom,
  type ClientRunway,
} from "@/lib/client-metrics";
import {
  bankHistoryIsSingleMonth,
  forecastLineRule,
  forecastRowLabel,
  forecastRuleLabel,
  groupSmallForecastRows,
  isAssumedMonthlyLine,
} from "@/lib/cash-forecast-rows";
import {
  isProjectedOnceOff,
  projectForecastFrequency,
  recurringPayeeFrequency,
  type RecurringFrequency,
} from "@/lib/cash-recurring-payees";
import {
  cashEmptyPresentation,
  forecastFloorPosition,
  forecastLinesSourceLabel,
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
import { CashSuggestionCard } from "@/components/cash-suggestion-card";
import { OnceOffSuggestBar } from "@/components/once-off-suggest-bar";
import {
  ledgerFromOpeningSource,
  suggestCashForecast,
  suggestionsMatchConfirm,
  type CashLedger,
  type ConfirmedCashSuggestions,
  type TrailingMonthInput,
} from "@/lib/cash-forecast-suggestions";
import {
  onceOffDirty,
  onceOffLines,
  linesForSilentSave,
  silentForecastKey,
} from "@/lib/cash-once-off-save";
import {
  onceOffSaveEnabled,
  showSuggestOnceOffs,
  suggestOnceOffRows,
  type SuggestedOnceOffLine,
} from "@/lib/cash-once-off-suggest";
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

const EXPENSE_PRESETS = [
  "Cost of sales (COS)",
  "Interest",
  "Loan capital repayment",
  "Rent",
  "Salaries & wages",
];

const DEFAULT_EXPENSES: LineItem[] = EXPENSE_PRESETS.map((n) => makeLine(n));
const DEFAULT_OTHER: LineItem[] = [makeLine("Other expenses")];

function distribute(
  line: LineItem,
  side: "revenue" | "expenses" | "other",
  recurring?: ReadonlyMap<string, RecurringFrequency> | null,
  singleMonth = false,
): number[] {
  return distributeForecastLine(
    {
      ...line,
      frequency: projectForecastFrequency(line.name, line.frequency, recurring, {
        side,
        singleMonth,
      }) as LineItem["frequency"],
    },
    WEEKS,
  );
}

// ── Brand palette (matches profitability waterfall / accountant reports) ─────
const GOLD = "#0B5FFF";
const GOLD_DARK = "#2563EB";
const RED = "#e05c5c";

function useStableChartWidth() {
  const tickObserver = useRef<ResizeObserver | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const onChartFrame = useCallback((node: HTMLDivElement | null) => {
    tickObserver.current?.disconnect();
    tickObserver.current = null;
    if (!node) return;
    const apply = () => {
      const next = node.clientWidth;
      setChartWidth((current) => stableCashChartWidth(current, next));
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    tickObserver.current = observer;
  }, []);
  useEffect(() => () => tickObserver.current?.disconnect(), []);
  return { chartWidth, onChartFrame };
}

function CashNegativeDot({
  cx,
  cy,
  payload,
  lowestKey,
}: {
  cx?: number;
  cy?: number;
  payload?: { closing?: number; week?: string };
  lowestKey?: string;
}) {
  if (cx == null || cy == null || payload?.closing == null) return <g />;
  if (!(payload.closing < 0) || payload.week === lowestKey) return <g />;
  return <circle cx={cx} cy={cy} r={3.5} fill={RED} stroke="#fff" strokeWidth={1.5} />;
}

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
          className="w-[4.75rem] border-0 border-b border-[#0B5FFF] bg-transparent p-0 text-right text-xs font-inherit tabular-nums text-inherit outline-none"
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
      className="milon-forecast-amount w-full cursor-text border-0 bg-transparent p-0 text-right text-inherit decoration-[#0B5FFF]/70 decoration-dotted underline-offset-2 hover:underline"
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
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: "neutral" | "good" | "bad";
  /** Soft circular tile icon (owner premium pass). */
  icon?: LucideIcon;
}) {
  return (
    <div
      className="cash-kpi rounded-xl border border-amber-900/10 bg-white/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/50"
      data-tone={tone}
    >
      <div className="cash-kpi-body">
        <div className={`cash-kpi-label ${LABEL_CLS}`}>{label}</div>
        <div
          className={`cash-kpi-value mt-1 text-xl font-extrabold leading-tight tracking-tight whitespace-normal ${
            tone === "good"
              ? "text-[#3f9c72] dark:text-[#5cc492]"
              : tone === "bad"
                ? "text-[#c0392b] dark:text-[#ef6b6b]"
                : "text-slate-950 dark:text-white"
          }`}
        >
          {value}
        </div>
        {sub && (
          <div className="cash-kpi-sub mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {sub}
          </div>
        )}
      </div>
      {Icon ? (
        <span className="cash-kpi-ic" aria-hidden="true">
          <Icon />
        </span>
      ) : null}
    </div>
  );
}

function LineEditor({
  line,
  onChange,
  onRemove,
  tone,
  side,
  singleMonth = false,
}: {
  line: LineItem;
  onChange: (l: LineItem) => void;
  onRemove?: () => void;
  tone: "revenue" | "expense";
  side?: "revenue" | "expenses" | "other";
  singleMonth?: boolean;
}) {
  const { market } = useMarketFormat();
  const cur = currencySymbol(market);
  const accent =
    tone === "revenue" ? "border-l-[3px] border-l-[#4caf82]" : "border-l-[3px] border-l-[#e05c5c]";
  const showSplit = line.frequency === "split-weeks" || line.frequency === "split-months";
  const sideForLabel = side ?? (tone === "revenue" ? "revenue" : "expenses");
  const rule = forecastLineRule(line.name, line.frequency, { side: sideForLabel, singleMonth });
  const ruleLabel = forecastRuleLabel(rule);
  const assumed = isAssumedMonthlyLine(line.name, line.frequency, { side: sideForLabel, singleMonth });
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
        {ruleLabel ? (
          <p className="mt-1 text-[11px] text-slate-500" data-assumed-monthly={assumed ? "" : undefined} data-forecast-rule={rule}>
            {ruleLabel}
          </p>
        ) : null}
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

/** Owner forecast extras. Collapsed until the owner asks. */
export function ForecastMoreDetail({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = `cash-more-${useId().replace(/:/g, "")}`;
  return (
    <section className="cash-more-detail">
      <button
        type="button"
        className="cash-more-detail__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((next) => !next)}
      >
        More detail
      </button>
      <div id={panelId} className="cash-more-detail__panel" hidden={!open}>
        {children}
      </div>
    </section>
  );
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
  signoffKnown = true,
  onSignoffChange,
  reloadToken,
  openBankUploadToken,
  pendingBankFile = null,
  onPendingBankFileConsumed,
  onBankPublish,
  initialBankDraft = null,
  statementChip = null,
  readOnly = false,
  onInvite,
  preview = null,
  includeFloorInDomain = false,
  spacedChartTicks = false,
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
  /** False until the parent sign-off fetch has settled. */
  signoffKnown?: boolean;
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
  /** Owner door: show the forecast and sign-off, hide setup and edits. */
  readOnly?: boolean;
  /** Invite control shown when a read-only forecast has no lines yet. */
  onInvite?: () => void;
  /**
   * Read-only figures already on hand. Skips the client fetch and autosave
   * so a public sample can show the same chart without a Supabase read.
   */
  /**
   * Keep the runway floor inside the y-axis. Off on owner and accountant
   * charts, where the auto domain is unchanged.
   */
  includeFloorInDomain?: boolean;
  /**
   * Keep the R gap in abbreviated axis ticks (R 656k). Off on owner and
   * accountant charts, which stay on the unspaced tick so the label cannot wrap.
   * US abbreviations stay $656k either way.
   */
  spacedChartTicks?: boolean;
  preview?: {
    startDate: string;
    openingBalance: string;
    revenue: LineItem[];
    expenses: LineItem[];
    other: LineItem[];
    note: string | null;
    cycleNote: string | null;
    financials: Record<string, string | number | null | undefined> | null;
    /** Local preview of a one-month bank file. Real clients use the stored seed. */
    singleMonth?: boolean;
  } | null;
} = {}) {
  const accountant = useOptionalAccountantProfile();
  const profile = accountant?.profile ?? DEFAULT_PROFILE;
  const firmId = accountant?.firmId ?? null;
  const { user } = useAuth();
  const { money: fullMoney, moneyCompact: compactMoney, date, market } = useMarketFormat();
  const sign = (text: string) => (simplified ? text.replace(/^-/, "−") : text);
  const fmtR = (n: number, opts?: Parameters<typeof fullMoney>[1]) => sign(fullMoney(n, opts));
  const fmtCompact = (n: number) => sign(compactMoney(n));
  const cur = currencySymbol(market);
  const fetchReviewSignoffs = useServerFn(listClientReviewSignoffs);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [openingSourceChip, setOpeningSourceChip] = useState<string | null>(null);
  const [openingSourceKey, setOpeningSourceKey] = useState<string | null>(null);
  const [linesSourceKey, setLinesSourceKey] = useState<string | null>(null);
  const [publishedBankEvidence, setPublishedBankEvidence] = useState(false);
  const [forecastSignoff, setForecastSignoff] = useState<ClientReviewSignoff | null>(
    signoffProp ?? null,
  );
  const [lastForecastAt, setLastForecastAt] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(
    () => preview?.startDate ?? forecastAnchorDate({ now: new Date(), timeZone: market.timezone }),
  );
  const [bankSeeded, setBankSeeded] = useState(false);
  const plEstimateRef = useRef(false);
  const [openingBalance, setOpeningBalance] = useState(preview?.openingBalance ?? "0");
  const [revenue, setRevenue] = useState<LineItem[]>(preview?.revenue ?? []);
  const [expenses, setExpenses] = useState<LineItem[]>(preview?.expenses ?? DEFAULT_EXPENSES);
  const [other, setOther] = useState<LineItem[]>(preview?.other ?? DEFAULT_OTHER);
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
  const [resolvedOpening, setResolvedOpening] = useState<number | null>(null);
  const [cashLedger, setCashLedger] = useState<CashLedger>("On file");
  const [configuredFloor, setConfiguredFloor] = useState<number | null>(null);
  const [suggestionConfirm, setSuggestionConfirm] = useState<ConfirmedCashSuggestions | null>(null);
  const [trailingSnapshots, setTrailingSnapshots] = useState<TrailingMonthInput[]>([]);
  const [mounted, setMounted] = useState(false);
  const [showBankUpload, setShowBankUpload] = useState(false);
  const [inputFinancials, setInputFinancials] = useState<Record<
    string,
    string | number | null | undefined
  > | null>(preview?.financials ?? null);
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
  const savedRevenueOnceOff = useRef<LineItem[]>([]);
  const savedExpensesOnceOff = useRef<LineItem[]>([]);
  const savedOtherOnceOff = useRef<LineItem[]>([]);
  const heldRevenue = useRef<Record<string, LineItem>>({});
  const heldExpenses = useRef<Record<string, LineItem>>({});
  const heldOther = useRef<Record<string, LineItem>>({});
  const silentBaselineRef = useRef("");
  const hydrateOnceOff = useRef(false);
  const saveTicket = useRef(0);
  const [onceOffStatus, setOnceOffStatus] = useState<string | null>(null);
  const [onceOffSaving, setOnceOffSaving] = useState(false);
  const [bankHistory, setBankHistory] = useState<unknown>(initialBankDraft);
  const recurringPayees = useMemo(() => recurringPayeeFrequency(bankHistory), [bankHistory]);
  const singleMonthHistory = useMemo(
    () =>
      bankHistoryIsSingleMonth({
        seededFromBanksAt: preview?.singleMonth || bankSeeded ? "published" : null,
        bankDraft: bankHistory,
      }),
    [preview?.singleMonth, bankSeeded, bankHistory],
  );
  const [stagedOnceOffs, setStagedOnceOffs] = useState<SuggestedOnceOffLine[]>([]);
  const [linesSourceChip, setLinesSourceChip] = useState<string | null>(null);
  const [forecastCycleNote, setForecastCycleNote] = useState<string | null>(preview?.cycleNote ?? null);
  const [xeroBankNote, setXeroBankNote] = useState<string | null>(preview?.note ?? null);
  const xeroBankNoteRef = useRef<string | null>(preview?.note ?? null);
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
    setBankHistory(payload);
    setBankSeeded(true);
    plEstimateRef.current = false;
    if (xeroBankNoteRef.current === "Estimated from the P&L") {
      xeroBankNoteRef.current = null;
      setXeroBankNote(null);
    }

    savedRevenueOnceOff.current = onceOffLines(payload.revenue as LineItem[]);
    savedExpensesOnceOff.current = onceOffLines(payload.expenses as LineItem[]);
    savedOtherOnceOff.current = onceOffLines(payload.other as LineItem[]);
    silentBaselineRef.current = silentForecastKey({
      startDate: payload.startDate,
      openingBalance: payload.openingBalance,
      revenue: payload.revenue as LineItem[],
      expenses: payload.expenses as LineItem[],
      other: payload.other as LineItem[],
      savedRevenue: savedRevenueOnceOff.current,
      savedExpenses: savedExpensesOnceOff.current,
      savedOther: savedOtherOnceOff.current,
    });
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
    if (!clientId || preview) return;
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
    if (!clientId || preview) return;
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
      setResolvedOpening(resolvedCash.amount);
      setCashLedger(ledgerFromOpeningSource(cf?.openingBalanceSource));
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
      setOpeningSourceKey(
        typeof cf?.openingBalanceSource === "string" ? cf.openingBalanceSource : null,
      );
      setLinesSourceKey(typeof cf?.forecastLinesSource === "string" ? cf.forecastLinesSource : null);
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
      const outlook = resolveCashScreenForecast({
        financials: finRecord,
        cashflow: cf,
        financialsUpdatedAt: (data?.financials_updated_at as string | null | undefined) ?? null,
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
        if (cf.revenue && !blankForecastLines(cf.revenue)) setRevenue(cf.revenue);
        else if (!blankForecastLines(outlook.lines.revenue)) setRevenue(outlook.lines.revenue);
        else setRevenue([]);
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
      setBankHistory(data?.cashflow_bank_draft ?? initialBankDraft ?? null);
      const storedConfirm = (cf as { suggestionConfirm?: ConfirmedCashSuggestions } | null)?.suggestionConfirm;
      if (storedConfirm && typeof storedConfirm === "object") {
        setSuggestionConfirm(storedConfirm);
        setConfiguredFloor(typeof storedConfirm.floor === "number" && storedConfirm.floor > 0 ? storedConfirm.floor : null);
      } else {
        setSuggestionConfirm(null);
        setConfiguredFloor(null);
      }
      skipNextAutosave.current = true;
      hydrateOnceOff.current = true;
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

  if (loaded && hydrateOnceOff.current) {
    hydrateOnceOff.current = false;
    savedRevenueOnceOff.current = onceOffLines(revenue);
    savedExpensesOnceOff.current = onceOffLines(expenses);
    savedOtherOnceOff.current = onceOffLines(other);
    silentBaselineRef.current = silentForecastKey({
      startDate,
      openingBalance,
      revenue,
      expenses,
      other,
      savedRevenue: savedRevenueOnceOff.current,
      savedExpenses: savedExpensesOnceOff.current,
      savedOther: savedOtherOnceOff.current,
    });
  }
  const onceOffNeedsSave =
    onceOffDirty(revenue, savedRevenueOnceOff.current) ||
    onceOffDirty(expenses, savedExpensesOnceOff.current) ||
    onceOffDirty(other, savedOtherOnceOff.current);

  useEffect(() => {
    if (!clientId || preview) return;
    let cancelled = false;
    supabase
      .from("client_financial_snapshots")
      .select("period_date, financials")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(12)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : [];
        const next: TrailingMonthInput[] = [];
        for (const row of rows) {
          const record = row as { period_date?: unknown; financials?: unknown };
          if (typeof record.period_date !== "string" || !record.period_date) continue;
          const financials =
            record.financials && typeof record.financials === "object"
              ? (record.financials as Record<string, unknown>)
              : null;
          next.push({ periodDate: record.period_date, financials });
        }
        setTrailingSnapshots(next);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, preview, reloadToken]);

  useEffect(() => {
    if (!clientId || preview || !loaded) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    const silentRevenue = linesForSilentSave(revenue, savedRevenueOnceOff.current, heldRevenue.current);
    const silentExpenses = linesForSilentSave(expenses, savedExpensesOnceOff.current, heldExpenses.current);
    const silentOther = linesForSilentSave(other, savedOtherOnceOff.current, heldOther.current);
    const key = silentForecastKey({
      startDate,
      openingBalance,
      revenue,
      expenses,
      other,
      savedRevenue: savedRevenueOnceOff.current,
      savedExpenses: savedExpensesOnceOff.current,
      savedOther: savedOtherOnceOff.current,
      heldRevenue: heldRevenue.current,
      heldExpenses: heldExpenses.current,
      heldOther: heldOther.current,
    });
    if (key === silentBaselineRef.current) return;
    const ticket = saveTicket.current;
    const t = setTimeout(async () => {
      if (ticket !== saveTicket.current) return;
      const markers = xeroCashMarkers.current;
      const linesUntouched =
        markers.linesSource != null &&
        JSON.stringify({ revenue: silentRevenue, expenses: silentExpenses, other: silentOther }) ===
          markers.linesKey;
      const payload = {
        ...(loadedCashflowRef.current ?? {}),
        startDate,
        openingBalance,
        revenue: silentRevenue,
        expenses: silentExpenses,
        other: silentOther,
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
      if (ticket !== saveTicket.current) return;
      if (error) toast.error(`Cash forecast save failed: ${error.message}`);
      else {
        setLastForecastAt(forecastUpdatedAt);
        loadedCashflowRef.current = payload;
        silentBaselineRef.current = key;
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

  const saveOnceOff = async () => {
    if (!clientId || preview || onceOffSaving) return;
    if (!onceOffSaveEnabled({ dirty: onceOffNeedsSave, staged: stagedOnceOffs.length })) return;
    if (!onceOffNeedsSave) {
      setStagedOnceOffs([]);
      setOnceOffStatus("Saved");
      return;
    }
    const ticket = ++saveTicket.current;
    setOnceOffSaving(true);
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
    if (ticket !== saveTicket.current) return;
    setOnceOffSaving(false);
    if (error) {
      setOnceOffStatus(`Could not save: ${error.message}`);
      return;
    }
    heldRevenue.current = {};
    heldExpenses.current = {};
    heldOther.current = {};
    savedRevenueOnceOff.current = onceOffLines(revenue);
    savedExpensesOnceOff.current = onceOffLines(expenses);
    savedOtherOnceOff.current = onceOffLines(other);
    silentBaselineRef.current = silentForecastKey({
      startDate,
      openingBalance,
      revenue,
      expenses,
      other,
      savedRevenue: savedRevenueOnceOff.current,
      savedExpenses: savedExpensesOnceOff.current,
      savedOther: savedOtherOnceOff.current,
    });
    loadedCashflowRef.current = payload;
    setLastForecastAt(forecastUpdatedAt);
    setStagedOnceOffs([]);
    setOnceOffStatus("Saved");
  };

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
    const revRows = groupSmallForecastRows(
      revenue.map((l) => ({
        id: l.id,
        bucket: "revenue" as const,
        name: forecastRowLabel(l.name, l.frequency, { side: "revenue", singleMonth: singleMonthHistory }),
        onceOff: isProjectedOnceOff(l.name, l.frequency, recurringPayees, {
          side: "revenue",
          singleMonth: singleMonthHistory,
        }),
        vals: applyWeekOverrides(
          shiftVals(distribute(l, "revenue", recurringPayees, singleMonthHistory).map((v) => v * opts.rMul)).map((v, i) => v * growthMul(i)),
          l.weekOverrides,
        ),
      })),
    );
    const mapExp = (l: LineItem, bucket: "expenses" | "other") => ({
      id: l.id,
      bucket,
      name: forecastRowLabel(l.name, l.frequency, { side: bucket, singleMonth: singleMonthHistory }),
      onceOff: isProjectedOnceOff(l.name, l.frequency, recurringPayees, {
        side: bucket,
        singleMonth: singleMonthHistory,
      }),
      vals: applyWeekOverrides(
        distribute(l, bucket, recurringPayees, singleMonthHistory).map((v) => v * opts.eMul),
        l.weekOverrides,
      ),
    });
    const expRows = groupSmallForecastRows([
      ...expenses.map((l) => mapExp(l, "expenses")),
      ...other.map((l) => mapExp(l, "other")),
    ]);
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
      singleMonthHistory,
      recurringPayees,
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
    [revenue, expenses, other, openingBalance, singleMonthHistory, recurringPayees],
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
    () => forecastMinimumCash({ configured: configuredFloor, weeklyOutflows: baseCalc.outflow }),
    [baseCalc.outflow, configuredFloor],
  );
  const interestNote = interestOfRevenueSentence(inputFinancials, (amount) => fmtR(amount));
  const cashSuggestions = useMemo(
    () =>
      suggestCashForecast({
        ledger: cashLedger,
        openingCash: resolvedOpening,
        currentFinancials: inputFinancials,
        currentPeriodEnd:
          typeof inputFinancials?.periodEnd === "string" ? inputFinancials.periodEnd : null,
        trailing: trailingSnapshots,
        forecastWeeklyOutflows: baseCalc.outflow,
        forecastHasMovement:
          baseCalc.inflow.some((n) => n > 0) || baseCalc.outflow.some((n) => n > 0),
      }),
    [cashLedger, resolvedOpening, inputFinancials, trailingSnapshots, baseCalc],
  );
  const suggestionsConfirmed = suggestionsMatchConfirm(cashSuggestions.suggestions, suggestionConfirm);
  const confirmCashSuggestions = async () => {
    if (!clientId || preview || suggestionsConfirmed) return;
    const opening = cashSuggestions.suggestions.find((row) => row.key === "opening");
    const floor = cashSuggestions.suggestions.find((row) => row.key === "floor");
    const fixed = cashSuggestions.suggestions.find((row) => row.key === "fixed");
    const nextOpening = opening ? String(Math.round(opening.amount * 100) / 100) : openingBalance;
    let nextExpenses = expenses;
    if (!cashSuggestions.fixedAlreadyInForecast && fixed) {
      const line: LineItem = {
        id: "suggested-fixed-costs",
        name: "Recurring fixed costs",
        amount: String(fixed.amount),
        frequency: "recurring-monthly",
        startWeek: 1,
        splitCount: 1,
      };
      const existing = expenses.findIndex((row) => row.id === line.id);
      nextExpenses =
        existing >= 0
          ? expenses.map((row, index) => (index === existing ? { ...row, ...line } : row))
          : [...expenses, line];
    }
    const confirmed: ConfirmedCashSuggestions = {
      opening: opening?.amount ?? null,
      floor: floor?.amount ?? null,
      fixedMonthly: fixed?.amount ?? null,
      at: new Date().toISOString(),
    };
    const payload = {
      ...(loadedCashflowRef.current ?? {}),
      startDate,
      openingBalance: nextOpening,
      revenue,
      expenses: nextExpenses,
      other,
      ...baseCashflow({}),
      suggestionConfirm: confirmed,
    };
    loadedCashflowRef.current = payload;
    skipNextAutosave.current = true;
    setOpeningBalance(nextOpening);
    setExpenses(nextExpenses);
    setConfiguredFloor(floor && floor.amount > 0 ? floor.amount : configuredFloor);
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
    if (error) {
      toast.error(`Could not confirm: ${error.message}`);
      return;
    }
    heldRevenue.current = {};
    heldExpenses.current = {};
    heldOther.current = {};
    savedRevenueOnceOff.current = onceOffLines(revenue);
    savedExpensesOnceOff.current = onceOffLines(nextExpenses);
    savedOtherOnceOff.current = onceOffLines(other);
    silentBaselineRef.current = silentForecastKey({
      startDate,
      openingBalance: nextOpening,
      revenue,
      expenses: nextExpenses,
      other,
      savedRevenue: savedRevenueOnceOff.current,
      savedExpenses: savedExpensesOnceOff.current,
      savedOther: savedOtherOnceOff.current,
    });
    if (onceOffNeedsSave) setOnceOffStatus("Saved");
    setStagedOnceOffs([]);
    setSuggestionConfirm(confirmed);
    setLastForecastAt(forecastUpdatedAt);
  };
  const cashSuggestionCard = readOnly ? null : (
    <CashSuggestionCard
      model={cashSuggestions}
      confirmed={suggestionsConfirmed}
      formatAmount={fullMoney}
      canConfirm={Boolean(clientId) && !preview}
      onConfirm={() => void confirmCashSuggestions()}
    />
  );
  const stageSuggestedOnceOffs = () => {
    const markers = xeroCashMarkers.current;
    const linesMatch =
      markers.linesKey != null &&
      JSON.stringify({ revenue, expenses, other }) === markers.linesKey;
    const linesAreBank =
      linesMatch && (markers.linesSource ? forecastChipSource(markers.linesSource) === "bank_pack" : bankSeeded);
    const withSide = (list: LineItem[], side: SuggestedOnceOffLine["side"]) =>
      list.map((line) => ({ ...line, side }));
    const forecastLines = [
      ...withSide(revenue, "revenue"),
      ...withSide(expenses, "expenses"),
      ...withSide(other, "other"),
    ];
    const result = suggestOnceOffRows({
      bankDraft: bankHistory,
      existing: forecastLines,
      forecastLines,
      bankSourced: linesAreBank,
      singleMonth: singleMonthHistory,
    });
    if (!result.lines.length) {
      setStagedOnceOffs([]);
      setOnceOffStatus(result.empty);
      return;
    }
    const stagedById = new Map(result.lines.map((line) => [line.id, line]));
    const present = new Set(forecastLines.map((line) => line.id));
    const retarget = (list: LineItem[], held: { current: Record<string, LineItem> }) =>
      list.map((line) => {
        const next = stagedById.get(line.id);
        if (!next) return line;
        const sameAmount = Math.abs((parseFloat(line.amount) || 0) - (parseFloat(next.amount) || 0)) < 0.005;
        if (line.frequency === "once-off" && sameAmount && line.startWeek === next.startWeek) {
          return line;
        }
        if (!held.current[line.id]) held.current = { ...held.current, [line.id]: line };
        return {
          ...line,
          amount: next.amount,
          frequency: "once-off" as const,
          startWeek: next.startWeek,
          splitCount: 1,
        };
      });
    const add = (list: LineItem[], side: SuggestedOnceOffLine["side"]) => [
      ...retarget(list, side === "revenue" ? heldRevenue : side === "expenses" ? heldExpenses : heldOther),
      ...result.lines
        .filter((line) => line.side === side && !present.has(line.id))
        .map((line) => ({
          id: line.id,
          name: line.name,
          amount: line.amount,
          frequency: line.frequency,
          startWeek: line.startWeek,
          splitCount: line.splitCount,
        })),
    ];
    setRevenue(add(revenue, "revenue"));
    setExpenses(add(expenses, "expenses"));
    setOther(add(other, "other"));
    setStagedOnceOffs(result.lines);
    setOnceOffStatus(null);
  };
  const onceOffSaveBar =
    !clientId || preview || readOnly ? null : (
      <OnceOffSuggestBar
        showSuggest={showSuggestOnceOffs({
          suggestionCount: cashSuggestions.suggestions.length,
          lineAmounts: [...revenue, ...expenses, ...other].map((line) => parseFloat(line.amount) || 0),
        })}
        needsSave={onceOffSaveEnabled({ dirty: onceOffNeedsSave, staged: stagedOnceOffs.length })}
        saving={onceOffSaving}
        status={onceOffStatus ?? ""}
        staged={stagedOnceOffs.map((line) => ({
          id: line.id,
          name: line.name,
          amountLabel: fullMoney(parseFloat(line.amount) || 0),
        }))}
        onSuggest={stageSuggestedOnceOffs}
        onSave={() => void saveOnceOff()}
      />
    );
  const balanceSeries = cashBalanceSeries({
    opening: baseCalc.opening,
    closings: baseCalc.closing,
    floor: minimumCash,
  });
  const lowPoint = lowestCashPoint(balanceSeries);
  const lowestBal = lowPoint.balance;
  const lowestWeek = lowPoint.week;
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

  const chartData = balanceSeries.map((point) => {
    const floor = Math.round(minimumCash);
    const closing = Math.round(point.balance);
    return {
      week: point.key,
      label: point.week === 0 ? (openingAsOf ? openingLabel : "") : (weeks[point.week - 1] ?? point.key),
      closing,
      underFloor: point.belowFloor ? closing : floor,
      weekIndex: point.week,
    };
  });

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
  const heroChart = (
    height: number | string,
    chartWidth: number,
    onChartFrame: (node: HTMLDivElement | null) => void,
    enlarged = false,
  ) => {
    const narrow = cashGraphWeekTickInterval(chartWidth) === 2;
    const tickSize = enlarged ? 12 : 10;
    const axisTicks = cashGraphAxisTicks(
      chartWidth,
      chartData.map((row) => row.week),
    );
    return (
    <div
      ref={onChartFrame}
      style={{ height }}
      data-week-ticks={narrow ? "thin" : "all"}
      className="w-full min-w-0 max-w-full max-md:pb-3"
    >
      {chartWidth > 0 ? (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 22, right: narrow ? 80 : 16, left: 0, bottom: 8 }}>
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
            fontSize={tickSize}
            tickLine={false}
            axisLine={false}
            interval={0}
            ticks={axisTicks}
            height={enlarged ? 36 : 28}
          />
          <YAxis
            stroke="#94a3b8"
            fontSize={tickSize}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) =>
              sign(
                spacedChartTicks
                  ? formatMoneyCompact(v, market)
                  : formatMoneyChartTick(v, market),
              )
            }
            width={spacedChartTicks ? 84 : enlarged ? 76 : 68}
            tick={{ fill: "#94a3b8", fontSize: tickSize }}
            domain={
              includeFloorInDomain
                ? ([dataMin, dataMax]: [number, number]) =>
                    cashYDomainIncludingFloor(dataMin, dataMax, minimumCash)
                : undefined
            }
          />
          <Tooltip
            contentStyle={{
              background: "rgba(17,24,39,0.95)",
              border: "1px solid rgba(212,165,80,0.4)",
              borderRadius: 10,
              fontSize: 12,
              color: "#f1f5f9",
            }}
            labelStyle={{ color: "#0B5FFF", fontWeight: 700 }}
            formatter={(v: number, _name, item) => {
              const weekIndex = (item?.payload as { weekIndex?: number } | undefined)?.weekIndex;
              return [fmtR(v), weekIndex === 0 ? "Opening" : "Closing"];
            }}
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
            name="closing-fill"
            stroke="none"
            fill="url(#cfGoldFill)"
            tooltipType="none"
            dot={false}
            activeDot={false}
            isAnimationActive
            animationDuration={mounted ? 700 : 1100}
          />
          <Area
            type="monotone"
            dataKey="underFloor"
            className="cash-floor-breach"
            stroke="none"
            fill="rgba(224, 92, 92, 0.28)"
            baseValue={Math.round(minimumCash)}
            tooltipType="none"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="closing"
            name="Closing"
            stroke={GOLD}
            strokeWidth={2.5}
            dot={<CashNegativeDot lowestKey={lowPoint.key} />}
            activeDot={{ r: 4, fill: GOLD_DARK, stroke: "#fff", strokeWidth: 1.5 }}
            isAnimationActive={false}
          />
          {(lowPoint.belowFloor || lowPoint.negative) ? (
            <ReferenceDot
              x={lowPoint.key}
              y={Math.round(lowestBal)}
              r={5}
              fill={RED}
              stroke="#fff"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
              label={{
                value: fmtCompact(lowestBal),
                position: "top",
                fill: RED,
                fontSize: 11,
                fontWeight: 700,
              }}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
      ) : null}
    </div>
    );
  };

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

  const rollNote =
    xeroBankNote && /rolled forward|days sit between/i.test(xeroBankNote) ? xeroBankNote : null;
  const cashCopy = cashExplainerCopy({
    rangeStart: weekIsos[0] ?? null,
    rangeEnd: weekIsos.length >= WEEKS ? (weekIsos[WEEKS - 1] ?? null) : null,
    floorText: forecastEmpty ? "" : fmtCompact(minimumCash),
    anchorNote: rollNote,
    cycleNote: forecastEmpty ? null : forecastCycleNote,
    otherNote: rollNote ? null : xeroBankNote,
    timingNote: !forecastEmpty && shortfallExplain ? `Timing: ${shortfallExplain}` : null,
  });

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
    readOnly ? (
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-[15px] text-[var(--ink)]">
        <span>Your accountant sets this up</span>
        {onInvite ? (
          <button type="button" className="btn gold" onClick={onInvite}>
            Invite your accountant
          </button>
        ) : null}
      </div>
    ) : (
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#DBEAFE] bg-[#F4F8FF] px-4 py-3 text-sm text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB]">
        <span>
          Nothing is forecast yet. This needs a bank statement or forecast inputs — the figures
          below stay at {cur}0 until then. Upload bank statements, or set the line items in
          Forecast Setup.
        </span>
      </div>
    )
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

  const forecastUpdatedLabel = lastForecastAt
    ? `Updated ${ownerSignoffDate(lastForecastAt, market.timezone)}`
    : null;

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
          openingMissing: storedOpeningIsMissing(loadedCashflowRef.current),
        });
  const stripChip = !loaded ? null : shownLineSource === "Bank" ? "Bank" : statementChip?.trim() || null;

  const answerStrip = (
    <section className="answer-strip" data-answer-strip>
      <div className="answer-strip__lead">
        <p className="answer-strip__eyebrow">Cash flow</p>
        <h2 className="answer-strip__heading">13-week cash forecast</h2>
        {!loaded ? (
          <p className="answer-strip__sentence" data-answer-sentence aria-busy="true">
            <span className="inline-block h-4 w-72 max-w-full animate-pulse rounded bg-slate-200/80 dark:bg-slate-800" />
          </p>
        ) : !simplified && answerSentence ? (
          <p className="answer-strip__sentence" data-answer-sentence>
            {answerSentence}
          </p>
        ) : null}
        {forecastUpdatedLabel ? (
          <p className="answer-strip__sentence" data-forecast-updated>
            {forecastUpdatedLabel}
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
        {readOnly && !preview ? (
          <OwnerSignoffMark signoff={forecastSignoff} isStale={forecastStale} />
        ) : null}
        {readOnly ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="answer-strip__secondary"
            onClick={() => setShowBankUpload(true)}
          >
            Upload bank statements
          </Button>
        )}
        {preview ? null : (
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
        )}
      </div>
      <div className="answer-strip__meta">
        {stripChip ? (
          <span className="answer-strip__chip" data-source-chip>
            {stripChip}
          </span>
        ) : null}
        {readOnly || preview ? null : (
          <SignoffStatusChip
            clientId={clientId}
            scope="cash_forecast"
            signoff={forecastSignoff}
            isStale={forecastStale}
            known={signoffKnown}
          />
        )}
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

  const inlineChart = useStableChartWidth();
  const enlargeChart = useStableChartWidth();
  const [cashEnlarge, setCashEnlarge] = useState<null | "chart" | "table">(null);

  useEffect(() => {
    const revealWeeklyTable = () => {
      const hash = window.location.hash;
      const wantsTable =
        hashIsCashDetailAnchor(hash) ||
        new URL(window.location.href).searchParams.get("view") === "13week";
      if (!wantsTable) return;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.requestAnimationFrame(() => {
        document.getElementById("detailed-forecast")?.scrollIntoView({
          block: "start",
          behavior: reduce ? "auto" : "smooth",
        });
      });
    };
    revealWeeklyTable();
    window.addEventListener("hashchange", revealWeeklyTable);
    return () => window.removeEventListener("hashchange", revealWeeklyTable);
  }, []);

  const openingUntouched =
    xeroCashMarkers.current.openingBalance == null ||
    openingBalance === xeroCashMarkers.current.openingBalance;
  const openingChipKey = !openingUntouched
    ? "assumption"
    : openingSourceKey
      ? forecastChipSource(openingSourceKey)
      : bankSeeded
        ? "bank_pack"
        : "assumption";
  const flowChipKey = !linesMatchLoaded
    ? "assumption"
    : linesSourceKey
      ? forecastChipSource(linesSourceKey)
      : bankSeeded
        ? "bank_pack"
        : "assumption";

  const floorPos = forecastFloorPosition({
    opening: baseCalc.opening,
    closings: baseCalc.closing,
    floor: minimumCash,
  });
  const weeksBelow = weeksBelowFloorCopy({
    empty: forecastEmpty,
    weeksBelow: floorPos.weeksBelow,
    horizon: baseCalc.closing.length || WEEKS,
    firstDipWeek: floorPos.firstDipWeek,
    firstDipDate: floorPos.firstDipWeek != null ? (weeks[floorPos.firstDipWeek - 1] ?? null) : null,
    opensBelow: floorPos.opensBelow,
  });
  const runwayAside =
    !forecastEmpty && publishedStory.note === "above the floor" ? publishedStory.headline : null;
  // A balance-sheet date, or any non-zero opening on screen, is a real amount.
  // Only a stored blank with no date and no amount is missing.
  const openingTilesMissing =
    loaded &&
    storedOpeningIsMissing(loadedCashflowRef.current) &&
    !openingAsOf &&
    Math.abs(baseCalc.opening) < 0.5;
  const openingTileValue = openingTilesMissing ? "—" : fmtCompact(baseCalc.opening);
  const lowestTileValue =
    openingTilesMissing || emptyPresentation.lowestBlank ? "—" : fmtCompact(lowestBal);
  const lowestTileSub = openingTilesMissing
    ? "missing"
    : emptyPresentation.lowestBlank
      ? "Add an opening balance"
      : lowPoint.week === 0
        ? "Opening balance"
        : `Week ${lowestWeek} · ${weeks[lowestWeek - 1]}`;
  const lowestPointSub = openingTilesMissing
    ? "missing"
    : emptyPresentation.lowestBlank
      ? "Add an opening balance"
      : lowPoint.week === 0
        ? `Opening · ${lowestUnderFloor ? fmtCompact(minimumCash - lowestBal) + " under the floor" : fmtCompact(lowestBal - minimumCash) + " above the floor"}`
        : `Week ${lowestWeek} · ${lowestUnderFloor ? fmtCompact(minimumCash - lowestBal) + " under the floor" : fmtCompact(lowestBal - minimumCash) + " above the floor"}`;
  const weeksBelowValue = openingTilesMissing ? "—" : weeksBelow.value;
  const weeksBelowSub = openingTilesMissing ? "missing" : weeksBelow.sub;
  const weeksBelowTone = openingTilesMissing || forecastEmpty
    ? "neutral"
    : floorPos.weeksBelow > 0 || floorPos.opensBelow
      ? "bad"
      : "good";

  const kpiTiles = (
      <div
        className={`cash-kpis mb-5 grid grid-cols-1 gap-3 ${simplified ? "sm:grid-cols-2 min-[1100px]:grid-cols-4" : "sm:grid-cols-3"}`}
      >
        {!loaded ? (
          <CashTileSkeletons count={simplified ? 4 : 3} />
        ) : simplified ? (
          <>
            <Stat
              label="Closing · Week 13"
              value={fmtCompact(closingW13)}
              icon={LineChart}
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
              value={lowestTileValue}
              icon={ShieldCheck}
              tone={openingTilesMissing || emptyPresentation.lowestBlank ? "neutral" : lowestUnderFloor ? "bad" : "good"}
              sub={lowestTileSub}
            />
            <Stat
              label="Weeks below floor"
              value={weeksBelowValue}
              icon={CalendarDays}
              tone={weeksBelowTone}
              sub={weeksBelowSub}
            />
            <Stat
              label="Net cash · next 4 weeks"
              value={fmtCompact(calc.net.slice(0, 4).reduce((a, b) => a + b, 0))}
              icon={
                calc.net.slice(0, 4).reduce((a, b) => a + b, 0) < 0 ? TrendingDown : TrendingUp
              }
              tone={calc.net.slice(0, 4).reduce((a, b) => a + b, 0) < 0 ? "bad" : "good"}
              sub="Inflows minus outflows"
            />
          </>
        ) : (
          <>
            {openingTilesMissing ? (
              <Stat label="Opening bank" value={openingTileValue} sub="missing" />
            ) : (
              <Stat label="Opening bank" value={openingTileValue} sub={openingLabel} />
            )}
            <Stat
              label="Lowest point"
              value={lowestTileValue}
              tone={openingTilesMissing || emptyPresentation.lowestBlank ? "neutral" : lowestUnderFloor ? "bad" : "good"}
              sub={lowestPointSub}
            />
            <Stat
              label="Weeks below floor"
              value={weeksBelowValue}
              tone={weeksBelowTone}
              sub={weeksBelowSub}
            />
          </>
        )}
      </div>
  );
  const chartBody = (
    <>
      {emptyPresentation.showChart ? (
        <>
          <div className="cash-legend" data-cash-legend>
            <span className="cash-legend-item">
              <i className="cash-legend-line" aria-hidden="true" />
              Closing balance
            </span>
            <span className="cash-legend-item">
              <i className="cash-legend-floor" aria-hidden="true" />
              Runway floor {fmtCompact(minimumCash)}
            </span>
          </div>
          {interestNote ? (
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400" data-cash-interest>
              {interestNote}
            </p>
          ) : null}
          {heroChart(
            simplified ? 200 : 240,
            inlineChart.chartWidth,
            inlineChart.onChartFrame,
          )}
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300/80 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          The 13-week chart appears once a forecast line is entered.
        </p>
      )}
    </>
  );
  const graphPane = (
    <>
      {simplified ? null : kpiTiles}
      {chartBody}
    </>
  );
  const weekTableHint = readOnly
    ? "Red marks cash under the runway floor."
    : "Double-click a figure to edit. Red marks cash under the runway floor.";


  const forecastCard = (
    <>
    <Card
      id={CASH_FORECAST_CARD_ID}
      className={`${CARD_SHELL} w-full min-w-0 max-md:pb-6 max-md:pr-3`}
      data-cash-view="both"
    >
      <div className={GOLD_RULE} />
      <CardContent className="pt-5">
        <div className="mb-3 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#102A43] dark:text-[#F4F7FB]" data-cash-period>
              {cashCopy.range || "Next 13 weeks"}
            </p>
            {forecastUpdatedLabel ? (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400" data-forecast-updated>
                {forecastUpdatedLabel}
              </p>
            ) : null}
            {simplified && cashCopy.ownerRollLine ? (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400" data-cash-roll>
                {cashCopy.ownerRollLine}
              </p>
            ) : null}
            {!simplified && runwayAside ? (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Runway {runwayAside}</p>
            ) : null}
          </div>
          {emptyPresentation.showChart ? (
            <EnlargeButton label="cash flow graph" onClick={() => setCashEnlarge("chart")} />
          ) : null}
        </div>
        {simplified ? null : cashCopy.bullets.length > 0 ? (
          <details className="cash-details">
            <summary>Details</summary>
            <ul>
              {cashCopy.bullets.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {simplified ? null : scenarioLabel ? (
          <p className="mb-3 text-xs font-semibold text-[#102A43] dark:text-[#F4F7FB]">{scenarioLabel}</p>
        ) : null}
        {simplified ? null : disagreeNotice}
        {simplified ? null : emptyNotice}
        {simplified ? null : exportError ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e05c5c]/50 bg-[#e05c5c]/10 px-4 py-3 text-sm text-[#c0392b] dark:text-[#ef6b6b]">
            <span>{exportError}</span>
            <Button size="sm" variant="outline" className="h-8" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        ) : null}
        <div aria-label="Graph">{graphPane}</div>
        <section id="detailed-forecast" className="mt-6" aria-label="13-week">
          <div className={`mb-3 flex items-start gap-3 ${simplified ? "justify-end" : "justify-between"}`}>
            {simplified ? null : (
              <p className="max-w-xl text-xs text-slate-600 dark:text-slate-400">{weekTableHint}</p>
            )}
            <EnlargeButton label="cash flow table" onClick={() => setCashEnlarge("table")} />
          </div>
          <CashThirteenWeekGrid
            weeks={weeks}
            opening={baseCalc.opening}
            receipts={baseCalc.revRows.map((row) => ({
              id: row.id ?? row.name,
              name: row.name,
              vals: row.vals,
              bucket: row.id ? ("revenue" as const) : undefined,
            }))}
            payments={baseCalc.expRows.map((row) => ({
              id: row.id ?? row.name,
              name: row.name,
              vals: row.vals,
              bucket: row.id && row.bucket ? row.bucket : undefined,
            }))}
            inflow={baseCalc.inflow}
            outflow={baseCalc.outflow}
            net={baseCalc.net}
            closing={baseCalc.closing}
            floor={minimumCash}
            floorNote={hasWeeklyOutflows ? "about 4 weeks of outflows" : null}
            openingNote={openingAsOf ? openingLabel : null}
            symbol={cur}
            format={fmtR}
            signStyle={simplified ? "minus" : "paren"}
            openingChip={openingChipKey}
            flowChip={flowChipKey}
            readOnly={readOnly}
            onCommit={commitWeekOverride}
          />
        </section>
      </CardContent>
    </Card>
    <EnlargeSheet
      open={cashEnlarge === "chart"}
      onOpenChange={(next) => setCashEnlarge(next ? "chart" : null)}
      title="Cash flow graph"
    >
      <div className="flex h-full min-h-[280px] flex-col">
        {heroChart("100%", enlargeChart.chartWidth, enlargeChart.onChartFrame, true)}
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          Floor {fmtCompact(minimumCash)}
        </p>
      </div>
    </EnlargeSheet>
    <EnlargeSheet
      open={cashEnlarge === "table"}
      onOpenChange={(next) => setCashEnlarge(next ? "table" : null)}
      title="13-week cash flow"
    >
      <CashThirteenWeekGrid
        weeks={weeks}
        opening={baseCalc.opening}
        receipts={baseCalc.revRows.map((row) => ({
          id: row.id ?? row.name,
          name: row.name,
          vals: row.vals,
          bucket: row.id ? ("revenue" as const) : undefined,
        }))}
        payments={baseCalc.expRows.map((row) => ({
          id: row.id ?? row.name,
          name: row.name,
          vals: row.vals,
          bucket: row.id && row.bucket ? row.bucket : undefined,
        }))}
        inflow={baseCalc.inflow}
        outflow={baseCalc.outflow}
        net={baseCalc.net}
        closing={baseCalc.closing}
        floor={minimumCash}
        floorNote={hasWeeklyOutflows ? "about 4 weeks of outflows" : null}
        openingNote={openingAsOf ? openingLabel : null}
        symbol={cur}
        format={fmtR}
        signStyle={simplified ? "minus" : "paren"}
        openingChip={openingChipKey}
        flowChip={flowChipKey}
        readOnly={readOnly}
        onCommit={commitWeekOverride}
        scrollClassName="cash-13w-scroll--sheet"
      />
    </EnlargeSheet>
    </>
  );

  // ── Simplified mode: glanceable hero ─────────────────────────────────────
  if (simplified) {
    return (
      <div id="wizard-cash-outlook" className="space-y-0">
        {answerStrip}
        {cashSuggestionCard}
        {onceOffSaveBar}
        {forecastCard}
        <ForecastMoreDetail>
          {answerSentence ? (
            <p className="mb-3 text-sm text-slate-700 dark:text-slate-300" data-answer-sentence>
              {answerSentence}
            </p>
          ) : null}
          {runwayAside ? (
            <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">Runway {runwayAside}</p>
          ) : null}
          {cashCopy.bullets.length > 0 ? (
            <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
              {cashCopy.bullets.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {scenarioLabel ? (
            <p className="mb-3 text-xs font-semibold text-[#102A43] dark:text-[#F4F7FB]">{scenarioLabel}</p>
          ) : null}
          {disagreeNotice}
          {emptyNotice}
          {exportError ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e05c5c]/50 bg-[#e05c5c]/10 px-4 py-3 text-sm text-[#c0392b] dark:text-[#ef6b6b]">
              <span>{exportError}</span>
              <Button size="sm" variant="outline" className="h-8" onClick={() => window.location.reload()}>
                Reload
              </Button>
            </div>
          ) : null}
          {kpiTiles}
          <p className="max-w-xl text-xs text-slate-600 dark:text-slate-400">{weekTableHint}</p>
          {readOnly ? null : reviewInputs}
        </ForecastMoreDetail>
      </div>
    );
  }

  // ── Complex mode ──────────────────────────────────────────────────────────
  return (
    <div id="wizard-cash-outlook" className="space-y-5">
      {answerStrip}
      {cashSuggestionCard}
      {onceOffSaveBar}
      {readOnly ? null : reviewInputs}
      {forecastCard}
      {readOnly ? null : (
      <>
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
              {humanizeIsoDates(xeroBankNote)}
            </p>
          ) : null}
        </div>
      </CollapsibleGoldCard>

      <CollapsibleGoldCard
        icon={Wallet}
        title="Money In & Out"
        subtitle={
          interestNote
            ? interestNote
            : "Revenue and expense line items — pick how each lands across the 13 weeks"
        }
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
                singleMonth={singleMonthHistory}
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
                singleMonth={singleMonthHistory}
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
                side="other"
                singleMonth={singleMonthHistory}
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
      </>
      )}

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
                setBankHistory(draft);
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
