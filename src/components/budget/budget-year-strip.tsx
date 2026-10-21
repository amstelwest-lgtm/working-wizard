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
  periodLabel = null,
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
  /** Firm-year window these figures cover. Same words as the other cards. */
  periodLabel?: string | null;
}) {
  const money = (n: number) => {
    const text = fmtBudgetMoney(n, market);
    return signed ? ownerMinus(text) : text;
  };
  const compared = compareOwnerYear(thisYear, thisMonths, lastYear, lastMonths);
  const lastHeading = lastYearLabel ? `Last year · ${lastYearLabel}` : "Last year";
  return (
    <section className="space-y-2" data-budget-year={compared.mode}>
      <h3 className="text-base font-semibold text-[#102A43] dark:text-slate-100">This year vs last year</h3>
      {periodLabel ? (
        <p className="text-sm font-medium text-[#102A43] dark:text-slate-100" data-budget-year-period="">
          {periodLabel}
        </p>
      ) : null}
      <p className="text-sm leading-relaxed text-[#3D5270] dark:text-slate-300">{compared.summary}</p>
      <ul className="space-y-2 min-[480px]:hidden" data-budget-year-layout="stack">
        {compared.rows.map((row) => (
          <li key={row.key} className="rounded-xl border border-[#DBEAFE] px-3 py-3 dark:border-slate-700">
            <p className="text-sm font-semibold text-[#102A43] dark:text-slate-100">{row.label}</p>
            <dl className="mt-2 grid grid-cols-[minmax(7rem,1fr)_auto] gap-x-3 gap-y-1 text-sm">
              <dt className="text-[#3D5270] dark:text-slate-400">This year</dt>
              <dd className="text-right tabular-nums">{row.thisYear == null ? "—" : money(row.thisYear)}</dd>
              <dt className="text-[#3D5270] dark:text-slate-400">{lastHeading}</dt>
              <dd className="text-right tabular-nums">{row.lastYear == null ? "—" : money(row.lastYear)}</dd>
              <dt className="text-[#3D5270] dark:text-slate-400">Change</dt>
              <dd
                className={`text-right tabular-nums ${
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
              </dd>
            </dl>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-xl border border-[#DBEAFE] pb-3 min-[480px]:block">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-wide text-[#3D5270] dark:text-slate-400">
              <th className="px-3 py-2 font-semibold"> </th>
              <th className="px-3 py-2 text-right font-semibold">This year</th>
              <th className="px-3 py-2 text-right font-semibold">{lastHeading}</th>
              <th className="px-3 py-2 text-right font-semibold">Change</th>
            </tr>
          </thead>
          <tbody>
            {compared.rows.map((row) => (
              <tr key={row.key} className="border-t border-[#DBEAFE]">
                <th className="px-3 py-2 text-left font-semibold text-[#102A43] dark:text-slate-100">{row.label}</th>
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
