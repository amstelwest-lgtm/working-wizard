/**
 * Accountant Collections — a weekly chase list from the aged receivables cache.
 * When that cache is empty, the tab still shows debtor days, creditor days, and
 * the debtors and creditors totals, with a way to upload the age analysis or
 * connect Xero or QuickBooks. Drafts go through the recommendation → Action Plan loop.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getCollections } from "@/lib/collections.functions";
import {
  agedArProofLine,
  buildCollectionsDraft,
  collectionsAnswerSentence,
  collectionsNoFiguresLead,
  collectionsStatementLead,
  COLLECTIONS_UPLOAD_CTA,
  hasStatementWorkingCapital,
  rollupAgeBuckets,
  type CollectionsSnapshot,
  type StatementWorkingCapital,
} from "@/lib/collections";
import { figureSourceChipLabel } from "@/lib/ledger-link-copy";
import { createRecommendation } from "@/lib/recommendations.functions";
import { formatMoney, type MoneyMarket } from "@/lib/market/format";
import { ARAP_GOLD_BTN, ArapAnswerStrip } from "@/components/arap-answer-strip";
import { ReviewInputsDrawer } from "@/components/review-inputs-drawer";
import {
  statementArApMoney,
  StatementArApActions,
  StatementArApFallback,
  StatementArApTiles,
  type StatementCopyMarket,
} from "@/components/statement-arap-fallback";

type CopyMarket = StatementCopyMarket;

type Props = {
  clientId: string;
  market?: CopyMarket;
  /** Receivables, payables, debtor days, and creditor days already on the statements. */
  position?: StatementWorkingCapital | null;
  /** Ledger behind those statement totals. Same value Health chips. */
  statementSource?: string | null;
  /** Harness only. When set, the panel does not call the server. */
  fixtureSnapshot?: CollectionsSnapshot | null;
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

function copyPackOf(market?: CopyMarket): "za" | "us" {
  return market?.copyPack === "us" ? "us" : "za";
}

export function CollectionsPanel({
  clientId,
  market,
  position = null,
  statementSource = null,
  fixtureSnapshot,
  periodLabel = null,
  onUploadAged,
  onConnectXero,
  onConnectQbo,
  onOpenDrafts,
  onOpenActions,
}: Props) {
  const loadCollections = useServerFn(getCollections);
  const propose = useServerFn(createRecommendation);
  const [snapshot, setSnapshot] = useState<CollectionsSnapshot | null>(fixtureSnapshot ?? null);
  const [line, setLine] = useState<string>("");
  const [loading, setLoading] = useState(fixtureSnapshot === undefined);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState(false);

  useEffect(() => {
    if (fixtureSnapshot !== undefined) {
      setSnapshot(fixtureSnapshot);
      setLine(fixtureSnapshot ? agedArProofLine(fixtureSnapshot) : "");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadCollections({ data: { clientId } })
      .then((view) => {
        if (cancelled) return;
        setSnapshot(view.snapshot);
        setLine(view.line);
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshot(null);
        setLine("");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // loadCollections is a server-fn binding; reload when the client changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, fixtureSnapshot]);

  const draft = buildCollectionsDraft(snapshot);
  const fromStatements = hasStatementWorkingCapital(position);
  const namedList =
    snapshot != null && snapshot.status === "applied" && snapshot.contacts.length > 0;
  const buckets = namedList ? rollupAgeBuckets(snapshot.contacts) : [];
  const pack = copyPackOf(market);
  const tileMoney = (n: number) => statementArApMoney(n, market);
  const sentence = loading ? "" : collectionsAnswerSentence(snapshot, position, tileMoney);
  const chip = snapshot?.source
    ? figureSourceChipLabel(snapshot.source)
    : figureSourceChipLabel(statementSource);

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

  const booksNote =
    snapshot?.status === "skipped"
      ? snapshot.skipReason && snapshot.skipReason !== sentence
        ? snapshot.skipReason
        : null
      : snapshot && (snapshot.status === "empty" || snapshot.contacts.length === 0)
        ? `${line}${snapshot.note ? ` ${snapshot.note}` : ""} Nothing outstanding on that pull.`
        : null;

  const primary =
    namedList && draft ? (
      <button
        type="button"
        className={`${ARAP_GOLD_BTN} disabled:cursor-not-allowed disabled:opacity-40`}
        id="collections-file-draft"
        disabled={filing || filed}
        onClick={fileDraft}
      >
        {filed ? "Draft added" : filing ? "Adding…" : "Add chase draft"}
      </button>
    ) : !namedList && onUploadAged ? (
      <button
        type="button"
        className={ARAP_GOLD_BTN}
        id="collections-upload-aged"
        onClick={onUploadAged}
      >
        {COLLECTIONS_UPLOAD_CTA}
      </button>
    ) : null;

  return (
    <>
      <ArapAnswerStrip
        heading="Who to chase this week"
        sentence={sentence}
        chip={chip}
        primary={primary}
      />
      <ReviewInputsDrawer
        hint={
          snapshot
            ? agedArProofLine(snapshot)
            : fromStatements
              ? "Statement totals and connections"
              : "Connections"
        }
      >
        <p className="collections-note" id="collections-fallback-lead">
          {fromStatements
            ? collectionsStatementLead(pack)
            : "An aged debtors and creditors report names who to chase. Connect the books, or upload that report, when the statement totals are not enough."}
        </p>
        <StatementArApActions
          idPrefix="collections"
          onUploadAged={namedList ? onUploadAged : undefined}
          uploadClassName="btn ghost mini"
          onConnectXero={onConnectXero}
          onConnectQbo={onConnectQbo}
        />
        {onOpenDrafts || onOpenActions ? (
          <div className="collections-actions">
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
        ) : null}
      </ReviewInputsDrawer>

      {namedList && snapshot ? (
        <div className="collections" id="collections-chase">
          {snapshot.note ? <p className="collections-note">{snapshot.note}</p> : null}
          {fromStatements && position ? (
            <StatementArApTiles
              position={position}
              market={market}
              id="collections-statement-position"
            />
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
      ) : (
        <StatementArApFallback
          idPrefix="collections"
          position={position}
          market={market}
          periodLabel={periodLabel}
          fromStatements={fromStatements}
          lead={fromStatements ? collectionsStatementLead(pack) : collectionsNoFiguresLead()}
          loading={loading}
          loadingLead="Checking the aged report on file."
          booksNote={!loading && booksNote ? booksNote : null}
          booksNoteId={snapshot?.status === "skipped" ? "collections-skip" : "collections-empty"}
          footnote="Milōn drafts the chase once the aged report is on file. It does not email the customer or record the receipt."
          kickerWhenEmpty="Collections"
          omitLead
          hideActions
        />
      )}
    </>
  );
}
