import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  ChevronRight,
  Download,
  Info,
  Maximize2,
  Minus,
  PieChart,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { EnlargeButton, EnlargeSheet } from "@/components/enlarge-sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFinancialInputs } from "@/contexts/financial-inputs";
import {
  resolveWaterfallFigures,
  waterfallPrefersStatement,
  type WaterfallFallback,
} from "@/lib/weekly-inputs";
import { DEFAULT_PROFILE, useOptionalAccountantProfile } from "@/contexts/accountant-profile";
import { useAuth } from "@/hooks/use-auth";
import { useMarketFormat } from "@/contexts/market";
import { currencySymbol, formatMonthYear } from "@/lib/market";
import { yearToDateTitle } from "@/lib/statement-period";
import {
  hashFigures,
  latestSnapshotId,
  recordDelivery,
  warnIfDeliveryFailed,
  warnIfPdfArchiveFailed,
} from "@/lib/advisory-deliveries";
import type { ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { profitStepBand } from "@/lib/health-score";
import { estimatedTaxNote } from "@/lib/estimated-tax-note";
import { ownerOutflow } from "@/lib/owner-money";
import { periodProfitBridge, statementNetProfit, statementNetProfitFromSteps } from "@/lib/period-profit";
import { FULL_YEAR_ON_FILE } from "@/lib/statement-period";
import "./profitability-waterfall.css";

export type { WaterfallFallback };

type StepKind = "total" | "decrease" | "subtotal";

type WfStep = {
  label: string;
  /** Signed delta for decreases; absolute value for totals/subtotals. */
  delta: number;
  /** Running total after this step. */
  runningEnd: number;
  kind: StepKind;
  showStatus: boolean;
  /** When set, the chip scores this ratio instead of the running margin. */
  statusRatio?: string;
};

const COMPACT_LABEL: Record<string, string> = {
  Revenue: "Revenue",
  "Cost of Sales": "COS",
  "Gross profit": "Gross profit",
  "Operating Expenses": "Op. exp.",
  Depreciation: "Deprec.",
  "Operating Profit": "Op. profit",
  Interest: "Interest",
  Tax: "Tax",
  "Net Profit": "Net profit",
};

function pct(n: number, total: number) {
  if (!total) return "—";
  return `${((n / total) * 100).toFixed(1)}%`;
}

const STEP_RATIO: Record<string, string> = {
  "Gross profit": "Gross Margin",
  "Operating Profit": "Operating Margin",
  "Net Profit": "Net Margin",
};

const BAND_CHIP: Record<string, { color: string; bg: string }> = {
  healthy: { color: "#4caf82", bg: "rgba(76,175,130,0.15)" },
  at_risk: { color: "#B7791F", bg: "rgba(183,121,31,0.12)" },
  critical: { color: "#e05c5c", bg: "rgba(224,92,92,0.15)" },
};

/** Margin chip from the shared score and band table. 16% net margin is Healthy. */
function getStatus(step: WfStep, margin: number): { label: string; color: string; bg: string } {
  const ratioName = step.statusRatio ?? STEP_RATIO[step.label] ?? "Net Margin";
  const band = profitStepBand(ratioName, margin);
  return { label: band.label, ...BAND_CHIP[band.tier] };
}

// Colours per step kind
const COLORS = {
  total: { light: "#1a3a5c", dark: "#3b6ea5" }, // brand navy/blue
  subtotal: { light: "#4caf82", dark: "#4caf82" }, // brand green
  decrease: { light: "#e05c5c", dark: "#e05c5c" }, // red
  netNeg: { light: "#c0392b", dark: "#ef6b6b" },
};

/** Premium bars — brand tokens with fallbacks (cobalt/royal totals, green subtotals, soft red steps). */
const PREMIUM_BAR: Record<string, string> = {
  total: "linear-gradient(180deg, var(--royal, #2563eb), var(--cobalt, #0b5fff))",
  subtotal: "linear-gradient(180deg, #41c586, #1f9e62)",
  decrease: "linear-gradient(180deg, #f29191, #e76a6a)",
  netNeg: "linear-gradient(180deg, #d6565a, #bf3a44)",
};

function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  const base = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return base * pow;
}

/** Nice axis ticks covering [min, max]. Bar labels get pixel headroom above the top tick. */
function axisTicks(min: number, max: number): { ticks: number[]; lo: number; hi: number } {
  const span = Math.max(max - min, 1e-9);
  const step = niceStep(span / 5);
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.max(Math.ceil(max / step - 1e-9) * step, lo + step);
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t);
  return { ticks, lo, hi };
}

/** Unicode minus for printed figures on the owner door. */
function ownerSign(text: string): string {
  return text.replace(/^-/, "−");
}

