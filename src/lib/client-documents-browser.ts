/**
 * Browser side of client documents: archive an owner's uploaded files into the
 * `client-documents` bucket with the visibility they chose, and list / relabel
 * / download them later. Every call runs as the signed-in user, so Storage and
 * table RLS decide what is allowed — this module never widens access.
 *
 * Archive order matters and is enforced by RLS: the client_artifacts row (with
 * the visibility) is written first, then the object. An object can therefore
 * never exist without a visibility attached.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  CLIENT_DOCUMENTS_BUCKET,
  clientDocumentPath,
  documentContentType,
  documentExtension,
  type ClientDocumentMeta,
  type UploadSource,
  type UploadVisibility,
} from "@/lib/client-documents";
import { STAGED_UPLOAD_BUCKET } from "@/lib/staged-upload";

export type ArchiveItem = {
  file: File;
  /** Where the PDF already sits in statement-uploads; copied server-side instead of re-uploaded. */
  storagePath?: string;
  accountLabel?: string;
};

export type ArchiveInput = {
  clientId: string;
  visibility: UploadVisibility;
  source: UploadSource;
  items: ArchiveItem[];
};

export type ArchiveResult = {
  archived: Array<{ id: string; fileName: string; storagePath: string }>;
  failed: Array<{ fileName: string; reason: string }>;
};

type ArtifactInsert = {
  id: string;
  client_id: string;
  kind: "upload";
  storage_path: string;
  visibility: UploadVisibility;
  meta: ClientDocumentMeta;
  created_by: string;
};

type Err = { message: string } | null;

export type ArchiveDeps = {
  userId: () => Promise<string | null>;
  insertArtifact: (row: ArtifactInsert) => Promise<{ error: Err }>;
  deleteArtifact: (id: string) => Promise<unknown>;
  copyStaged: (fromPath: string, toPath: string) => Promise<{ error: Err }>;
  uploadFile: (path: string, file: File, contentType: string) => Promise<{ error: Err }>;
  newId: () => string;
};

const liveDeps: ArchiveDeps = {
  userId: async () => (await supabase.auth.getSession()).data.session?.user.id ?? null,
  insertArtifact: async (row) => {
    const { error } = await supabase
      .from("client_artifacts")
      .insert({ ...row, meta: row.meta as unknown as Json });
    return { error };
  },
  deleteArtifact: async (id) => {
    await supabase.from("client_artifacts").delete().eq("id", id);
  },
  copyStaged: async (fromPath, toPath) => {
    const { error } = await supabase.storage
      .from(STAGED_UPLOAD_BUCKET)
      .copy(fromPath, toPath, { destinationBucket: CLIENT_DOCUMENTS_BUCKET });
    return { error };
  },
  uploadFile: (path, file, contentType) =>
    supabase.storage
      .from(CLIENT_DOCUMENTS_BUCKET)
      .upload(path, file, { contentType, upsert: false }),
  newId: () => crypto.randomUUID(),
};

/**
 * Archive each file with the chosen visibility. Failures are per file and
 * never throw — the figures the user is about to confirm must not be blocked
 * by the archive. Callers surface `failed` as a warning.
 */
export async function archiveUploads(
  input: ArchiveInput,
  deps: ArchiveDeps = liveDeps,
): Promise<ArchiveResult> {
  const result: ArchiveResult = { archived: [], failed: [] };
  if (!input.items.length) return result;
  const userId = await deps.userId();
  if (!userId) {
    for (const it of input.items)
      result.failed.push({ fileName: it.file.name, reason: "Not signed in." });
    return result;
  }

  for (const item of input.items) {
    const id = deps.newId();
    const ext = item.storagePath ? "pdf" : documentExtension(item.file);
    const path = clientDocumentPath(input.clientId, id, ext);
    const row: ArtifactInsert = {
      id,
      client_id: input.clientId,
      kind: "upload",
      storage_path: path,
      visibility: input.visibility,
      meta: {
        file_name: item.file.name,
        bytes: item.file.size,
        mime: item.storagePath ? "application/pdf" : documentContentType(item.file),
        source: input.source,
        ...(item.accountLabel?.trim() ? { account_label: item.accountLabel.trim() } : {}),
      },
      created_by: userId,
    };

    const { error: rowErr } = await deps.insertArtifact(row);
    if (rowErr) {
      result.failed.push({ fileName: item.file.name, reason: rowErr.message });
      continue;
    }

    const { error: objErr } = item.storagePath
      ? await deps.copyStaged(item.storagePath, path)
      : await deps.uploadFile(path, item.file, row.meta.mime);
    if (objErr) {
      await Promise.resolve(deps.deleteArtifact(id)).catch(() => undefined);
      result.failed.push({ fileName: item.file.name, reason: objErr.message });
      continue;
    }
    result.archived.push({ id, fileName: item.file.name, storagePath: path });
  }
  return result;
}

/** One line for a toast when some files did not make it into the archive. */
export function describeArchiveFailures(result: ArchiveResult): string | null {
  if (!result.failed.length) return null;
  const names = result.failed.map((f) => `"${f.fileName}"`).join(", ");
  return `${names} could not be saved to your documents (${result.failed[0].reason}). Your figures were still applied.`;
}

export type ClientDocumentRow = {
  id: string;
  client_id: string;
  storage_path: string | null;
  visibility: UploadVisibility;
  meta: Json;
  created_by: string | null;
  created_at: string;
};

/** Uploads for a client — RLS returns only what the caller may see. */
export async function listClientDocuments(clientId: string): Promise<ClientDocumentRow[]> {
  const { data, error } = await supabase
    .from("client_artifacts")
    .select("id, client_id, storage_path, visibility, meta, created_by, created_at")
    .eq("client_id", clientId)
    .eq("kind", "upload")
    .not("storage_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as ClientDocumentRow[];
}

export async function setClientDocumentVisibility(
  id: string,
  visibility: UploadVisibility,
): Promise<void> {
  const { error } = await supabase.from("client_artifacts").update({ visibility }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Short-lived download link; Storage RLS rejects paths the caller may not read. */
export async function clientDocumentDownloadUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(CLIENT_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, 60, { download: true });
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "Could not open the file.");
  return data.signedUrl;
}

export async function deleteClientDocument(row: Pick<ClientDocumentRow, "id" | "storage_path">) {
  if (row.storage_path) {
    const { error } = await supabase.storage
      .from(CLIENT_DOCUMENTS_BUCKET)
      .remove([row.storage_path]);
    if (error) throw new Error(error.message);
  }
  const { error } = await supabase.from("client_artifacts").delete().eq("id", row.id);
  if (error) throw new Error(error.message);
}
