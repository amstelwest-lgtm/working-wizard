import { fmtBudgetMoney } from "@/lib/budget.compute";
import { ownerMinus } from "@/lib/owner-money";
import {
  compareOwnerYear,
  type BudgetYearMoney,
} from "@/lib/budget-year-compare";
import type { ResolvedMarket } from "@/lib/market";

const ARROW = { up: "↑", down: "↓", flat: "→" } as const;

export function BudgetYearStrip({
  thisYear,
  thisMonths = null,
  lastYear,
  lastMonths = null,
  lastYearLabel,
  market,
  signed = false,
}: {
  thisYear: BudgetYearMoney | null;
  /** Months in the statement window. Compared only when last year matches. */
  thisMonths?: number | null;
  lastYear: BudgetYearMoney | null;
  lastMonths?: number | null;
  lastYearLabel?: string | null;
  market: ResolvedMarket;
  /** Owner door uses one unicode minus. */
  signed?: boolean;
}) {
  const money = (n: number) => {
    const text = fmtBudgetMoney(n, market);
    return signed ? ownerMinus(text) : text;
  };
  const compared = compareOwnerYear(thisYear, thisMonths, lastYear, lastMonths);
  const lastHeading = lastYearLabel ? `Last year · ${lastYearLabel}` : "Last year";
  return (
    <section className="space-y-2" data-budget-year={compared.mode}>
      <h3 className="text-base font-semibold text-[#1b1608] dark:text-slate-100">This year vs last year</h3>
      <p className="text-sm leading-relaxed text-[#6b6354] dark:text-slate-300">{compared.summary}</p>
      <div className="overflow-x-auto rounded-xl border border-[#DBEAFE]">
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
              <tr key={row.key} className="border-t border-[#DBEAFE]">
                <th className="px-3 py-2 text-left font-semibold text-[#1b1608] dark:text-slate-100">{row.label}</th>
                <td className="px-3 py-2 text-right tabular-nums">{row.thisYear == null ? "—" : money(row.thisYear)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{row.lastYear == null ? "—" : money(row.lastYear)}</td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    row.signal === "favourable"
                      ? "text-emerald-700 dark:text-emerald-400"
                      : row.signal === "adverse"
                        ? "text-red-600 dark:text-red-400"
                        : ""
                  }`}
                  data-year-signal={row.signal ?? "none"}
                >
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
