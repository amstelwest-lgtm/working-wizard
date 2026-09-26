/**
 * One line on the owner board when the aged-receivables cache has overdue balances.
 * The chase list itself stays on the accountant Collections tab.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCollections } from "@/lib/collections.functions";
import { sourceLabel } from "@/lib/collections";
import { formatMoney, type MoneyMarket } from "@/lib/market/format";

type Props = {
  clientId: string | null;
  market?: MoneyMarket;
};

export function CollectionsOverdueNote({ clientId, market }: Props) {
  const loadCollections = useServerFn(getCollections);
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadCollections({ data: { clientId } })
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
        const who = `${snap.contactCount} customer${snap.contactCount === 1 ? "" : "s"}`;
        const when = snap.asOf ? ` · as of ${snap.asOf}` : "";
        setLine(`Overdue to collect · ${amount} · ${who}${when} · ${sourceLabel(snap.source)}`);
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
    <p className="text-[12px] leading-relaxed text-slate-600 dark:text-slate-300" id="collections-overdue-note">
      {line}. Your accountant has the chase list.
    </p>
  );
}
