import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useTrack } from "@/hooks/use-track";
import {
  createClientNote,
  deleteClientNote,
  extractMentionsFromText,
  listClientNotes,
  listNoteCollaborators,
  replyToClientNote,
  resolveClientNote,
  type ClientNote,
  type NoteCollaborator,
  type NoteMention,
  type NoteReply,
} from "@/lib/notes.functions";

export type { ClientNote as Note, NoteReply as Reply, NoteCollaborator, NoteMention };

type NotesSurface = {
  clientId: string;
  tab: string;
  authorName: string;
  clientName?: string;
};

type NotesCtx = {
  surface: NotesSurface | null;
  registerSurface: (surface: NotesSurface) => void;
  clearSurface: (clientId?: string) => void;
  notes: ClientNote[];
  collaborators: NoteCollaborator[];
  loading: boolean;
  pinMode: boolean;
  setPinMode: (v: boolean) => void;
  refresh: () => Promise<void>;
  addNote: (input: {
    x: number;
    y: number;
    text: string;
  }) => Promise<ClientNote | null>;
  deleteNote: (id: string) => Promise<void>;
  resolveNote: (id: string) => Promise<void>;
  replyToNote: (noteId: string, text: string) => Promise<void>;
  getNotesForTab: (tab: string) => ClientNote[];
  archiveOpen: boolean;
  archiveFilter: "open" | "resolved";
  openArchive: (filter?: "open" | "resolved") => void;
  closeArchive: () => void;
};

const NotesContext = createContext<NotesCtx | null>(null);

function toastEmailResult(
  emailResult:
    | { sent: string[]; failed: Array<{ email: string; error: string }> }
    | undefined,
  mentionCount: number,
) {
  if (mentionCount <= 0) {
    toast.success("Note saved");
    return;
  }
  const sent = emailResult?.sent?.length ?? 0;
  const failed = emailResult?.failed ?? [];
  if (sent > 0 && failed.length === 0) {
    toast.success(`Note saved · emailed ${sent} tagged ${sent === 1 ? "person" : "people"}`);
    return;
  }
  if (sent > 0 && failed.length > 0) {
    toast.warning(
      `Note saved · emailed ${sent}, failed ${failed.length} (${failed[0]?.error ?? "email error"})`,
    );
    return;
  }
  if (failed.length > 0) {
    const err = failed[0]?.error ?? "email failed";
    if (/RESEND_API_KEY not configured/i.test(err)) {
      toast.warning(
        "Note saved · mention email not sent (Resend API key not configured in this environment)",
      );
    } else {
      toast.warning(`Note saved · email not sent: ${err}`);
    }
    return;
  }
  toast.success("Note saved");
}

