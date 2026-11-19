/**
 * Per-client forwarding address routing for source-document ingest.
 * No Resend sends; inbound only.
 */
import { extractEmail } from "@/lib/lighthouse-delivery.server";

export const INBOUND_FORWARD_DOMAIN_ENV = "MILON_SOURCE_INBOUND_DOMAIN";

export type ForwardingAliasRow = {
  clientId: string;
  firmId: string | null;
  allowedSenders: readonly string[];
  revokedAt: string | null;
};

export type InboundAttachment = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

export type InboundDisposition =
  | { kind: "ingest"; clientId: string; channel: "email" }
  | { kind: "held"; reason: "unknown_sender" | "unknown_recipient" | "revoked" | "no_attachments" }
  | { kind: "rejected"; reason: "unknown_sender" | "unknown_recipient" };

export function forwardingLocalPart(clientId: string): string {
  const id = clientId.trim().toLowerCase();
  const short = id.replace(/-/g, "").slice(0, 12);
  return `src-${short}`;
}

export function forwardingAddress(clientId: string, domain: string): string {
  const host = domain.trim().toLowerCase().replace(/^@/, "");
  return `${forwardingLocalPart(clientId)}@${host}`;
}

export function clientIdMatchesShortPrefix(clientId: string, short12: string): boolean {
  const compact = clientId.trim().toLowerCase().replace(/-/g, "");
  return compact.startsWith(short12.toLowerCase());
}

export function resolveInboundRecipient(
  recipient: string | null | undefined,
  domain: string,
  aliasTable: readonly ForwardingAliasRow[],
): ForwardingAliasRow | null {
  const email = extractEmail(recipient);
  if (!email) return null;
  const host = domain.trim().toLowerCase();
  const [local] = email.split("@");
  if (!local?.startsWith("src-")) return null;
  const short = local.slice(4);

  for (const row of aliasTable) {
    if (clientIdMatchesShortPrefix(row.clientId, short)) {
      const expected = forwardingAddress(row.clientId, host);
      if (expected === email) return row;
    }
  }
  return null;
}

export function senderAllowed(
  from: string | null | undefined,
  allowed: readonly string[],
): boolean {
  const sender = extractEmail(from);
  if (!sender) return false;
  if (allowed.length === 0) return true;
  const norm = sender.toLowerCase();
  return allowed.some((a) => a.toLowerCase() === norm);
}

export function decideInboundDisposition(input: {
  from: string | null;
  recipient: string | null;
  domain: string;
  aliasTable: readonly ForwardingAliasRow[];
  attachments: readonly InboundAttachment[];
  holdUnknownSender: boolean;
}): InboundDisposition {
  const alias = resolveInboundRecipient(input.recipient, input.domain, input.aliasTable);
  if (!alias) {
    return input.holdUnknownSender
      ? { kind: "held", reason: "unknown_recipient" }
      : { kind: "rejected", reason: "unknown_recipient" };
  }
  if (alias.revokedAt) return { kind: "held", reason: "revoked" };
  if (!senderAllowed(input.from, alias.allowedSenders)) {
    return input.holdUnknownSender
      ? { kind: "held", reason: "unknown_sender" }
      : { kind: "rejected", reason: "unknown_sender" };
  }
  if (input.attachments.length === 0) return { kind: "held", reason: "no_attachments" };
  return { kind: "ingest", clientId: alias.clientId, channel: "email" };
}