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
import { hotelLineDisplayName } from "@/lib/budget-industry";
import { fmtBudgetMoney } from "@/lib/budget.compute";
import type { BudgetTemplateId } from "@/lib/budget.types";
import { ownerMinus } from "@/lib/owner-money";
import {
  budgetChartDomain,
  budgetMonthViews,
  budgetPlanIsSet,
  budgetTableRows,
  budgetYtdSentence,
  budgetYtdSignal,
  budgetYtdWithStatement,
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

const BUDGET_BAR = "#38BDF8";
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
  statementActuals = null,
  readOnly = false,
  signed = false,
  displayTemplateId = null,
}: {
  doc: BudgetDocument;
  clientId?: string;
  lens?: BudgetLens;
  onLensChange?: (next: BudgetLens) => void;
  /** Harness preview. Production leaves this empty and reads stored month actuals. */
  actualMonths?: readonly BudgetActualMonth[];
  /** Statement comparison already on the verdict strip. Used when month rows are empty. */
  statementActuals?: { chip?: string | null; revenue?: number | null; budgetRevenue?: number | null } | null;
  /** Owner view hides a $0 draft instead of drawing an empty axis. */
  readOnly?: boolean;
  /** Owner door uses one unicode minus. The accountant table keeps its formatter. */
  signed?: boolean;
  /** Industry kit. Labour line names on a hotel render as the hotel drivers. */
  displayTemplateId?: BudgetTemplateId | null;
}) {
  const { market } = useMarketFormat();
  const money = (n: number) => {
    const text = fmtBudgetMoney(n, market);
    return signed ? ownerMinus(text) : text;
  };
  const listActuals = useServerFn(listBudgetMonthActuals);
  const [loaded, setLoaded] = useState<BudgetActualMonth[]>(actualMonths ? [...actualMonths] : []);
  const monthsOpen = lens === "table";

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
  const ytd = budgetYtdWithStatement(revenueYtd(views, through), statementActuals);
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
      data-budget-lens="chart"
      aria-label="Budget chart and table"
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-[#102A43] dark:text-slate-100">Budget vs actual</h3>
        <p className={`mt-1 text-[13px] leading-snug ${ytdTone}`} data-ytd-signal={budgetYtdSignal(ytd) ?? "none"}>
          {sentence}
        </p>
      </div>
      <BudgetMonthChart views={views} locale={market.locale} market={market} money={money} signed={signed} />
      <details
        className="mt-4"
        {...(onLensChange
          ? {
              open: monthsOpen,
              onToggle: (event: { currentTarget: HTMLDetailsElement }) => {
                const open = event.currentTarget.open;
                if (open === monthsOpen) return;
                onLensChange(open ? "table" : "chart");
              },
            }
          : { defaultOpen: monthsOpen })}
      >
        <summary className="w-fit cursor-pointer text-sm font-semibold text-[#0B5FFF]">
          Month by month
        </summary>
        <div className="mt-3">
          <BudgetMonthTable
            doc={doc}
            views={views}
            money={money}
            locale={market.locale}
            displayTemplateId={displayTemplateId}
          />
        </div>
      </details>
    </section>
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
  locale,
  market,
  money,
  signed = false,
}: {
  views: BudgetMonthView[];
  locale: string;
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
    label: shortMonth(row.month, locale),
    budget: row.budget.revenue,
    actual: row.actual ? row.actual.revenue : null,
    hasActual: Boolean(row.actual),
    signal: row.revenue?.signal ?? null,
    delta: row.revenue?.delta ?? null,
  }));
  const domain = budgetChartDomain(data.flatMap((row) => [row.budget, row.actual]));

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
              domain={domain}
              tickFormatter={(value) => tick(Number(value))}
              width={48}
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
  money,
  locale,
  displayTemplateId = null,
}: {
  doc: BudgetDocument;
  views: BudgetMonthView[];
  money: (n: number) => string;
  locale: string;
  displayTemplateId?: BudgetTemplateId | null;
}) {
  const rows = budgetTableRows(doc, views, (name, index) =>
    hotelLineDisplayName(displayTemplateId, name, index),
  );
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
