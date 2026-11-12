import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { saveImTakeoverProposals } from "@/lib/im-takeover-proposal.functions";
import { takeoverProposals } from "@/lib/im-takeover-proposal";
import type { PracticeImplementationPlan } from "@/lib/setup-partner-plan";

/** Confirmed steps the practice can hand to Milōn. Drafts only. */
export function ImTakeoverProposals({
  firmId,
  plan,
}: {
  firmId: string;
  plan: PracticeImplementationPlan | null;
}) {
  const save = useServerFn(saveImTakeoverProposals);
  const proposals = takeoverProposals(plan?.steps ?? []);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (proposals.length === 0) return null;

  return (
    <div data-im-takeover-proposals="">
      <h3>Takeover proposals</h3>
      <ul>
        {proposals.map((proposal) => (
          <li key={proposal.dedupeKey}>
            {proposal.title}. {proposal.detail}
          </li>
        ))}
      </ul>
      <div className="setup-partner__actions">
        <button
          type="button"
          className="setup-partner__ghost"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            setNote(null);
            void save({ data: { firmId, steps: plan?.steps ?? [] } })
              .then((result) => {
                setNote(
                  result.ok
                    ? `Stored ${result.stored} proposal${result.stored === 1 ? "" : "s"}. Not scheduled.`
                    : result.error,
                );
              })
              .catch((err: unknown) => {
                setNote(err instanceof Error ? err.message : "Could not store the proposals.");
              })
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving proposals…" : "Save takeover proposals"}
        </button>
      </div>
      {note ? <p>{note}</p> : null}
    </div>
  );
}
