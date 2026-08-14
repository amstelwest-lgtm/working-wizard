/**
 * Client-facing "Movements in balances" trial balance + bank tie-out panel.
 */

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { MovementsTrialBalance } from "@/lib/bank-movements";
import { fmtMoney } from "@/lib/bank-movements";

export function MovementsTrialBalancePanel({
  movements,
}: {
  movements: MovementsTrialBalance;
}) {
  const currency = movements.currency ?? "R";

  return (
    <div className="space-y-3 rounded-lg border border-amber-900/15 bg-amber-50/40 p-3 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#b8860b]">
            Movements in balances
          </p>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
            Trial balance from the same bank statements ·{" "}
            {movements.periodStart ?? "?"} → {movements.periodEnd ?? "?"}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            movements.allOk
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
          }`}
        >
          {movements.allOk ? (
            <>
              <CheckCircle2 className="h-3 w-3" /> Balances tie
            </>
          ) : (
            <>
              <AlertTriangle className="h-3 w-3" /> Review balance check
            </>
          )}
        </span>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-amber-900/10 text-[10px] uppercase tracking-wide text-slate-500 dark:border-slate-800">
            <th className="py-1.5 text-left font-semibold">Movement</th>
            <th className="py-1.5 text-right font-semibold">Debit</th>
            <th className="py-1.5 text-right font-semibold">Credit</th>
          </tr>
        </thead>
        <tbody>
          {movements.lines.map((line) => (
            <tr
              key={line.key}
              className={
                line.key === "opening" || line.key === "closing"
                  ? "border-t border-amber-900/15 font-semibold dark:border-slate-700"
                  : ""
              }
            >
              <td className="py-1 pr-2 text-slate-800 dark:text-slate-200">{line.label}</td>
              <td className="py-1 text-right tabular-nums text-slate-700 dark:text-slate-300">
                {line.debit ? fmtMoney(line.debit, currency) : "—"}
              </td>
              <td className="py-1 text-right tabular-nums text-slate-700 dark:text-slate-300">
                {line.credit ? fmtMoney(line.credit, currency) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {movements.balanceChecks.length > 0 && (
        <ul className="space-y-1.5 border-t border-amber-900/10 pt-2 dark:border-slate-800">
          {movements.balanceChecks.map((c) => (
            <li
              key={c.scope}
              className={`flex items-start gap-1.5 text-[11px] ${
                c.ok
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-amber-900 dark:text-amber-300"
              }`}
            >
              {c.ok ? (
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              )}
              <span>
                <strong>{c.scope}:</strong> {c.notes}
                {c.expectedClosing != null && c.statedClosing != null && (
                  <span className="mt-0.5 block text-slate-500 dark:text-slate-400">
                    In {fmtMoney(c.inflowTotal, currency)} · Out{" "}
                    {fmtMoney(c.outflowTotal, currency)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
