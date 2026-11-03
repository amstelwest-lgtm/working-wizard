import type { ReactNode } from "react";
import { BarChart3, LineChart } from "lucide-react";

export type ChartShape = "bar" | "line";

/** Bar | line icon switch shared by Profit and Budget. Active segment is ice on cobalt. */
export function ChartShapeToggle({
  value,
  onChange,
}: {
  value: ChartShape;
  onChange: (next: ChartShape) => void;
}) {
  const item = (shape: ChartShape, label: string, icon: ReactNode) => {
    const on = value === shape;
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={label}
        data-chart-shape-option={shape}
        className={`grid h-8 w-9 place-items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B5FFF] ${
          on ? "bg-[#DBEAFE] text-[#0B5FFF]" : "bg-transparent text-[#102A43] dark:text-slate-100"
        }`}
        onClick={() => onChange(shape)}
      >
        {icon}
      </button>
    );
  };
  return (
    <div
      role="group"
      aria-label="Chart shape"
      data-chart-shape={value}
      className="inline-flex rounded-md border border-[#DBEAFE] bg-white p-0.5 dark:border-slate-700 dark:bg-slate-950"
    >
      {item("bar", "Bar chart", <BarChart3 className="h-4 w-4" aria-hidden />)}
      {item("line", "Line chart", <LineChart className="h-4 w-4" aria-hidden />)}
    </div>
  );
}
