/**
 * Browser side of staged uploads: put a PDF in the private statement-uploads
 * bucket and hand the server the object path instead of a base64 body.
 *
 * Staging is tried first for every PDF so the path is exercised on every
 * upload. If the bucket is missing (migration not applied yet) or Storage is
 * unreachable, small files fall back to inline base64 — which is exactly what
 * the server functions accepted before — and large files get a precise error.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  STAGED_UPLOAD_BUCKET,
  describeStagingFailure,
  inlineAllowed,
  stagedObjectPath,
} from "@/lib/staged-upload";

export type PdfTransport =
  | { storagePath: string; base64?: undefined }
  | { base64: string; storagePath?: undefined };

type StagingDeps = {
  userId: () => Promise<string | null>;
  upload: (path: string, file: File) => Promise<{ error: { message: string } | null }>;
  remove: (paths: string[]) => Promise<unknown>;
  newId: () => string;
};

const liveDeps: StagingDeps = {
  userId: async () => (await supabase.auth.getSession()).data.session?.user.id ?? null,
  upload: (path, file) =>
    supabase.storage
      .from(STAGED_UPLOAD_BUCKET)
      .upload(path, file, { contentType: "application/pdf", upsert: false }),
  remove: (paths) => supabase.storage.from(STAGED_UPLOAD_BUCKET).remove(paths),
  newId: () => crypto.randomUUID(),
};

/** Only ever used for files ≤ INLINE_MAX_BYTES, so a chunked string build is fine. */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function stagePdf(
  file: File,
  deps: StagingDeps = liveDeps,
): Promise<{ storagePath: string }> {
  const userId = await deps.userId();
  if (!userId) throw new Error("Sign in to upload a statement.");
  const storagePath = stagedObjectPath(userId, deps.newId());
  const { error } = await deps.upload(storagePath, file);
  if (error) throw new Error(error.message);
  return { storagePath };
}

/**
 * How this PDF should reach the server: a staged object path, or — only when
 * staging failed and the file is small enough — inline base64.
 */
export async function pdfTransport(
  file: File,
  deps: StagingDeps = liveDeps,
): Promise<PdfTransport> {
  try {
    return await stagePdf(file, deps);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (!inlineAllowed(file.size))
      throw new Error(describeStagingFailure(file.name, file.size, reason));
    console.warn(`[staged-upload] falling back to inline base64 for ${file.name}: ${reason}`);
    return { base64: await fileToBase64(file) };
  }
}

/**
 * Best-effort cleanup for objects the server never got to (network failure
 * before the handler ran). Removing an already-deleted object is a no-op.
 */
export async function unstage(
  paths: Array<string | undefined>,
  deps: StagingDeps = liveDeps,
): Promise<void> {
  const live = paths.filter((p): p is string => Boolean(p));
  if (!live.length) return;
  try {
    await deps.remove(live);
  } catch {
    /* nothing to do — the server deletes on read anyway */
  }
}

export function transportPaths(items: Array<{ storagePath?: string }>): string[] {
  return items.map((i) => i.storagePath).filter((p): p is string => Boolean(p));
}
