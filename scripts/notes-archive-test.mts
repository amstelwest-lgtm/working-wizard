/**
 * Notes: close, delete, and resolved archive (not a hard delete).
 * Run: pnpm test:notes-archive
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const layer = readFileSync(resolve("src/components/note-layer.tsx"), "utf8");
assert(layer.includes('aria-label="Close note"'), "note popover has a close control");
assert(layer.includes('aria-label="Delete note"'), "note popover has a delete control");
assert(layer.includes('aria-label="Close notes panel"'), "side tray can be closed");
assert(layer.includes("trayExpanded"), "side tray has a minimise state");
assert(layer.includes("useState(false)"), "side tray starts collapsed");
assert(!layer.includes("authorId === user?.id"), "close/delete are not skipped for existing notes");
assert(!layer.includes("if (saved) setOpenNoteId(saved.id)"), "new notes do not stay expanded");
assert(layer.includes("<X className"), "close uses an X icon");
assert(layer.includes("<Trash2"), "delete uses a trash icon");
assert(
  layer.indexOf("function closeOpenNote") < layer.indexOf('aria-label="Close note"'),
  "close helper exists before the close button",
);
assert(layer.includes('openArchive("resolved")'), "on-tab tray links to the resolved archive");
assert(layer.includes("Tag Milōn IT"), "notes can tag Milōn IT");
assert(
  !/setNotes\(\(prev\) => prev\.filter\(\(n\) => n\.id !== id &&/.test(layer),
  "resolving a note must not remove it from the layer",
);

const fns = readFileSync(resolve("src/lib/notes.functions.ts"), "utf8");
const deleteFn = fns.slice(fns.indexOf("export const deleteClientNote"));
assert(deleteFn.includes("assertClientAccess"), "delete still requires client access");
assert(!deleteFn.includes(".eq(\"author_id\""), "delete is not limited to the author");
assert(
  readFileSync(resolve("supabase/migrations/20260904120000_notes_delete_by_access.sql"), "utf8").includes(
    "notes delete by access",
  ),
  "RLS allows anyone with client access to delete a stuck note",
);

const ctx = readFileSync(resolve("src/contexts/notes.tsx"), "utf8");
assert(ctx.includes("archiveFilter"), "notes context exposes an archive filter");
assert(ctx.includes("openArchive"), "notes context can open the archive");
assert(
  ctx.includes('n.id === id ? { ...n, resolved: res.resolved } : n'),
  "resolve updates the flag instead of dropping the note",
);
assert(ctx.includes("View archive"), "resolve toast points at the archive");
assert(!ctx.includes("setNotes((prev) => prev.filter((n) => n.id !== id && !"), "resolve is not a delete");

const archive = readFileSync(resolve("src/components/note-archive.tsx"), "utf8");
assert(archive.includes("Resolved"), "archive has a Resolved tab");
assert(archive.includes("Open ("), "archive has an Open tab");
assert(archive.includes("Reopen"), "resolved notes can be reopened");
assert(archive.includes('aria-label="Delete note"'), "archive rows always expose delete");
assert(archive.includes('aria-label={note.resolved ? "Reopen note" : "Close note"}'), "archive rows always expose close");
assert(!archive.includes("canDelete"), "archive delete is not author-gated");

const root = readFileSync(resolve("src/routes/__root.tsx"), "utf8");
assert(root.includes("NoteArchiveSheet"), "archive sheet is mounted app-wide");

const client = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(client.includes("openArchive"), "Open queries opens the notes archive");
assert(client.includes("meta-notes"), "Open queries is a clickable control");

const fab = readFileSync(resolve("src/components/floating-note-button.tsx"), "utf8");
assert(fab.includes("Open notes archive"), "pin button cluster includes the archive");

console.log("notes-archive-test: ok");
