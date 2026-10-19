import { useState } from "react";
import { formatAssignmentNote } from "@/lib/action-handoff";

export type AssignmentNoteRow = {
  note: string | null;
  at: string;
  actorLabel?: string | null;
  actorType?: string | null;
};

function noteLine(row: AssignmentNoteRow): string {
  const text = row.note?.trim() ?? "";
  if (!text) return "";
  return formatAssignmentNote({ note: text, at: row.at, actorLabel: row.actorLabel });
}

/** Latest note on the row, with earlier notes behind one control. */
export function AssignmentNotes({ notes }: { notes: readonly AssignmentNoteRow[] }) {
  const [open, setOpen] = useState(false);
  const rows = [...notes]
    .filter((row) => row.note?.trim())
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  if (rows.length === 0) return null;
  const latest = rows[0]!;
  const older = rows.slice(1);
  return (
    <div className="mt-1" data-assignment-notes>
      <p className="text-[12px] font-medium leading-snug text-[#102A43] dark:text-slate-100" data-assignment-note>
        {noteLine(latest)}
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
              {noteLine(row)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
