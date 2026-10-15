/**
 * Calm comparison when the P&L monthly run-rate and the bank forecast disagree.
 */
import { TriangleAlert } from "lucide-react";
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
      className="pl-disagree mb-4 flex items-start gap-3 rounded-lg border border-slate-300/80 bg-slate-50 px-4 py-3 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200"
      role="status"
    >
      <span className="pl-disagree-ic mt-0.5 shrink-0" aria-hidden="true">
        <TriangleAlert className="h-4 w-4 text-amber-600" />
      </span>
      <div className="pl-disagree-body">
        <div className="pl-disagree-title text-sm font-semibold text-slate-900 dark:text-slate-100">
          Invoiced sales and cash collected are different figures
        </div>
        <p className="pl-disagree-line mt-1 text-xs leading-relaxed">
          P&amp;L revenue is invoiced sales, {monthly(disagreement.plRevenueMonthly, market)}. Bank
          receipts are cash collected in the 13-week forecast,{" "}
          {monthly(disagreement.bankInflowMonthly, market)}.
        </p>
        <p className="pl-disagree-line text-xs leading-relaxed">
          P&amp;L costs are expenses on the statement, {monthly(disagreement.plCostMonthly, market)}.
          Bank payments are cash paid in that forecast, {monthly(disagreement.bankOutflowMonthly, market)}.
        </p>
      </div>
    </div>
  );
}
