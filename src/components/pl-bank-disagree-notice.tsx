/**
 * Calm comparison when the P&L monthly run-rate and the bank forecast disagree.
 */
import { formatMoney, type MoneyMarket } from "@/lib/market/format";
import type { PlBankDisagreement } from "@/lib/client-metrics";

function monthly(n: number | null, market: MoneyMarket): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${formatMoney(n, market)}/mo`;
}

export function PlBankDisagreeNotice({
  disagreement,
  market,
}: {
  disagreement: PlBankDisagreement;
  market: MoneyMarket;
}) {
  return (
    <div
      className="mb-4 rounded-lg border border-slate-300/80 bg-slate-50 px-4 py-3 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200"
      role="status"
    >
      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
        P&amp;L and bank data disagree
      </div>
      <p className="mt-1 text-xs leading-relaxed">
        P&amp;L revenue {monthly(disagreement.plRevenueMonthly, market)} · Bank receipts{" "}
        {monthly(disagreement.bankInflowMonthly, market)}
      </p>
      <p className="text-xs leading-relaxed">
        P&amp;L costs {monthly(disagreement.plCostMonthly, market)} · Bank payments{" "}
        {monthly(disagreement.bankOutflowMonthly, market)}
      </p>
    </div>
  );
}
