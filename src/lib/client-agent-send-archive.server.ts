/**
 * Copies a client's send files into the client's documents. Service role
 * only. Shared by Finish, by the upload confirmation, and by the backfill
 * that heals sends finished before the copy step shipped.
 *
 * This module never emails anyone and never reads or writes the send rows:
 * the finish and review marks are not its business.
 */
import { buildClientAgentArtifact, type FinalFile } from "@/lib/client-agent-done";
import {
  SEND_STORAGE_BUCKET,
  sanitizeClientFileName,
  sniffDocumentMime,
} from "@/lib/client-agent-link";
import {
  archiveCopiesOfPaths,
  archiveCopiesStillNeeded,
  sendArchiveCandidates,
  type ArchiveItemRow,
} from "@/lib/client-agent-send-backfill";
import { CLIENT_DOCUMENTS_BUCKET } from "@/lib/client-documents";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type DbError = { message: string } | null;

function missingRelation(error: DbError, name: string): boolean {
  const message = error?.message ?? "";
  return message.includes(name) && /does not exist|schema cache|could not find/i.test(message);
}

function archiveStorage(bucket: string) {
  return (
    supabaseAdmin as unknown as {
      storage: {
        from: (name: string) => {
          download: (path: string) => Promise<{ data: Blob | null; error: DbError }>;
          upload: (
            path: string,
            body: Uint8Array,
            options: { contentType: string; upsert: boolean },
          ) => Promise<{ error: DbError }>;
          remove: (paths: string[]) => Promise<{ error: DbError }>;
        };
      };
    }
  ).storage.from(bucket);
}

export async function copySendFileToArchive(input: {
  clientId: string;
  sendId: string;
  file: FinalFile;
}): Promise<boolean> {
  const downloaded = await archiveStorage(SEND_STORAGE_BUCKET).download(input.file.sourcePath);
  if (downloaded.error || !downloaded.data) return false;
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const sniffed = sniffDocumentMime(bytes);
  if (!sniffed || sniffed !== input.file.mime) return false;
  const artifactId = crypto.randomUUID();
  const row = buildClientAgentArtifact({
    artifactId,
    clientId: input.clientId,
    sendId: input.sendId,
    itemKey: input.file.itemKey,
    label: input.file.label,
    mime: sniffed,
    size: bytes.byteLength,
    sourcePath: input.file.sourcePath,
    displayName: input.file.displayName,
  });
  const uploaded = await archiveStorage(CLIENT_DOCUMENTS_BUCKET).upload(row.storage_path, bytes, {
    contentType: sniffed,
    upsert: false,
  });
  if (uploaded.error) return false;
  const inserted = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        insert: (value: Record<string, unknown>) => Promise<{ error: DbError }>;
      };
    }
  )
    .from("client_artifacts")
    .insert({
      id: row.id,
      client_id: row.client_id,
      kind: row.kind,
      storage_path: row.storage_path,
      visibility: row.visibility,
      created_by: row.created_by,
      meta: row.meta,
    });
  if (inserted.error) {
    await archiveStorage(CLIENT_DOCUMENTS_BUCKET).remove([row.storage_path]);
    return false;
  }
  return true;
}

async function loadArtifactMetaRows(clientId: string): Promise<Array<{ meta: unknown }> | null> {
  const { data, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        select: (cols: string) => {
          eq: (
            column: string,
            value: string,
          ) => Promise<{ data: Array<{ meta: unknown }> | null; error: DbError }>;
        };
      };
    }
  )
    .from("client_artifacts")
    .select("meta")
    .eq("client_id", clientId);
  if (error) return null;
  return data ?? [];
}

async function loadArchiveItemRows(sendId: string): Promise<ArchiveItemRow[]> {
  const { data, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        select: (cols: string) => {
          eq: (
            column: string,
            value: string,
          ) => Promise<{ data: Array<Record<string, unknown>> | null; error: DbError }>;
        };
      };
    }
  )
    .from("client_agent_send_items")
    .select("item_key, label, storage_path, mime, size_bytes")
    .eq("send_id", sendId);
  if (error) return [];
  return (data ?? []).flatMap((row) => {
    const itemKey = typeof row.item_key === "string" ? row.item_key : "";
    if (!itemKey) return [];
    return [
      {
        itemKey,
        label: typeof row.label === "string" ? row.label : null,
        storagePath: typeof row.storage_path === "string" ? row.storage_path : null,
        mime: typeof row.mime === "string" ? row.mime : null,
        sizeBytes: typeof row.size_bytes === "number" ? row.size_bytes : null,
      },
    ];
  });
}

