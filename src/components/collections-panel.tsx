/**
 * Accountant Collections — a weekly chase list from the aged receivables cache.
 * When that cache is empty, the tab still shows the AR/AP totals and day counts
 * already on Overview and Ratios, with a way to upload the age analysis or
 * connect Xero or QuickBooks. Drafts go through the recommendation → Action Plan loop.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getCollections } from "@/lib/collections.functions";
import {
  COLLECTIONS_QBO_CTA,
  COLLECTIONS_UPLOAD_CTA,
  COLLECTIONS_XERO_CTA,
  buildCollectionsDraft,
  collectionsNoFiguresLead,
  collectionsStatementLead,
  hasStatementWorkingCapital,
  rollupAgeBuckets,
  sourceLabel,
  type CollectionsSnapshot,
  type StatementWorkingCapital,
} from "@/lib/collections";
import { createRecommendation } from "@/lib/recommendations.functions";
import { t } from "@/lib/market/copy";
import { formatMoney, type MoneyMarket } from "@/lib/market/format";

type CopyMarket = MoneyMarket & { copyPack?: "za" | "us" };

type Props = {
  clientId: string;
  market?: CopyMarket;
  /** Receivables, payables, and day counts already computed for Overview / Ratios. */
  position?: StatementWorkingCapital | null;
  periodLabel?: string | null;
  onUploadAged?: () => void;
  onConnectXero?: () => void;
  onConnectQbo?: () => void;
  onOpenDrafts?: () => void;
  onOpenActions?: () => void;
};

