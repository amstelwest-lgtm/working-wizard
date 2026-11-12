import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { saveImRoutineProposals } from "@/lib/im-routine-proposal.functions";
import { ROUTINE_RUNS_PER_FIRM_MONTH, routineProposals } from "@/lib/im-routine-proposal";
import type { PracticeImplementationPlan } from "@/lib/setup-partner-plan";

/** Routine drafts. The button stores them. It does not schedule a run. */
export function ImRoutineProposals({
  firmId,
  plan,
}: {
  firmId: string;
  plan: PracticeImplementationPlan | null;
}) {
  const save = useServerFn(saveImRoutineProposals);
  const proposals = routineProposals(plan?.steps ?? []);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (proposals.length === 0) return null;

  return (
    <div data-im-routine-proposals="">
      <h3>Routine proposals</h3>
      <p>Locked cap: {ROUTINE_RUNS_PER_FIRM_MONTH} routine runs a month. Not scheduled.</p>
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
                    ? `Stored ${result.stored} routine proposal${result.stored === 1 ? "" : "s"}. Not scheduled.`
                    : result.error,
                );
              })
              .catch((err: unknown) => {
                setNote(err instanceof Error ? err.message : "Could not store the routine proposals.");
              })
              .finally(() => setSaving(false));
          }}
        >
          {saving ? "Saving routines…" : "Save routine proposals"}
        </button>
      </div>
      {note ? <p>{note}</p> : null}
    </div>
  );
}
