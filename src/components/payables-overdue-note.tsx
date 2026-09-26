/**
 * One line on the owner board when the aged-payables cache has overdue balances.
 * Supplier names stay on the accountant Payables tab.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getPayables } from "@/lib/payables.functions";
import { payablesSourceLabel } from "@/lib/payables";
import { formatMoney, type MoneyMarket } from "@/lib/market/format";

type Props = {
  clientId: string | null;
  market?: MoneyMarket;
};

export function PayablesOverdueNote({ clientId, market }: Props) {
  const loadPayables = useServerFn(getPayables);
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadPayables({ data: { clientId } })
      .then((view) => {
        if (cancelled) return;
        const snap = view.snapshot;
        if (!snap || snap.status !== "applied" || snap.totalOverdue < 0.005) {
          setLine(null);
          return;
        }
        const amount = formatMoney(snap.totalOverdue, market, {
          maximumFractionDigits: 0,
        });
        const who = `${snap.supplierCount} supplier${snap.supplierCount === 1 ? "" : "s"}`;
        const when = snap.asOf ? ` · as of ${snap.asOf}` : "";
        setLine(`Overdue to pay · ${amount} · ${who}${when} · ${payablesSourceLabel(snap.source)}`);
      })
      .catch(() => {
        if (!cancelled) setLine(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, market?.currency, market?.locale]);

  if (!line) return null;
  return (
    <p className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-300" id="payables-overdue-note">
      {line}. Your accountant has the payables list.
    </p>
  );
}
