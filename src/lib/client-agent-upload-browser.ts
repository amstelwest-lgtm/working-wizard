/**
 * Browser upload for a server-issued signed URL.
 * The file bytes stay out of the server-function body.
 */
import { StorageClient } from "@supabase/storage-js";
import { SEND_STORAGE_BUCKET } from "@/lib/client-agent-link";

export async function uploadToClientAgentSignedUrl(input: {
  path: string;
  token: string;
  file: File;
}): Promise<boolean> {
  const url = (import.meta.env.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(
    /\/$/,
    "",
  );
  const key =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  if (!url || !key) return false;
  const client = new StorageClient(`${url}/storage/v1`, {
    apikey: key,
    Authorization: `Bearer ${key}`,
  });
  const uploaded = await client.from(SEND_STORAGE_BUCKET).uploadToSignedUrl(input.path, input.token, input.file, {
    contentType: input.file.type || "application/octet-stream",
    upsert: false,
  });
  return !uploaded.error;
}
