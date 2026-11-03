import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartShapeToggle, type ChartShape } from "@/components/profit/chart-shape-toggle";
import { ProfitSeriesMenu } from "@/components/profit/profit-series-menu";
import { ViewToggle } from "@/components/ui/view-toggle";
import { useMarketFormat } from "@/contexts/market";
import { formatMoneyChartTick, formatMoneyCompact } from "@/lib/market/format";
import { ownerMinus } from "@/lib/owner-money";
import {
  presentProfitSeries,
  profitSeriesHasValues,
  profitSeriesKeys,
  profitSeriesPoints,
  type ProfitFlows,
  type ProfitInterval,
  type ProfitSeriesId,
  type ProfitSeriesPoint,
  type ProfitSnapshot,
} from "@/lib/profit-statement";

const COLOR: Record<keyof ProfitFlows, string> = {
  income: "#102A43",
  sales: "#102A43",
  otherIncome: "#38BDF8",
  cogs: "#2563EB",
  expenses: "#E05C5C",
  grossProfit: "#0B5FFF",
  operatingProfit: "#0B5FFF",
  netProfit: "#102A43",
  breakEven: "#0B5FFF",
};

const NAME: Record<keyof ProfitFlows, string> = {
  income: "Income",
  sales: "Sales",
  otherIncome: "Other income",
  cogs: "Cost of sales",
  expenses: "Expenses",
  grossProfit: "Gross profit",
  operatingProfit: "Operating profit",
  netProfit: "Net profit",
  breakEven: "Break-even",
};

function defaultStart(points: readonly ProfitSeriesPoint[]): string {
  const latest = points[points.length - 1];
  if (!latest) return "";
  return `${latest.sort.slice(0, 4)}-01-01`;
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
  const [series, setSeries] = useState<ProfitSeriesId>("income-expenses");
  const [shape, setShape] = useState<ChartShape>("line");
  const [interval, setInterval] = useState<ProfitInterval>("month");
  const [start, setStart] = useState("");
  const allPoints = useMemo(
    () =>
      profitSeriesPoints({
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
  const keys = profitSeriesKeys(series);
  const hasValues = profitSeriesHasValues(presented.points, series);
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
      data-profit-chart-series={series}
      data-profit-chart-shape={shape}
      data-profit-chart-interval={interval}
      aria-label="Profitability"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProfitSeriesMenu value={series} onChange={setSeries} />
        <ChartShapeToggle value={shape} onChange={setShape} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
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
      {!presented.points.length || !hasValues ? (
        <p className="mt-6 text-sm text-[#102A43]" data-profit-chart="empty">
          {!presented.points.length
            ? "Add a profit and loss to see income and expenses."
            : "That series is not on the statement."}
        </p>
      ) : (
        <div className="mt-4 h-[300px] w-full min-w-0" data-profit-axis="chart">
          <ResponsiveContainer width="100%" height="100%">
            {shape === "line" ? (
              <LineChart
                data={presented.points}
                margin={{ top: 22, right: 12, left: 0, bottom: 0 }}
              >
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
                <Tooltip
                  formatter={(value: number, name: string) => [compact(Number(value)), name]}
                />
                <Legend />
                {keys.map((key) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={NAME[key]}
                    stroke={COLOR[key]}
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: COLOR[key], stroke: "#fff", strokeWidth: 1 }}
                    connectNulls={false}
                  >
                    <LabelList
                      dataKey={key}
                      position="top"
                      formatter={(value: number) => (value == null ? "" : compact(value))}
                      fill={COLOR[key]}
                      fontSize={11}
                    />
                  </Line>
                ))}
              </LineChart>
            ) : (
              <BarChart data={presented.points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
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
                <Tooltip
                  formatter={(value: number, name: string) => [compact(Number(value)), name]}
                />
                <Legend />
                {keys.map((key) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    name={NAME[key]}
                    fill={COLOR[key]}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={28}
                  />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
