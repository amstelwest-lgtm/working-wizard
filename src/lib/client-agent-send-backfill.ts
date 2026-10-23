/**
 * Which send files still need a copy in the client's documents.
 * Pure rules only — no database, no mail, no file bytes. The copy itself
 * lives in client-agent-send-archive.server.ts.
 *
 * A send finished before the copy step shipped has its finish mark set and
 * nothing in client_artifacts. These rules find those files so the server
 * can copy them. The same rules make an upload visible without Finish.
 * Nothing here reads or writes the finish or review marks.
 */
import {
  copiesStillNeeded,
  extensionForAgentMime,
  indexedCopyKeys,
  type ArchiveFileRow,
  type FinalFile,
} from "@/lib/client-agent-done";
import { itemLabel, pathBelongsToSend } from "@/lib/client-agent-link";

export type ArchiveItemRow = {
  itemKey: string;
  label: string | null;
  storagePath: string | null;
  mime: string | null;
  sizeBytes: number | null;
};

export type ArtifactMetaRow = { meta: unknown };

export type ArtifactPathRow = {
  storage_path: unknown;
  visibility: unknown;
  meta: unknown;
};

/**
 * Every stored file on a send that can live in the archive. Lenient on
 * purpose: a row with a foreign path or an unknown type is skipped, not
 * refused, so one bad row cannot hide the rest. Item rows without a file
 * row (links from before client_agent_send_files) still count once.
 */
export function sendArchiveCandidates(input: {
  sendId: string;
  items: readonly ArchiveItemRow[];
  fileRows: readonly ArchiveFileRow[];
}): FinalFile[] {
  const labels = new Map(
    input.items.map((item) => [item.itemKey, itemLabel(item.itemKey, item.label)]),
  );
  const out: FinalFile[] = [];
  const seen = new Set<string>();
  const push = (row: {
    itemKey: string;
    sourcePath: string;
    mime: string | null;
    sizeBytes: number | null;
    displayName: string | null;
  }) => {
    if (!row.itemKey || !row.sourcePath || seen.has(row.sourcePath)) return;
    if (!pathBelongsToSend(row.sourcePath, input.sendId, row.itemKey)) return;
    const mime = row.mime ?? "";
    if (!extensionForAgentMime(mime)) return;
    seen.add(row.sourcePath);
    out.push({
      itemKey: row.itemKey,
      label: labels.get(row.itemKey) ?? itemLabel(row.itemKey, null),
      sourcePath: row.sourcePath,
      mime,
      size: row.sizeBytes ?? 0,
      displayName: row.displayName?.trim() || null,
    });
  };
  for (const row of input.fileRows) {
    push({
      itemKey: row.itemKey,
      sourcePath: row.storagePath,
      mime: row.mime,
      sizeBytes: row.sizeBytes,
      displayName: row.displayName,
    });
  }
  for (const item of input.items) {
    if (!item.storagePath) continue;
    push({
      itemKey: item.itemKey,
      sourcePath: item.storagePath,
      mime: item.mime,
      sizeBytes: item.sizeBytes,
      displayName: null,
    });
  }
  return out;
}

/**
 * The candidates without a copy yet. Uses the same key as Finish
 * (send, item, source path), so Finish, an upload copy, and the
 * backfill can run in any order without a duplicate.
 */
export function archiveCopiesStillNeeded(input: {
  sendId: string;
  files: readonly FinalFile[];
  artifactRows: readonly ArtifactMetaRow[];
}): FinalFile[] {
  return copiesStillNeeded(
    input.files,
    input.sendId,
    indexedCopyKeys(input.artifactRows, input.sendId),
  );
}

/** The archive path of one send file's shared copy, if a copy exists. */
export function sendFileDocumentPath(
  rows: readonly ArtifactPathRow[],
  sendId: string,
  sourcePath: string,
): string | null {
  for (const row of rows) {
    if (row.visibility !== "shared") continue;
    if (typeof row.storage_path !== "string" || row.storage_path.length === 0) continue;
    if (!row.meta || typeof row.meta !== "object") continue;
    const meta = row.meta as Record<string, unknown>;
    if (meta.source !== "client_agent_send") continue;
    if (meta.send_id !== sendId || meta.source_path !== sourcePath) continue;
    return row.storage_path;
  }
  return null;
}

/** Archive rows that copy one of the given send paths. Used when the client removes a file before Finish. */
export function archiveCopiesOfPaths(
  rows: ReadonlyArray<{ id: unknown; storage_path: unknown; meta: unknown }>,
  sendId: string,
  sourcePaths: readonly string[],
): Array<{ id: string; storagePath: string | null }> {
  const wanted = new Set(sourcePaths);
  const out: Array<{ id: string; storagePath: string | null }> = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id) continue;
    if (!row.meta || typeof row.meta !== "object") continue;
    const meta = row.meta as Record<string, unknown>;
    if (meta.source !== "client_agent_send" || meta.send_id !== sendId) continue;
    if (typeof meta.source_path !== "string" || !wanted.has(meta.source_path)) continue;
    out.push({
      id: row.id,
      storagePath:
        typeof row.storage_path === "string" && row.storage_path ? row.storage_path : null,
    });
  }
  return out;
}
