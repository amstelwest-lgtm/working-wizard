import { Archive, CheckCheck, Trash2, X } from "lucide-react";
import { useNotes, type Note } from "@/contexts/notes";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const TAB_LABELS: Record<string, string> = {
  today: "Today",
  waterfall: "Profit",
  next: "Next moves",
  cash: "Cash",
  budget: "Budget",
  tasks: "Action plan",
  ratios: "Health",
  profit: "Profit",
  reports: "Reports",
  plan: "Action plan",
  advisory: "Advisory",
};

function tabLabel(tab: string) {
  return TAB_LABELS[tab] ?? tab;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ArchiveRow({ note }: { note: Note }) {
  const { resolveNote, deleteNote } = useNotes();

  return (
    <article className="rounded-xl border border-black/8 bg-white p-3 dark:border-white/10 dark:bg-[#16233d]">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-white/10 dark:text-slate-300">
          {tabLabel(note.tab)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">
          {note.author} · {formatWhen(note.timestamp)}
        </span>
        <button
          type="button"
          title={note.resolved ? "Reopen note" : "Close note"}
          aria-label={note.resolved ? "Reopen note" : "Close note"}
          onClick={() => void resolveNote(note.id)}
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
        >
          {note.resolved ? <CheckCheck className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          title="Delete note"
          aria-label="Delete note"
          onClick={() => void deleteNote(note.id)}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <p
        className={`text-[13px] leading-relaxed ${
          note.resolved ? "text-slate-500" : "text-slate-800 dark:text-slate-100"
        }`}
      >
        {note.text}
      </p>
      {note.replies.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-black/5 pt-2 dark:border-white/10">
          {note.replies.map((r) => (
            <li key={r.id} className="text-[12px] text-slate-600 dark:text-slate-300">
              <span className="font-semibold">{r.author}</span> {r.text}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => void resolveNote(note.id)}
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
        >
          <CheckCheck className="h-3 w-3" />
          {note.resolved ? "Reopen" : "Resolve"}
        </button>
      </div>
    </article>
  );
}

export function NoteArchiveSheet() {
  const { notes, archiveOpen, archiveFilter, openArchive, closeArchive } = useNotes();
  const openNotes = notes.filter((n) => !n.resolved);
  const resolvedNotes = notes.filter((n) => n.resolved);
  const rows = archiveFilter === "resolved" ? resolvedNotes : openNotes;

  return (
    <Sheet open={archiveOpen} onOpenChange={(open) => (open ? openArchive() : closeArchive())}>
      <SheetContent
        side="right"
        className="z-[100000] flex w-full flex-col gap-0 overflow-hidden border-l border-black/10 bg-[#f7f8fb] p-0 sm:max-w-md dark:border-white/10 dark:bg-[#0d1526]"
      >
        <SheetHeader className="border-b border-black/8 px-5 py-4 pr-12 text-left dark:border-white/10">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Archive className="h-4 w-4 text-[#c9962b]" />
            Notes
          </SheetTitle>
          <SheetDescription>
            Resolved notes stay here so you can reopen them. They are not deleted.
          </SheetDescription>
        </SheetHeader>
        <div className="flex gap-1 border-b border-black/8 px-4 py-2 dark:border-white/10">
          <button
            type="button"
            onClick={() => openArchive("open")}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
              archiveFilter === "open"
                ? "bg-[#c9962b] text-[#0a1628]"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
            }`}
          >
            Open ({openNotes.length})
          </button>
          <button
            type="button"
            onClick={() => openArchive("resolved")}
            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
              archiveFilter === "resolved"
                ? "bg-[#c9962b] text-[#0a1628]"
                : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10"
            }`}
          >
            Resolved ({resolvedNotes.length})
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {rows.length === 0 ? (
            <p className="px-1 py-8 text-center text-[13px] text-slate-500">
              {archiveFilter === "resolved"
                ? "No resolved notes yet. Resolve a query to archive it here."
                : "No open notes on this client."}
            </p>
          ) : (
            rows.map((note) => <ArchiveRow key={note.id} note={note} />)
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
