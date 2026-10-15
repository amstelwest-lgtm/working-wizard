import { useEffect, useState } from "react";
import { toast } from "sonner";
import { chaseDraftMessage, type ChaseDraftInput } from "@/lib/chase-draft";

/**
 * Draft only. Copy and close. There is no send control.
 */
export function ChaseDraftDialog({
  draft,
  onClose,
}: {
  draft: ChaseDraftInput;
  onClose: () => void;
}) {
  const message = chaseDraftMessage(draft);
  const [body, setBody] = useState(message.body);
  useEffect(() => setBody(message.body), [message.body]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    const text = `${message.subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Chase draft copied");
    } catch {
      toast.error("Couldn't copy the draft");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-3 sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="chase-draft-title"
        data-chase-draft=""
        className="w-full max-w-lg rounded-2xl border border-[#DBEAFE] bg-white p-4 shadow-xl dark:border-[#1e3a5f] dark:bg-[#102A43]"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#102A43] dark:text-[#F4F7FB]">
          Draft only · nothing is sent
        </p>
        <h2 id="chase-draft-title" className="mt-1 text-lg font-bold text-slate-950 dark:text-white">
          {message.subject}
        </h2>
        <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-500" htmlFor="chase-draft-body">
          Message
        </label>
        <textarea
          id="chase-draft-body"
          className="mt-1 min-h-48 w-full rounded-xl border border-[#DBEAFE] bg-white p-3 text-sm text-slate-900 dark:border-[#1e3a5f] dark:bg-[#0B1F33] dark:text-[#F4F7FB]"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn gold" onClick={() => void copy()}>
            Copy draft
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