export function NotesProvider({ children }: { children: ReactNode }) {
  const [surface, setSurface] = useState<NotesSurface | null>(null);
  const [notes, setNotes] = useState<ClientNote[]>([]);
  const [collaborators, setCollaborators] = useState<NoteCollaborator[]>([]);
  const [clientName, setClientName] = useState("Client");
  const [loading, setLoading] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveFilter, setArchiveFilter] = useState<"open" | "resolved">("open");

  const openArchive = useCallback((filter?: "open" | "resolved") => {
    if (filter) setArchiveFilter(filter);
    setArchiveOpen(true);
  }, []);

  const closeArchive = useCallback(() => setArchiveOpen(false), []);

  const fetchNotes = useServerFn(listClientNotes);
  const fetchCollaborators = useServerFn(listNoteCollaborators);
  const createNoteFn = useServerFn(createClientNote);
  const replyFn = useServerFn(replyToClientNote);
  const resolveFn = useServerFn(resolveClientNote);
  const deleteFn = useServerFn(deleteClientNote);
  const track = useTrack();

  const registerSurface = useCallback((next: NotesSurface) => {
    setSurface((prev) => {
      if (
        prev &&
        prev.clientId === next.clientId &&
        prev.tab === next.tab &&
        prev.authorName === next.authorName
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const clearSurface = useCallback((clientId?: string) => {
    setSurface((prev) => {
      if (!prev) return null;
      if (clientId && prev.clientId !== clientId) return prev;
      return null;
    });
    setPinMode(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!surface?.clientId) {
      setNotes([]);
      setCollaborators([]);
      return;
    }
    setLoading(true);
    try {
      const [notesRes, collabRes] = await Promise.all([
        fetchNotes({ data: { clientId: surface.clientId } }),
        fetchCollaborators({ data: { clientId: surface.clientId } }),
      ]);
      setNotes(notesRes.notes ?? []);
      setCollaborators(collabRes.collaborators ?? []);
      setClientName(collabRes.clientName ?? surface.clientName ?? "Client");
    } catch (e) {
      console.error("Failed to load notes", e);
      const msg = e instanceof Error ? e.message : "Failed to load notes";
      // Lovable Cloud often lacks a service-role key — don't toast that as a user error.
      if (!/SUPABASE_SERVICE_ROLE_KEY|Connect Supabase in Lovable/i.test(msg)) {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [surface?.clientId, surface?.clientName, fetchNotes, fetchCollaborators]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addNote = useCallback(
    async (input: { x: number; y: number; text: string }) => {
      if (!surface?.clientId) {
        toast.error("Open a client workspace before pinning a note");
        return null;
      }
      const mentions = extractMentionsFromText(input.text, collaborators);
      try {
        const res = await createNoteFn({
          data: {
            clientId: surface.clientId,
            tab: surface.tab,
            x: input.x,
            y: input.y,
            text: input.text,
            mentions,
          },
        });
        setNotes((prev) => [...prev, res.note]);
        track("note_created", {
          tab: surface.tab,
          clientId: surface.clientId,
          mentions: res.notifyMentions.length,
        });
        toastEmailResult(
          res.emailResult as
            | { sent: string[]; failed: Array<{ email: string; error: string }> }
            | undefined,
          res.notifyMentions.length,
        );
        return res.note;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save note");
        return null;
      }
    },
    [surface, collaborators, createNoteFn, clientName, track],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      if (!surface?.clientId) return;
      try {
        await deleteFn({ data: { clientId: surface.clientId, noteId: id } });
        setNotes((prev) => prev.filter((n) => n.id !== id));
        toast.success("Note deleted");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to delete note");
      }
    },
    [surface?.clientId, deleteFn],
  );

  const resolveNote = useCallback(
    async (id: string) => {
      if (!surface?.clientId) return;
      try {
        const res = await resolveFn({
          data: { clientId: surface.clientId, noteId: id },
        });
        setNotes((prev) =>
          prev.map((n) =>
            n.id === id ? { ...n, resolved: res.resolved } : n,
          ),
        );
        if (res.resolved) {
          toast.success("Note resolved", {
            description: "It stays on the page and in Resolved notes — it is not deleted.",
            action: {
              label: "View archive",
              onClick: () => {
                setArchiveFilter("resolved");
                setArchiveOpen(true);
              },
            },
          });
        } else {
          toast.success("Note reopened");
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to update note");
      }
    },
    [surface?.clientId, resolveFn],
  );

  const replyToNote = useCallback(
    async (noteId: string, text: string) => {
      if (!surface?.clientId) return;
      const mentions = extractMentionsFromText(text, collaborators);
      try {
        const res = await replyFn({
          data: {
            clientId: surface.clientId,
            noteId,
            text,
            mentions,
          },
        });
        setNotes((prev) =>
          prev.map((n) =>
            n.id === noteId
              ? { ...n, replies: [...n.replies, res.reply] }
              : n,
          ),
        );
        if (res.notifyMentions.length > 0) {
          toastEmailResult(
            res.emailResult as
              | { sent: string[]; failed: Array<{ email: string; error: string }> }
              | undefined,
            res.notifyMentions.length,
          );
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to reply");
      }
    },
    [surface, collaborators, replyFn, clientName],
  );

  const getNotesForTab = useCallback(
    (tab: string) => notes.filter((n) => n.tab === tab),
    [notes],
  );

  const value = useMemo<NotesCtx>(
    () => ({
      surface,
      registerSurface,
      clearSurface,
      notes,
      collaborators,
      loading,
      pinMode,
      setPinMode,
      refresh,
      addNote,
      deleteNote,
      resolveNote,
      replyToNote,
      getNotesForTab,
      archiveOpen,
      archiveFilter,
      openArchive,
      closeArchive,
    }),
    [
      surface,
      registerSurface,
      clearSurface,
      notes,
      collaborators,
      loading,
      pinMode,
      refresh,
      addNote,
      deleteNote,
      resolveNote,
      replyToNote,
      getNotesForTab,
      archiveOpen,
      archiveFilter,
      openArchive,
      closeArchive,
    ],
  );

  return (
    <NotesContext.Provider value={value}>{children}</NotesContext.Provider>
  );
}

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) {
    throw new Error("useNotes must be used within NotesProvider");
  }
  return ctx;
}
