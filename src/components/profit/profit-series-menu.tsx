import { useRef, type KeyboardEvent } from "react";
import { PROFIT_SERIES, type ProfitSeriesId } from "@/lib/profit-statement";

/** Series tabs from the profitability chart: Income vs Expenses through Break-Even. */
export function ProfitSeriesMenu({
  value,
  onChange,
}: {
  value: ProfitSeriesId;
  onChange: (next: ProfitSeriesId) => void;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const series = PROFIT_SERIES[index];
    if (!series) return;
    onChange(series.id);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.max(
      0,
      PROFIT_SERIES.findIndex((series) => series.id === value),
    );
    const last = PROFIT_SERIES.length - 1;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      select(current === last ? 0 : current + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      select(current === 0 ? last : current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      select(0);
    } else if (event.key === "End") {
      event.preventDefault();
      select(last);
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Profit series"
      data-profit-series=""
      className="flex max-w-full gap-1 overflow-x-auto"
      onKeyDown={onKeyDown}
    >
      {PROFIT_SERIES.map((series, index) => {
        const on = series.id === value;
        return (
          <button
            key={series.id}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            data-profit-series-tab={series.id}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B5FFF] ${
              on
                ? "bg-[#DBEAFE] text-[#0B5FFF]"
                : "bg-transparent text-[#102A43] hover:bg-[#F4F8FF] dark:text-slate-100"
            }`}
            onClick={() => onChange(series.id)}
          >
            {series.label}
          </button>
        );
      })}
    </div>
  );
}
