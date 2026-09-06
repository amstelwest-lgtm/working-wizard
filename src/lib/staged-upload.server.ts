/**
 * Server side of staged uploads: read a PDF the browser put in the
 * statement-uploads bucket, as the calling user (their JWT, their RLS), and
 * delete it whether or not the read succeeded. Server-only; never imported by
 * the browser bundle.
 */

import { STAGED_UPLOAD_BUCKET, assertOwnStagedPath } from "@/lib/staged-upload";

// Structural so tests can inject a fake; supabase-js returns thenable builders,
// not Promises, hence PromiseLike.
export type StagedStorage = {
  from(bucket: string): {
    download(path: string): PromiseLike<{ data: Blob | null; error: { message: string } | null }>;
    remove(paths: string[]): PromiseLike<unknown>;
  };
};

export type StagedPdf = { base64: string; bytes: number };

export type ReadStagedOptions = {
  /**
   * Leave the object in place after reading. Used when two server functions
   * read the same staged pack concurrently (the bank drafter's P&L + cash
   * calls); the browser removes it once both have settled.
   */
  retain?: boolean;
};

export async function readStagedPdf(
  storage: StagedStorage,
  userId: string,
  storagePath: string,
  opts: ReadStagedOptions = {},
): Promise<StagedPdf> {
  assertOwnStagedPath(userId, storagePath);
  const bucket = storage.from(STAGED_UPLOAD_BUCKET);
  try {
    const { data, error } = await bucket.download(storagePath);
    if (error || !data) {
      throw new Error(
        `Could not read the uploaded file (${error?.message ?? "not found"}). Please upload it again.`,
      );
    }
    const buf = Buffer.from(await data.arrayBuffer());
    return { base64: buf.toString("base64"), bytes: buf.byteLength };
  } finally {
    if (!opts.retain) await Promise.resolve(bucket.remove([storagePath])).catch(() => undefined);
  }
}

/**
 * Resolve a file that arrived either inline or staged to base64. Exactly one
 * of the two is expected; the zod schemas enforce that before we get here.
 */
export async function resolvePdfBase64(
  storage: StagedStorage,
  userId: string,
  file: { base64?: string; storagePath?: string },
  opts: ReadStagedOptions = {},
): Promise<string> {
  if (file.storagePath) {
    return (await readStagedPdf(storage, userId, file.storagePath, opts)).base64;
  }
  if (file.base64) return file.base64;
  throw new Error("No file content was received. Please upload the file again.");
}
