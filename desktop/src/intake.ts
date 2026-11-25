/**
 * Same upload as src/lib/source-documents-browser.ts uploadSourceDocument:
 * private bucket `source-docs`, path `{client_id}/{object_name}`, then
 * `register_source_document` with channel `upload`. Nothing is posted.
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  mimeForFileName,
  sanitizeSourceObjectName,
  sizeError,
  sourceObjectPath,
  suffixSourceObjectName,
} from "./paths";
import { REGISTER_SOURCE_DOCUMENT, SOURCE_DOCS_BUCKET } from "./public-config";

export type UploadResult =
  | { ok: true; duplicate: boolean; documentId: string }
  | { ok: false; message: string };

type RegisterRow = {
  ok?: boolean;
  duplicate?: boolean;
  document_id?: string;
  error?: string;
};

function messageOf(error: string): string {
  const code = error.toLowerCase();
  if (code.includes("mime_not_allowed") || code.includes("mime type") || code.includes("invalid mime")) {
    return "Use a PDF or a photo (JPEG, PNG, WebP, or HEIC).";
  }
  if (code.includes("size_not_allowed")) return "This file is over 20 MB.";
  if (code.includes("upload_forbidden")) return "You can't upload documents for this client.";
  if (code.includes("storage_path_invalid")) {
    return "Rename the file using letters, numbers, dots, or dashes.";
  }
  if (code.includes("sha256_invalid")) return "The file could not be checked. Try again.";
  if (code.includes("unauthorised") || code.includes("unauthorized")) return "Sign in to upload a document.";
  return "The file could not be saved. Try again.";
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function intakeHasSha(
  supabase: SupabaseClient,
  clientId: string,
  sha: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("source_documents")
    .select("id")
    .eq("client_id", clientId)
    .eq("sha256", sha)
    .neq("status", "rejected_intake")
    .limit(1);
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

async function existingPath(supabase: SupabaseClient, documentId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("source_documents")
    .select("storage_path")
    .eq("id", documentId)
    .limit(1);
  if (error || !Array.isArray(data) || !data[0] || typeof data[0] !== "object") return null;
  const path = (data[0] as { storage_path?: unknown }).storage_path;
  return typeof path === "string" ? path : null;
}

export async function uploadToIntake(
  supabase: SupabaseClient,
  input: { clientId: string; fileName: string; bytes: Uint8Array },
): Promise<UploadResult> {
  const mime = mimeForFileName(input.fileName);
  if (!mime) return { ok: false, message: "Use a PDF or a photo (JPEG, PNG, WebP, or HEIC)." };
  const tooBig = sizeError(input.bytes.byteLength);
  if (tooBig) return { ok: false, message: tooBig };

  const sha = sha256Hex(input.bytes);
  const safeName = sanitizeSourceObjectName(input.fileName);
  const body = Buffer.from(input.bytes);
  let uploadedPath = "";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const objectName = attempt === 0 ? safeName : suffixSourceObjectName(safeName, attempt + 1);
    let path = "";
    try {
      path = sourceObjectPath(input.clientId, objectName);
    } catch {
      return { ok: false, message: "Rename the file using letters, numbers, dots, or dashes." };
    }
    const stored = await supabase.storage.from(SOURCE_DOCS_BUCKET).upload(path, body, {
      contentType: mime,
      upsert: false,
    });
    if (!stored.error) {
      uploadedPath = path;
      break;
    }
    const conflict = /exist|duplicate|409/i.test(stored.error.message);
    if (!conflict || attempt === 3) return { ok: false, message: messageOf(stored.error.message) };
  }

  const clientId = input.clientId.trim().toLowerCase();
  const registered = await supabase.rpc(REGISTER_SOURCE_DOCUMENT, {
    p_client_id: clientId,
    p_storage_path: uploadedPath,
    p_sha256: sha,
    p_mime: mime,
    p_size_bytes: input.bytes.byteLength,
    p_channel: "upload",
  });
  if (registered.error) {
    await supabase.storage.from(SOURCE_DOCS_BUCKET).remove([uploadedPath]);
    return { ok: false, message: messageOf(registered.error.message) };
  }
  const result = (registered.data ?? {}) as RegisterRow;
  if (result.ok !== true || typeof result.document_id !== "string") {
    await supabase.storage.from(SOURCE_DOCS_BUCKET).remove([uploadedPath]);
    return { ok: false, message: messageOf(result.error ?? "failed") };
  }
  if (result.duplicate === true) {
    const existing = await existingPath(supabase, result.document_id);
    if (existing && existing !== uploadedPath) {
      await supabase.storage.from(SOURCE_DOCS_BUCKET).remove([uploadedPath]);
    }
    return { ok: true, duplicate: true, documentId: result.document_id };
  }
  return { ok: true, duplicate: false, documentId: result.document_id };
}
