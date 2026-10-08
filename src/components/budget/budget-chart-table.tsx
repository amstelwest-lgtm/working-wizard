/**
 * Chart or table of the budget already on file, directly under the answer strip.
 * Actuals are the month rows the variance panel already loads. Nothing here
 * writes a budget.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMarketFormat } from "@/contexts/market";
import { ScrollableTable } from "@/components/primitives/scrollable-table";
import { ViewToggle } from "@/components/ui/view-toggle";
import { fmtBudgetMoney } from "@/lib/budget.compute";
import {
  budgetMonthViews,
  budgetTableRows,
  budgetYtdSentence,
  budgetYtdSignal,
  revenueYtd,
  type BudgetActualMonth,
  type BudgetLens,
  type BudgetMonthView,
  type BudgetTableCell,
} from "@/lib/budget-chart-table";
import type { BudgetDocument } from "@/lib/budget.types";
import { currentBudgetMonth, formatMonthLabel, fyMonths } from "@/lib/budget.months";
import { listBudgetMonthActuals } from "@/lib/budget-actuals.functions";
import { formatMoneyChartTick } from "@/lib/market/format";
import type { VarianceSignal } from "@/lib/budget.variance";

const BUDGET_BAR = "#d4a550";
const BUDGET_ONLY = "#94a3b8";
const ACTUAL_BAR = "#3d4f66";

function tone(signal: VarianceSignal | null): string {
  if (signal === "favourable") return "text-emerald-700 dark:text-emerald-400";
  if (signal === "adverse") return "text-red-600 dark:text-red-400";
  return "text-slate-500";
}

function shortMonth(ym: string, locale: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleString(locale, {
    month: "short",
    timeZone: "UTC",
  });
}

export function BudgetChartTable({
  doc,
  clientId,
  lens,
  onLensChange,
  actualMonths,
}: {
  doc: BudgetDocument;
  clientId?: string;
  lens?: BudgetLens;
  onLensChange?: (next: BudgetLens) => void;
  /** Harness preview. Production leaves this empty and reads stored month actuals. */
  actualMonths?: readonly BudgetActualMonth[];
}) {
  const { market } = useMarketFormat();
  const money = (n: number) => fmtBudgetMoney(n, market);
  const listActuals = useServerFn(listBudgetMonthActuals);
  const [loaded, setLoaded] = useState<BudgetActualMonth[]>(actualMonths ? [...actualMonths] : []);
  const [localLens, setLocalLens] = useState<BudgetLens>(lens ?? "chart");
  const shown = lens ?? localLens;

  useEffect(() => {
    if (actualMonths) {
      setLoaded([...actualMonths]);
      return;
    }
    if (!clientId) {
      setLoaded([]);
      return;
    }
    let cancelled = false;
    listActuals({ data: { clientId, fyStart: doc.fyStart } })
      .then((res) => {
        if (cancelled) return;
        setLoaded(
          (res.actuals ?? []).map((row) => ({
            month: row.month,
            totals: row.totals,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setLoaded([]);
      });
    return () => {
      cancelled = true;
    };
  }, [actualMonths, clientId, doc.fyStart, listActuals]);

  const views = useMemo(() => budgetMonthViews(doc, loaded), [doc, loaded]);
  const months = useMemo(() => fyMonths(doc.fyStart), [doc.fyStart]);
  const through = currentBudgetMonth(months);
  const ytd = revenueYtd(views, through);
  const sentence = budgetYtdSentence({ ...ytd, money });
  const ytdTone = tone(budgetYtdSignal(ytd));

  const choose = (next: BudgetLens) => {
    setLocalLens(next);
    onLensChange?.(next);
  };

  return (
    <section
      className="budget-lens min-w-0 max-w-full rounded-2xl border border-[#d4a550]/25 bg-white/80 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/50"
      data-budget-lens={shown}
      aria-label="Budget chart and table"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#1b1608] dark:text-slate-100">Budget vs actual</h3>
          <p className={`mt-1 text-[13px] leading-snug ${ytdTone}`} data-ytd-signal={budgetYtdSignal(ytd) ?? "none"}>
            {sentence}
          </p>
        </div>
        <ViewToggle
          value={shown}
          ariaLabel="Chart or table"
          options={[
            { value: "chart", label: "Chart" },
            { value: "table", label: "Table" },
          ]}
          onChange={(next) => choose(next === "table" ? "table" : "chart")}
        />
      </div>

      {shown === "chart" ? (
        <BudgetMonthChart views={views} locale={market.locale} market={market} money={money} />
      ) : (
        <BudgetMonthTable doc={doc} views={views} money={money} locale={market.locale} />
      )}
    </section>
  );
}

function BudgetMonthChart({
  views,
  locale,
  market,
  money,
}: {
  views: BudgetMonthView[];
  locale: string;
  market: Parameters<typeof formatMoneyChartTick>[1];
  money: (n: number) => string;
}) {
  const tick = (n: number) => formatMoneyChartTick(n, market);
  const data = views.map((row) => ({
    month: row.month,
    label: shortMonth(row.month, locale),
    budget: row.budget.revenue,
    actual: row.actual ? row.actual.revenue : null,
    hasActual: Boolean(row.actual),
    signal: row.revenue?.signal ?? null,
    delta: row.revenue?.delta ?? null,
  }));

  return (
    <div className="mt-4 min-w-0">
      <div className="h-[240px] w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="#94a3b8"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              interval={0}
              minTickGap={0}
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => tick(Number(value))}
              width={48}
            />
            <Tooltip
              cursor={{ fill: "rgba(212,165,80,0.08)" }}
              contentStyle={{
                background: "rgba(17,24,39,0.95)",
                border: "1px solid rgba(212,165,80,0.4)",
                borderRadius: 10,
                fontSize: 12,
                color: "#f1f5f9",
              }}
              formatter={(value: number, name: string) => [
                money(value),
                name === "budget" ? "Budget" : "Actual",
              ]}
            />
            <Bar dataKey="budget" name="budget" radius={[3, 3, 0, 0]} maxBarSize={18}>
              {data.map((row) => (
                <Cell
                  key={row.month}
                  fill={row.hasActual ? BUDGET_BAR : BUDGET_ONLY}
                  fillOpacity={row.hasActual ? 0.95 : 0.45}
                />
              ))}
            </Bar>
            <Bar dataKey="actual" name="actual" radius={[3, 3, 0, 0]} maxBarSize={18}>
              {data.map((row) => (
                <Cell key={`${row.month}-a`} fill={row.hasActual ? ACTUAL_BAR : "transparent"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex min-w-0" aria-hidden="true">
        {data.map((row) => (
          <div
            key={`${row.month}-band`}
            className="mx-0.5 h-1.5 min-w-0 flex-1 rounded-full"
            style={{
              background:
                row.signal === "favourable"
                  ? "#059669"
                  : row.signal === "adverse"
                    ? "#dc2626"
                    : row.hasActual
                      ? "#94a3b8"
                      : "rgba(148,163,184,0.35)",
            }}
          />
        ))}
      </div>
      <div className="mt-1 flex min-w-0">
        {data.map((row) => (
          <div key={row.month} className="min-w-0 flex-1 px-0.5 text-center">
            <div className="truncate text-[10px] text-slate-500">{row.label}</div>
            {row.delta == null ? (
              <div className="truncate text-[10px] text-slate-500/40" title="Budget only" aria-label="Budget only">
                –
              </div>
            ) : (
              <div className={`truncate text-[10px] font-semibold tabular-nums ${tone(row.signal)}`}>
                {row.delta > 0 ? `+${tick(row.delta)}` : tick(row.delta)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-600 dark:text-slate-300">
        <LegendSwatch color={BUDGET_BAR} label="Budget" />
        <LegendSwatch color={ACTUAL_BAR} label="Actual" />
        <LegendSwatch color={BUDGET_ONLY} label="Budget only" faded />
        <span className="text-emerald-700 dark:text-emerald-400">Green is favourable</span>
        <span className="text-red-600 dark:text-red-400">Red is adverse</span>
      </div>
    </div>
  );
}

function LegendSwatch({ color, label, faded }: { color: string; label: string; faded?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ background: color, opacity: faded ? 0.45 : 1 }}
      />
      {label}
    </span>
  );
}

function BudgetMonthTable({
  doc,
  views,
  money,
  locale,
}: {
  doc: BudgetDocument;
  views: BudgetMonthView[];
  money: (n: number) => string;
  locale: string;
}) {
  const rows = budgetTableRows(doc, views);
  const months = views.map((row) => row.month);
  return (
    <div className="mt-4 min-w-0">
      <ScrollableTable hint="Swipe sideways to see every month." fadeEdge={false}>
        <table className="budget-grid w-full min-w-[960px] border-separate border-spacing-0 text-xs text-[#0f172a] dark:text-slate-100">
          <thead>
            <tr>
              <th rowSpan={2} className="budget-grid__line px-3 py-2 text-left">
                Line
              </th>
              {months.map((month) => (
                <th key={month} colSpan={3} className="px-2 py-2 text-center">
                  {formatMonthLabel(month, { locale })}
                </th>
              ))}
            </tr>
            <tr>
              {months.map((month) => (
                <MonthHeads key={month} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.kind === "total" ? "budget-grid__total" : row.kind === "subtotal" ? "budget-grid__sub" : undefined}>
                <td className="budget-grid__line px-3 py-1.5 font-medium">{row.label}</td>
                {row.cells.map((item, index) => (
                  <MonthCells key={`${row.id}-${months[index]}`} item={item} money={money} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}

function MonthHeads() {
  return (
    <>
      <th className="budget-grid__money px-2 py-1 text-right font-medium">Budget</th>
      <th className="budget-grid__money px-2 py-1 text-right font-medium">Actual</th>
      <th className="budget-grid__money px-2 py-1 text-right font-medium">Variance</th>
    </>
  );
}

function MonthCells({
  item,
  money,
}: {
  item: BudgetTableCell;
  money: (n: number) => string;
}) {
  return (
    <>
      <td className="budget-grid__money px-2 py-1.5 text-right tabular-nums">{money(item.budget)}</td>
      <td className="budget-grid__money px-2 py-1.5 text-right tabular-nums">
        {item.actual == null ? "—" : money(item.actual)}
      </td>
      <td className={`budget-grid__money px-2 py-1.5 text-right tabular-nums ${tone(item.variance?.signal ?? null)}`}>
        {item.variance == null ? "—" : money(item.variance.delta)}
      </td>
    </>
  );
}
