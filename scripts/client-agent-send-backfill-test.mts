/**
 * Send files reach the client's documents without Finish, and a send
 * finished before the copy step shipped is healed — without a duplicate
 * and without touching completed_at or reviewed_at.
 * Run: pnpm test:client-agent-send-backfill
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountantSendFileList } from "../src/components/accountant-send-files.tsx";
import {
  artifactCopyKey,
  buildClientAgentArtifact,
  copiesStillNeeded,
  indexedCopyKeys,
  type FinalFile,
} from "../src/lib/client-agent-done.ts";
import {
  archiveCopiesOfPaths,
  archiveCopiesStillNeeded,
  sendArchiveCandidates,
  sendFileDocumentPath,
} from "../src/lib/client-agent-send-backfill.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const sendId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const irp5Path = `${sendId}/irp5/33333333-3333-4333-8333-333333333333`;
const it3bPath = `${sendId}/it3b/44444444-4444-4444-8444-444444444444`;

const items = [
  { itemKey: "irp5", label: null, storagePath: irp5Path, mime: "application/pdf", sizeBytes: 900 },
  { itemKey: "it3b", label: null, storagePath: it3bPath, mime: "application/pdf", sizeBytes: 700 },
];
const fileRows = [
  {
    itemKey: "irp5",
    storagePath: irp5Path,
    mime: "application/pdf",
    sizeBytes: 900,
    displayName: "IRP5 2026.pdf",
  },
  {
    itemKey: "it3b",
    storagePath: it3bPath,
    mime: "application/pdf",
    sizeBytes: 700,
    displayName: null,
  },
];

// ── Candidates ───────────────────────────────────────────────────────────────

const candidates = sendArchiveCandidates({ sendId, items, fileRows });
assert(candidates.length === 2, "every stored file is a candidate");
assert(candidates[0]?.displayName === "IRP5 2026.pdf", "the client's file name is kept");
assert(candidates.every((file) => file.label.length > 0), "every candidate carries a label");

const legacyOnly = sendArchiveCandidates({ sendId, items, fileRows: [] });
assert(legacyOnly.length === 2, "a send without file rows still counts its item files");

const hostile = sendArchiveCandidates({
  sendId,
  items: [],
  fileRows: [
    { itemKey: "irp5", storagePath: "other-send/irp5/x", mime: "application/pdf", sizeBytes: 1, displayName: null },
    { itemKey: "irp5", storagePath: irp5Path, mime: "application/zip", sizeBytes: 1, displayName: null },
    { itemKey: "irp5", storagePath: irp5Path, mime: "application/pdf", sizeBytes: 900, displayName: null },
  ],
});
assert(hostile.length === 1, "a foreign path and an unknown type are skipped, not fatal");
assert(hostile[0]?.sourcePath === irp5Path, "the good row survives a bad one");

// ── The incident: completed send, nothing copied ─────────────────────────────

const nothingCopied = archiveCopiesStillNeeded({ sendId, files: candidates, artifactRows: [] });
assert(nothingCopied.length === 2, "a finished send with no copies backfills every file");

// ── Upload copy, then Finish, then backfill: one copy each ──────────────────

function copiedArtifact(file: FinalFile, artifactId: string) {
  return buildClientAgentArtifact({
    artifactId,
    clientId,
    sendId,
    itemKey: file.itemKey,
    label: file.label,
    mime: file.mime,
    size: file.size,
    sourcePath: file.sourcePath,
    displayName: file.displayName,
  });
}

const uploadCopy = copiedArtifact(candidates[0]!, "55555555-5555-4555-8555-555555555555");
const archive: Array<{ storage_path: string; visibility: string; meta: unknown }> = [
  { storage_path: uploadCopy.storage_path, visibility: uploadCopy.visibility, meta: uploadCopy.meta },
];

// The copy made at upload time is found and not repeated.
assert(
  archiveCopiesStillNeeded({ sendId, files: [candidates[0]!], artifactRows: archive }).length === 0,
  "an upload copy is not copied again",
);

// Finish only copies what is still missing.
const atFinish = copiesStillNeeded(candidates, sendId, indexedCopyKeys(archive, sendId));
assert(atFinish.length === 1 && atFinish[0]?.sourcePath === it3bPath, "Finish skips the upload copy");
const finishCopy = copiedArtifact(atFinish[0]!, "66666666-6666-4666-8666-666666666666");
archive.push({
  storage_path: finishCopy.storage_path,
  visibility: finishCopy.visibility,
  meta: finishCopy.meta,
});

// The backfill after Finish has nothing to do — no duplicates.
assert(
  archiveCopiesStillNeeded({ sendId, files: candidates, artifactRows: archive }).length === 0,
  "the backfill after Finish copies nothing",
);
assert(
  archiveCopiesStillNeeded({ sendId, files: candidates, artifactRows: archive }).length === 0,
  "a second backfill pass also copies nothing",
);
assert(
  artifactCopyKey(sendId, "irp5", irp5Path) === `${sendId}\nirp5\n${irp5Path}`,
  "the duplicate key is the send, the item, and the source path",
);

// ── The firm sees the file without Finish ────────────────────────────────────

const documentPath = sendFileDocumentPath(archive, sendId, irp5Path);
assert(documentPath === uploadCopy.storage_path, "a stored upload resolves to its archive copy");
assert(
  sendFileDocumentPath(archive, "99999999-9999-4999-8999-999999999999", irp5Path) === null,
  "another send's copy is not borrowed",
);
assert(
  sendFileDocumentPath(
    [{ ...archive[0]!, visibility: "private" }],
    sendId,
    irp5Path,
  ) === null,
  "a private row is not offered",
);

const listHtml = renderToStaticMarkup(
  createElement(AccountantSendFileList, {
    files: [
      {
        id: "file-1",
        itemKey: "irp5",
        displayName: "IRP5 2026.pdf",
        hasPassword: false,
        documentPath,
      },
      {
        id: "file-2",
        itemKey: "it3b",
        displayName: null,
        hasPassword: false,
        documentPath: null,
      },
    ],
    revealed: null,
    busyFileId: null,
    onShow: () => undefined,
    onToggleVisible: () => undefined,
    onCopy: () => undefined,
    onOpen: () => undefined,
  }),
);
assert(listHtml.includes('data-open-file="file-1"'), "a copied file can be opened from the list");
assert(listHtml.includes("Open in Documents"), "the open control names the documents");
const uncopied = listHtml.slice(listHtml.indexOf('data-send-file="file-2"'));
assert(!uncopied.includes("data-open-file"), "a file without a copy has no open control");

// ── Removal before Finish cleans the copy ────────────────────────────────────

const removable = archiveCopiesOfPaths(
  [
    { id: "a-1", storage_path: uploadCopy.storage_path, meta: uploadCopy.meta },
    { id: "a-2", storage_path: finishCopy.storage_path, meta: finishCopy.meta },
    { id: "a-3", storage_path: "x", meta: { source: "bank_pack" } },
  ],
  sendId,
  [irp5Path],
);
assert(removable.length === 1 && removable[0]?.id === "a-1", "only the removed path's copy is named");

// ── Server wiring ────────────────────────────────────────────────────────────

const archiveServer = read("src/lib/client-agent-send-archive.server.ts");
assert(!archiveServer.includes("completed_at"), "the archive module never reads or writes completed_at");
assert(!archiveServer.includes("reviewed_at"), "the archive module never reads or writes reviewed_at");
assert(
  !archiveServer.includes('from("client_agent_sends")'),
  "the archive module does not touch client_agent_sends",
);
assert(!archiveServer.includes("sendClientAgentDone"), "the backfill sends no mail");
assert(!/resend/i.test(archiveServer), "the archive module does not know the mailer");
assert(
  archiveServer.includes("kind: row.kind") &&
    archiveServer.includes("visibility: row.visibility") &&
    archiveServer.includes("created_by: row.created_by"),
  "the copy writes the shared artifact row",
);

const backfillPure = read("src/lib/client-agent-send-backfill.ts");
assert(!backfillPure.includes("supabase"), "the rules module has no database");
assert(!backfillPure.includes("completed_at") && !backfillPure.includes("reviewed_at"), "the rules never name the timestamps");

const linkFn = read("src/lib/client-agent-link.functions.ts");
const confirmHandler = linkFn.slice(
  linkFn.indexOf("export const confirmClientAgentUpload"),
  linkFn.indexOf("export const removeClientAgentFile"),
);
assert(confirmHandler.includes("copySendFileIfMissing"), "confirm copies the upload for the firm");
assert(
  confirmHandler.indexOf("updateItem") < confirmHandler.indexOf("copySendFileIfMissing"),
  "the copy happens after the item is stored",
);
const removeHandler = linkFn.slice(
  linkFn.indexOf("export const removeClientAgentFile"),
  linkFn.indexOf("export const finishClientAgentItem"),
);
assert(removeHandler.includes("removeSendArchiveCopies"), "removal also removes the copy");
assert(
  removeHandler.includes("!resolved.send.completed_at"),
  "a completed send's copies are never removed",
);
const finishHandler = linkFn.slice(linkFn.indexOf("export const completeClientAgentSend"));
assert(finishHandler.includes("copiesStillNeeded"), "Finish still skips stored copies");
assert(finishHandler.includes("copySendFileToArchive"), "Finish uses the shared copy");

const listFn = read("src/lib/client-agent-send.functions.ts");
const listHandler = listFn.slice(
  listFn.indexOf("export const listClientAgentSends"),
  listFn.indexOf("export const mintClientAgentSend"),
);
assert(listHandler.includes("copyMissingSendArtifacts"), "listing the sends heals missing copies");
assert(listHandler.includes("sendFileDocumentPath"), "listing resolves each file's copy");
assert(
  !listHandler.includes(".update("),
  "listing writes nothing to the send rows",
);
assert(listFn.includes("documentPath: null"), "a file without a copy says so");

const panel = read("src/components/send-agent-panel.tsx");
assert(panel.includes("onOpen={(documentPath)"), "the panel opens a copied file");
const listUi = read("src/components/accountant-send-files.tsx");
assert(listUi.includes("Open in Documents"), "the file list offers the copy");
assert(!listUi.includes("flex-row"), "the file list still stacks vertically");

// ── Migration ────────────────────────────────────────────────────────────────

const sql = read("supabase/migrations/20261024150000_client_agent_send_artifact_copy_key.sql");
const code = sql
  .split("\n")
  .map((line) => line.split("--")[0])
  .join("\n")
  .toLowerCase();
assert(code.includes("create unique index if not exists client_artifacts_send_copy_key"), "the copy key is unique");
assert(code.includes("meta->>'send_id'") && code.includes("meta->>'item_key'") && code.includes("meta->>'source_path'"), "the key matches the application's duplicate key");
assert(code.includes("where meta->>'source' = 'client_agent_send'"), "only send copies are keyed");
assert(!/\bsecurity\s+definer\b/.test(code), "no security definer");
assert(!/grant\b/.test(code), "nothing is granted");
assert(!/\balter\s+table\b/.test(code), "no table is altered");
assert(!/\bupdate\b/.test(code) && !/\bdelete\b/.test(code), "the migration rewrites no rows");
assert(
  !read("scripts/apply-client-agent-sends-sql.sh").includes("artifact_copy_key") &&
    !read("scripts/apply-client-agent-send-storage-sql.sh").includes("artifact_copy_key"),
  "the migration is not wired into the CI apply scripts",
);

console.log("client agent send backfill test ok");
