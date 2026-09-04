import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Trash2,
  CheckCheck,
  CornerDownRight,
  X,
  Shield,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useNotes, type NoteCollaborator } from "@/contexts/notes";
import { useMarketFormat } from "@/contexts/market";

type NoteLayerProps = {
  clientId: string | null | undefined;
  tab: string;
  authorName: string;
  clientName?: string;
  /** Fired after a note create / resolve / delete / reply so parents can refresh live counts. */
  onNotesChanged?: () => void;
  /** Switch the parent tab so a deep-linked note can open. */
  onNeedTab?: (tab: string) => void;
};

function getInitials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function MentionComposer({
  value,
  onChange,
  onSubmit,
  onCancel,
  collaborators,
  placeholder,
  autoFocus,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  collaborators: NoteCollaborator[];
  placeholder: string;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.toLowerCase();
    return collaborators
      .filter(
        (c) =>
          c.handle.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [collaborators, mentionQuery]);

  function detectMention(next: string, caret: number) {
    const before = next.slice(0, caret);
    const m = before.match(/@([a-zA-Z0-9._%+-@]*)$/);
    if (m) {
      setMentionQuery(m[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function applyMention(c: NoteCollaborator) {
    const caret = inputRef?.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const replaced = before.replace(/@([a-zA-Z0-9._-]*)$/, `@${c.handle} `);
    onChange(replaced + after);
    setMentionQuery(null);
    setTimeout(() => {
      const el = inputRef?.current;
      if (!el) return;
      const pos = replaced.length;
      el.focus();
      el.setSelectionRange(pos, pos);
    }, 0);
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next);
          detectMention(next, e.target.selectionStart ?? next.length);
        }}
        onKeyDown={(e) => {
          if (mentionQuery != null && suggestions.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setMentionIndex((i) => (i + 1) % suggestions.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setMentionIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              applyMention(suggestions[mentionIndex] ?? suggestions[0]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setMentionQuery(null);
              return;
            }
          }
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onCancel();
        }}
        placeholder={placeholder}
        className="w-full rounded-full border border-[#d4a550]/50 bg-transparent px-4 py-2 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#d4a550] dark:text-white"
      />
      {mentionQuery != null && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-[#16233d]">
          {suggestions.map((c, i) => (
            <button
              key={c.userId}
              type="button"
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] ${
                i === mentionIndex
                  ? "bg-[#d4a550]/15 text-slate-900 dark:text-white"
                  : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/5"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                applyMention(c);
              }}
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#d4a550] text-[10px] font-bold text-[#0a1628]">
                {getInitials(c.name)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">{c.name}</span>
                <span className="text-slate-400"> @{c.handle}</span>
              </span>
              <span className="shrink-0 text-[10px] text-slate-400">{c.roleLabel}</span>
            </button>
          ))}
        </div>
      )}
      {mentionQuery != null && suggestions.length === 0 && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-[11px] text-slate-500 shadow-lg dark:border-white/10 dark:bg-[#16233d]">
          {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mentionQuery) ? (
            <button
              type="button"
              className="w-full text-left text-[#b8860b] hover:underline"
              onMouseDown={(e) => {
                e.preventDefault();
                const email = mentionQuery.toLowerCase();
                const caret = inputRef?.current?.selectionStart ?? value.length;
                const before = value.slice(0, caret);
                const after = value.slice(caret);
                const replaced = before.replace(/@([a-zA-Z0-9._%+-@]*)$/, `@${email} `);
                onChange(replaced + after);
                setMentionQuery(null);
              }}
            >
              Notify {mentionQuery} by email
            </button>
          ) : (
            <>Type @name or a full email (name@company.com) to notify</>
          )}
        </div>
      )}
    </div>
  );
}

export function NoteLayer({
  clientId,
  tab,
  authorName,
  clientName,
  onNotesChanged,
  onNeedTab,
}: NoteLayerProps) {
  const { dateTime } = useMarketFormat();
  const {
    pinMode,
    setPinMode,
    addNote,
    deleteNote,
    resolveNote,
    replyToNote,
    getNotesForTab,
    collaborators,
    registerSurface,
    clearSurface,
    openArchive,
    tagMilonIt,
    notes: allNotes,
    focusNoteId,
    requestOpenNote,
    clearFocusNote,
  } = useNotes();

  const [composing, setComposing] = useState<{
    vpX: number;
    vpY: number;
    pageX: number;
    pageY: number;
  } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [scrollY, setScrollY] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tagIt, setTagIt] = useState(false);
  const [trayExpanded, setTrayExpanded] = useState(false);
  const [trayHidden, setTrayHidden] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const replyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    setScrollY(window.scrollY);
  }, []);

  useEffect(() => {
    if (!clientId) {
      clearSurface();
      return;
    }
    registerSurface({
      clientId,
      tab,
      authorName,
      clientName,
    });
  }, [clientId, tab, authorName, clientName, registerSurface, clearSurface]);

  useEffect(() => {
    return () => {
      if (clientId) clearSurface(clientId);
    };
  }, [clientId, clearSurface]);

  useEffect(() => {
    function onScroll() {
      setScrollY(window.scrollY);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const tabNotes = clientId ? getNotesForTab(tab) : [];
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

  async function submitNote() {
    if (!composing || !noteText.trim() || saving) return;
    setSaving(true);
    try {
      const saved = await addNote({
        x: composing.pageX,
        y: composing.pageY,
        text: noteText.trim(),
        tagMilonIt: tagIt,
      });
      setNoteText("");
      setTagIt(false);
      setComposing(null);
      // Stay on the pin — do not leave the composer card open over the page.
      if (saved) {
        setOpenNoteId(null);
        setTrayHidden(false);
        setTrayExpanded(false);
      }
      onNotesChanged?.();
    } finally {
      setSaving(false);
    }
  }

  async function submitReply(noteId: string) {
    if (!replyText.trim() || saving) return;
    setSaving(true);
    try {
      await replyToNote(noteId, replyText.trim());
      setReplyText("");
      setReplyingTo(null);
      onNotesChanged?.();
    } finally {
      setSaving(false);
    }
  }

  function closeOpenNote() {
    setOpenNoteId(null);
    setReplyingTo(null);
    setReplyText("");
  }

  const openNote = (noteId: string) => {
    const note = allNotes.find((n) => n.id === noteId) ?? tabNotes.find((n) => n.id === noteId);
    if (!note) return;
    if (note.tab !== tab) {
      onNeedTab?.(note.tab);
      requestOpenNote(noteId);
      return;
    }
    const targetY = Math.max(0, note.y - window.innerHeight * 0.4);
    window.scrollTo({ top: targetY, behavior: "smooth" });
    setOpenNoteId(noteId);
    setScrollY(window.scrollY);
  };

  useEffect(() => {
    if (!focusNoteId) return;
    const note = allNotes.find((n) => n.id === focusNoteId);
    if (!note) return;
    if (note.tab !== tab) {
      onNeedTab?.(note.tab);
      return;
    }
    openNote(focusNoteId);
    clearFocusNote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNoteId, allNotes, tab]);

  useEffect(() => {
    setTrayExpanded(false);
    setTrayHidden(false);
  }, [tab]);

  useEffect(() => {
    if (pinMode) setTrayHidden(false);
  }, [pinMode]);

  if (!mounted || !clientId) return null;
  if (!pinMode && tabNotes.length === 0 && !composing && !openNoteId && !focusNoteId) return null;

  const overlay = (
    <>
      {pinMode && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 99990, cursor: "crosshair" }}
          onClick={handleCrosshairClick}
        />
      )}

      {/* Collapsed-by-default tray — existing notes stay findable without covering the page */}
      {tabNotes.length > 0 && !trayHidden && (
        <div
          data-note="true"
          className="fixed bottom-44 right-4 z-[99993] w-[min(280px,calc(100vw-2rem))] rounded-2xl border border-[#d4a550]/30 bg-white/95 p-2 shadow-xl backdrop-blur dark:border-[#d4a550]/25 dark:bg-[#0d1525]/95"
        >
          <div className="flex items-center justify-between gap-1 px-1">
            <button
              type="button"
              onClick={() => setTrayExpanded((o) => !o)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-[#d4a550]/10"
              title={trayExpanded ? "Minimise notes" : "Show notes on this tab"}
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b8860b]">
                Notes · {tabNotes.length}
              </span>
              <span className="text-[#d4a550]">
                {trayExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </span>
            </button>
            <button
              type="button"
              title="Open notes archive"
              onClick={() => openArchive("resolved")}
              className="px-1.5 text-[10px] font-semibold text-slate-500 hover:text-[#b8860b]"
            >
              Archive
            </button>
            <button
              type="button"
              title="Close notes panel"
              aria-label="Close notes panel"
              onClick={() => setTrayHidden(true)}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {trayExpanded && (
            <ul className="mt-1 max-h-[36vh] space-y-1 overflow-y-auto">
              {tabNotes.map((n) => (
                <li key={n.id} className="flex items-start gap-0.5">
                  <button
                    type="button"
                    onClick={() => openNote(n.id)}
                    className={`flex min-w-0 flex-1 items-start gap-2 rounded-xl px-2 py-1.5 text-left text-[11px] transition hover:bg-[#d4a550]/10 ${
                      openNoteId === n.id ? "bg-[#d4a550]/15" : ""
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                        n.resolved
                          ? "bg-emerald-600/20 text-emerald-500"
                          : "bg-[#d4a550]/25 text-[#b8860b]"
                      }`}
                    >
                      {n.resolved ? "✓" : getInitials(n.author)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">
                        {n.author}
                      </span>
                      <span
                        className={`block truncate text-slate-500 dark:text-slate-400 ${
                          n.resolved ? "line-through" : ""
                        }`}
                      >
                        {n.taggedMilonIt ? "IT · " : ""}
                        {n.text}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    title="Close note"
                    aria-label="Close note"
                    onClick={() => {
                      if (openNoteId === n.id) closeOpenNote();
                      if (!n.resolved) void resolveNote(n.id).then(() => onNotesChanged?.());
                    }}
                    className="mt-1 shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Delete note"
                    aria-label="Delete note"
                    onClick={() => {
                      void deleteNote(n.id).then(() => {
                        if (openNoteId === n.id) closeOpenNote();
                        onNotesChanged?.();
                      });
                    }}
                    className="mt-1 shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tabNotes.map((note) => {
        const vpX = note.x - window.scrollX;
        const vpY = note.y - scrollY;
        const inView =
          vpX > -60 && vpX < window.innerWidth + 60 && vpY > -60 && vpY < window.innerHeight + 60;
        // Keep open notes visible even if slightly off-screen; otherwise only
        // render pins in view (tray still lists everything).
        if (!inView && openNoteId !== note.id) return null;

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
                if (!next) {
                  setReplyingTo(null);
                  setReplyText("");
                }
              }}
            >
              {note.resolved ? "✓" : getInitials(note.author)}
            </button>

            {openNoteId === note.id && (
              <div
                data-note="true"
                className="absolute left-1/2 w-[min(300px,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border border-black/8 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.22)] dark:border-white/10 dark:bg-[#1e2d4a]"
                style={{ bottom: "calc(100% + 10px)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-4 pt-3 pb-2">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#d4a550] text-[10px] font-extrabold text-[#0a1628]">
                        {getInitials(note.author)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold text-slate-800 dark:text-white">
                          {note.author}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {dateTime(note.timestamp, {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        title="Delete note"
                        aria-label="Delete note"
                        onClick={() => {
                          void deleteNote(note.id).then(() => onNotesChanged?.());
                          closeOpenNote();
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        title="Close note"
                        aria-label="Close note"
                        onClick={closeOpenNote}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-200"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div
                    className={`text-[13px] leading-relaxed ${
                      note.resolved
                        ? "text-slate-400 line-through dark:text-slate-500"
                        : "text-slate-700 dark:text-slate-200"
                    }`}
                  >
                    {note.text}
                  </div>
                  {note.taggedMilonIt && (
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#d4a550]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#b8860b]">
                      <Shield className="h-3 w-3" /> Tagged Milōn IT
                    </div>
                  )}
                </div>

                {note.replies.length > 0 && (
                  <div className="space-y-2 border-t border-black/5 px-4 py-2 dark:border-white/6">
                    {note.replies.map((r) => (
                      <div key={r.id} className="flex gap-2">
                        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {getInitials(r.author)}
                        </div>
                        <div>
                          <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                            {r.author}{" "}
                          </span>
                          <span className="text-[12px] text-slate-600 dark:text-slate-300">
                            {r.text}
                          </span>
                          <div className="text-[10px] text-slate-400">
                            {dateTime(r.timestamp, {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {replyingTo === note.id && (
                  <div className="border-t border-black/5 px-3 pb-3 pt-2 dark:border-white/6">
                    <MentionComposer
                      value={replyText}
                      onChange={setReplyText}
                      onSubmit={() => void submitReply(note.id)}
                      onCancel={() => {
                        setReplyingTo(null);
                        setReplyText("");
                      }}
                      collaborators={collaborators}
                      placeholder="Reply… use @ to notify"
                      autoFocus
                      inputRef={replyRef}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setReplyingTo(null);
                          setReplyText("");
                        }}
                        className="text-[11px] text-slate-400 hover:text-slate-600"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void submitReply(note.id)}
                        disabled={!replyText.trim() || saving}
                        className="rounded-full px-3 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
                        style={{ background: "#1a73e8" }}
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                )}

                {replyingTo !== note.id && (
                  <div className="flex items-center gap-1 border-t border-black/5 px-3 py-2 dark:border-white/6">
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
                      onClick={() => void resolveNote(note.id).then(() => onNotesChanged?.())}
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        note.resolved
                          ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-200"
                      }`}
                    >
                      <CheckCheck className="h-3 w-3" />
                      {note.resolved ? "Resolved" : "Resolve"}
                    </button>
                    <button
                      onClick={() =>
                        void tagMilonIt(note.id, !note.taggedMilonIt).then(() => onNotesChanged?.())
                      }
                      className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        note.taggedMilonIt
                          ? "bg-[#d4a550]/20 text-[#b8860b]"
                          : "text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700/60 dark:hover:text-slate-200"
                      }`}
                    >
                      <Shield className="h-3 w-3" />
                      {note.taggedMilonIt ? "IT tagged" : "Tag Milōn IT"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

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
          className="relative w-[min(300px,calc(100vw-1.5rem))] rounded-2xl border border-black/8 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.22)] dark:border-white/10 dark:bg-[#1e2d4a]"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            title="Close note"
            aria-label="Close note"
            onClick={() => setComposing(null)}
            className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2.5 px-4 pb-3 pt-4 pr-10">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d4a550] text-[11px] font-extrabold text-[#0a1628]">
              {initials}
            </div>
            <div className="text-[13px] font-semibold text-slate-800 dark:text-white">
              {authorName}
            </div>
          </div>

          <div className="px-4 pb-3">
            <MentionComposer
              value={noteText}
              onChange={setNoteText}
              onSubmit={() => void submitNote()}
              onCancel={() => setComposing(null)}
              collaborators={collaborators}
              placeholder="Comment — @name emails only that person"
              autoFocus
              inputRef={inputRef}
            />
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={tagIt}
                onChange={(e) => setTagIt(e.target.checked)}
                className="accent-[#b8860b]"
              />
              <Shield className="h-3 w-3 text-[#b8860b]" />
              Tag Milōn IT
            </label>
          </div>

          <div className="flex justify-end gap-3 px-4 pb-4">
            <button
              className="text-[13px] font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
              onClick={() => setComposing(null)}
            >
              Cancel
            </button>
            <button
              disabled={!noteText.trim() || saving}
              onClick={() => void submitNote()}
              className="rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-40"
              style={
                noteText.trim()
                  ? { background: "#1a73e8", color: "#fff" }
                  : { background: "#e2e8f0", color: "#64748b" }
              }
            >
              {saving ? "Saving…" : "Comment"}
            </button>
          </div>
        </div>
      )}
    </>
  );

  return createPortal(overlay, document.body);
}
