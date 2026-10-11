import { fmtBudgetMoney } from "@/lib/budget.compute";
import {
  budgetYearCompare,
  type BudgetYearMoney,
} from "@/lib/budget-year-compare";
import type { ResolvedMarket } from "@/lib/market";

const ARROW = { up: "↑", down: "↓", flat: "→" } as const;

export function BudgetYearStrip({
  thisYear,
  lastYear,
  lastYearLabel,
  market,
}: {
  thisYear: BudgetYearMoney;
  lastYear: BudgetYearMoney | null;
  lastYearLabel?: string | null;
  market: ResolvedMarket;
}) {
  const money = (n: number) => fmtBudgetMoney(n, market);
  const compared = budgetYearCompare(thisYear, lastYear);
  const lastHeading = lastYearLabel ? `Last year · ${lastYearLabel}` : "Last year";
  return (
    <section className="space-y-2" data-budget-year={compared.empty ? "empty" : "compared"}>
      <h3 className="text-base font-semibold text-[#1b1608] dark:text-slate-100">This year vs last year</h3>
      <p className="text-sm leading-relaxed text-[#6b6354] dark:text-slate-300">{compared.summary}</p>
      <div className="overflow-x-auto rounded-xl border border-[#d4a550]/25">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-[#6b6354] dark:text-slate-400">
              <th className="px-3 py-2 font-semibold"> </th>
              <th className="px-3 py-2 text-right font-semibold">This year</th>
              <th className="px-3 py-2 text-right font-semibold">{lastHeading}</th>
              <th className="px-3 py-2 text-right font-semibold">Change</th>
            </tr>
          </thead>
          <tbody>
            {compared.rows.map((row) => (
              <tr key={row.key} className="border-t border-[#d4a550]/15">
                <th className="px-3 py-2 text-left font-semibold text-[#1b1608] dark:text-slate-100">{row.label}</th>
                <td className="px-3 py-2 text-right tabular-nums">{row.thisYear == null ? "—" : money(row.thisYear)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.lastYear == null ? "—" : money(row.lastYear)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.change == null ? (
                    "—"
                  ) : (
                    <>
                      {ARROW[row.direction]} {money(row.change)}
                      {row.changePct == null ? "" : ` (${Math.abs(Math.round(row.changePct))}%)`}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
