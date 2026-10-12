/**
 * Extract a source document and write a ledger proposal.
 *
 * POST { document_id, target_ledger, requested_mode? }
 * Caller JWT, or the service role. verify_jwt is true.
 * The model only proposes. This function never approves and never posts.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { claudeRequestFields } from "../../../src/lib/claude-request.ts";
import {
  assessSourceDocument,
  documentNumberKey,
  extractionMimeSupported,
  normaliseMime,
  parseModelDocument,
  sealPayload,
  sha256HexBytes,
  sonnet55CostUsd,
  supplierKey,
  type DedupeCandidate,
  type LedgerTarget,
  type PostingMode,
  type SupplierOnFile,
} from "../../../src/lib/source-document-ledger.ts";
import { CLAUDE_MODEL } from "../_shared/claude-model.ts";
import { SOURCE_DOC_PROMPT_VERSION, SOURCE_DOC_SYSTEM, sourceDocumentUserParts } from "./prompt.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function bearerRole(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const pad = (value: string) => value + "=".repeat((4 - (value.length % 4)) % 4);
    const payload = JSON.parse(atob(pad(parts[1].replace(/-/g, "+").replace(/_/g, "/"))));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

type SourceDocumentRow = {
  id: string;
  client_id: string;
  storage_path: string;
  sha256: string;
  mime: string;
  size_bytes: number;
  status: string;
};

type AdminClient = {
  // Supabase-js without generated tables types this client as `never`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "unauthorised" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ ok: false, error: "not_configured" }, 500);

  const serviceRole = bearerRole(authHeader) === "service_role";
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let userId: string | null = null;
  if (!serviceRole) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) return json({ ok: false, error: "unauthorised" }, 401);
    userId = user.id;
    const { data: allowed, error: limitError } = await userClient.rpc("extraction_record_request", {
      p_kind: "source-document",
      p_files: 1,
      p_bytes: 0,
      p_limit: 20,
    });
    if (limitError && limitError.code !== "42883") {
      console.warn(`extraction rate limit not enforced: ${limitError.message}`);
    } else if (limitError == null && allowed !== true) {
      return json({ ok: false, error: "rate_limited" }, 429);
    }
  }

  let body: { document_id?: unknown; target_ledger?: unknown; requested_mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  const documentId = typeof body.document_id === "string" ? body.document_id : "";
  const ledger = body.target_ledger;
  const requestedMode = body.requested_mode == null || body.requested_mode === "draft" ? "draft" : body.requested_mode;
  if (!UUID.test(documentId)) return json({ ok: false, error: "document_id_required" }, 400);
  if (ledger !== "xero" && ledger !== "qbo" && ledger !== "sage") {
    return json({ ok: false, error: "target_ledger_invalid" }, 400);
  }
  if (requestedMode !== "draft" && requestedMode !== "final") {
    return json({ ok: false, error: "requested_mode_invalid" }, 400);
  }

  const loaded = await loadDocument(admin, documentId);
  if (!loaded.ok) return json({ ok: false, error: loaded.error }, loaded.status);
  const document = loaded.document;

  // Same rule as register and the storage insert policy. The business owner
  // may upload. A firm member may upload only with client access.
  if (!serviceRole) {
    const { data: canUpload, error: accessError } = await admin.rpc("source_doc_can_upload", {
      p_user_id: userId,
      p_client_id: document.client_id,
    });
    if (accessError) return json({ ok: false, error: "access_check_failed" }, 500);
    if (canUpload !== true) return json({ ok: false, error: "forbidden" }, 403);
  }

  if (document.status === "duplicate") {
    return json({ ok: true, document_id: document.id, duplicate: true, proposal_id: null });
  }

  const duplicateFile = await fileDuplicate(admin, document);
  if (duplicateFile) {
    await admin.from("source_documents").update({ status: "duplicate" }).eq("id", document.id);
    return json({
      ok: true,
      document_id: document.id,
      duplicate: true,
      matched_document_id: duplicateFile,
      proposal_id: null,
    });
  }

  const mime = normaliseMime(document.mime);
  if (!extractionMimeSupported(mime)) {
    await admin.from("source_documents").update({ status: "extract_failed" }).eq("id", document.id);
    return json({ ok: false, error: "unsupported_mime" }, 415);
  }

  const downloaded = await admin.storage.from("source-docs").download(document.storage_path);
  if (downloaded.error || !downloaded.data) {
    await admin.from("source_documents").update({ status: "extract_failed" }).eq("id", document.id);
    return json({ ok: false, error: "file_unreadable" }, 422);
  }
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
    await admin.from("source_documents").update({ status: "rejected_intake" }).eq("id", document.id);
    return json({ ok: false, error: "size_not_allowed" }, 422);
  }
  const actualSha = await sha256HexBytes(bytes);
  if (actualSha !== document.sha256.toLowerCase()) {
    await admin.from("source_documents").update({ status: "rejected_intake" }).eq("id", document.id);
    return json({ ok: false, error: "file_hash_mismatch" }, 422);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ ok: false, error: "AI is not configured (ANTHROPIC_API_KEY missing)" }, 500);

  await admin.from("source_documents").update({ status: "extracting" }).eq("id", document.id);

  const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SOURCE_DOC_SYSTEM,
      messages: [
        {
          role: "user",
          content: sourceDocumentUserParts({
            mime,
            base64: bytesToBase64(bytes),
            fileName: document.storage_path.split("/").pop() ?? "document",
          }),
        },
      ],
      ...claudeRequestFields({ model: CLAUDE_MODEL }),
    }),
  });

  if (aiRes.status === 429) {
    await admin.from("source_documents").update({ status: "extract_failed" }).eq("id", document.id);
    return json({ ok: false, error: "rate_limited" }, 429);
  }
  if (!aiRes.ok) {
    await admin.from("source_documents").update({ status: "extract_failed" }).eq("id", document.id);
    return json({ ok: false, error: "extraction_failed" }, 502);
  }

  const aiJson = await aiRes.json();
  const raw = ((aiJson?.content ?? []) as Array<{ type?: string; text?: string }>)
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
  const usage = aiJson?.usage ?? {};
  const cost = sonnet55CostUsd(
    Number(usage.input_tokens ?? 0),
    Number(usage.output_tokens ?? 0),
    Number(usage.cache_read_input_tokens ?? 0),
  );

  let parsed;
  try {
    parsed = await parseModelDocument(raw || "{}");
  } catch {
    await admin.from("source_documents").update({ status: "extract_failed" }).eq("id", document.id);
    return json({ ok: false, error: "extraction_json_invalid" }, 422);
  }

  const context = await loadProposalContext(admin, document.client_id, parsed.supplierName, parsed.invoiceNumber);
  const assessment = assessSourceDocument({
    parsed,
    targetLedger: ledger as LedgerTarget,
    requestedMode: requestedMode as PostingMode,
    fileSha256: document.sha256,
    existing: context.existing,
    suppliersOnFile: context.suppliers,
    excludeDocumentId: document.id,
    finalUnlockAfter: context.finalUnlockAfter,
  });

  const { data: extraction, error: extractionError } = await admin
    .from("document_extractions")
    .insert({
      document_id: document.id,
      client_id: document.client_id,
      model: CLAUDE_MODEL,
      prompt_version: SOURCE_DOC_PROMPT_VERSION,
      doc_type: assessment.docType,
      supplier_name: assessment.supplierName,
      supplier_vat_number: assessment.supplierVatNumber,
      supplier_key: assessment.supplierKey || null,
      fields: assessment.fields,
      line_items: assessment.lineItems,
      totals_check: assessment.totalsCheck,
      arithmetic_ok: assessment.arithmeticOk,
      vat_claimable: assessment.vatClaimable,
      tax_treatment: assessment.taxTreatment,
      flags: assessment.flags,
      cost_usd: cost,
    })
    .select("id")
    .single();
  if (extractionError || !extraction) {
    await admin.from("source_documents").update({ status: "extract_failed" }).eq("id", document.id);
    return json({ ok: false, error: "extraction_save_failed" }, 500);
  }

  if (!assessment.proposal) {
    await admin.from("source_documents").update({ status: "extracted" }).eq("id", document.id);
    return json({
      ok: true,
      document_id: document.id,
      extraction_id: extraction.id,
      proposal_id: null,
      skipped: assessment.skipReason,
      flags: assessment.flags,
    });
  }

  const sealed = await sealPayload(assessment.proposal.payload);
  const { data: proposal, error: proposalError } = await admin
    .from("ledger_post_proposals")
    .insert({
      client_id: document.client_id,
      document_id: document.id,
      extraction_id: extraction.id,
      target_ledger: ledger,
      doc_type: assessment.proposal.payload.doc_type,
      mode: assessment.proposal.payload.mode,
      draft_holding: assessment.proposal.payload.draft_holding,
      canonical_payload: sealed.canonicalPayload,
      payload: assessment.proposal.payload,
      payload_sha256: sealed.payloadSha256,
      flags: assessment.flags,
      status: "proposed",
      supplier_key: assessment.proposal.supplierKey,
      supplier_display_name: assessment.proposal.supplierDisplayName,
      supplier_vat_number: assessment.proposal.supplierVatNumber,
      document_number: assessment.proposal.documentNumber,
      amount: assessment.proposal.amount,
      issued_on: assessment.proposal.issuedOn,
      file_sha256: document.sha256.toLowerCase(),
      clean: assessment.proposal.clean,
      proposed_by: "agent",
    })
    .select("id, payload_sha256, status")
    .single();
  if (proposalError || !proposal) {
    await admin.from("source_documents").update({ status: "extract_failed" }).eq("id", document.id);
    return json({ ok: false, error: "proposal_save_failed" }, 500);
  }

  await admin.from("source_documents").update({ status: "proposed" }).eq("id", document.id);
  return json({
    ok: true,
    document_id: document.id,
    extraction_id: extraction.id,
    proposal_id: proposal.id,
    payload_sha256: proposal.payload_sha256,
    status: proposal.status,
    flags: assessment.flags,
    mode: assessment.proposal.payload.mode,
    draft_holding: assessment.proposal.payload.draft_holding,
  });
});

async function loadDocument(
  admin: AdminClient,
  documentId: string,
): Promise<{ ok: true; document: SourceDocumentRow } | { ok: false; error: string; status: number }> {
  const { data, error } = await admin
    .from("source_documents")
    .select("id, client_id, storage_path, sha256, mime, size_bytes, status")
    .eq("id", documentId)
    .maybeSingle();
  if (error) return { ok: false, error: "document_lookup_failed", status: 500 };
  if (!data) return { ok: false, error: "document_not_found", status: 404 };
  return { ok: true, document: data as SourceDocumentRow };
}

async function fileDuplicate(admin: AdminClient, document: SourceDocumentRow): Promise<string | null> {
  const { data, error } = await admin
    .from("source_documents")
    .select("id")
    .eq("client_id", document.client_id)
    .eq("sha256", document.sha256.toLowerCase())
    .neq("id", document.id)
    .neq("status", "rejected_intake")
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return String(data[0]?.id ?? "") || null;
}

async function loadProposalContext(
  admin: AdminClient,
  clientId: string,
  supplierName: string | null,
  invoiceNumber: string | null,
): Promise<{ existing: DedupeCandidate[]; suppliers: SupplierOnFile[]; finalUnlockAfter: number }> {
  const key = supplierKey(supplierName);
  const number = documentNumberKey(invoiceNumber);
  const [{ data: suppliers }, { data: proposals }, { data: config }] = await Promise.all([
    admin
      .from("supplier_trust")
      .select("supplier_key, vat_number, bank_fingerprint, clean_approved_drafts")
      .eq("client_id", clientId),
    key && number
      ? admin
          .from("ledger_post_proposals")
          .select("id, document_id, supplier_key, document_number, amount, issued_on, status, file_sha256")
          .eq("client_id", clientId)
          .eq("supplier_key", key)
          .eq("document_number", number)
          .neq("status", "rejected")
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    admin.from("ledger_posting_config").select("final_unlock_after_clean_drafts").eq("singleton", true).maybeSingle(),
  ]);

  const existing: DedupeCandidate[] = ((proposals ?? []) as Array<Record<string, unknown>>).map((row) => ({
    documentId: String(row.document_id),
    sha256: String(row.file_sha256 ?? ""),
    supplierKey: String(row.supplier_key ?? ""),
    documentNumber: String(row.document_number ?? ""),
    amount: Number(row.amount ?? 0),
    issuedOn: String(row.issued_on ?? ""),
    status: row.status == null ? null : String(row.status),
  }));
  const onFile: SupplierOnFile[] = ((suppliers ?? []) as Array<Record<string, unknown>>).map((row) => ({
    supplierKey: String(row.supplier_key ?? ""),
    vatNumber: row.vat_number == null ? null : String(row.vat_number),
    bankFingerprint: row.bank_fingerprint == null ? null : String(row.bank_fingerprint),
    cleanApprovedDrafts: Number(row.clean_approved_drafts ?? 0),
  }));
  const unlock = Number(config?.final_unlock_after_clean_drafts ?? 3);
  return {
    existing,
    suppliers: onFile,
    finalUnlockAfter: Number.isFinite(unlock) && unlock >= 1 ? unlock : 3,
  };
}
