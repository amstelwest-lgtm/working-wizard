/**
 * Service-role write path into analytics.events.
 * Used for magic-link beacons and account.deleted — never from GET handlers.
 * Flags are stamped inside public.analytics_emit (do not trust client flags).
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { ANALYTICS_MIGRATION } from "@/lib/analytics-events";

export type AnalyticsEmitInput = {
  eventKey: string;
  occurredAt?: string;
  actorKind:
    | "anonymous"
    | "accountant"
    | "practice_admin"
    | "sme_owner"
    | "sme_member"
    | "sme_employee"
    | "milon_it"
    | "platform_owner"
    | "system";
  actorId?: string | null;
  actorHash?: string | null;
  practiceId?: string | null;
  entityId?: string | null;
  objectId?: string | null;
  objectType?: string | null;
  source: "client" | "server" | "db_trigger" | "job";
  sessionId?: string | null;
  isBot?: boolean;
  idempotencyKey?: string | null;
  properties?: Record<string, unknown>;
};

export async function emitAnalyticsEvent(input: AnalyticsEmitInput): Promise<{ ok: boolean }> {
  const admin = getSupabaseAdminOrNull() as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>;
  } | null;
  if (!admin) return { ok: false };

  try {
    const { error } = await admin.rpc("analytics_emit", {
      p_event_key: input.eventKey,
      p_occurred_at: input.occurredAt ?? new Date().toISOString(),
      p_actor_kind: input.actorKind,
      p_actor_id: input.actorId ?? null,
      p_actor_hash: input.actorHash ?? null,
      p_practice_id: input.practiceId ?? null,
      p_entity_id: input.entityId ?? null,
      p_object_id: input.objectId ?? null,
      p_object_type: input.objectType ?? null,
      p_source: input.source,
      p_session_id: input.sessionId ?? null,
      p_is_bot: Boolean(input.isBot),
      p_idempotency_key: input.idempotencyKey ?? null,
      p_properties: input.properties ?? {},
    });
    if (error) {
      if (!/does not exist|42883|schema "analytics"/i.test(error.message)) {
        console.warn("analytics_emit failed", error.message, ANALYTICS_MIGRATION);
      }
      return { ok: false };
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
