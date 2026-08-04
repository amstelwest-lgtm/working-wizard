import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useFinancialInputs } from "@/contexts/financial-inputs";
import { useAccountantProfile } from "@/contexts/accountant-profile";

export type WaterfallFallback = {
  revenue: number;
  cogs: number;
  fixedCosts: number;
  interest: number;
  tax: number;
};

type StepKind = "total" | "decrease" | "subtotal";

type WfStep = {
  label: string;
  /** Signed delta for decreases; absolute value for totals/subtotals. */
  delta: number;
  /** Running total after this step. */
  runningEnd: number;
  kind: StepKind;
  showStatus: boolean;
};

function fmt(n: number) {
  return `R\u00a0${Math.round(n).toLocaleString("en-ZA")}`;
}

function fmtCompact(n: number) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R\u00a0${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`;
  if (abs >= 1_000) return `${sign}R\u00a0${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  return `${sign}R\u00a0${Math.round(abs).toLocaleString("en-ZA")}`;
}

function pct(n: number, total: number) {
  if (!total) return "—";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function getStatus(p: number): { label: string; color: string; bg: string } {
  if (p >= 0.2)
    return { label: "HEALTHY",  color: "#4caf82", bg: "rgba(76,175,130,0.15)" };
  if (p >= 0.1)
    return { label: "AT RISK",  color: "#d4a550", bg: "rgba(212,165,80,0.15)" };
  return       { label: "CRITICAL", color: "#e05c5c", bg: "rgba(224,92,92,0.15)" };
}

// Colours per step kind
const COLORS = {
  total:    { light: "#1a3a5c", dark: "#3b6ea5" },       // brand navy/blue
  subtotal: { light: "#4caf82", dark: "#4caf82" },       // brand green
  decrease: { light: "#e05c5c", dark: "#e05c5c" },       // red
  netNeg:   { light: "#c0392b", dark: "#ef6b6b" },
};

/**
 * Professional PDF export — renders the branded react-pdf
 * ProfitabilityWaterfallPDF report (same one used on the accountant side)
 * and downloads it as a file.
 */
async function exportPDF(opts: {
  clientName?: string;
  revenue: number;
  costOfSales: number;
  fixedCosts: number;
  interest: number;
  tax: number;
  accountantProfile: import("@/contexts/accountant-profile").AccountantProfile;
}) {
  const { revenue, costOfSales, fixedCosts, interest, tax } = opts;
  const grossProfit = revenue - costOfSales;
  const operatingProfit = grossProfit - fixedCosts;
  const ebt = operatingProfit - interest;
  const netProfit = ebt - tax;

  const [{ pdf }, { ProfitabilityWaterfallPDF }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/reports/profitability-waterfall"),
  ]);

  const now = new Date();
  const period = now.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  const name = opts.clientName?.trim() || "Your Business";

  const blob = await pdf(
    ProfitabilityWaterfallPDF({
      smeData: { name, period },
      profitabilityData: {
        revenue,
        gross_profit: grossProfit,
        gross_margin_pct: revenue ? grossProfit / revenue : 0,
        operating_profit: operatingProfit,
        operating_margin_pct: revenue ? operatingProfit / revenue : 0,
        ebt,
        tax,
        net_profit: netProfit,
        net_margin_pct: revenue ? netProfit / revenue : 0,
      },
      accountantProfile: opts.accountantProfile,
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
}

export function ProfitabilityWaterfall({
  fallback,
  clientName,
}: {
  fallback?: WaterfallFallback;
  clientName?: string;
}) {
  const { weeklyInputs } = useFinancialInputs();
  const { profile } = useAccountantProfile();
  const [open, setOpen] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  const agg = Object.values(weeklyInputs.weeks).reduce(
    (acc, w) => ({
      revenue:     acc.revenue     + (w.revenue     || 0),
      costOfSales: acc.costOfSales + (w.costOfSales || 0),
      fixedCosts:  acc.fixedCosts  + (w.fixedCosts  || 0),
      interest:    acc.interest    + (w.interest    || 0),
      tax:         acc.tax         + (w.tax         || 0),
    }),
    { revenue: 0, costOfSales: 0, fixedCosts: 0, interest: 0, tax: 0 },
  );

  const hasWeekly = agg.revenue > 0 || agg.costOfSales > 0;

  const revenue      = hasWeekly ? agg.revenue     : (fallback?.revenue    ?? 0);
  const costOfSales  = hasWeekly ? agg.costOfSales : (fallback?.cogs       ?? 0);
  const fixedCosts   = hasWeekly ? agg.fixedCosts  : (fallback?.fixedCosts ?? 0);
  const interest     = hasWeekly ? agg.interest    : (fallback?.interest   ?? 0);
  const tax          = hasWeekly ? agg.tax         : (fallback?.tax        ?? 0);

  const grossProfit     = revenue - costOfSales;
  const operatingProfit = grossProfit - fixedCosts;
  const ebt             = operatingProfit - interest;
  const netProfit       = ebt - tax;

  const steps: WfStep[] = [
    { label: "Revenue",            delta: revenue,      runningEnd: revenue,         kind: "total",    showStatus: false },
    { label: "Cost of Sales",      delta: -costOfSales, runningEnd: grossProfit,     kind: "decrease", showStatus: false },
    { label: "Gross Profit",       delta: grossProfit,  runningEnd: grossProfit,     kind: "subtotal", showStatus: true  },
    { label: "Operating Expenses", delta: -fixedCosts,  runningEnd: operatingProfit, kind: "decrease", showStatus: false },
    { label: "Operating Profit",   delta: operatingProfit, runningEnd: operatingProfit, kind: "subtotal", showStatus: true },
    { label: "Interest",           delta: -interest,    runningEnd: ebt,             kind: "decrease", showStatus: false },
    { label: "Tax",                delta: -tax,         runningEnd: netProfit,       kind: "decrease", showStatus: false },
    { label: "Net Profit",         delta: netProfit,    runningEnd: netProfit,       kind: "total",    showStatus: true  },
  ];

  // Vertical scale: from min(0, most-negative running value) to max(revenue, 1)
  const runningValues = steps.map((s) => s.runningEnd);
  const minVal = Math.min(0, ...runningValues);
  const maxVal = Math.max(revenue, 1);
  const range = maxVal - minVal || 1;
  /** y(v) → % height from chart bottom */
  const y = (v: number) => ((v - minVal) / range) * 100;

  const CHART_H = 280; // px

  return (
    <Card className="relative overflow-hidden border border-amber-900/15 bg-[radial-gradient(circle_at_90%_0%,rgba(212,165,80,0.13),transparent_34%),linear-gradient(135deg,#fffdf8,#f8f5ed)] shadow-[0_20px_60px_rgba(109,79,22,0.10)] print:hidden dark:border-slate-800 dark:bg-[radial-gradient(circle_at_90%_0%,rgba(212,165,80,0.12),transparent_34%),linear-gradient(135deg,#111827,#0b1220)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
      <div className="pointer-events-none absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-[#b7872a] via-[#f1d28b] to-transparent" />
      <CardHeader className="border-b border-amber-900/10 pb-5 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div
            className="flex-1 cursor-pointer"
            onClick={() => setOpen((o) => !o)}
          >
            <CardTitle className="text-xl font-semibold tracking-tight text-slate-950 dark:text-slate-100">
              Profitability Waterfall
            </CardTitle>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              How R1 of revenue becomes profit
              {hasWeekly ? " · aggregated weekly data" : " · period inputs"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 border-[#d4a550]/40 bg-[#d4a550]/10 px-2.5 text-[10px] text-[#d4a550] hover:bg-[#d4a550]/20"
              disabled={exporting}
              onClick={async (e) => {
                e.stopPropagation();
                setExporting(true);
                try {
                  await exportPDF({
                    clientName,
                    revenue,
                    costOfSales,
                    fixedCosts,
                    interest,
                    tax,
                    accountantProfile: profile,
                  });
                } finally {
                  setExporting(false);
                }
              }}
            >
              <Download className="h-3 w-3" />
              {exporting ? "Preparing…" : "Export PDF"}
            </Button>
            <button
              type="button"
              className="p-1 text-[#d4a550]"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </CardHeader>

      {open && (
        <CardContent className="pb-7 pt-6">
          {revenue === 0 && (
            <p className="mb-4 rounded-lg border border-amber-900/10 bg-amber-50/70 px-3 py-2 text-xs italic text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
              Enter revenue figures in Financial Inputs or Weekly Inputs above to populate the waterfall.
            </p>
          )}

          {/* ── Waterfall chart ── */}
          <div className="relative w-full" style={{ height: CHART_H + 88 }}>
            {/* horizontal grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((p) => (
              <div
                key={p}
                className="absolute left-0 right-0 border-t border-dashed border-amber-900/10 dark:border-white/10"
                style={{ bottom: 88 + p * CHART_H }}
              />
            ))}
            {/* zero baseline (solid, more visible if negatives present) */}
            <div
              className="absolute left-0 right-0 border-t border-amber-900/25 dark:border-white/25"
              style={{ bottom: 88 + (y(0) / 100) * CHART_H }}
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
                const colorKey: keyof typeof COLORS = negNet ? "netNeg" : s.kind;
                const value = isDec ? Math.abs(s.delta) : s.runningEnd;
                const p = revenue ? value / revenue : 0;
                const status = s.showStatus ? getStatus(revenue ? s.runningEnd / revenue : 0) : null;

                // connector to next bar at this step's running-end level
                const connBottom = 88 + (y(s.runningEnd) / 100) * CHART_H;

                return (
                  <div key={s.label} className="relative min-w-0 flex-1">
                    {/* connector line */}
                    {i < steps.length - 1 && (
                      <div
                        className="absolute z-0 border-t border-dashed border-slate-400/60 transition-opacity duration-700 dark:border-slate-500/60"
                        style={{
                          left: "50%",
                          width: "100%",
                          bottom: connBottom,
                          opacity: mounted ? 1 : 0,
                          transitionDelay: `${i * 90 + 250}ms`,
                        }}
                      />
                    )}

                    {/* value label above bar */}
                    <div
                      className="absolute left-0 right-0 z-10 text-center transition-all duration-500"
                      style={{
                        bottom: 88 + ((barBottomPct + barHeightPct) / 100) * CHART_H + 4,
                        opacity: mounted ? 1 : 0,
                        transitionDelay: `${i * 90 + 150}ms`,
                      }}
                    >
                      <div
                        className="truncate px-0.5 text-[10px] font-extrabold tracking-tight sm:text-[11px]"
                        style={{
                          color: isDec
                            ? "var(--wf-red, #c0392b)"
                            : negNet
                              ? "#c0392b"
                              : undefined,
                        }}
                      >
                        <span className={isDec ? "" : "text-slate-900 dark:text-slate-100"}>
                          {isDec ? `(${fmtCompact(Math.abs(s.delta))})` : fmtCompact(s.runningEnd)}
                        </span>
                      </div>
                      <div className="truncate text-[9px] font-medium text-slate-500 dark:text-slate-400">
                        {pct(value, revenue)}
                      </div>
                    </div>

                    {/* floating bar */}
                    <div
                      className="absolute left-[14%] right-[14%] z-[5] rounded-md shadow-[0_4px_14px_rgba(0,0,0,0.12)] transition-all duration-700 ease-out"
                      style={{
                        bottom: 88 + (barBottomPct / 100) * CHART_H,
                        height: mounted ? `${(barHeightPct / 100) * CHART_H}px` : "0px",
                        background: negNet
                          ? `linear-gradient(180deg, ${COLORS.netNeg.light}, ${COLORS.netNeg.light}cc)`
                          : isDec
                            ? "linear-gradient(180deg, #e05c5c, #c94b4b)"
                            : s.kind === "total"
                              ? "linear-gradient(180deg, #2c5580, #1a3a5c)"
                              : "linear-gradient(180deg, #5cc492, #3f9c72)",
                        transitionDelay: `${i * 90}ms`,
                        transformOrigin: "bottom",
                      }}
                    />

                    {/* column label + badge */}
                    <div className="absolute bottom-0 left-0 right-0 flex h-[84px] flex-col items-center gap-1 pt-2">
                      <span className="w-full truncate px-0.5 text-center text-[9px] font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300 sm:text-[10px]">
                        {s.label}
                      </span>
                      {status && (
                        <span
                          className="rounded border px-1 py-0.5 text-[8px] font-extrabold uppercase tracking-wide sm:px-1.5 sm:text-[9px]"
                          style={{
                            color: status.color,
                            background: status.bg,
                            borderColor: status.color,
                          }}
                        >
                          {status.label}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* legend */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 border-t border-amber-900/10 pt-3 dark:border-slate-800">
            {[
              { c: "linear-gradient(180deg, #2c5580, #1a3a5c)", t: "Revenue / Net Profit" },
              { c: "linear-gradient(180deg, #5cc492, #3f9c72)", t: "Profit subtotal" },
              { c: "linear-gradient(180deg, #e05c5c, #c94b4b)", t: "Cost step" },
            ].map((l) => (
              <span key={l.t} className="flex items-center gap-1.5 text-[10px] font-medium text-slate-600 dark:text-slate-400">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: l.c }} />
                {l.t}
              </span>
            ))}
          </div>

          {/* detail rows */}
          <div className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            {steps
              .filter((s) => s.showStatus)
              .map((s) => {
                const status = getStatus(revenue ? s.runningEnd / revenue : 0);
                return (
                  <div
                    key={s.label}
                    className="flex items-center justify-between gap-2 rounded-lg border border-amber-900/10 bg-white/60 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/50"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                        {s.label}
                      </div>
                      <div className="truncate text-sm font-extrabold tracking-tight text-slate-950 dark:text-white">
                        {fmt(s.runningEnd)}
                        <span className="ml-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          {pct(s.runningEnd, revenue)}
                        </span>
                      </div>
                    </div>
                    <span
                      className="shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide"
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
        </CardContent>
      )}
    </Card>
  );
}
