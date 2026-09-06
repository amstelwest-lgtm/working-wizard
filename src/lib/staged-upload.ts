/**
 * Staged uploads — shared, dependency-free pieces.
 *
 * Large PDFs never travel through the app server as request bodies (Vercel
 * caps those at 4.5 MB). The browser stages the file in a private Storage
 * bucket and hands the server an object path; the server reads it back under
 * the caller's RLS and deletes it. See staged-upload.client.ts and
 * staged-upload.server.ts for the two ends.
 */

export const STAGED_UPLOAD_BUCKET = "statement-uploads";

/**
 * Largest file that may still be sent inline as base64. 3 MB becomes ~4 MB of
 * base64 plus JSON framing — under the 4.5 MB cap. Anything larger has to be
 * staged; there is no other way for it to reach the server on Vercel.
 */
export const INLINE_MAX_BYTES = 3 * 1024 * 1024;

/** Server-side cap on an inline base64 field: INLINE_MAX_BYTES after encoding, with headroom. */
export const INLINE_BASE64_MAX = 4_300_000;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const STAGED_PATH_RE = new RegExp(`^${UUID}/${UUID}\\.pdf$`, "i");

export function inlineAllowed(bytes: number): boolean {
  return bytes <= INLINE_MAX_BYTES;
}

/** `{userId}/{uuid}.pdf` — the folder is what the Storage policies check. */
export function stagedObjectPath(userId: string, objectId: string): string {
  return `${userId}/${objectId}.pdf`;
}

/**
 * A staged path is only valid if it is well-formed and sits in the caller's
 * own folder. Storage RLS enforces the same thing; this rejects bad input
 * before a network call and gives a readable error.
 */
export function assertOwnStagedPath(userId: string, path: string): void {
  if (!STAGED_PATH_RE.test(path) || !path.toLowerCase().startsWith(`${userId.toLowerCase()}/`)) {
    throw new Error("That uploaded file could not be found. Please upload it again.");
  }
}

export function describeStagingFailure(fileName: string, bytes: number, reason: string): string {
  const mb = (bytes / 1024 / 1024).toFixed(1);
  return (
    `"${fileName}" is ${mb} MB and could not be staged for upload (${reason}). ` +
    `Files over ${INLINE_MAX_BYTES / 1024 / 1024} MB need the ${STAGED_UPLOAD_BUCKET} storage bucket — ` +
    `apply the latest database migration, or upload a smaller file.`
  );
}