function PremiumWaterfallFigure({
  steps,
  revenue,
  fixedCosts,
  netProfit,
  taxNote,
  mounted,
  negative,
  money,
  moneyWhole,
  display,
  mode,
}: {
  steps: WfStep[];
  revenue: number;
  fixedCosts: number;
  netProfit: number;
  taxNote: string | null;
  mounted: boolean;
  negative: "paren" | "minus";
  /** Compact money for the axis ticks, e.g. "R12k". */
  money: (n: number) => string;
  /** Whole-unit money for the bar labels, e.g. "R10,000". */
  moneyWhole: (n: number) => string;
  display: "amount" | "percent";
  mode: "card" | "wide";
}) {
  const wide = mode === "wide";
  const chartH = wide ? 340 : 300;
  const band = wide ? 88 : 80;
  const colW = wide ? 106 : 94;
  const axisW = 52;
  /** Room above the top gridline so its tick and a top bar's label never clip. */
  const topPad = wide ? 40 : 36;

  const asPercent = display === "percent" && revenue > 0;
  const unit = (v: number) => (asPercent ? (v / revenue) * 100 : v);
  const runningValues = steps.map((step) => step.runningEnd);
  const vMin = Math.min(0, ...runningValues);
  const vMax = Math.max(revenue, ...runningValues, 1);
  const { ticks, lo, hi } = axisTicks(unit(vMin), unit(vMax));
  const y = (v: number) => ((unit(v) - lo) / (hi - lo)) * 100;
  const tickY = (t: number) => ((t - lo) / (hi - lo)) * 100;
  const tickLabel = (t: number) =>
    asPercent
      ? `${ownerSign(String(+t.toFixed(1)))}%`
      : ownerSign(
          money(t)
            .replace(/\s/g, "")
            .replace(/\.0(?=[km])/i, ""),
        );
  const zeroTick = ticks.find((t) => Math.abs(t) < 1e-9);

  return (
    <div className="pw-scroll" data-waterfall-premium={mode}>
      <div
        className="relative"
        style={{ height: topPad + chartH + band, minWidth: axisW + steps.length * colW }}
      >
        {ticks.map((t) => (
          <div key={`g-${t}`}>
            <div
              className="pw-gridline"
              data-zero={zeroTick === t ? "true" : undefined}
              style={{ left: axisW, bottom: band + (tickY(t) / 100) * chartH }}
            />
            <span
              className="pw-tick"
              style={{
                left: 0,
                width: axisW - 8,
                right: "auto",
                textAlign: "right",
                bottom: band + (tickY(t) / 100) * chartH,
              }}
            >
              {tickLabel(t)}
            </span>
          </div>
        ))}
        <div className="absolute bottom-0 top-0 flex" style={{ left: axisW, right: 0 }}>
          {steps.map((s, i) => {
            const isDec = s.kind === "decrease";
            const startVal = isDec ? s.runningEnd - s.delta : 0;
            const topVal = isDec ? Math.max(startVal, s.runningEnd) : Math.max(0, s.runningEnd);
            const botVal = isDec ? Math.min(startVal, s.runningEnd) : Math.min(0, s.runningEnd);
            const barBottomPct = y(botVal);
            const barHeightPct = Math.max(y(topVal) - y(botVal), 0.6);
            const isNet = s.label === "Net Profit";
            const negNet = isNet && netProfit < 0;
            const neg = isDec || negNet;
            const spanAbs = Math.abs(isDec ? s.delta : s.runningEnd);
            const pctText = ownerSign(pct(isDec ? spanAbs : s.runningEnd, revenue));
            const moneyText = isDec
              ? negative === "minus"
                ? ownerOutflow(moneyWhole(spanAbs))
                : `(${moneyWhole(spanAbs)})`
              : negative === "minus"
                ? ownerSign(moneyWhole(s.runningEnd))
                : moneyWhole(s.runningEnd);
            const primary = display === "percent" ? (isDec ? `−${pctText}` : pctText) : moneyText;
            const secondary = display === "percent" ? moneyText : pctText;
            const status = s.showStatus
              ? getStatus(
                  s,
                  !revenue
                    ? 0
                    : s.statusRatio === "Fixed Cost Ratio"
                      ? fixedCosts / revenue
                      : s.runningEnd / revenue,
                )
              : null;
            return (
              <div key={s.label} className="relative min-w-0 flex-1" style={{ minWidth: colW - 8 }}>
                {i < steps.length - 1 ? (
                  <div
                    className="pw-connector"
                    style={{
                      left: "50%",
                      width: "100%",
                      bottom: band + (y(s.runningEnd) / 100) * chartH,
                      opacity: mounted ? 1 : 0,
                    }}
                  />
                ) : null}
                <div
                  className="absolute left-0 right-0 z-10 flex flex-col items-center gap-0.5 text-center"
                  style={{ bottom: band + ((barBottomPct + barHeightPct) / 100) * chartH + 5 }}
                >
                  <span className="pw-figure" data-neg={neg ? "true" : undefined}>
                    {primary}
                  </span>
                  <span className="pw-figure-sub" data-neg={neg ? "true" : undefined}>
                    {secondary}
                  </span>
                </div>
                <div
                  className="pw-bar"
                  style={{
                    bottom: band + (barBottomPct / 100) * chartH,
                    height: mounted ? `${(barHeightPct / 100) * chartH}px` : "0px",
                    background: negNet
                      ? PREMIUM_BAR.netNeg
                      : isDec
                        ? PREMIUM_BAR.decrease
                        : PREMIUM_BAR[s.kind],
                  }}
                />
                <div
                  className="absolute bottom-0 left-0 right-0 flex flex-col items-center gap-1 px-1 pt-2 text-center"
                  style={{ height: band - 4 }}
                >
                  <span className="pw-step-label line-clamp-2 w-full whitespace-normal">
                    {s.label}
                  </span>
                  {status ? (
                    <span
                      className="pw-pill"
                      style={{ color: status.color, background: status.bg }}
                    >
                      {status.label}
                    </span>
                  ) : null}
                  {isNet && taxNote ? (
                    <span className="line-clamp-2 w-full text-[8.5px] font-medium leading-tight text-[#64748b] dark:text-[#94a3b8]">
                      {taxNote}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WaterfallFigure({
  steps,
  revenue,
  fixedCosts,
  netProfit,
  taxNote,
  mounted,
  negative,
  money,
  mode,
}: {
  steps: WfStep[];
  revenue: number;
  fixedCosts: number;
  netProfit: number;
  taxNote: string | null;
  mounted: boolean;
  negative: "paren" | "minus";
  money: (n: number) => string;
  mode: "fit" | "desk" | "wide";
}) {
  const fit = mode === "fit";
  const chartH = mode === "wide" ? 320 : fit ? 196 : 280;
  const band = fit ? 64 : 96;
  const head = fit ? 34 : 40;
  const runningValues = steps.map((step) => step.runningEnd);
  const minVal = Math.min(0, ...runningValues);
  const maxVal = Math.max(revenue, 1);
  const range = maxVal - minVal || 1;
  const y = (v: number) => ((v - minVal) / range) * 100;
  const frame = (
    <div
      className="relative"
      style={{
        height: chartH + band + head,
        minWidth: mode === "wide" ? steps.length * 88 : fit ? undefined : 560,
      }}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((p) => (
        <div
          key={p}
          className="absolute left-0 right-0 border-t border-dashed border-amber-900/10 dark:border-white/10"
          style={{ bottom: band + p * chartH }}
        />
      ))}
      <div
        className="absolute left-0 right-0 border-t border-amber-900/25 dark:border-white/25"
        style={{ bottom: band + (y(0) / 100) * chartH }}
      />
      <div className="absolute inset-x-0 bottom-0 top-0 flex">
        {steps.map((s, i) => {
          const isDec = s.kind === "decrease";
          const startVal = isDec ? s.runningEnd - s.delta : 0;
          const topVal = isDec ? Math.max(startVal, s.runningEnd) : Math.max(0, s.runningEnd);
          const botVal = isDec ? Math.min(startVal, s.runningEnd) : Math.min(0, s.runningEnd);
          const barBottomPct = y(botVal);
          const barHeightPct = Math.max(y(topVal) - y(botVal), 0.75);
          const isNet = s.label === "Net Profit";
          const negNet = isNet && netProfit < 0;
          const value = isDec ? Math.abs(s.delta) : s.runningEnd;
          const status = s.showStatus
            ? getStatus(
                s,
                !revenue
                  ? 0
                  : s.statusRatio === "Fixed Cost Ratio"
                    ? fixedCosts / revenue
                    : s.runningEnd / revenue,
              )
            : null;
          const connBottom = band + (y(s.runningEnd) / 100) * chartH;
          const shown = fit ? (COMPACT_LABEL[s.label] ?? s.label) : s.label;
          const figure = (
            isDec
              ? negative === "minus"
                ? ownerOutflow(money(Math.abs(s.delta)))
                : `(${money(Math.abs(s.delta))})`
              : money(s.runningEnd)
          )
            .replace(/\s/g, "")
            .replace(/\.0(?=[km])/i, "");
          return (
            <div
              key={s.label}
              className={`relative min-w-0 flex-1 ${mode === "wide" ? "min-w-[84px]" : ""}`}
            >
              {i < steps.length - 1 ? (
                <div
                  className="absolute z-0 border-t border-dashed border-slate-400/60 dark:border-slate-500/60"
                  style={{
                    left: "50%",
                    width: "100%",
                    bottom: connBottom,
                    opacity: mounted ? 1 : 0,
                  }}
                />
              ) : null}
              <div
                className="absolute left-0 right-0 z-10 text-center"
                style={{ bottom: band + ((barBottomPct + barHeightPct) / 100) * chartH + 2 }}
              >
                <div
                  className={`rounded-sm bg-[#FFFFFF]/90 px-0.5 font-extrabold leading-none tracking-tight dark:bg-[#0b1220]/85 ${fit ? "text-[8px]" : "text-[11px]"}`}
                  style={{ color: isDec || negNet ? "#c0392b" : undefined }}
                >
                  <span
                    className={`block whitespace-nowrap ${isDec || negNet ? "" : "text-[#102A43] dark:text-[#F4F7FB]"}`}
                  >
                    {figure}
                  </span>
                </div>
                <div
                  className={`font-medium leading-none text-[#475569] dark:text-[#94a3b8] ${fit ? "text-[8px]" : "text-[10px]"}`}
                >
                  {pct(value, revenue)}
                </div>
              </div>
              <div
                className="absolute left-[12%] right-[12%] z-[5] rounded-md"
                style={{
                  bottom: band + (barBottomPct / 100) * chartH,
                  height: mounted ? `${(barHeightPct / 100) * chartH}px` : "0px",
                  background: negNet
                    ? `linear-gradient(180deg, ${COLORS.netNeg.light}, ${COLORS.netNeg.light}cc)`
                    : isDec
                      ? "linear-gradient(180deg, #e05c5c, #c94b4b)"
                      : s.kind === "total"
                        ? "linear-gradient(180deg, #2c5580, #1a3a5c)"
                        : "linear-gradient(180deg, #5cc492, #3f9c72)",
                }}
              />
              <div
                className="absolute bottom-0 left-0 right-0 flex flex-col items-center gap-1 px-0.5 pt-1 text-center"
                style={{ height: band - 4 }}
              >
                <span className="line-clamp-2 w-full whitespace-normal text-[10px] font-bold leading-tight text-[#1e293b] dark:text-[#e2e8f0]">
                  {shown}
                </span>
                {isNet && taxNote && !fit ? (
                  <span className="line-clamp-2 w-full text-[8px] font-medium leading-tight text-[#64748b]">
                    {taxNote}
                  </span>
                ) : null}
                {status && !fit ? (
                  <span
                    className="rounded border px-1 py-0.5 text-[8px] font-extrabold"
                    style={{
                      color: status.color,
                      background: status.bg,
                      borderColor: status.color,
                    }}
                  >
                    {status.label}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (mode === "fit") return frame;
  return <div className="overflow-x-auto overscroll-x-contain">{frame}</div>;
}

/**
 * Professional PDF export — renders the branded react-pdf
 * ProfitabilityWaterfallPDF report (same one used on the accountant side)
 * and downloads it as a file.
 */
async function exportPDF(opts: {
  clientId?: string;
  clientName?: string;
  revenue: number;
  costOfSales: number;
  fixedCosts: number;
  depreciation?: number;
  interest: number;
  tax: number;
  accountantProfile: import("@/contexts/accountant-profile").AccountantProfile;
  reviewSignoff?: ReportSignoffStamp | null;
  createdBy?: string | null;
  firmId?: string | null;
  market?: import("@/lib/market").ResolvedMarket;
  periodLabel?: string | null;
}) {
  const { revenue, costOfSales, fixedCosts, interest, tax } = opts;
  const depreciation = opts.depreciation ?? 0;
  const grossProfit = revenue - costOfSales;
  const operatingProfit = grossProfit - fixedCosts - depreciation;
  const ebt = operatingProfit - interest;
  const netProfit = ebt - tax;

  const [{ pdf }, { ProfitabilityWaterfallPDF }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/reports/profitability-waterfall"),
  ]);

  const now = new Date();
  const period = opts.periodLabel?.trim() || formatMonthYear(now, opts.market?.timezone);
  const name = opts.clientName?.trim() || "Your Business";

  const profitabilityData = {
    revenue,
    gross_profit: grossProfit,
    gross_margin_pct: revenue ? grossProfit / revenue : 0,
    operating_profit: operatingProfit,
    operating_margin_pct: revenue ? operatingProfit / revenue : 0,
    depreciation,
    ebt,
    tax,
    net_profit: netProfit,
    net_margin_pct: revenue ? netProfit / revenue : 0,
  };

  const blob = await pdf(
    ProfitabilityWaterfallPDF({
      smeData: { name, period },
      profitabilityData,
      accountantProfile: opts.accountantProfile,
      reviewSignoff: opts.reviewSignoff ?? null,
      market: opts.market,
    }) as Parameters<typeof pdf>[0],
  ).toBlob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/\s+/g, "_")}_${period.replace(/\s+/g, "_")}_ProfitabilityWaterfall.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);

  if (opts.clientId && opts.createdBy) {
    const snapId = await latestSnapshotId(opts.clientId);
    const logged = await recordDelivery({
      clientId: opts.clientId,
      firmId: opts.firmId,
      channel: "pdf_download",
      kind: "report_pdf",
      reportKey: "waterfall",
      snapshotId: snapId,
      figuresHash: hashFigures(profitabilityData),
      periodLabel: period,
      createdBy: opts.createdBy,
      pdfBlob: blob,
    });
    warnIfDeliveryFailed(logged.error);
    warnIfPdfArchiveFailed(logged.pdfError);
  }
}

/** The waterfall's existing subtitle, or the loaded margins when they are on the page. */
export function profitAnswerSentence(input: {
  currency: string;
  periodLabel?: string | null;
  preferPeriod?: boolean;
  /** Compact money already formatted, e.g. "$700k". */
  revenueText?: string | null;
  /** Net margin in percent, e.g. 8.6. */
  netMarginPct?: number | null;
  /** Gross margin in percent, e.g. 60. */
  grossMarginPct?: number | null;
}): string {
  const periodBit = input.periodLabel?.trim() || "";
  const revenue = input.revenueText?.trim() || "";
  const net =
    typeof input.netMarginPct === "number" && Number.isFinite(input.netMarginPct)
      ? input.netMarginPct
      : null;
  if (revenue && net != null) {
    const when = periodBit ? ` for ${periodBit}` : "";
    const gross =
      typeof input.grossMarginPct === "number" && Number.isFinite(input.grossMarginPct)
        ? ` Gross margin ${input.grossMarginPct.toFixed(1)}%.`
        : "";
    return `Net margin ${net.toFixed(1)}% on ${revenue} revenue${when}.${gross}`;
  }
  const how = `How ${input.currency}1 of revenue becomes profit`;
  if (!periodBit) return how;
  const monthToDate = input.preferPeriod && periodBit !== FULL_YEAR_ON_FILE;
  return monthToDate ? `${how} · Month to date · ${periodBit}` : `${how} · ${periodBit}`;
}

export type WaterfallExportApi = {
  exporting: boolean;
  exportPdf: () => void;
};

/** Prior-period margins for the premium strip. A missing margin hides its delta. */
export type PreviousMargins = {
  gross: number | null;
  operating: number | null;
  net: number | null;
};

/**
 * Margins from a stored prior-period snapshot, through the same P&L bridge as
 * the live board. Null when the snapshot has no usable revenue, so the strip
 * never invents a delta.
 */
export function priorMarginsFromFinancials(
  fin: Record<string, unknown> | null | undefined,
): PreviousMargins | null {
  if (!fin) return null;
  const bridge = periodProfitBridge(fin);
  if (!(bridge.revenue > 0)) return null;
  const statedNetRaw = fin["netIncome"];
  const statedNet =
    statedNetRaw == null || String(statedNetRaw).trim() === ""
      ? null
      : Number(String(statedNetRaw).replace(/,/g, ""));
  const quotedNet = statementNetProfit(fin);
  const net =
    quotedNet != null
      ? quotedNet
      : bridge.interestIsFact && bridge.taxIsFact
        ? bridge.ebit - bridge.interest - bridge.tax
        : bridge.ebit;
  return {
    gross: bridge.grossProfit / bridge.revenue,
    operating: bridge.ebit / bridge.revenue,
    net: net != null ? net / bridge.revenue : null,
  };
}

/** Delta line for the margin strip. Null hides the line rather than inventing one. */
function marginDelta(
  current: number | null,
  previous: number | null | undefined,
): { dir: "up" | "down" | "flat"; text: string } | null {
  if (current == null || previous == null || !Number.isFinite(previous)) return null;
  const pp = (current - previous) * 100;
  const dir = Math.abs(pp) < 0.05 ? "flat" : pp > 0 ? "up" : "down";
  const sign = dir === "up" ? "+" : dir === "down" ? "−" : "";
  return { dir, text: `${sign}${Math.abs(pp).toFixed(1)} pp vs. previous period` };
}

/**
 * Owner Profit tab lead — big title, one-line subtitle, and the statement
 * period as a quiet pill. Real period from the books; no fake selector when
 * there is only one period to show.
 */
export function ProfitLead({ periodLabel }: { periodLabel?: string | null }) {
  return (
    <header className="profit-lead">
      <div className="min-w-0">
        <h1 className="owner-title">Profit</h1>
        <p className="profit-lead-sub">
          Understand how your revenue becomes profit, and what&rsquo;s driving the changes.
        </p>
      </div>
      {periodLabel?.trim() ? (
        <span className="profit-lead-period" title="Statement period">
          <CalendarDays aria-hidden />
          {periodLabel.trim()}
        </span>
      ) : null}
    </header>
  );
}

/** Subtotal / status rows shared by the classic card and the premium details drawer. */
function DetailRows({
  steps,
  revenue,
  fixedCosts,
  fmt,
}: {
  steps: WfStep[];
  revenue: number;
  fixedCosts: number;
  fmt: (n: number) => string;
}) {
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
      {steps
        .filter((s) => s.showStatus)
        .map((s) => {
          const status = getStatus(
            s,
            !revenue
              ? 0
              : s.statusRatio === "Fixed Cost Ratio"
                ? fixedCosts / revenue
                : s.runningEnd / revenue,
          );
          return (
            <div
              key={s.label}
              className="flex items-center justify-between gap-2 rounded-lg border border-amber-900/10 bg-white/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/50"
            >
              <div className="min-w-0">
                <div className="truncate text-[10px] font-bold uppercase tracking-wide text-[#475569] dark:text-[#94a3b8]">
                  {s.label}
                </div>
                <div className="truncate text-sm font-extrabold tracking-tight text-[#102A43] dark:text-[#F4F7FB]">
                  {fmt(s.kind === "decrease" ? Math.abs(s.delta) : s.runningEnd)}
                  <span className="ml-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    {pct(s.kind === "decrease" ? Math.abs(s.delta) : s.runningEnd, revenue)}
                  </span>
                </div>
              </div>
              <span
                className="shrink-0 rounded border px-1.5 py-0.5 text-xs font-extrabold tracking-wide"
                style={{
                  color: status.color,
                  background: status.bg,
                  borderColor: status.color,
                }}
              >
                {status.label}
              </span>
            </div>
          );
        })}
    </div>
  );
}

function WaterfallPhoneList({
  steps,
  revenue,
  negative,
  money,
}: {
  steps: { label: string; delta: number; runningEnd: number; kind: string }[];
  revenue: number;
  negative: "minus" | "paren";
  money: (n: number) => string;
}) {
  return (
    <ol className="m-0 flex list-none flex-col gap-3 p-0" data-waterfall-layout="vertical">
      {steps.map((s) => {
        const isDec = s.kind === "decrease";
        const negNet = s.kind === "total" && s.label === "Net Profit" && s.runningEnd < 0;
        const span = Math.abs(isDec ? s.delta : s.runningEnd);
        const width = Math.max(8, Math.min(100, (span / Math.max(Math.abs(revenue), 1)) * 100));
        const valueText = isDec
          ? negative === "minus"
            ? ownerOutflow(money(Math.abs(s.delta)))
            : `(${money(Math.abs(s.delta))})`
          : money(s.runningEnd);
        return (
          <li key={s.label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-xs font-bold uppercase leading-tight tracking-wide text-[#1e293b] dark:text-[#e2e8f0]">
                {s.label}
              </span>
              <span
                className="shrink-0 text-xs font-extrabold tabular-nums text-[#102A43] dark:text-[#F4F7FB]"
                style={{ color: isDec || negNet ? "#c0392b" : undefined }}
              >
                {valueText}
              </span>
            </div>
            <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-[#e8eef5] dark:bg-slate-800">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${width}%`,
                  background: negNet
                    ? "#c0392b"
                    : isDec
                      ? "#c94b4b"
                      : s.kind === "total"
                        ? "#1a3a5c"
                        : "#3f9c72",
                }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ProfitabilityWaterfall({
  fallback,
  clientName,
  clientId,
  reviewSignoff = null,
  periodLabel = null,
  preferPeriod = false,
  yearToDate = null,
  periodNote = null,
  hideLead = false,
  hideCardExport = false,
  negative = "paren",
  headerAside = null,
  appearance = "classic",
  previousMargins = null,
  onExportReady,
}: {
  fallback?: WaterfallFallback;
  clientName?: string;
  clientId?: string;
  reviewSignoff?: ReportSignoffStamp | null;
  /** Explicit statement range, "1 Sep 2026 – 21 Sep 2026". */
  periodLabel?: string | null;
  /** Xero (or another ledger) statement wins over weekly totals. */
  preferPeriod?: boolean;
  /** Financial-year or calendar year companion. Hidden when it is the same month. */
  yearToDate?: {
    basis: "financial" | "calendar" | null;
    periodLabel: string;
    revenue: number;
  } | null;
  /** Shown when a Xero link exists but the stored total has no dates yet. */
  periodNote?: string | null;
  /** Owner door uses a unicode minus. The accountant waterfall keeps parentheses. */
  negative?: "paren" | "minus";
  /** Dated ledger that owns these period figures. The chip lives on the answer strip. */
  statementSource?: string | null;
  /** The answer strip already shows the heading and the sentence. */
  hideLead?: boolean;
  /** Export PDF sits on the answer strip. The card does not repeat it. */
  hideCardExport?: boolean;
  /** Owner sign-off, aligned with this card's header. */
  headerAside?: ReactNode;
  /** "premium" is the owner Profit tab look: toggle, axis, margin strip. */
  appearance?: "classic" | "premium";
  /** Prior-period margins for the premium strip deltas. Absent deltas stay hidden. */
  previousMargins?: PreviousMargins | null;
  onExportReady?: (api: WaterfallExportApi) => void;
}) {
  const { weeklyInputs } = useFinancialInputs();
  const accountant = useOptionalAccountantProfile();
  const profile = accountant?.profile ?? DEFAULT_PROFILE;
  const firmId = accountant?.firmId ?? null;
  const { user } = useAuth();
  const { money: fmt, moneyCompact: fmtCompact, market } = useMarketFormat();
  const [mounted, setMounted] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [phone, setPhone] = useState(false);
  const [waterfallOpen, setWaterfallOpen] = useState(false);
  const [display, setDisplay] = useState<"amount" | "percent">("amount");
  const [detailsOpen, setDetailsOpen] = useState(false);
  useLayoutEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setPhone(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  const exportPdfRef = useRef<() => void>(() => {});

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const figures = resolveWaterfallFigures(weeklyInputs, fallback, {
    preferPeriod: waterfallPrefersStatement(fallback, preferPeriod),
  });
  const periodBit = periodLabel?.trim() || null;
  const answerSentence = profitAnswerSentence({
    currency: currencySymbol(market),
    periodLabel,
    preferPeriod,
  });
  const revenue = figures.revenue;
  const costOfSales = figures.costOfSales;
  const fixedCosts = figures.fixedCosts;
  const depreciation = figures.depreciation;
  const interest = figures.interest;
  const tax = figures.tax;
  const interestIsFact = figures.interestIsFact;
  const taxIsFact = figures.taxIsFact;

  const grossProfit = revenue - costOfSales;
  const afterOverheads = grossProfit - fixedCosts;
  const operatingProfit = afterOverheads - depreciation;
  const ebt = operatingProfit - interest;
  const statedNet = figures.statedNetIncome;
  const netProfit = statementNetProfitFromSteps({
    operatingProfit,
    interest,
    tax,
    statedNetIncome: statedNet,
  });
  const taxNote = estimatedTaxNote({ clientName, tax, operatingProfit });
  const showDepreciation = Math.abs(depreciation) >= 0.5;

  const steps: WfStep[] = [
    { label: "Revenue", delta: revenue, runningEnd: revenue, kind: "total", showStatus: false },
    {
      label: "Cost of Sales",
      delta: -costOfSales,
      runningEnd: grossProfit,
      kind: "decrease",
      showStatus: false,
    },
    {
      label: "Gross profit",
      delta: grossProfit,
      runningEnd: grossProfit,
      kind: "subtotal",
      showStatus: true,
    },
    {
      label: "Operating Expenses",
      delta: -fixedCosts,
      runningEnd: showDepreciation ? afterOverheads : operatingProfit,
      kind: "decrease",
      showStatus: true,
      statusRatio: "Fixed Cost Ratio",
    },
    ...(showDepreciation
      ? [
          {
            label: "Depreciation",
            delta: -depreciation,
            runningEnd: operatingProfit,
            kind: "decrease" as const,
            showStatus: false,
          },
        ]
      : []),
    {
      label: "Operating Profit",
      delta: operatingProfit,
      runningEnd: operatingProfit,
      kind: "subtotal",
      showStatus: true,
    },
    ...(interestIsFact
      ? [
          {
            label: "Interest",
            delta: -interest,
            runningEnd: ebt,
            kind: "decrease" as const,
            showStatus: false,
          },
        ]
      : []),
    ...(taxIsFact
      ? [
          {
            label: "Tax",
            delta: -tax,
            runningEnd: netProfit,
            kind: "decrease" as const,
            showStatus: false,
          },
        ]
      : []),
    {
      label: "Net Profit",
      delta: netProfit,
      runningEnd: netProfit,
      kind: "total",
      showStatus: true,
    },
  ];

  exportPdfRef.current = () => {
    setExporting(true);
    void exportPDF({
      clientId,
      clientName,
      revenue,
      costOfSales,
      fixedCosts,
      depreciation,
      interest,
      tax,
      accountantProfile: profile,
      reviewSignoff,
      createdBy: user?.id ?? null,
      firmId,
      market,
      periodLabel: periodBit,
    }).finally(() => setExporting(false));
  };

  useEffect(() => {
    onExportReady?.({ exporting, exportPdf: () => exportPdfRef.current() });
  }, [onExportReady, exporting]);

  const showHeader =
    !hideLead || Boolean(yearToDate?.periodLabel) || Boolean(periodNote) || !hideCardExport;

  if (appearance === "premium") {
    const fmtWhole = (n: number) => fmt(n, { maximumFractionDigits: 0 });
    const grossMargin = revenue > 0 ? grossProfit / revenue : null;
    const operatingMargin = revenue > 0 ? operatingProfit / revenue : null;
    const netMargin = revenue > 0 ? netProfit / revenue : null;
    const marginText = (m: number | null) => (m == null ? "—" : `${(m * 100).toFixed(1)}%`);
    const insight = profitAnswerSentence({
      currency: currencySymbol(market),
      periodLabel,
      preferPeriod,
      revenueText: revenue > 0 ? fmtCompact(revenue) : null,
      netMarginPct: netMargin != null ? netMargin * 100 : null,
      grossMarginPct: grossMargin != null ? grossMargin * 100 : null,
    });
    const infoText = `How ${currencySymbol(market)}1 of revenue becomes profit. Blue bars are revenue and net profit, green bars are profit subtotals, red bars are the costs in between. Health bands use the same scoring as your Health tab.`;
    const strip: {
      key: string;
      label: string;
      value: string;
      icon: ReactNode;
      delta: { dir: "up" | "down" | "flat"; text: string } | null;
    }[] = [
      {
        key: "gross",
        label: "Gross margin",
        value: marginText(grossMargin),
        icon: <TrendingUp aria-hidden />,
        delta: marginDelta(grossMargin, previousMargins?.gross),
      },
      {
        key: "operating",
        label: "Operating margin",
        value: marginText(operatingMargin),
        icon: <PieChart aria-hidden />,
        delta: marginDelta(operatingMargin, previousMargins?.operating),
      },
      {
        key: "net",
        label: "Net margin",
        value: marginText(netMargin),
        icon: <BarChart3 aria-hidden />,
        delta: marginDelta(netMargin, previousMargins?.net),
      },
    ];
    return (
      <Card className="pw-card relative overflow-hidden border border-[#DBEAFE] bg-white text-[#102A43] shadow-[0_8px_24px_rgba(16,42,67,0.06)] print:hidden dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB] dark:shadow-none">
        <CardHeader className="border-b border-[#EDF3FC] pb-4 dark:border-slate-800">
          <div className="pw-head">
            <div className="pw-head-copy">
              <div className="pw-title-row">
                <CardTitle className="truncate text-xl font-semibold tracking-tight text-[#102A43] dark:text-[#F4F7FB]">
                  Profitability waterfall
                </CardTitle>
                <span className="pw-info" role="img" aria-label={infoText} title={infoText}>
                  <Info aria-hidden />
                </span>
              </div>
              <p className="mt-1 text-xs text-[#475569] dark:text-[#94a3b8]">{answerSentence}</p>
              {yearToDate?.periodLabel ? (
                <p className="mt-0.5 text-xs text-[#475569] dark:text-[#94a3b8]">
                  {yearToDateTitle(yearToDate.basis)}
                  {" · "}
                  {yearToDate.periodLabel}
                  {Number.isFinite(yearToDate.revenue)
                    ? ` · Revenue ${fmt(yearToDate.revenue)}`
                    : ""}
                </p>
              ) : null}
              {periodNote ? (
                <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">{periodNote}</p>
              ) : null}
            </div>
            <div className="pw-controls">
              <div
                className="pw-toggle"
                role="group"
                aria-label="Show figures as amounts or as percentages of revenue"
              >
                <button
                  type="button"
                  aria-pressed={display === "amount"}
                  onClick={() => setDisplay("amount")}
                >
                  Amount
                </button>
                <button
                  type="button"
                  aria-pressed={display === "percent"}
                  onClick={() => setDisplay("percent")}
                >
                  Percentage
                </button>
              </div>
              <button
                type="button"
                className="pw-btn"
                aria-label="Expand the profitability waterfall"
                onClick={() => setWaterfallOpen(true)}
              >
                <Maximize2 aria-hidden />
                Expand
              </button>
              {hideCardExport ? null : (
                <button
                  type="button"
                  className="pw-btn"
                  disabled={exporting}
                  onClick={(e) => {
                    e.stopPropagation();
                    exportPdfRef.current();
                  }}
                >
                  <Download aria-hidden />
                  {exporting ? "Preparing…" : "Export PDF"}
                </button>
              )}
            </div>
          </div>
          {headerAside ? <div className="pw-signoff">{headerAside}</div> : null}
        </CardHeader>

        <CardContent className="pb-6 pt-5">
          {revenue === 0 && (
            <p className="mb-4 rounded-lg border border-amber-900/10 bg-amber-50/70 px-3 py-2 text-xs italic text-[#475569] dark:border-slate-700 dark:bg-slate-900/50 dark:text-[#94a3b8]">
              Enter revenue figures in Financial Inputs or Weekly Inputs below to populate the
              waterfall.
            </p>
          )}

          {phone ? (
            <WaterfallPhoneList steps={steps} revenue={revenue} negative={negative} money={fmtCompact} />
          ) : (
            <PremiumWaterfallFigure
              steps={steps}
              revenue={revenue}
              fixedCosts={fixedCosts}
              netProfit={netProfit}
              taxNote={taxNote}
              mounted={mounted}
              negative={negative}
              money={fmtCompact}
              moneyWhole={fmtWhole}
              display={display}
              mode="card"
            />
          )}
          <EnlargeSheet
            open={waterfallOpen}
            onOpenChange={setWaterfallOpen}
            title="Profitability waterfall"
          >
            <PremiumWaterfallFigure
              steps={steps}
              revenue={revenue}
              fixedCosts={fixedCosts}
              netProfit={netProfit}
              taxNote={taxNote}
              mounted={mounted}
              negative={negative}
              money={fmtCompact}
              moneyWhole={fmtWhole}
              display={display}
              mode="wide"
            />
          </EnlargeSheet>

          <div className="pw-strip">
            {strip.map((cell) => (
              <div key={cell.key} className="pw-cell">
                <span className="pw-cell-ic">{cell.icon}</span>
                <span className="min-w-0">
                  <span className="pw-cell-label block">{cell.label}</span>
                  <span className="pw-cell-value block">{cell.value}</span>
                  {cell.delta ? (
                    <span className="pw-cell-delta" data-dir={cell.delta.dir}>
                      {cell.delta.dir === "up" ? (
                        <ArrowUpRight aria-hidden />
                      ) : cell.delta.dir === "down" ? (
                        <ArrowDownRight aria-hidden />
                      ) : (
                        <Minus aria-hidden />
                      )}
                      {cell.delta.text}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
            <button
              type="button"
              className="pw-cell pw-insight"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((open) => !open)}
            >
              <span className="pw-cell-ic">
                <Sparkles aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="pw-cell-label block">Key insight</span>
                <span className="pw-insight-text block">{insight}</span>
              </span>
              <span className="pw-insight-caret" aria-hidden>
                <ChevronRight />
              </span>
            </button>
          </div>

          {detailsOpen ? (
            <div className="mt-3">
              <DetailRows steps={steps} revenue={revenue} fixedCosts={fixedCosts} fmt={fmt} />
            </div>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden border border-[#DBEAFE] bg-white text-[#102A43] shadow-[0_8px_24px_rgba(16,42,67,0.06)] print:hidden dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB] dark:shadow-none">
      <div className="pointer-events-none absolute left-0 top-0 h-1 w-full bg-[#0B5FFF]" />
      {showHeader ? (
        <CardHeader className="border-b border-[#DBEAFE] pb-5 dark:border-slate-800">
          <div className="deliverable-head flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              {hideLead ? null : (
                <>
                  <CardTitle className="text-xl font-semibold tracking-tight text-[#102A43] dark:text-[#F4F7FB]">
                    Profitability Waterfall
                  </CardTitle>
                  <p className="mt-1 text-xs text-[#475569] dark:text-[#94a3b8]">
                    {answerSentence}
                  </p>
                </>
              )}
              {yearToDate?.periodLabel ? (
                <p className="mt-0.5 text-xs text-[#475569] dark:text-[#94a3b8]">
                  {yearToDateTitle(yearToDate.basis)}
                  {" · "}
                  {yearToDate.periodLabel}
                  {Number.isFinite(yearToDate.revenue)
                    ? ` · Revenue ${fmt(yearToDate.revenue)}`
                    : ""}
                </p>
              ) : null}
              {periodNote ? (
                <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">{periodNote}</p>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:max-w-[48%] sm:justify-end">
              {headerAside}
              <EnlargeButton
                label="profitability waterfall"
                onClick={() => setWaterfallOpen(true)}
              />
              {hideCardExport ? null : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 border-[#0B5FFF] bg-transparent px-2.5 text-[11px] font-semibold text-[#102A43] hover:bg-[#DBEAFE]"
                  disabled={exporting}
                  onClick={(e) => {
                    e.stopPropagation();
                    exportPdfRef.current();
                  }}
                >
                  <Download className="h-3 w-3" />
                  {exporting ? "Preparing…" : "Export PDF"}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      ) : null}

      <CardContent className="pb-7 pt-6">
        {revenue === 0 && (
          <p className="mb-4 rounded-lg border border-amber-900/10 bg-amber-50/70 px-3 py-2 text-xs italic text-[#475569] dark:border-slate-700 dark:bg-slate-900/50 dark:text-[#94a3b8]">
            Enter revenue figures in Financial Inputs or Weekly Inputs below to populate the
            waterfall.
          </p>
        )}

        {phone ? (
          <ol className="m-0 flex list-none flex-col gap-3 p-0" data-waterfall-layout="horizontal">
            {steps.map((s) => {
              const isDec = s.kind === "decrease";
              const negNet = s.kind === "total" && s.label === "Net Profit" && s.runningEnd < 0;
              const span = Math.abs(isDec ? s.delta : s.runningEnd);
              const width = Math.max(
                8,
                Math.min(100, (span / Math.max(Math.abs(revenue), 1)) * 100),
              );
              const valueText = isDec
                ? negative === "minus"
                  ? ownerOutflow(fmtCompact(Math.abs(s.delta)))
                  : `(${fmtCompact(Math.abs(s.delta))})`
                : fmtCompact(s.runningEnd);
              return (
                <li key={s.label} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-xs font-bold uppercase leading-tight tracking-wide text-[#1e293b] dark:text-[#e2e8f0]">
                      {s.label}
                    </span>
                    <span
                      className="shrink-0 text-xs font-extrabold tabular-nums text-[#102A43] dark:text-[#F4F7FB]"
                      style={{ color: isDec || negNet ? "#c0392b" : undefined }}
                    >
                      {valueText}
                    </span>
                  </div>
                  <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-[#e8eef5] dark:bg-slate-800">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${width}%`,
                        background: negNet
                          ? "#c0392b"
                          : isDec
                            ? "#c94b4b"
                            : s.kind === "total"
                              ? "#1a3a5c"
                              : "#3f9c72",
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <WaterfallFigure
            steps={steps}
            revenue={revenue}
            fixedCosts={fixedCosts}
            netProfit={netProfit}
            taxNote={taxNote}
            mounted={mounted}
            negative={negative}
            money={fmtCompact}
            mode="desk"
          />
        )}
        <EnlargeSheet
          open={waterfallOpen}
          onOpenChange={setWaterfallOpen}
          title="Profitability waterfall"
        >
          <WaterfallFigure
            steps={steps}
            revenue={revenue}
            fixedCosts={fixedCosts}
            netProfit={netProfit}
            taxNote={taxNote}
            mounted={mounted}
            negative={negative}
            money={fmtCompact}
            mode="wide"
          />
        </EnlargeSheet>

        {/* legend */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 border-t border-amber-900/10 pt-3 dark:border-slate-800">
          {[
            { c: "linear-gradient(180deg, #2c5580, #1a3a5c)", t: "Revenue / Net Profit" },
            { c: "linear-gradient(180deg, #5cc492, #3f9c72)", t: "Gross profit" },
            { c: "linear-gradient(180deg, #e05c5c, #c94b4b)", t: "Cost step" },
          ].map((l) => (
            <span
              key={l.t}
              className="flex items-center gap-1.5 text-[10px] font-medium text-[#475569] dark:text-[#94a3b8]"
            >
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.c }} />
              {l.t}
            </span>
          ))}
        </div>

        {/* detail rows */}
        <div className="mt-4">
          <DetailRows steps={steps} revenue={revenue} fixedCosts={fixedCosts} fmt={fmt} />
        </div>
      </CardContent>
    </Card>
  );
}
