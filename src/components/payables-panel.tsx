/**
 * Accountant Payables — who to pay, delay, or renegotiate from the aged payables cache.
 * Drafts go through the existing recommendation → Action Plan loop.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getPayables } from "@/lib/payables.functions";
import {
  buildPayablesDraft,
  payablesSourceLabel,
  supplierMove,
  type PayablesSnapshot,
} from "@/lib/payables";
import { createRecommendation } from "@/lib/recommendations.functions";
import { formatMoney, type MoneyMarket } from "@/lib/market/format";

type Props = {
  clientId: string;
  market?: MoneyMarket;
  /** Weeks already stored on the cash forecast. Null when that figure is absent. */
  runwayWeeks?: number | null;
  onOpenDrafts?: () => void;
  onOpenActions?: () => void;
};

function money(n: number, market?: MoneyMarket) {
  return formatMoney(n, market, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PayablesPanel({
  clientId,
  market,
  runwayWeeks = null,
  onOpenDrafts,
  onOpenActions,
}: Props) {
  const loadPayables = useServerFn(getPayables);
  const propose = useServerFn(createRecommendation);
  const [snapshot, setSnapshot] = useState<PayablesSnapshot | null>(null);
  const [line, setLine] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFiled(false);
    loadPayables({ data: { clientId } })
      .then((view) => {
        if (cancelled) return;
        setSnapshot(view.snapshot);
        setLine(view.line);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load payables");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // loadPayables is a server-fn binding; reload when the client changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const draft = buildPayablesDraft(snapshot, runwayWeeks);

  const fileDraft = async () => {
    if (!draft || filing || filed) return;
    setFiling(true);
    try {
      await propose({
        data: {
          clientId,
          title: draft.title,
          problem: draft.problem,
          rationale: draft.rationale,
          assumptions: draft.assumptions,
          evidence: draft.evidence,
          priority: draft.priority,
          dataDepth: draft.dataDepth,
          source: "system",
          expectedImpact: draft.expectedImpact,
        },
      });
      setFiled(true);
      toast.success(
        "Payables draft added. Accept it with the other recommendations, then it lands on the Action Plan.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not file the payables draft");
    } finally {
      setFiling(false);
    }
  };

  if (loading) {
    return <p className="payables-muted">Loading the payables list…</p>;
  }
  if (error) {
    return <p className="payables-muted">{error}</p>;
  }
  if (!snapshot) {
    return (
      <p className="payables-muted">
        Sync Xero or QuickBooks to pull aged payables. Payables reads who to pay, delay, or
        renegotiate from the books. It does not keep a second ledger, send payments, or record
        bills.
      </p>
    );
  }
  if (snapshot.status === "skipped") {
    return (
      <p className="payables-muted" id="payables-skip">
        {snapshot.skipReason ?? line}
      </p>
    );
  }
  if (snapshot.status === "empty" || snapshot.suppliers.length === 0) {
    return (
      <p className="payables-muted" id="payables-empty">
        {line}
        {snapshot.note ? ` ${snapshot.note}` : ""} Nothing to pay on this pull.
      </p>
    );
  }

  return (
    <div className="payables" id="payables-list">
      <p className="payables-kicker">
        {payablesSourceLabel(snapshot.source)}
        {snapshot.asOf ? ` · as of ${snapshot.asOf}` : ""} · {line}
      </p>
      {snapshot.note ? <p className="payables-note">{snapshot.note}</p> : null}
      <div className="payables-scroll">
        <table className="payables-table">
          <thead>
            <tr>
              <th>Who</th>
              <th>Outstanding</th>
              <th>Overdue</th>
              <th>Age</th>
              <th>Move</th>
              <th>Books ref</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.suppliers.map((supplier) => (
              <tr key={supplier.supplierId}>
                <td>{supplier.name}</td>
                <td>{money(supplier.outstanding, market)}</td>
                <td>{money(supplier.overdue, market)}</td>
                <td>{supplier.ageBucket || "—"}</td>
                <td>{supplier.overdue >= 0.005 ? supplierMove(supplier.ageBucket, runwayWeeks) : "—"}</td>
                <td>
                  {supplier.bills.length
                    ? supplier.bills
                        .slice(0, 4)
                        .map((bill) => bill.reference)
                        .join(", ")
                    : "Supplier total only"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft ? (
        <div className="payables-script">
          <p className="payables-kicker">Pay, delay, or renegotiate</p>
          <pre>{draft.rationale}</pre>
          <div className="payables-actions">
            <button type="button" className="btn gold mini" disabled={filing || filed} onClick={fileDraft}>
              {filed ? "Draft added" : filing ? "Adding…" : "Add payables draft"}
            </button>
            {onOpenDrafts ? (
              <button type="button" className="btn ghost mini" onClick={onOpenDrafts}>
                Review drafts
              </button>
            ) : null}
            {onOpenActions ? (
              <button type="button" className="btn ghost mini" onClick={onOpenActions}>
                Action Plan
              </button>
            ) : null}
          </div>
          <p className="payables-note">
            Accept works the same way as other recommendations. Partner sign-off stays on the Action
            Plan. Milōn does not send a payment or record the bill.
          </p>
        </div>
      ) : (
        <p className="payables-note">Nothing is overdue on this report, so there is no payables draft.</p>
      )}
    </div>
  );
}
