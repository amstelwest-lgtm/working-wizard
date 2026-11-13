import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { decideImProposal, listImProposals, type ImProposalRow } from "@/lib/im-proposal-decision.functions";
import { ROUTINE_RUNS_PER_FIRM_MONTH, capEstimateUsd } from "@/lib/im-proposal-decision";

function costLine(row: ImProposalRow): string {
  if (!row.costLabel) return "Cost not labelled.";
  if (row.estimatedCostUsd == null) return row.costLabel;
  return `${row.costLabel}. At the locked cap of ${ROUTINE_RUNS_PER_FIRM_MONTH}, about $${capEstimateUsd(row.estimatedCostUsd).toFixed(2)}.`;
}

/** Approve or dismiss stored proposals. The cap is fixed. Nothing is scheduled here. */
export function ImProposalDecisions({ firmId }: { firmId: string }) {
  const list = useServerFn(listImProposals);
  const decide = useServerFn(decideImProposal);
  const [rows, setRows] = useState<ImProposalRow[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setBusy(true);
    setNote(null);
    void list({ data: { firmId } })
      .then((result) => setRows(result.proposals))
      .catch((err: unknown) => {
        setNote(err instanceof Error ? err.message : "Could not load proposals.");
      })
      .finally(() => setBusy(false));
  };

  const choose = (findingId: string, decision: "approve" | "dismiss") => {
    setBusy(true);
    setNote(null);
    void decide({ data: { findingId, decision } })
      .then(() => load())
      .catch((err: unknown) => {
        setBusy(false);
        setNote(err instanceof Error ? err.message : "Could not save the decision.");
      });
  };

  return (
    <div data-im-proposal-decisions="">
      <h3>Approve proposals</h3>
      <p>
        Locked cap: {ROUTINE_RUNS_PER_FIRM_MONTH} routine runs a month. Estimated cost is on each proposal.
      </p>
      {rows === null ? (
        <div className="setup-partner__actions">
          <button type="button" className="setup-partner__ghost" disabled={busy} onClick={load}>
            {busy ? "Loading proposals…" : "Review proposals"}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p>No proposals waiting.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              {row.title}. {costLine(row)}
              {row.decision ? (
                <span> {row.decision === "approved" ? "Approved." : "Dismissed."}</span>
              ) : (
                <span className="setup-partner__actions">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    className="bg-[#0B5FFF] text-white shadow-none hover:bg-[#0B5FFF]/90"
                    onClick={() => choose(row.id, "approve")}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => choose(row.id, "dismiss")}
                  >
                    Dismiss
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {note ? <p>{note}</p> : null}
    </div>
  );
}
