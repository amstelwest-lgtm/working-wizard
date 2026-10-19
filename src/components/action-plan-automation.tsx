/**
 * Confirm suggested owners and dates, and drop a duplicate or a contradiction.
 * Confirm is the only write. The panel does not email anyone.
 */
import type { ActionAutomationRow, Contradiction, DuplicateGroup } from "@/lib/action-plan-automation";
import { useMarketFormat } from "@/contexts/market";
import { formatCalendarDay } from "@/lib/market/format";
import { actionDisplayTitle } from "@/lib/strategic-moves";

const FOLLOW_UP: Record<ActionAutomationRow["followUp"], string> = {
  overdue: "Overdue",
  nudged: "Follow-up sent",
  waiting: "Waiting on the owner",
  none: "No follow-up yet",
  done: "Done",
};

export function ActionPlanAutomation({
  rows,
  duplicates,
  contradictions,
  canEdit,
  onConfirm,
  onDrop,
}: {
  rows: readonly ActionAutomationRow[];
  duplicates: readonly DuplicateGroup[];
  contradictions: readonly Contradiction[];
  canEdit: boolean;
  onConfirm: (row: ActionAutomationRow) => void;
  onDrop: (id: string, note: string) => void;
}) {
  const { market } = useMarketFormat();
  const open = rows.filter((row) => row.followUp !== "done");
  const needsConfirm = open.filter((row) => row.ownerSuggested || row.dueSuggested);
  if (!needsConfirm.length && !duplicates.length && !contradictions.length && !open.some((row) => row.overdue)) {
    return null;
  }
  return (
    <section className="mx-4 mb-3 rounded-xl border border-[#DBEAFE] bg-[#F4F7FB] p-3 text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#0B1B2B] dark:text-[#F4F7FB]" aria-label="Action suggestions" data-action-automation="true">
      <h3 className="text-xs font-bold uppercase tracking-[0.16em]">Suggested — confirm</h3>
      {needsConfirm.length ? (
        <ul className="mt-2 space-y-2">
          {needsConfirm.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <b>{actionDisplayTitle(row.title)}</b>
                {row.ownerSuggested && row.owner ? ` · ${row.owner.name}` : ""}
                {row.dueSuggested && row.dueDate ? ` · due ${formatCalendarDay(row.dueDate, market)}` : ""}
                {` · ${FOLLOW_UP[row.followUp]}`}
                {row.overdue ? " · Overdue" : ""}
              </span>
              {canEdit ? (
                <button type="button" className="btn ghost mini" onClick={() => onConfirm(row)}>
                  Confirm
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open.some((row) => row.overdue && !row.ownerSuggested && !row.dueSuggested) ? (
        <ul className="mt-2 space-y-1 text-sm">
          {open
            .filter((row) => row.overdue && !row.ownerSuggested && !row.dueSuggested)
            .map((row) => (
              <li key={`overdue-${row.id}`}>
                <b>Overdue</b> · {actionDisplayTitle(row.title)} · {FOLLOW_UP[row.followUp]}
              </li>
            ))}
        </ul>
      ) : null}
      {duplicates.map((group) => (
        <div key={group.keepId} className="mt-3 text-sm">
          <p>Same action more than once: {actionDisplayTitle(group.title)}</p>
          {canEdit
            ? group.dropIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="btn ghost mini mt-1"
                  onClick={() => onDrop(id, "Dropped as a duplicate")}
                >
                  Drop duplicate
                </button>
              ))
            : null}
        </div>
      ))}
      {contradictions.map((pair) => (
        <div key={`${pair.leftId}-${pair.rightId}`} className="mt-3 text-sm">
          <p>{pair.reason}</p>
          <p>
            {actionDisplayTitle(pair.leftTitle)} · {actionDisplayTitle(pair.rightTitle)}
          </p>
          {canEdit ? (
            <button
              type="button"
              className="btn ghost mini mt-1"
              onClick={() => onDrop(pair.rightId, "Dropped because it contradicts the action that was kept")}
            >
              Keep the first
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
