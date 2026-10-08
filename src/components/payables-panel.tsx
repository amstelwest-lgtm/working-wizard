/**
 * Accountant Payables — who to pay, delay, or renegotiate from the aged payables cache.
 * When that cache is empty, the tab uses the same statement totals as Collections,
 * plus upload and connect. Drafts go through the recommendation → Action Plan loop.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getPayables } from "@/lib/payables.functions";
import {
  buildPayablesDraft,
  payablesAnswerSentence,
  payablesNoFiguresLead,
  payablesStatementLead,
  supplierMove,
  type PayablesSnapshot,
} from "@/lib/payables";
import { COLLECTIONS_UPLOAD_CTA, hasStatementWorkingCapital, type StatementWorkingCapital } from "@/lib/collections";
import { figureSourceChipLabel } from "@/lib/ledger-link-copy";
import { createRecommendation } from "@/lib/recommendations.functions";
import { formatMoney, type MoneyMarket } from "@/lib/market/format";
import { ARAP_GOLD_BTN, ArapAnswerStrip } from "@/components/arap-answer-strip";
import { ReviewInputsDrawer } from "@/components/review-inputs-drawer";
import {
  StatementArApActions,
  StatementArApFallback,
  StatementArApTiles,
  type StatementCopyMarket,
} from "@/components/statement-arap-fallback";

type Props = {
  clientId: string;
  market?: StatementCopyMarket;
  /** Weeks already stored on the cash forecast. Null when that figure is absent. */
  runwayWeeks?: number | null;
  /** Receivables, payables, debtor days, and creditor days already on the statements. */
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

function copyPackOf(market?: StatementCopyMarket): "za" | "us" {
  return market?.copyPack === "us" ? "us" : "za";
}

export function PayablesPanel({
  clientId,
  market,
  runwayWeeks = null,
  position = null,
  periodLabel = null,
  onUploadAged,
  onConnectXero,
  onConnectQbo,
  onOpenDrafts,
  onOpenActions,
}: Props) {
  const loadPayables = useServerFn(getPayables);
  const propose = useServerFn(createRecommendation);
  const [snapshot, setSnapshot] = useState<PayablesSnapshot | null>(null);
  const [line, setLine] = useState<string>("");
  const [loading, setLoading] = useState(true);
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
    // loadPayables is a server-fn binding; reload when the client changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const draft = buildPayablesDraft(snapshot, runwayWeeks);
  const fromStatements = hasStatementWorkingCapital(position);
  const namedList =
    snapshot != null && snapshot.status === "applied" && snapshot.suppliers.length > 0;
  const pack = copyPackOf(market);
  const sentence = loading ? "" : payablesAnswerSentence(snapshot);
  const chip = snapshot?.source
    ? figureSourceChipLabel(snapshot.source)
    : fromStatements
      ? figureSourceChipLabel("statement")
      : null;

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

  const booksNote =
    snapshot?.status === "skipped"
      ? snapshot.skipReason && snapshot.skipReason !== sentence
        ? snapshot.skipReason
        : null
      : snapshot && (snapshot.status === "empty" || snapshot.suppliers.length === 0)
        ? `${line}${snapshot.note ? ` ${snapshot.note}` : ""} Nothing outstanding on that pull.`
        : null;

  const primary =
    namedList && draft ? (
      <button
        type="button"
        className={`${ARAP_GOLD_BTN} disabled:cursor-not-allowed disabled:opacity-40`}
        id="payables-file-draft"
        disabled={filing || filed}
        onClick={fileDraft}
      >
        {filed ? "Draft added" : filing ? "Adding…" : "Add payables draft"}
      </button>
    ) : !namedList && onUploadAged ? (
      <button type="button" className={ARAP_GOLD_BTN} id="payables-upload-aged" onClick={onUploadAged}>
        {COLLECTIONS_UPLOAD_CTA}
      </button>
    ) : null;

  return (
    <>
      <ArapAnswerStrip
        heading="Who to pay, delay, or renegotiate"
        sentence={sentence}
        chip={chip}
        primary={primary}
      />
      <ReviewInputsDrawer hint={fromStatements ? "Statement totals and connections" : "Connections"}>
        <p className="collections-note" id="payables-fallback-lead">
          {fromStatements
            ? payablesStatementLead(pack)
            : "An aged debtors and creditors report names who to pay, delay, or renegotiate. Connect the books, or upload that report, when the statement totals are not enough."}
        </p>
        <StatementArApActions
          idPrefix="payables"
          onUploadAged={namedList ? onUploadAged : undefined}
          uploadClassName="btn ghost mini"
          onConnectXero={onConnectXero}
          onConnectQbo={onConnectQbo}
        />
        {onOpenDrafts || onOpenActions ? (
          <div className="payables-actions">
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
        <div className="payables" id="payables-list">
          {snapshot.note ? <p className="payables-note">{snapshot.note}</p> : null}
          {fromStatements && position ? (
            <StatementArApTiles
              position={position}
              market={market}
              id="payables-statement-position"
            />
          ) : null}
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
                    <td>
                      {supplier.overdue >= 0.005
                        ? supplierMove(supplier.ageBucket, runwayWeeks)
                        : "—"}
                    </td>
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
              <p className="payables-note">
                Accept works the same way as other recommendations. Partner sign-off stays on the
                Action Plan. Milōn does not send a payment or record the bill.
              </p>
            </div>
          ) : (
            <p className="payables-note">
              Nothing is overdue on this report, so there is no payables draft.
            </p>
          )}
        </div>
      ) : (
        <StatementArApFallback
          idPrefix="payables"
          position={position}
          market={market}
          periodLabel={periodLabel}
          fromStatements={fromStatements}
          lead={fromStatements ? payablesStatementLead(pack) : payablesNoFiguresLead()}
          loading={loading}
          loadingLead="Checking the aged report on file."
          booksNote={!loading && booksNote ? booksNote : null}
          booksNoteId={snapshot?.status === "skipped" ? "payables-skip" : "payables-empty"}
          footnote="Milōn drafts the move once the aged report is on file. It does not send a payment or record the bill."
          kickerWhenEmpty="Payables"
          omitLead
          hideActions
        />
      )}
    </>
  );
}
