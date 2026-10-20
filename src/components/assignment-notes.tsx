import { useState } from "react";
import { assignmentNoteFace, formatAssignmentNote } from "@/lib/action-handoff";
import { useMarketFormat } from "@/contexts/market";

export type AssignmentNoteRow = {
  note: string | null;
  at: string;
  actorLabel?: string | null;
  actorType?: string | null;
};

function noteLine(
  row: AssignmentNoteRow,
  market: ReturnType<typeof useMarketFormat>["market"],
): string {
  const text = row.note?.trim() ?? "";
  if (!text) return "";
  return formatAssignmentNote(
    {
      note: text,
      at: row.at,
      actorLabel: row.actorLabel,
      actorType: row.actorType,
    },
    market,
  );
}

/** Latest note on the row, with earlier notes behind one control. */
export function AssignmentNotes({ notes }: { notes: readonly AssignmentNoteRow[] }) {
  const { market } = useMarketFormat();
  const [open, setOpen] = useState(false);
  const { face, earlier } = assignmentNoteFace(notes);
  if (!face) return null;
  const latest = face;
  const older = earlier;
  return (
    <div className="mt-1" data-assignment-notes>
      <p className="text-[12px] font-medium leading-snug text-[#102A43] dark:text-slate-100" data-assignment-note>
        {noteLine(latest, market)}
      </p>
      {older.length > 0 ? (
        <button
          type="button"
          className="mt-0.5 text-[11px] font-semibold text-[#0B5FFF]"
          data-assignment-history
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
          }}
        >
          {open ? "Hide earlier notes" : `Earlier notes (${older.length})`}
        </button>
      ) : null}
      {open ? (
        <ul className="mt-1 space-y-1">
          {older.map((row, index) => (
            <li
              key={`${row.at}-${index}`}
              className="text-[12px] leading-snug text-[#3d5270] dark:text-slate-300"
              data-assignment-earlier
            >
              {noteLine(row, market)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
