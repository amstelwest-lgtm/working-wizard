import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Trash2, CheckCheck, CornerDownRight } from "lucide-react";
import { useNotes } from "@/contexts/notes";

type NoteLayerProps = {
  tab: string;
  authorName: string;
};

function getInitials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function NoteLayer({ tab, authorName }: NoteLayerProps) {
  const { pinMode, setPinMode, addNote, deleteNote, resolveNote, replyToNote, getNotesForTab } =
    useNotes();

  const [composing, setComposing] = useState<{ vpX: number; vpY: number; pageX: number; pageY: number } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [scrollY, setScrollY] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const replyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    setScrollY(window.scrollY);
  }, []);

  useEffect(() => {
    function onScroll() { setScrollY(window.scrollY); }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const tabNotes = getNotesForTab(tab);
  const initials = getInitials(authorName);

  function handleCrosshairClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-note]")) return;
    const vpX = e.clientX;
    const vpY = e.clientY;
    const pageX = vpX + window.scrollX;
    const pageY = vpY + window.scrollY;
    setComposing({ vpX, vpY, pageX, pageY });
    setPinMode(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function submitNote() {
    if (!composing || !noteText.trim()) return;
    const saved = addNote({
      tab,
      x: composing.pageX,
      y: composing.pageY,
      text: noteText.trim(),
      author: authorName,
    });
    setNoteText("");
    setComposing(null);
    setOpenNoteId(saved.id);
  }

  function submitReply(noteId: string) {
    if (!replyText.trim()) return;
    replyToNote(noteId, { text: replyText.trim(), author: authorName });
    setReplyText("");
    setReplyingTo(null);
  }

  if (!mounted) return null;
  if (!pinMode && tabNotes.length === 0 && !composing) return null;

  const overlay = (
    <>
      {/* Crosshair capture layer — only when in pin mode */}
      {pinMode && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 99990, cursor: "crosshair" }}
          onClick={handleCrosshairClick}
        />
      )}

      {/* Saved pins — position tracks the page via scroll offset */}
      {tabNotes.map((note) => {
        const vpX = note.x - window.scrollX;
        const vpY = note.y - scrollY;
        const inView = vpX > -60 && vpX < window.innerWidth + 60 && vpY > -60 && vpY < window.innerHeight + 60;
        if (!inView) return null;

        return (
          <div
            key={note.id}
            data-note="true"
            style={{
              position: "fixed",
              left: vpX,
              top: vpY,
              transform: "translate(-50%, -50%)",
              zIndex: 99991,
            }}
          >
            <button
              className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-[10px] font-extrabold shadow-[0_2px_12px_rgba(0,0,0,0.4)] transition-all hover:scale-110 ${
                note.resolved
                  ? "border-emerald-500 bg-emerald-900/80 text-emerald-400"
                  : "border-[#d4a550] bg-[#1a2540] text-[#d4a550]"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                const next = openNoteId === note.id ? null : note.id;
                setOpenNoteId(next);
                if (!next) { setReplyingTo(null); setReplyText(""); }
              }}
            >
              {note.resolved ? "✓" : getInitials(note.author)}
            </button>

            {openNoteId === note.id && (
              <div
                data-note="true"
                className="absolute left-1/2 w-[300px] -translate-x-1/2 rounded-2xl border border-black/8 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.22)] dark:border-white/10 dark:bg-[#1e2d4a]"
                style={{ bottom: "calc(100% + 10px)" }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Original note */}
                <div className="px-4 pt-3 pb-2">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#d4a550] text-[10px] font-extrabold text-[#0a1628]">
                        {initials}
                      </div>
                      <div>
                        <div className="text-[12px] font-semibold text-slate-800 dark:text-white">
                          {note.author}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {new Date(note.timestamp).toLocaleString("en-ZA", {
                            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                    {/* Delete */}
                    <button
                      title="Delete note"
                      onClick={() => { deleteNote(note.id); setOpenNoteId(null); }}
                      className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500 dark:text-slate-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className={`text-[13px] leading-relaxed ${note.resolved ? "text-slate-400 line-through dark:text-slate-500" : "text-slate-700 dark:text-slate-200"}`}>
                    {note.text}
                  </div>
                </div>

                {/* Replies */}
                {note.replies.length > 0 && (
                  <div className="border-t border-black/5 dark:border-white/6 px-4 py-2 space-y-2">
                    {note.replies.map((r) => (
                      <div key={r.id} className="flex gap-2">
                        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {getInitials(r.author)}
                        </div>
                        <div>
                          <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{r.author} </span>
                          <span className="text-[12px] text-slate-600 dark:text-slate-300">{r.text}</span>
                          <div className="text-[10px] text-slate-400">
                            {new Date(r.timestamp).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reply input */}
                {replyingTo === note.id && (
                  <div className="border-t border-black/5 dark:border-white/6 px-3 pb-3 pt-2">
                    <input
                      ref={replyRef}
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitReply(note.id);
                        if (e.key === "Escape") { setReplyingTo(null); setReplyText(""); }
                      }}
                      placeholder="Reply…"
                      className="mb-2 w-full rounded-full border border-[#d4a550]/40 bg-transparent px-3 py-1.5 text-[12px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#d4a550] dark:text-white"
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setReplyingTo(null); setReplyText(""); }} className="text-[11px] text-slate-400 hover:text-slate-600">Cancel</button>
                      <button
                        onClick={() => submitReply(note.id)}
                        disabled={!replyText.trim()}
                        className="rounded-full px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                        style={{ background: "#1a73e8" }}
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                )}

                {/* Actions */}
                {replyingTo !== note.id && (
                  <div className="flex items-center gap-1 border-t border-black/5 dark:border-white/6 px-3 py-2">
                    <button
                      onClick={() => {
                        setReplyingTo(note.id);
                        setTimeout(() => replyRef.current?.focus(), 50);
                      }}
                      className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-200"
                    >
                      <CornerDownRight className="h-3 w-3" />
                      Reply
                    </button>
                    <button
                      onClick={() => resolveNote(note.id)}
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        note.resolved
                          ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-200"
                      }`}
                    >
                      <CheckCheck className="h-3 w-3" />
                      {note.resolved ? "Resolved" : "Resolve"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Compose dialog — appears at click viewport position */}
      {composing && (
        <div
          data-note="true"
          style={{
            position: "fixed",
            left: composing.vpX,
            top: composing.vpY,
            transform: "translate(-50%, -50%)",
            zIndex: 99992,
          }}
          className="w-[300px] rounded-2xl border border-black/8 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.22)] dark:border-white/10 dark:bg-[#1e2d4a]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d4a550] text-[11px] font-extrabold text-[#0a1628]">
              {initials}
            </div>
            <div className="text-[13px] font-semibold text-slate-800 dark:text-white">
              {authorName}
            </div>
          </div>

          <div className="px-4 pb-3">
            <input
              ref={inputRef}
              type="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNote();
                if (e.key === "Escape") setComposing(null);
              }}
              placeholder="Comment or add others with @"
              className="w-full rounded-full border border-[#d4a550]/50 bg-transparent px-4 py-2 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#d4a550] dark:text-white"
            />
          </div>

          <div className="flex justify-end gap-3 px-4 pb-4">
            <button
              className="text-[13px] font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
              onClick={() => setComposing(null)}
            >
              Cancel
            </button>
            <button
              disabled={!noteText.trim()}
              onClick={submitNote}
              className="rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-40"
              style={noteText.trim() ? { background: "#1a73e8", color: "#fff" } : { background: "#e2e8f0", color: "#64748b" }}
            >
              Comment
            </button>
          </div>
        </div>
      )}
    </>
  );

  return createPortal(overlay, document.body);
}
