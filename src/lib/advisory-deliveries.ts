/**
 * Advisory / report delivery ledger — defend "we advised them in March."
 */

import { supabase } from "@/integrations/supabase/client";

export type DeliveryChannel = "mailto" | "whatsapp" | "copy" | "pdf_download" | "email";
export type DeliveryKind =
  | "advisory_draft"
  | "health_summary"
  | "report_pdf"
  | "meeting_agenda"
  | "exec_summary";

export type AdvisoryDelivery = {
  id: string;
  client_id: string;
  firm_id: string | null;
  channel: DeliveryChannel;
  kind: DeliveryKind;
  subject: string | null;
  body: string | null;
  recipient_email: string | null;
  recipient_name: string | null;
  report_key: string | null;
  snapshot_id: string | null;
  figures_hash: string | null;
  period_label: string | null;
  created_by: string;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  ack_token: string | null;
};

export type RecordDeliveryInput = {
  clientId: string;
  firmId?: string | null;
  channel: DeliveryChannel;
  kind: DeliveryKind;
  subject?: string | null;
  body?: string | null;
  recipientEmail?: string | null;
  recipientName?: string | null;
  reportKey?: string | null;
  snapshotId?: string | null;
  figuresHash?: string | null;
  periodLabel?: string | null;
  createdBy: string;
  /** When false, skip appending the ack URL to body (default: append for share channels). */
  appendAckLink?: boolean;
};

/** Simple stable hash of figures for stamping (not cryptographic). */
export function hashFigures(payload: unknown): string {
  const s = JSON.stringify(payload ?? {});
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Cryptographically random ack token (≥16 chars for the RPC guard). */
export function newAckToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function ackUrlForToken(token: string): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/ack/${token}`;
  }
  return `/ack/${token}`;
}

export function appendAckFooter(body: string, ackToken: string): string {
  const url = ackUrlForToken(ackToken);
  return `${body.trim()}\n\n---\nPlease confirm you received this: ${url}`;
}

/** Untyped access until advisory_deliveries lands in generated Database types. */
function deliveriesTable() {
  return (supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }).from(
    "advisory_deliveries",
  );
}

const SHARE_CHANNELS: DeliveryChannel[] = ["mailto", "whatsapp", "copy", "email"];

export async function recordDelivery(
  input: RecordDeliveryInput,
): Promise<{
  id: string | null;
  ackToken: string | null;
  body: string | null;
  error: string | null;
}> {
  const ackToken = newAckToken();
  const shouldAppend =
    input.appendAckLink !== false &&
    SHARE_CHANNELS.includes(input.channel) &&
    Boolean(input.body?.trim());
  const body = shouldAppend && input.body
    ? appendAckFooter(input.body, ackToken)
    : (input.body ?? null);

  const { data, error } = await deliveriesTable()
    .insert({
      client_id: input.clientId,
      firm_id: input.firmId ?? null,
      channel: input.channel,
      kind: input.kind,
      subject: input.subject ?? null,
      body,
      recipient_email: input.recipientEmail ?? null,
      recipient_name: input.recipientName ?? null,
      report_key: input.reportKey ?? null,
      snapshot_id: input.snapshotId ?? null,
      figures_hash: input.figuresHash ?? null,
      period_label: input.periodLabel ?? null,
      created_by: input.createdBy,
      ack_token: ackToken,
    } as never)
    .select("id, ack_token")
    .maybeSingle();

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("does not exist") || msg.includes("relation") || (error as { code?: string }).code === "42P01") {
      return { id: null, ackToken: null, body, error: null };
    }
    return { id: null, ackToken: null, body, error: msg };
  }
  const row = data as { id: string; ack_token: string } | null;
  return {
    id: row?.id ?? null,
    ackToken: row?.ack_token ?? ackToken,
    body,
    error: null,
  };
}

export async function listDeliveries(
  clientId: string,
  limit = 40,
): Promise<AdvisoryDelivery[]> {
  const { data, error } = await deliveriesTable()
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data as unknown) as AdvisoryDelivery[] | null) ?? [];
}

export async function latestSnapshotId(clientId: string): Promise<string | null> {
  const { data } = await supabase
    .from("client_financial_snapshots")
    .select("id")
    .eq("client_id", clientId)
    .order("period_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function acknowledgeDelivery(
  ackToken: string,
): Promise<{ ok: boolean; delivery: AdvisoryDelivery | null; error: string | null }> {
  const token = ackToken.trim();
  if (!token) return { ok: false, delivery: null, error: "Missing acknowledgement token" };

  const { data, error } = await (supabase as unknown as {
    rpc: (
      fn: string,
      args: { _token: string },
    ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  }).rpc("acknowledge_advisory_delivery", { _token: token });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("does not exist") || error.code === "42883") {
      return {
        ok: false,
        delivery: null,
        error: "Acknowledgement is not available yet — run the latest DB migration.",
      };
    }
    return { ok: false, delivery: null, error: msg };
  }
  if (!data) {
    return { ok: false, delivery: null, error: "Token not found" };
  }
  return { ok: true, delivery: data as AdvisoryDelivery, error: null };
}

export function channelHonestyLabel(channel: DeliveryChannel, acknowledged: boolean): string {
  if (acknowledged) return "Acknowledged by client";
  if (channel === "email") return "Sent via email";
  if (channel === "pdf_download") return "PDF downloaded";
  if (channel === "copy") return "Copied · not confirmed delivered";
  if (channel === "mailto" || channel === "whatsapp") return "Opened share · not confirmed delivered";
  return "Logged";
}
