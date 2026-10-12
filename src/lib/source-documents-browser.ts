/**
 * Browser calls for source documents. Upload, list, extract, decide.
 * Nothing here posts to Xero, QuickBooks, or Sage.
 */
import { supabase } from "@/integrations/supabase/client";
import { refusesSignOffWording } from "@/lib/agent-draft-decision";
import { SOURCE_DOCS_BUCKET, sourceDocumentHooks } from "@/lib/source-document-hooks";
import {
  extractSourceDocumentBody,
  ledgerDecisionMessage,
  sanitizeSourceObjectName,
  sha256HexOfBytes,
  sourceDocumentMime,
  sourceDocumentSizeError,
  sourceObjectPath,
  suffixSourceObjectName,
  type LedgerChoice,
  type PostingModeChoice,
  type SourceDocumentRow,
  type SourceExtractionRow,
  type SourceProposalRow,
  type SupplierTrustRow,
} from "@/lib/source-documents-ui";

export type UploadChannel = "upload" | "camera";

export type UploadOutcome =
  | { ok: true; duplicate: true; documentId: string }
  | { ok: true; duplicate: false; documentId: string; retentionUntil: string | null }
  | { ok: false; message: string };

export type DecideOutcome =
  | { ok: true; status: string; approvedBy: string | null; approvedAt: string | null }
  | { ok: false; message: string };

export type ExtractOutcome =
  | { ok: true; duplicate: boolean; proposalId: string | null; skipped: string | null }
  | { ok: false; message: string };

export type SourceDocumentBundle = {
  documents: SourceDocumentRow[];
  extractions: SourceExtractionRow[];
  proposals: SourceProposalRow[];
  trust: SupplierTrustRow[];
  names: Record<string, string>;
  connectedLedgers: LedgerChoice[];
  viewerName: string | null;
  viewerUserId: string | null;
};

type Result<T> = { data: T; error: { message: string } | null };

type Query = PromiseLike<Result<unknown>> & {
  select: (columns: string) => Query;
  eq: (column: string, value: string) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
};

type LooseDb = {
  from: (table: string) => { select: (columns: string) => Query };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<Result<unknown>>;
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Blob,
        options: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message: string } | null }>;
      remove: (paths: string[]) => Promise<{ error: { message: string } | null }>;
    };
  };
};

function loose(): LooseDb {
  return supabase as unknown as LooseDb;
}

function rows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function messageOf(error: string): string {
  const code = error.toLowerCase();
  if (code.includes("mime_not_allowed")) return "Use a PDF or a photo (JPEG, PNG, WebP, or HEIC).";
  if (code.includes("size_not_allowed")) return "This file is over 20 MB.";
  if (code.includes("upload_forbidden")) return "You can't upload documents for this client.";
  if (code.includes("storage_path_invalid"))
    return "Rename the file using letters, numbers, dots, or dashes.";
  if (code.includes("sha256_invalid")) return "The file could not be checked. Try again.";
  if (code.includes("unauthorised") || code.includes("unauthorized"))
    return "Sign in to upload a document.";
  return "The file could not be saved. Try again.";
}

function extractMessage(error: string): string {
  const code = error.toLowerCase();
  if (code.includes("rate_limited"))
    return "You've reached the hourly limit for reading documents. Try again later.";
  if (code.includes("unsupported_mime"))
    return "This file type can't be read. Use a PDF or a photo.";
  if (code.includes("forbidden") || code.includes("unauthorised"))
    return "You can't read documents for this client.";
  return "This file could not be read. Try again.";
}

async function sessionToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function viewerIdentity(): Promise<{ userId: string | null; name: string | null }> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return { userId: null, name: null };
  const meta = user.user_metadata as { full_name?: unknown; name?: unknown } | undefined;
  const metaName =
    typeof meta?.full_name === "string"
      ? meta.full_name
      : typeof meta?.name === "string"
        ? meta.name
        : "";
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  const profileName = profile?.full_name?.trim() ?? "";
  return { userId: user.id, name: profileName || metaName.trim() || null };
}

