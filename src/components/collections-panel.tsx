/**
 * Accountant Collections — a weekly chase list from the aged receivables cache.
 * Drafts go through the existing recommendation → Action Plan loop.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getCollections } from "@/lib/collections.functions";
import {
  buildCollectionsDraft,
  sourceLabel,
  type CollectionsSnapshot,
} from "@/lib/collections";
import { createRecommendation } from "@/lib/recommendations.functions";
import { formatMoney, type MoneyMarket } from "@/lib/market/format";

type Props = {
  clientId: string;
  market?: MoneyMarket;
  onOpenDrafts?: () => void;
  onOpenActions?: () => void;
};

function money(n: number, market?: MoneyMarket) {
  return formatMoney(n, market, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CollectionsPanel({ clientId, market, onOpenDrafts, onOpenActions }: Props) {
  const loadCollections = useServerFn(getCollections);
  const propose = useServerFn(createRecommendation);
  const [snapshot, setSnapshot] = useState<CollectionsSnapshot | null>(null);
  const [line, setLine] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadCollections({ data: { clientId } })
      .then((view) => {
        if (cancelled) return;
        setSnapshot(view.snapshot);
        setLine(view.line);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load collections");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // loadCollections is a server-fn binding; reload when the client changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const draft = buildCollectionsDraft(snapshot);

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
      toast.success("Chase draft added. Accept it with the other recommendations, then it lands on the Action Plan.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not file the chase draft");
    } finally {
      setFiling(false);
    }
  };

  if (loading) {
    return <p className="collections-muted">Loading the chase list…</p>;
  }
  if (error) {
    return <p className="collections-muted">{error}</p>;
  }
  if (!snapshot) {
    return (
      <p className="collections-muted">
        Sync Xero to pull aged receivables. Collections reads who owes what from the books. It does
        not keep a second ledger, send chase emails, or record receipts.
      </p>
    );
  }
  if (snapshot.status === "skipped") {
    return (
      <p className="collections-muted" id="collections-skip">
        {snapshot.skipReason ?? line}
      </p>
    );
  }
  if (snapshot.status === "empty" || snapshot.contacts.length === 0) {
    return (
      <p className="collections-muted" id="collections-empty">
        {line}
        {snapshot.note ? ` ${snapshot.note}` : ""} Nothing to chase on this pull.
      </p>
    );
  }

  return (
    <div className="collections" id="collections-chase">
      <p className="collections-kicker">
        {sourceLabel(snapshot.source)}
        {snapshot.asOf ? ` · as of ${snapshot.asOf}` : ""} · {line}
      </p>
      {snapshot.note ? <p className="collections-note">{snapshot.note}</p> : null}
      <div className="collections-scroll">
        <table className="collections-table">
          <thead>
            <tr>
              <th>Who</th>
              <th>Outstanding</th>
              <th>Overdue</th>
              <th>Age</th>
              <th>Books ref</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.contacts.map((contact) => (
              <tr key={contact.contactId}>
                <td>{contact.name}</td>
                <td>{money(contact.outstanding, market)}</td>
                <td>{money(contact.overdue, market)}</td>
                <td>{contact.ageBucket || "—"}</td>
                <td>
                  {contact.invoices.length
                    ? contact.invoices
                        .slice(0, 4)
                        .map((invoice) => invoice.reference)
                        .join(", ")
                    : "Contact total only"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {draft ? (
        <div className="collections-script">
          <p className="collections-kicker">Chase script</p>
          <pre>{draft.rationale}</pre>
          <div className="collections-actions">
            <button type="button" className="btn gold mini" disabled={filing || filed} onClick={fileDraft}>
              {filed ? "Draft added" : filing ? "Adding…" : "Add chase draft"}
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
          <p className="collections-note">
            Accept works the same way as other recommendations. Partner sign-off stays on the Action
            Plan. Milōn does not email the customer or record the receipt.
          </p>
        </div>
      ) : (
        <p className="collections-note">Nothing is overdue on this report, so there is no chase draft.</p>
      )}
    </div>
  );
}
