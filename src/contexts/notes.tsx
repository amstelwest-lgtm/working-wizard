import { createContext, useContext, useState } from "react";

export type Reply = {
  id: string;
  text: string;
  author: string;
  timestamp: string;
};

export type Note = {
  id: string;
  tab: string;
  x: number;
  y: number;
  text: string;
  author: string;
  timestamp: string;
  resolved: boolean;
  replies: Reply[];
};

type NotesCtx = {
  notes: Note[];
  addNote: (note: Omit<Note, "id" | "timestamp" | "resolved" | "replies">) => Note;
  deleteNote: (id: string) => void;
  resolveNote: (id: string) => void;
  replyToNote: (noteId: string, reply: Omit<Reply, "id" | "timestamp">) => void;
  getNotesForTab: (tab: string) => Note[];
  pinMode: boolean;
  setPinMode: (v: boolean) => void;
};

const NotesContext = createContext<NotesCtx>({
  notes: [],
  addNote: () => ({ id: "", tab: "", x: 0, y: 0, text: "", author: "", timestamp: "", resolved: false, replies: [] }),
  deleteNote: () => {},
  resolveNote: () => {},
  replyToNote: () => {},
  getNotesForTab: () => [],
  pinMode: false,
  setPinMode: () => {},
});

export function NotesProvider({ children }: { children: React.ReactNode }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [pinMode, setPinMode] = useState(false);

  function addNote(note: Omit<Note, "id" | "timestamp" | "resolved" | "replies">): Note {
    const newNote: Note = {
      ...note,
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      resolved: false,
      replies: [],
    };
    setNotes((prev) => [...prev, newNote]);
    return newNote;
  }

  function deleteNote(id: string) {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  function resolveNote(id: string) {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, resolved: !n.resolved } : n))
    );
  }

  function replyToNote(noteId: string, reply: Omit<Reply, "id" | "timestamp">) {
    const newReply: Reply = {
      ...reply,
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
    };
    setNotes((prev) =>
      prev.map((n) => (n.id === noteId ? { ...n, replies: [...n.replies, newReply] } : n))
    );
  }

  function getNotesForTab(tab: string): Note[] {
    return notes.filter((n) => n.tab === tab);
  }

  return (
    <NotesContext.Provider value={{ notes, addNote, deleteNote, resolveNote, replyToNote, getNotesForTab, pinMode, setPinMode }}>
      {children}
    </NotesContext.Provider>
  );
}

export function useNotes() {
  return useContext(NotesContext);
}