export async function listSourceDocuments(clientId: string): Promise<SourceDocumentBundle> {
  const db = loose();
  const column = sourceDocumentHooks.proposalsList.filterColumn;
  const [documents, extractions, proposals, trust, names, ledgers, viewer] = await Promise.all([
    db
      .from(sourceDocumentHooks.proposalsList.documentsTable)
      .select("id, storage_path, status, received_at, mime")
      .eq(column, clientId)
      .order("received_at", { ascending: false }),
    db
      .from(sourceDocumentHooks.proposalsList.extractionsTable)
      .select("document_id, doc_type, flags, created_at")
      .eq(column, clientId)
      .order("created_at", { ascending: false }),
    db
      .from(sourceDocumentHooks.proposalsList.proposalsTable)
      .select(
        "id, document_id, target_ledger, doc_type, mode, draft_holding, status, supplier_key, supplier_display_name, document_number, amount, issued_on, approved_by, approved_at, approver_role, rejection_note, payload, flags, created_at",
      )
      .eq(column, clientId)
      .order("created_at", { ascending: false }),
    db
      .from(sourceDocumentHooks.proposalsList.trustTable)
      .select("supplier_key, clean_approved_drafts")
      .eq(column, clientId),
    collaboratorNames(clientId),
    connectedLedgers(clientId),
    viewerIdentity(),
  ]);
  const failed = [documents.error, extractions.error, proposals.error, trust.error].find(Boolean);
  if (failed) throw new Error(failed.message);
  return {
    documents: rows<SourceDocumentRow>(documents.data),
    extractions: rows<SourceExtractionRow>(extractions.data),
    proposals: rows<SourceProposalRow>(proposals.data),
    trust: rows<SupplierTrustRow>(trust.data),
    names: names,
    connectedLedgers: ledgers,
    viewerName: viewer.name,
    viewerUserId: viewer.userId,
  };
}

async function collaboratorNames(clientId: string): Promise<Record<string, string>> {
  const { data, error } = await loose().rpc("list_note_collaborators", { p_client_id: clientId });
  if (error || !Array.isArray(data)) return {};
  const names: Record<string, string> = {};
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const record = row as { user_id?: unknown; full_name?: unknown; email?: unknown };
    const id = typeof record.user_id === "string" ? record.user_id : "";
    const full = typeof record.full_name === "string" ? record.full_name.trim() : "";
    const email =
      typeof record.email === "string" ? (record.email.split("@")[0]?.trim() ?? "") : "";
    if (id && (full || email)) names[id] = full || email;
  }
  return names;
}

async function connectedLedgers(clientId: string): Promise<LedgerChoice[]> {
  const [xero, qbo, sage] = await Promise.all([
    supabase.from("xero_connections").select("id").eq("client_id", clientId).limit(1),
    supabase.from("qbo_connections").select("id").eq("client_id", clientId).limit(1),
    supabase.from("sage_connections").select("id").eq("client_id", clientId).limit(1),
  ]);
  const ledgers: LedgerChoice[] = [];
  if (!xero.error && (xero.data?.length ?? 0) > 0) ledgers.push("xero");
  if (!qbo.error && (qbo.data?.length ?? 0) > 0) ledgers.push("qbo");
  if (!sage.error && (sage.data?.length ?? 0) > 0) ledgers.push("sage");
  return ledgers;
}

export type SourceUploadApi = {
  upload: (path: string, file: Blob, mime: string) => Promise<{ error: string | null }>;
  remove: (path: string) => Promise<void>;
  register: (args: {
    p_client_id: string;
    p_storage_path: string;
    p_sha256: string;
    p_mime: string;
    p_size_bytes: number;
    p_channel: UploadChannel;
  }) => Promise<{ data: unknown; error: string | null }>;
  existingPath: (documentId: string) => Promise<string | null>;
};

const liveUploadApi: SourceUploadApi = {
  upload: async (path, file, mime) => {
    const { error } = await loose().storage.from(SOURCE_DOCS_BUCKET).upload(path, file, {
      contentType: mime,
      upsert: false,
    });
    return { error: error?.message ?? null };
  },
  remove: async (path) => {
    await loose().storage.from(SOURCE_DOCS_BUCKET).remove([path]);
  },
  register: async (args) => {
    const { data, error } = await loose().rpc(sourceDocumentHooks.upload.registerRpc, args);
    return { data, error: error?.message ?? null };
  },
  existingPath: async (documentId) => {
    const { data, error } = await loose()
      .from(sourceDocumentHooks.proposalsList.documentsTable)
      .select("storage_path")
      .eq("id", documentId)
      .limit(1);
    if (error || !Array.isArray(data) || !data[0] || typeof data[0] !== "object") return null;
    const path = (data[0] as { storage_path?: unknown }).storage_path;
    return typeof path === "string" ? path : null;
  },
};

