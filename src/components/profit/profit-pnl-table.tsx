import { Fragment, useMemo, useState } from "react";
import { useMarketFormat } from "@/contexts/market";
import type { FiscalStatementSlice } from "@/lib/budget-period-types";
import { formatMoney, formatReportAmount } from "@/lib/market/format";
import { ownerMinus } from "@/lib/owner-money";
import { buildProfitPnl, type ProfitPnlRow } from "@/lib/profit-statement";

function moneyText(
  amount: number | null,
  market: Parameters<typeof formatMoney>[1],
  signed: boolean,
): string {
  if (amount == null) return "—";
  if (signed) return ownerMinus(formatMoney(amount, market));
  return formatReportAmount(amount, market, { sign: "parens" });
}

function VarianceCell({
  row,
  market,
  signed,
}: {
  row: ProfitPnlRow;
  market: Parameters<typeof formatMoney>[1];
  signed: boolean;
}) {
  if (row.variance == null || row.variancePct == null) {
    return <span className="text-slate-400">—</span>;
  }
  const tone =
    row.favourable == null
      ? "text-slate-500"
      : row.favourable
        ? "text-emerald-700"
        : "text-red-600";
  const arrow = row.variance > 0 ? "▲" : row.variance < 0 ? "▼" : "";
  const pct = formatReportAmount(row.variancePct, market, {
    style: "percent",
    percentPoints: true,
    sign: "always",
  });
  return (
    <span className={`font-semibold tabular-nums ${tone}`} data-favourable={String(row.favourable)}>
      {arrow ? <span aria-hidden="true">{arrow} </span> : null}
      {signed ? ownerMinus(pct) : pct}
    </span>
  );
}

export function ProfitPnlTable({
  financials,
  prior,
  quoted = null,
  currentLabel,
  priorLabel,
  fyStartMonth = null,
  signed = false,
}: {
  financials: Record<string, unknown> | null | undefined;
  prior?: Record<string, unknown> | null;
  quoted?: FiscalStatementSlice | null;
  currentLabel: string;
  priorLabel: string;
  fyStartMonth?: number | null;
  /** Owner door keeps one minus. The accountant statement uses parentheses. */
  signed?: boolean;
}) {
  const { market } = useMarketFormat();
  const built = useMemo(
    () => buildProfitPnl({ current: financials, prior, quoted, fyStartMonth }),
    [financials, prior, quoted, fyStartMonth],
  );
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);
  if (!built.rows.length) {
    return (
      <p
        className="rounded-xl border border-[#DBEAFE] bg-white px-4 py-6 text-sm text-[#102A43]"
        data-profit-pnl="empty"
      >
        Add a profit and loss to compare this period with the prior period.
      </p>
    );
  }

  const hidden = (row: ProfitPnlRow) =>
    Boolean(row.section && closed[row.section] && !row.emphasis);

  return (
    <section
      className="overflow-hidden rounded-2xl border border-[#DBEAFE] bg-white text-[#102A43] shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      data-profit-pnl=""
      aria-label="Profit and loss"
    >
      <header className="border-b border-[#DBEAFE] px-4 py-3 dark:border-slate-700">
        <h2 className="text-lg font-semibold tracking-tight">Profit and Loss</h2>
        <p className="mt-0.5 text-[13px] text-[#486581] dark:text-slate-400">
          {currentLabel} vs {priorLabel}
        </p>
        {built.prorated ? (
          <p className="mt-1 text-[13px] text-[#486581]" data-profit-pnl-prorated="">
            This period is prorated to the firm year, so it is not compared with the prior
            statement.
          </p>
        ) : null}
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#DBEAFE] text-left text-[11px] font-semibold uppercase tracking-wide text-[#486581] dark:border-slate-700">
              <th className="px-4 py-2 font-semibold"> </th>
              <th className="px-3 py-2 text-right font-semibold">{currentLabel}</th>
              <th className="px-3 py-2 text-right font-semibold">{priorLabel}</th>
              <th className="px-3 py-2 text-right font-semibold">Variance</th>
              <th className="px-3 py-2 text-right font-semibold">Variance (%)</th>
              <th className="px-4 py-2 text-right font-semibold">YTD (FY)</th>
            </tr>
          </thead>
          <tbody>
            {built.rows.map((row, index) => {
              const section =
                row.section && built.rows[index - 1]?.section !== row.section ? row.section : null;
              return (
                <Fragment key={row.id}>
                  {section ? (
                    <tr
                      key={`${section}-head`}
                      className="bg-[#F4F8FF] dark:bg-slate-900"
                      data-profit-section={section}
                    >
                      <th
                        colSpan={6}
                        className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em]"
                      >
                        <button
                          type="button"
                          className="text-[#102A43] dark:text-slate-100"
                          aria-expanded={!closed[section]}
                          onClick={() =>
                            setClosed((prev) => ({ ...prev, [section]: !prev[section] }))
                          }
                        >
                          {section}
                        </button>
                      </th>
                    </tr>
                  ) : null}
                  {hidden(row) ? null : (
                    <tr
                      key={row.id}
                      data-profit-row={row.id}
                      data-selected={selected === row.id ? "true" : "false"}
                      className={`border-t border-[#EEF4FF] dark:border-slate-800 ${
                        row.emphasis ? "bg-[#F8FBFF] font-semibold dark:bg-slate-900/60" : ""
                      } ${selected === row.id ? "outline outline-2 outline-[#0B5FFF]" : ""}`}
                      onClick={() => setSelected(row.id)}
                    >
                      <th scope="row" className="px-4 py-2 text-left font-medium">
                        {row.label}
                      </th>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {moneyText(row.current, market, signed)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {moneyText(row.prior, market, signed)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {moneyText(row.variance, market, signed)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <VarianceCell row={row} market={market} signed={signed} />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {moneyText(row.ytd, market, signed)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
