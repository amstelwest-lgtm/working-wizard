import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartShapeToggle, type ChartShape } from "@/components/profit/chart-shape-toggle";
import { ViewToggle } from "@/components/ui/view-toggle";
import { useMarketFormat } from "@/contexts/market";
import { formatMoneyChartTick, formatMoneyCompact } from "@/lib/market/format";
import { ownerMinus } from "@/lib/owner-money";
import {
  presentProfitSeries,
  profitChartPoints,
  profitChartValue,
  type ProfitInterval,
  type ProfitSeriesPoint,
  type ProfitSnapshot,
} from "@/lib/profit-statement";

const PROFIT_COLOR = "#102A43";

function defaultStart(points: readonly ProfitSeriesPoint[]): string {
  const latest = points[points.length - 1];
  if (!latest) return "";
  return `${latest.sort.slice(0, 4)}-01-01`;
}

/** Net profit, then operating profit, then gross profit. */
function chartProfit(point: ProfitSeriesPoint): number | null {
  return profitChartValue(point);
}

export function ProfitChart({
  financials,
  snapshots,
  currentPeriodEnd = null,
  currentLabel = null,
  signed = false,
}: {
  financials: Record<string, unknown> | null | undefined;
  snapshots?: readonly ProfitSnapshot[] | null;
  currentPeriodEnd?: string | null;
  currentLabel?: string | null;
  signed?: boolean;
}) {
  const { market } = useMarketFormat();
  const [shape, setShape] = useState<ChartShape>("line");
  const [interval, setInterval] = useState<ProfitInterval>("month");
  const [start, setStart] = useState("");
  const allPoints = useMemo(
    () =>
      profitChartPoints({
        snapshots,
        current: financials,
        currentPeriodEnd,
        currentLabel,
      }),
    [snapshots, financials, currentPeriodEnd, currentLabel],
  );
  const startDate = start || defaultStart(allPoints);
  const presented = useMemo(
    () => presentProfitSeries(allPoints, { interval, startDate }),
    [allPoints, interval, startDate],
  );
  const data = presented.points.map((point) => ({ ...point, profit: chartProfit(point) }));
  const hasProfit = data.some((point) => point.profit != null);
  const compact = (value: number) => {
    const text = formatMoneyCompact(value, market);
    return signed ? ownerMinus(text) : text;
  };
  const tick = (value: number) => {
    const text = formatMoneyChartTick(value, market);
    return signed ? ownerMinus(text) : text;
  };

  return (
    <section
      className="rounded-2xl border border-[#DBEAFE] bg-white p-4 text-[#102A43] shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      data-profit-chart=""
      data-profit-chart-series="profit"
      data-profit-chart-shape={shape}
      data-profit-chart-interval={interval}
      aria-label="Profitability"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ChartShapeToggle value={shape} onChange={setShape} />
        <ViewToggle
          ariaLabel="Interval"
          value={interval}
          onChange={(next) => setInterval(next === "week" || next === "year" ? next : "month")}
          options={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
            { value: "year", label: "Year" },
          ]}
        />
        <label className="flex items-center gap-2 text-[13px] font-semibold text-[#486581]">
          Start
          <input
            type="date"
            value={startDate}
            aria-label="Start date"
            data-profit-start=""
            className="h-9 rounded-md border border-[#DBEAFE] bg-white px-2 text-sm font-medium text-[#102A43] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            onChange={(event) => setStart(event.target.value)}
          />
        </label>
      </div>
      {presented.note ? (
        <p className="mt-3 text-[13px] text-[#486581]" data-profit-chart-note="">
          {presented.note}
        </p>
      ) : null}
      {!data.length || !hasProfit ? (
        <p className="mt-6 text-sm text-[#102A43]" data-profit-chart="empty">
          Add a profit and loss to see profit.
        </p>
      ) : (
        <div className="mt-4 h-[300px] w-full min-w-0" data-profit-axis="chart">
          <ResponsiveContainer width="100%" height="100%">
            {shape === "line" ? (
              <LineChart data={data} margin={{ top: 22, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(148,163,184,0.35)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => tick(Number(value))}
                  width={56}
                />
                <Tooltip formatter={(value: number) => [compact(Number(value)), "Profit"]} />
                <Line
                  type="monotone"
                  dataKey="profit"
                  name="Profit"
                  stroke={PROFIT_COLOR}
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: PROFIT_COLOR, stroke: "#fff", strokeWidth: 1 }}
                  connectNulls={false}
                >
                  <LabelList
                    dataKey="profit"
                    position="top"
                    formatter={(value: number) => (value == null ? "" : compact(value))}
                    fill={PROFIT_COLOR}
                    fontSize={11}
                  />
                </Line>
              </LineChart>
            ) : (
              <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(148,163,184,0.35)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => tick(Number(value))}
                  width={56}
                />
                <Tooltip formatter={(value: number) => [compact(Number(value)), "Profit"]} />
                <Bar
                  dataKey="profit"
                  name="Profit"
                  fill={PROFIT_COLOR}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
