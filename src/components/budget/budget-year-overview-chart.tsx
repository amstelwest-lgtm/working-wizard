/**
 * Budget year overview — FY revenue bars + subtle trend line above the budget grid.
 * Data: computeBudgetMonths(doc, activeScenario) — same engine as the P&L table.
 */

import { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BudgetDocument } from "@/lib/budget.types";
import { computeBudgetMonths, fmtBudgetMoney } from "@/lib/budget.compute";
import { budgetWindowLabel, formatMonthLabel } from "@/lib/budget.months";
import { useMarketFormat } from "@/contexts/market";

const GOLD = "#d4a550";
const GOLD_DARK = "#b8860b";
const TREND = "rgba(184, 134, 11, 0.75)";

type ChartRow = {
  month: string;
  label: string;
  revenue: number;
  trend: number;
};

function shortMonth(ym: string, market: ReturnType<typeof useMarketFormat>["market"]) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(market.locale, {
    month: "short",
    timeZone: "UTC",
  });
}

/** Centered 3-month rolling average — cheap trend overlay for the combo chart. */
function rollingTrend(values: number[], window = 3): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length, i + half + 1);
    const slice = values.slice(start, end);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

export function BudgetYearOverviewChart({ doc }: { doc: BudgetDocument }) {
  const { market, moneyCompact } = useMarketFormat();
  const money = (n: number) => fmtBudgetMoney(n, market);
  const monthLabel = (ym: string) => formatMonthLabel(ym, market);

  const results = useMemo(
    () => computeBudgetMonths(doc, doc.activeScenario),
    [doc],
  );

  const chartData = useMemo<ChartRow[]>(() => {
    const revenues = results.map((r) => r.revenue);
    const trends = rollingTrend(revenues);
    return results.map((r, i) => ({
      month: r.month,
      label: shortMonth(r.month, market),
      revenue: r.revenue,
      trend: trends[i],
    }));
  }, [results, market]);

  const fyTotals = useMemo(() => {
    const revenue = results.reduce((s, r) => s + r.revenue, 0);
    const ebit = results.reduce((s, r) => s + r.ebit, 0);
    return { revenue, ebit };
  }, [results]);

  const isEmpty =
    fyTotals.revenue === 0 &&
    fyTotals.ebit === 0 &&
    results.every((r) => r.overheads === 0 && r.cogs === 0);

  const scenarioLabel = doc.scenarios[doc.activeScenario]?.label ?? doc.activeScenario;
  const fyCaption = budgetWindowLabel(doc, market);

  return (
    <section
      id="wizard-budget-year-chart"
      className="rounded-xl border border-slate-200/80 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/50"
      aria-label="Budget year overview"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b8860b]">
            Year at a glance
          </p>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {fyCaption}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Monthly revenue with trend · {scenarioLabel} scenario
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isEmpty ? (
            <span className="inline-flex items-center rounded-full border border-slate-400/50 bg-slate-500/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Awaiting drivers
            </span>
          ) : (
            <>
              <span className="rounded-lg border border-[#d4a550]/25 bg-[#d4a550]/5 px-2.5 py-1.5 text-right">
                <span className="block text-[9px] font-semibold uppercase tracking-wider text-[#b8860b]">
                  FY revenue
                </span>
                <span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {money(fyTotals.revenue)}
                </span>
              </span>
              <span
                className={`rounded-lg border px-2.5 py-1.5 text-right ${
                  fyTotals.ebit < 0
                    ? "border-red-500/30 bg-red-500/5"
                    : "border-emerald-500/30 bg-emerald-500/5"
                }`}
              >
                <span className="block text-[9px] font-semibold uppercase tracking-wider text-slate-500">
                  FY EBIT
                </span>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    fyTotals.ebit < 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-700 dark:text-emerald-400"
                  }`}
                >
                  {money(fyTotals.ebit)}
                </span>
              </span>
            </>
          )}
        </div>
      </div>

      <div className="relative h-[220px] w-full sm:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="budgetRevFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={GOLD} stopOpacity={isEmpty ? 0.08 : 0.85} />
                <stop offset="100%" stopColor={GOLD_DARK} stopOpacity={isEmpty ? 0.04 : 0.35} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="#94a3b8"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => moneyCompact(v)}
              width={52}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(17,24,39,0.95)",
                border: "1px solid rgba(212,165,80,0.4)",
                borderRadius: 10,
                fontSize: 12,
                color: "#f1f5f9",
              }}
              labelStyle={{ color: GOLD, fontWeight: 700 }}
              formatter={(value: number, name: string) => [
                money(value),
                name === "revenue" ? "Revenue" : "Trend (3-mo avg)",
              ]}
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as ChartRow | undefined;
                return row ? monthLabel(row.month) : "";
              }}
            />
            <Bar
              dataKey="revenue"
              name="revenue"
              fill="url(#budgetRevFill)"
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
              isAnimationActive={!isEmpty}
              animationDuration={700}
            />
            <Line
              type="monotone"
              dataKey="trend"
              name="trend"
              stroke={TREND}
              strokeWidth={1.75}
              strokeDasharray="6 4"
              dot={false}
              activeDot={{ r: 3, fill: GOLD_DARK, stroke: "#fff", strokeWidth: 1 }}
              isAnimationActive={!isEmpty}
              animationDuration={700}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
            <p className="max-w-sm rounded-lg border border-dashed border-[#d4a550]/35 bg-white/80 px-4 py-3 text-center text-xs leading-relaxed text-slate-600 dark:bg-slate-950/80 dark:text-slate-300">
              Enter volume and price on your drivers — this chart fills in as you plan the year.
            </p>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4 text-[10px] uppercase tracking-wider text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-gradient-to-b from-[#d4a550] to-[#b8860b]" />
          Revenue
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded"
            style={{ background: TREND, borderTop: "1px dashed rgba(184,134,11,0.5)" }}
          />
          Trend
        </span>
      </div>
    </section>
  );
}