function registerRecord(data: unknown): {
  ok: boolean;
  duplicate: boolean;
  documentId: string | null;
  retentionUntil: string | null;
  error: string | null;
} {
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return {
    ok: row.ok === true,
    duplicate: row.duplicate === true,
    documentId: typeof row.document_id === "string" ? row.document_id : null,
    retentionUntil: typeof row.retention_until === "string" ? row.retention_until : null,
    error: typeof row.error === "string" ? row.error : null,
  };
}

export async function uploadSourceDocument(
  input: { clientId: string; file: File; channel: UploadChannel },
  api: SourceUploadApi = liveUploadApi,
): Promise<UploadOutcome> {
  const mime = sourceDocumentMime(input.file);
  if (!mime) return { ok: false, message: "Use a PDF or a photo (JPEG, PNG, WebP, or HEIC)." };
  const sizeError = sourceDocumentSizeError(input.file.size);
  if (sizeError) return { ok: false, message: sizeError };

  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const sha = await sha256HexOfBytes(bytes);
  const name = sanitizeSourceObjectName(input.file.name);
  let uploadedPath = "";

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const objectName = attempt === 0 ? name : suffixSourceObjectName(name, attempt + 1);
    const path = sourceObjectPath(input.clientId, objectName);
    const stored = await api.upload(path, input.file, mime);
    if (!stored.error) {
      uploadedPath = path;
      break;
    }
    const conflict = /exist|duplicate|409/i.test(stored.error);
    if (!conflict || attempt === 3)
      return { ok: false, message: "The file could not be saved. Try again." };
  }

  const registered = await api.register({
    p_client_id: input.clientId.trim().toLowerCase(),
    p_storage_path: uploadedPath,
    p_sha256: sha,
    p_mime: mime,
    p_size_bytes: input.file.size,
    p_channel: input.channel,
  });
  if (registered.error) {
    await api.remove(uploadedPath);
    return { ok: false, message: messageOf(registered.error) };
  }
  const result = registerRecord(registered.data);
  if (!result.ok || !result.documentId) {
    await api.remove(uploadedPath);
    return { ok: false, message: messageOf(result.error ?? "failed") };
  }
  if (result.duplicate) {
    const existing = await api.existingPath(result.documentId);
    if (existing && existing !== uploadedPath) await api.remove(uploadedPath);
    return { ok: true, duplicate: true, documentId: result.documentId };
  }
  return {
    ok: true,
    duplicate: false,
    documentId: result.documentId,
    retentionUntil: result.retentionUntil,
  };
}

export async function extractSourceDocument(input: {
  documentId: string;
  targetLedger: LedgerChoice;
  requestedMode: PostingModeChoice;
}): Promise<ExtractOutcome> {
  const token = await sessionToken();
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!token || !base) return { ok: false, message: "Sign in to read this document." };
  let response: Response;
  try {
    response = await fetch(`${base}/functions/v1/${sourceDocumentHooks.extract.functionName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(extractSourceDocumentBody(input)),
    });
  } catch {
    return { ok: false, message: "This file could not be read. Try again." };
  }
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const error = typeof body?.error === "string" ? body.error : "";
  if (!response.ok || body?.ok === false)
    return { ok: false, message: extractMessage(error || `status ${response.status}`) };
  return {
    ok: true,
    duplicate: body?.duplicate === true,
    proposalId: typeof body?.proposal_id === "string" ? body.proposal_id : null,
    skipped: typeof body?.skipped === "string" ? body.skipped : null,
  };
}

export async function decideSourceProposal(input: {
  proposalId: string;
  decision: "approve" | "reject";
  note?: string | null;
}): Promise<DecideOutcome> {
  if (input.note && refusesSignOffWording(input.note)) {
    return { ok: false, message: ledgerDecisionMessage("signed_off_refused") };
  }
  const { data, error } = await loose().rpc(sourceDocumentHooks.decide.rpc, {
    p_proposal_id: input.proposalId,
    p_decision: input.decision,
    p_note: input.note?.trim() ? input.note.trim() : null,
  });
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const bodyError = typeof row.error === "string" ? row.error : "";
  const role = typeof row.approver_role === "string" ? row.approver_role : null;
  if (error || row.ok === false) {
    return {
      ok: false,
      message: ledgerDecisionMessage(bodyError || error?.message || "failed", role),
    };
  }
  return {
    ok: true,
    status:
      typeof row.status === "string"
        ? row.status
        : input.decision === "approve"
          ? "approved"
          : "rejected",
    approvedBy: typeof row.approved_by === "string" ? row.approved_by : null,
    approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
  };
}
