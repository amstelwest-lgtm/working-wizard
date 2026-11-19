/**
 * Apply Resend inbound events for client source documents (not Lighthouse CRM).
 */
import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { classificationStaysInReview } from "@/lib/im-cloud-ingest";
import {
  decideInboundDisposition,
  forwardingAddress,
  INBOUND_FORWARD_DOMAIN_ENV,
  type ForwardingAliasRow,
  type InboundAttachment,
} from "@/lib/im-inbound-forward";
import { listForwardingAliasesForDomain } from "@/lib/im-access-settings.server";
import { extractEmail } from "@/lib/lighthouse-delivery.server";
import { SOURCE_DOCS_BUCKET } from "@/lib/source-document-hooks";
import {
  sanitizeSourceObjectName,
  sha256HexOfBytes,
  sourceDocumentMime,
  sourceObjectPath,
} from "@/lib/source-documents-ui";

type LooseAdmin = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: Uint8Array,
        opts: { contentType: string; upsert: boolean },
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function admin(): LooseAdmin | null {
  const client = getSupabaseAdminOrNull();
  return client ? (client as unknown as LooseAdmin) : null;
}

async function aliasTable(): Promise<ForwardingAliasRow[]> {
  const domain = (process.env[INBOUND_FORWARD_DOMAIN_ENV] ?? "").trim();
  if (!domain) return [];
  const rows = await listForwardingAliasesForDomain(domain);
  return rows.map((row) => ({
    clientId: row.clientId,
    firmId: row.firmId,
    allowedSenders: row.settings.forwarding.allowedSenders,
    revokedAt: row.settings.revokedAt,
  }));
}

export type ClientSourceInboundResult = {
  ok: boolean;
  disposition: string;
  clientId?: string;
  documentId?: string;
  held?: boolean;
};

export async function applyClientSourceInbound(input: {
  from: string | null;
  to: string | null;
  attachments: InboundAttachment[];
  /** Fetched server-side from Resend; never logged. */
  firstAttachmentBytes?: Uint8Array | null;
  holdUnknownSender?: boolean;
}): Promise<ClientSourceInboundResult> {
  const domain = (process.env[INBOUND_FORWARD_DOMAIN_ENV] ?? "").trim();
  if (!domain) return { ok: false, disposition: "inbound_domain_unconfigured" };

  const table = await aliasTable();
  const disposition = decideInboundDisposition({
    from: input.from,
    recipient: input.to,
    domain,
    aliasTable: table,
    attachments: input.attachments,
    holdUnknownSender: input.holdUnknownSender ?? true,
  });

  if (disposition.kind === "rejected") {
    return { ok: false, disposition: disposition.reason };
  }
  if (disposition.kind === "held") {
    return { ok: true, disposition: disposition.reason, held: true };
  }

  const db = admin();
  if (!db) return { ok: false, disposition: "admin_unavailable" };

  const clientId = disposition.clientId;
  const att = input.attachments[0];
  if (!att) return { ok: true, disposition: "no_attachments", held: true };

  const mime = sourceDocumentMime({ name: att.filename, type: att.mimeType });
  if (!mime) return { ok: true, disposition: "unsupported_mime", held: true };

  const bytes = input.firstAttachmentBytes;
  if (!bytes?.length) return { ok: true, disposition: "attachment_pending", held: true };

  const name = sanitizeSourceObjectName(att.filename);
  const path = sourceObjectPath(clientId, name);
  const sha = await sha256HexOfBytes(bytes);

  const { error: upErr } = await db.storage.from(SOURCE_DOCS_BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: false,
  });
  if (upErr) return { ok: false, disposition: "upload_failed" };

  const { data, error } = await db.rpc("register_source_document", {
    p_client_id: clientId,
    p_storage_path: path,
    p_sha256: sha,
    p_mime: mime,
    p_size_bytes: att.sizeBytes,
    p_channel: "email",
  });
  if (error) return { ok: false, disposition: "register_failed" };

  void classificationStaysInReview();

  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const documentId = typeof row.document_id === "string" ? row.document_id : undefined;
  return {
    ok: true,
    disposition: "review_queue",
    clientId,
    documentId,
  };
}

export function describeClientForwarding(clientId: string): string | null {
  const domain = (process.env[INBOUND_FORWARD_DOMAIN_ENV] ?? "").trim();
  if (!domain) return null;
  return forwardingAddress(clientId, domain);
}

export function redactInboundFrom(raw: string | null): string {
  const email = extractEmail(raw);
  if (!email) return "";
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
}