function money(n: number, market?: MoneyMarket) {
  return formatMoney(n, market, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statementMoney(n: number, market?: MoneyMarket) {
  const cents = Math.abs(n - Math.round(n)) >= 0.005;
  return formatMoney(
    n,
    market,
    cents
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : { maximumFractionDigits: 0, minimumFractionDigits: 0 },
  );
}

function copyPackOf(market?: CopyMarket): "za" | "us" {
  return market?.copyPack === "us" ? "us" : "za";
}

function StatementPosition({
  position,
  market,
}: {
  position: StatementWorkingCapital;
  market?: CopyMarket;
}) {
  const copy = { copyPack: copyPackOf(market) } as const;
  const metrics: { key: string; label: string; value: string }[] = [];
  if (typeof position.debtorDays === "number" && Number.isFinite(position.debtorDays)) {
    metrics.push({ key: "dso", label: t("dso", copy), value: `${position.debtorDays} days` });
  }
  if (typeof position.receivables === "number" && Number.isFinite(position.receivables)) {
    metrics.push({
      key: "ar",
      label: t("receivables", copy),
      value: statementMoney(position.receivables, market),
    });
  }
  if (typeof position.creditorDays === "number" && Number.isFinite(position.creditorDays)) {
    metrics.push({ key: "dpo", label: t("dpo", copy), value: `${position.creditorDays} days` });
  }
  if (typeof position.payables === "number" && Number.isFinite(position.payables)) {
    metrics.push({
      key: "ap",
      label: t("payables", copy),
      value: statementMoney(position.payables, market),
    });
  }
  if (!metrics.length) return null;
  return (
    <dl className="collections-position" id="collections-statement-position">
      {metrics.map((metric) => (
        <div key={metric.key} data-metric={metric.key}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function NextActions({
  onUploadAged,
  onConnectXero,
  onConnectQbo,
}: {
  onUploadAged?: () => void;
  onConnectXero?: () => void;
  onConnectQbo?: () => void;
}) {
  if (!onUploadAged && !onConnectXero && !onConnectQbo) return null;
  return (
    <div className="collections-actions">
      {onUploadAged ? (
        <button
          type="button"
          className="btn gold mini"
          id="collections-upload-aged"
          onClick={onUploadAged}
        >
          {COLLECTIONS_UPLOAD_CTA}
        </button>
      ) : null}
      {onConnectXero ? (
        <button
          type="button"
          className="btn ghost mini"
          id="collections-connect-xero"
          onClick={onConnectXero}
        >
          {COLLECTIONS_XERO_CTA}
        </button>
      ) : null}
      {onConnectQbo ? (
        <button
          type="button"
          className="btn ghost mini"
          id="collections-connect-qbo"
          onClick={onConnectQbo}
        >
          {COLLECTIONS_QBO_CTA}
        </button>
      ) : null}
    </div>
  );
}

export function CollectionsPanel({
  clientId,
  market,
  position = null,
  periodLabel = null,
  onUploadAged,
  onConnectXero,
  onConnectQbo,
  onOpenDrafts,
  onOpenActions,
}: Props) {
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
  const fromStatements = hasStatementWorkingCapital(position);
  const namedList =
    snapshot != null && snapshot.status === "applied" && snapshot.contacts.length > 0;
  const buckets = namedList ? rollupAgeBuckets(snapshot.contacts) : [];

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
        "Chase draft added. Accept it with the other recommendations, then it lands on the Action Plan.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not file the chase draft");
    } finally {
      setFiling(false);
    }
  };

  if (namedList && snapshot) {
    return (
      <div className="collections" id="collections-chase">
        <p className="collections-kicker">
          {sourceLabel(snapshot.source)}
          {snapshot.asOf ? ` · as of ${snapshot.asOf}` : ""} · {line}
        </p>
        {snapshot.note ? <p className="collections-note">{snapshot.note}</p> : null}
        {fromStatements && position ? (
          <StatementPosition position={position} market={market} />
        ) : null}
        {buckets.length > 0 ? (
          <div className="collections-buckets" id="collections-age-buckets">
            {buckets.map((bucket) => (
              <span key={bucket.label}>
                {bucket.label}
                <strong>{money(bucket.amount, market)}</strong>
              </span>
            ))}
          </div>
        ) : null}
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
              <button
                type="button"
                className="btn gold mini"
                disabled={filing || filed}
                onClick={fileDraft}
              >
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
              Accept works the same way as other recommendations. Partner sign-off stays on the
              Action Plan. Milōn does not email the customer or record the receipt.
            </p>
          </div>
        ) : (
          <p className="collections-note">
            Nothing is overdue on this report, so there is no chase draft.
          </p>
        )}
      </div>
    );
  }

  const pack = copyPackOf(market);
  const booksNote =
    snapshot?.status === "skipped"
      ? (snapshot.skipReason ?? line)
      : snapshot && (snapshot.status === "empty" || snapshot.contacts.length === 0)
        ? `${line}${snapshot.note ? ` ${snapshot.note}` : ""} Nothing outstanding on that pull.`
        : null;

  return (
    <div className="collections" id="collections-from-statements">
      {error ? <p className="collections-muted">{error}</p> : null}
      {!loading && booksNote ? (
        <p
          className="collections-note"
          id={snapshot?.status === "skipped" ? "collections-skip" : "collections-empty"}
        >
          {booksNote}
        </p>
      ) : null}
      <p className="collections-kicker">
        {fromStatements ? "From the statements" : "Collections"}
        {fromStatements && periodLabel ? ` · ${periodLabel}` : ""}
      </p>
      <p className="collections-note" id="collections-fallback-lead">
        {loading
          ? "Checking Xero and QuickBooks for named customers."
          : fromStatements
            ? collectionsStatementLead(pack)
            : collectionsNoFiguresLead()}
      </p>
      {fromStatements && position ? (
        <StatementPosition position={position} market={market} />
      ) : null}
      <NextActions
        onUploadAged={onUploadAged}
        onConnectXero={onConnectXero}
        onConnectQbo={onConnectQbo}
      />
      <p className="collections-note">
        Milōn drafts the chase once the aged report is on file. It does not email the customer or
        record the receipt.
      </p>
    </div>
  );
}