async function loadArchiveFileRows(sendId: string) {
  const load = (columns: string) =>
    (
      supabaseAdmin as unknown as {
        from: (name: string) => {
          select: (cols: string) => {
            eq: (
              column: string,
              value: string,
            ) => Promise<{ data: Array<Record<string, unknown>> | null; error: DbError }>;
          };
        };
      }
    )
      .from("client_agent_send_files")
      .select(columns)
      .eq("send_id", sendId);
  let found = await load("item_key, storage_path, mime, size_bytes, display_name");
  if (found.error && missingRelation(found.error, "display_name")) {
    found = await load("item_key, storage_path, mime, size_bytes");
  }
  if (found.error) return [];
  return (found.data ?? []).flatMap((row) => {
    const itemKey = typeof row.item_key === "string" ? row.item_key : "";
    const storagePath = typeof row.storage_path === "string" ? row.storage_path : "";
    if (!itemKey || !storagePath) return [];
    const displayName = sanitizeClientFileName(
      typeof row.display_name === "string" ? row.display_name : "",
    );
    return [
      {
        itemKey,
        storagePath,
        mime: typeof row.mime === "string" ? row.mime : null,
        sizeBytes: typeof row.size_bytes === "number" ? row.size_bytes : null,
        displayName: displayName || null,
      },
    ];
  });
}

/**
 * Copies every file of one send that has no archive copy yet. Idempotent:
 * the duplicate key is the send, the item, and the source path — the same
 * key Finish uses. A failed copy is counted and left for the next pass.
 */
export async function copyMissingSendArtifacts(input: {
  clientId: string;
  sendId: string;
}): Promise<{ copied: number; failed: number }> {
  const artifactRows = await loadArtifactMetaRows(input.clientId);
  if (!artifactRows) return { copied: 0, failed: 0 };
  const files = sendArchiveCandidates({
    sendId: input.sendId,
    items: await loadArchiveItemRows(input.sendId),
    fileRows: await loadArchiveFileRows(input.sendId),
  });
  const pending = archiveCopiesStillNeeded({ sendId: input.sendId, files, artifactRows });
  let copied = 0;
  let failed = 0;
  for (const file of pending) {
    const ok = await copySendFileToArchive({
      clientId: input.clientId,
      sendId: input.sendId,
      file,
    });
    if (ok) copied += 1;
    else failed += 1;
  }
  return { copied, failed };
}

/** One file straight after its upload was confirmed. Skips a path already copied. */
export async function copySendFileIfMissing(input: {
  clientId: string;
  sendId: string;
  file: FinalFile;
}): Promise<boolean> {
  const artifactRows = await loadArtifactMetaRows(input.clientId);
  if (!artifactRows) return false;
  const pending = archiveCopiesStillNeeded({
    sendId: input.sendId,
    files: [input.file],
    artifactRows,
  });
  if (pending.length === 0) return true;
  return copySendFileToArchive({
    clientId: input.clientId,
    sendId: input.sendId,
    file: input.file,
  });
}

/**
 * Deletes the archive copies of send paths the client removed before
 * Finish, so a replaced upload does not leave a stale file on the firm's
 * side. Callers must not use this on a completed send.
 */
export async function removeSendArchiveCopies(input: {
  clientId: string;
  sendId: string;
  sourcePaths: readonly string[];
}): Promise<void> {
  if (input.sourcePaths.length === 0) return;
  const { data, error } = await (
    supabaseAdmin as unknown as {
      from: (name: string) => {
        select: (cols: string) => {
          eq: (
            column: string,
            value: string,
          ) => Promise<{
            data: Array<{ id: unknown; storage_path: unknown; meta: unknown }> | null;
            error: DbError;
          }>;
        };
      };
    }
  )
    .from("client_artifacts")
    .select("id, storage_path, meta")
    .eq("client_id", input.clientId);
  if (error || !data) return;
  const copies = archiveCopiesOfPaths(data, input.sendId, input.sourcePaths);
  if (copies.length === 0) return;
  const paths = copies.flatMap((copy) => (copy.storagePath ? [copy.storagePath] : []));
  if (paths.length > 0) await archiveStorage(CLIENT_DOCUMENTS_BUCKET).remove(paths);
  for (const copy of copies) {
    await (
      supabaseAdmin as unknown as {
        from: (name: string) => {
          delete: () => {
            eq: (column: string, value: string) => Promise<{ error: DbError }>;
          };
        };
      }
    )
      .from("client_artifacts")
      .delete()
      .eq("id", copy.id);
  }
}
