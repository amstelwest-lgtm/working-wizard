/**
 * Chart or table of the budget already on file, directly under the answer strip.
 * Actuals are the month rows the variance panel already loads. Nothing here
 * writes a budget.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMarketFormat } from "@/contexts/market";
import { ScrollableTable } from "@/components/primitives/scrollable-table";
import { ViewToggle } from "@/components/ui/view-toggle";
import { hotelLineDisplayName } from "@/lib/budget-industry";
import { fmtBudgetMoney } from "@/lib/budget.compute";
import { budgetStatementTiles } from "@/lib/budget-period";
import type { FiscalStatementSlice } from "@/lib/budget-period-types";
import type { BudgetTemplateId } from "@/lib/budget.types";
import { ownerMinus } from "@/lib/owner-money";
import {
  budgetMonthViews,
  budgetPeriodTotalCell,
  budgetPlanIsSet,
  budgetRangeTotals,
  budgetTableRows,
  budgetYtdSentence,
  budgetYtdSignal,
  budgetYtdWithStatement,
  niceBudgetAxis,
  revenueYtd,
  type BudgetActualMonth,
  type BudgetLens,
  type BudgetMonthView,
  type BudgetTableCell,
} from "@/lib/budget-chart-table";
import type { BudgetDocument } from "@/lib/budget.types";
import { MONTHS } from "@/lib/market/date-presets";
import { currentBudgetMonth, formatBudgetMonthYear, fyMonths } from "@/lib/budget.months";
import { listBudgetMonthActuals } from "@/lib/budget-actuals.functions";
import { formatMoneyChartTick } from "@/lib/market/format";
import type { VarianceSignal } from "@/lib/budget.variance";

const BUDGET_BAR = "#38BDF8";
const BUDGET_ONLY = "#94a3b8";
const ACTUAL_BAR = "#3d4f66";

function tone(signal: VarianceSignal | null): string {
  if (signal === "favourable") return "text-emerald-700 dark:text-emerald-400";
  if (signal === "adverse") return "text-red-600 dark:text-red-400";
  return "text-slate-500";
}

function tileText(amount: number | null, money: (n: number) => string): string {
  return amount == null ? "—" : money(amount);
}

function shortMonth(ym: string): string {
  const month = Number(ym.split("-")[1]);
  return MONTHS[month - 1] ?? ym;
}

export function BudgetChartTable({
  doc,
  clientId,
  lens,
  onLensChange,
  actualMonths,
  statementActuals = null,
  readOnly = false,
  signed = false,
  displayTemplateId = null,
  periodCaption = null,
  uniformNote = null,
  windowMonths = null,
}: {
  doc: BudgetDocument;
  clientId?: string;
  lens?: BudgetLens;
  onLensChange?: (next: BudgetLens) => void;
  /** Harness preview. Production leaves this empty and reads stored month actuals. */
  actualMonths?: readonly BudgetActualMonth[];
  /** Statement comparison already on the verdict strip. The firm-year slice, when present, is what the tiles show. */
  statementActuals?: {
    chip?: string | null;
    revenue?: number | null;
    budgetRevenue?: number | null;
    period?: FiscalStatementSlice | null;
  } | null;
  /** Owner view hides a $0 draft instead of drawing an empty axis. */
  readOnly?: boolean;
  /** Owner door uses one unicode minus. The accountant table keeps its formatter. */
  signed?: boolean;
  /** Industry kit. Labour line names on a hotel render as the hotel drivers. */
  displayTemplateId?: BudgetTemplateId | null;
  /** Visible window, with both periods named when the books year differs. */
  periodCaption?: string | null;
  /** Flat year from a statement seed or a copy-forward. */
  uniformNote?: string | null;
  /** Statement window. Totals match the verdict instead of the whole year. */
  windowMonths?: readonly string[] | null;
}) {
  const { market } = useMarketFormat();
  const money = (n: number) => {
    const text = fmtBudgetMoney(n, market);
    return signed ? ownerMinus(text) : text;
  };
  const listActuals = useServerFn(listBudgetMonthActuals);
  const [loaded, setLoaded] = useState<BudgetActualMonth[]>(actualMonths ? [...actualMonths] : []);
  const [actualsPending, setActualsPending] = useState(!actualMonths && Boolean(clientId));
  const [uncontrolledLens, setUncontrolledLens] = useState<BudgetLens>("chart");
  const activeLens = lens ?? uncontrolledLens;
  const selectLens = (next: string) => {
    const value: BudgetLens = next === "table" ? "table" : "chart";
    if (!lens) setUncontrolledLens(value);
    onLensChange?.(value);
  };

  useEffect(() => {
    if (actualMonths) {
      setLoaded([...actualMonths]);
      return;
    }
    if (!clientId) {
      setLoaded([]);
      setActualsPending(false);
      return;
    }
    let cancelled = false;
    setActualsPending(true);
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
      })
      .finally(() => {
        if (!cancelled) setActualsPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [actualMonths, clientId, doc.fyStart, listActuals]);

  const views = useMemo(() => budgetMonthViews(doc, loaded), [doc, loaded]);
  const scopedViews = useMemo(() => {
    // No window means the whole plan. An empty window is a statement that
    // is not scored, so the chart does not total the year in its place.
    if (windowMonths == null) return views;
    const wanted = windowMonths.filter(Boolean);
    if (!wanted.length) return [];
    const scoped = views.filter((row) => wanted.includes(row.month));
    return scoped.length ? scoped : views;
  }, [views, windowMonths]);
  const planTotals = useMemo(() => budgetRangeTotals(scopedViews), [scopedViews]);
  const totals = useMemo(() => {
    if (statementActuals?.period) return budgetStatementTiles(statementActuals.period);
    return {
      revenue: planTotals.revenue,
      expenses: planTotals.expenses,
      operatingProfit: planTotals.net,
    };
  }, [statementActuals, planTotals]);
  const months = useMemo(() => fyMonths(doc.fyStart), [doc.fyStart]);
  const through = currentBudgetMonth(months);
  const ytd = budgetYtdWithStatement(revenueYtd(scopedViews, through), statementActuals);
  const sentence = budgetYtdSentence({ ...ytd, money });
  const ytdTone = tone(budgetYtdSignal(ytd));

  if (readOnly && !budgetPlanIsSet(views)) {
    return (
      <p
        className="budget-lens flex items-center gap-2 rounded-lg bg-[#DBEAFE] px-3 py-2 text-[13px] leading-snug text-[#102A43]"
        data-budget-chart="draft"
        data-budget-lens="chart"
      >
        <Info className="h-4 w-4 shrink-0 text-[#0B5FFF]" aria-hidden />
        Your accountant is still setting the budget
      </p>
    );
  }

  return (
    <section
      className="budget-lens min-w-0 max-w-full rounded-2xl border border-[#DBEAFE] bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/50"
      data-budget-lens={activeLens}
      data-budget-paint="ready"
      aria-label="Budget chart and table"
      aria-busy={actualsPending || undefined}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#102A43] dark:text-slate-100">Budget vs actual</h3>
          {periodCaption ? (
            <p className="mt-1 text-[13px] leading-snug text-[#3D5270] dark:text-slate-300" data-budget-period>
              {periodCaption}
            </p>
          ) : null}
          <p className={`mt-1 text-[13px] leading-snug ${ytdTone}`} data-ytd-signal={budgetYtdSignal(ytd) ?? "none"}>
            {sentence}
          </p>
          {uniformNote ? (
            <p className="mt-1 text-[13px] leading-snug text-[#102A43] dark:text-[#93c5fd]" data-budget-uniform>
              {uniformNote}
            </p>
          ) : null}
        </div>
        <ViewToggle
          ariaLabel="Budget"
          value={activeLens}
          onChange={selectLens}
          options={[
            { value: "chart", label: "Chart" },
            { value: "table", label: "Table" },
          ]}
        />
      </div>
      <BudgetRangeTotalsRow totals={totals} money={money} />
      {actualsPending ? (
        <p className="sr-only" role="status">
          Loading monthly actuals
        </p>
      ) : null}
      {activeLens === "table" ? (
        <BudgetMonthTable
          doc={doc}
          views={scopedViews}
          totals={totals}
          money={money}
          market={market}
          displayTemplateId={displayTemplateId}
        />
      ) : (
        <BudgetMonthChart views={scopedViews} market={market} money={money} signed={signed} />
      )}
    </section>
  );
}

function BudgetRangeTotalsRow({
  totals,
  money,
}: {
  totals: { revenue: number | null; expenses: number | null; operatingProfit: number | null };
  money: (n: number) => string;
}) {
  const items = [
    ["Revenue", totals.revenue],
    ["Expenses", totals.expenses],
    ["Operating profit", totals.operatingProfit],
  ] as const;
  return (
    <div
      className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-[#F4F8FF] px-3 py-2 dark:bg-slate-900"
      data-budget-totals=""
    >
      {items.map(([label, amount]) => (
        <div key={label} className="min-w-0" data-budget-tile={label}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[#3D5270] dark:text-slate-400">
            {label}
          </div>
          <div className="truncate text-sm font-semibold tabular-nums text-[#102A43] dark:text-slate-100">
            {tileText(amount, money)}
          </div>
        </div>
      ))}
    </div>
  );
}

function BudgetMonthTick({
  x = 0,
  y = 0,
  payload,
  index = 0,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
  index?: number;
}) {
  const label = payload?.value ?? "";
  // Two rows. Twelve horizontal names do not fit on one line at 390px.
  const drop = index % 2 === 0 ? 12 : 26;
  return (
    <text x={x} y={y + drop} textAnchor="middle" fill="currentColor" fontSize={11} fontWeight={600}>
      {label}
    </text>
  );
}

function BudgetMonthChart({
  views,
  market,
  money,
  signed = false,
}: {
  views: BudgetMonthView[];
  market: Parameters<typeof formatMoneyChartTick>[1];
  money: (n: number) => string;
  signed?: boolean;
}) {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  const tick = (n: number) => {
    const text = formatMoneyChartTick(n, market);
    return signed ? ownerMinus(text) : text;
  };
  const data = views.map((row) => ({
    month: row.month,
    label: shortMonth(row.month),
    budget: row.budget.revenue,
    actual: row.actual ? row.actual.revenue : null,
    hasActual: Boolean(row.actual),
    signal: row.revenue?.signal ?? null,
    delta: row.revenue?.delta ?? null,
  }));
  const axis = niceBudgetAxis(data.flatMap((row) => [row.budget, row.actual]));

  return (
    <div className="mt-4 min-w-0">
      <div className="h-[240px] w-full min-w-0 text-[#102A43] dark:text-slate-100" data-budget-axis="chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: narrow ? 8 : 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
            <XAxis
              dataKey="label"
              stroke="#94a3b8"
              tickLine={false}
              axisLine={false}
              interval={0}
              minTickGap={0}
              height={narrow ? 40 : 4}
              tick={narrow ? BudgetMonthTick : false}
            />
            <YAxis
              stroke="#94a3b8"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              domain={axis?.domain}
              ticks={axis?.ticks}
              allowDecimals={false}
              tickFormatter={(value) => tick(Number(value))}
              width={56}
            />
            <Tooltip
              cursor={{ fill: "rgba(56,189,248,0.12)" }}
              contentStyle={{
                background: "rgba(17,24,39,0.95)",
                border: "1px solid rgba(11,95,255,0.35)",
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
      <div className={`mt-1 flex min-w-0${narrow ? " hidden" : ""}`} data-budget-axis="readout">
        {data.map((row) => (
          <div key={row.month} className="min-w-0 flex-1 px-0.5 text-center">
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{row.label}</div>
            {row.delta == null ? (
              <div className="truncate text-[10px] text-slate-500/40" title="Budget only" aria-label="Budget only">
                –
              </div>
            ) : (
              <div className={`truncate text-sm font-semibold tabular-nums ${tone(row.signal)}`}>
                {row.delta > 0 ? `+${tick(row.delta)}` : tick(row.delta)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-800 dark:text-slate-100">
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
  totals,
  money,
  market,
  displayTemplateId = null,
}: {
  doc: BudgetDocument;
  views: BudgetMonthView[];
  totals: { revenue: number | null; expenses: number | null; operatingProfit: number | null };
  money: (n: number) => string;
  market: Parameters<typeof formatBudgetMonthYear>[1];
  displayTemplateId?: BudgetTemplateId | null;
}) {
  const rows = budgetTableRows(doc, views, (name, index) =>
    hotelLineDisplayName(displayTemplateId, name, index),
  );
  const months = views.map((row) => row.month);
  const periodTotal = [
    `Revenue ${tileText(totals.revenue, money)}`,
    `Expenses ${tileText(totals.expenses, money)}`,
    `Operating profit ${tileText(totals.operatingProfit, money)}`,
  ].join(" · ");
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
                  {formatBudgetMonthYear(month, market)}
                </th>
              ))}
              <th colSpan={3} className="px-2 py-2 text-center">
                Total
              </th>
            </tr>
            <tr>
              {months.map((month) => (
                <MonthHeads key={month} />
              ))}
              <MonthHeads />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.kind === "total" ? "budget-grid__total" : row.kind === "subtotal" ? "budget-grid__sub" : undefined}>
                <td className="budget-grid__line px-3 py-1.5 font-medium">{row.label}</td>
                {row.cells.map((item, index) => (
                  <MonthCells key={`${row.id}-${months[index]}`} item={item} money={money} />
                ))}
                <MonthCells
                  item={budgetPeriodTotalCell(row.cells, "ebit", row.label, row.higherIsBetter)}
                  money={money}
                />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr data-budget-totals-row="" className="budget-grid__total">
              <th className="budget-grid__line px-3 py-2 text-left font-semibold" colSpan={1 + months.length * 3 + 3}>
                Period total · {periodTotal}
              </th>
            </tr>
          </tfoot>
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
      <td className="budget-grid__money px-2 py-1.5 text-right tabular-nums">
        {item.budget == null ? "—" : money(item.budget)}
      </td>
      <td className="budget-grid__money px-2 py-1.5 text-right tabular-nums">
        {item.actual == null ? "—" : money(item.actual)}
      </td>
      <td className={`budget-grid__money px-2 py-1.5 text-right tabular-nums ${tone(item.variance?.signal ?? null)}`}>
        {item.variance == null ? "—" : money(item.variance.delta)}
      </td>
    </>
  );
}
