/**
 * The first thing on the Budget tab: this period, on or off the plan.
 */

import { fmtBudgetMoney } from "@/lib/budget.compute";
import type { BudgetActualsChip } from "@/lib/budget.bridges";
import { formatVariancePct, varianceLine } from "@/lib/budget.variance";
import type { ResolvedMarket } from "@/lib/market";

function signedMoney(n: number, market: ResolvedMarket): string {
  if (Math.abs(n) < 1) return fmtBudgetMoney(0, market);
  const body = fmtBudgetMoney(n, market);
  if (n > 0) return `+${body}`;
  return body;
}

function Delta({
  budget,
  actual,
  higherIsBetter,
  market,
}: {
  budget: number;
  actual: number;
  higherIsBetter: boolean;
  market: ResolvedMarket;
}) {
  const line = varianceLine("revenue", "", budget, actual, higherIsBetter);
  const pct = line.deltaPct != null && Math.abs(line.delta) < 1 ? 0 : line.deltaPct;
  const tone =
    line.signal === "adverse"
      ? "text-red-600"
      : line.signal === "favourable"
        ? "text-emerald-700"
        : "text-slate-500";
  return (
    <span className={`font-semibold tabular-nums ${tone}`}>
      {signedMoney(line.delta, market)}, {formatVariancePct(pct)}
    </span>
  );
}

export function BudgetVerdictStrip({
  periodLabel,
  revenueBudget,
  revenueActual,
  profitBudget,
  profitActual,
  chip,
  status,
  market,
}: {
  periodLabel: string;
  revenueBudget: number;
  revenueActual: number | null;
  profitBudget: number;
  profitActual: number | null;
  chip: BudgetActualsChip;
  status: string;
  market: ResolvedMarket;
}) {
  const money = (n: number) => fmtBudgetMoney(n, market);
  const hasActuals = revenueActual != null && chip !== "None";
  return (
    <section
      className="rounded-2xl border border-[#d4a550]/40 bg-[#fffdf8] px-4 py-3.5 dark:border-slate-700 dark:bg-slate-950"
      data-budget-verdict
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b8860b]">
        {periodLabel}
      </p>
      <p className="mt-1 text-[15px] leading-relaxed text-[#1b1608] dark:text-slate-100">
        <span className="font-semibold">Revenue</span>{" "}
        {hasActuals ? (
          <>
            {money(revenueActual!)} vs budget {money(revenueBudget)} (
            <Delta
              budget={revenueBudget}
              actual={revenueActual!}
              higherIsBetter
              market={market}
            />
            )
          </>
        ) : (
          <span className="tabular-nums">{money(revenueBudget)}</span>
        )}
        <span className="text-slate-400"> · </span>
        <span className="font-semibold">Profit</span>{" "}
        {hasActuals && profitActual != null ? (
          <>
            {money(profitActual)} vs budget {money(profitBudget)} (
            <Delta
              budget={profitBudget}
              actual={profitActual}
              higherIsBetter
              market={market}
            />
            )
          </>
        ) : (
          <span className="tabular-nums">{money(profitBudget)}</span>
        )}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
          {chip}
        </span>
        <span className="rounded-full border border-slate-200 px-2 py-0.5 dark:border-slate-700">
          {status}
        </span>
      </div>
    </section>
  );
}
