/**
 * Product usage ingest + Lighthouse reporting.
 *
 * Any signed-in user may write their own events. Only the platform owner
 * can read the aggregated report (same allowlist as the rest of Lighthouse).
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  adminLoose,
  assertPlatformOwner,
  migrationHintFor,
  missingRelation,
  type AuthCtx,
} from "@/lib/owner-ops.guard";
import {
  FEATURE_BY_KEY,
  PERSONA_LABELS,
  USAGE_SURFACES,
  resolveFeatureKey,
  resolveUsagePersona,
  rollupUsage,
  type UsageEventRow,
  type UsagePersona,
  type UsageRollup,
  type UsageSurface,
} from "@/lib/product-usage";

export const USAGE_MIGRATION = "20260822120000_lighthouse_product_usage.sql";

const UUID = z.string().uuid();
const optionalUuid = z
  .string()
  .max(64)
  .nullish()
  .transform((v) => {
    if (!v) return null;
    const parsed = UUID.safeParse(v);
    return parsed.success ? parsed.data : null;
  });

const ingestEventSchema = z.object({
  event: z.string().min(1).max(80),
  featureKey: z.string().max(80).optional(),
  surface: z.enum(USAGE_SURFACES).optional(),
  tab: z.string().max(40).optional(),
  path: z.string().max(200).optional(),
  clientId: optionalUuid,
  firmId: optionalUuid,
  sessionId: z.string().max(64).optional(),
  occurredAt: z.string().max(40).optional(),
  idempotencyKey: z.string().max(120).optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

type IngestEvent = z.infer<typeof ingestEventSchema>;

type UsageAuth = AuthCtx & {
  supabase?: { from: (table: string) => any };
  actingAsClientId?: string | null;
};

function clampOccurredAt(raw: string | undefined): string {
  const now = Date.now();
  const t = raw ? Date.parse(raw) : now;
  if (!Number.isFinite(t)) return new Date(now).toISOString();
  const min = now - 60 * 60 * 1000;
  const max = now + 5 * 60 * 1000;
  return new Date(Math.min(max, Math.max(min, t))).toISOString();
}

const DROP_PROP_KEYS = /email|password|token|secret|authorization|cookie/i;

function sanitizeProps(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (n >= 16) break;
    if (DROP_PROP_KEYS.test(k)) continue;
    if (k === "userId") continue;
    if (v == null) {
      out[k] = null;
      n += 1;
      continue;
    }
    const t = typeof v;
    if (t === "string") {
      out[k] = (v as string).slice(0, 200);
      n += 1;
    } else if (t === "number" || t === "boolean") {
      out[k] = v;
      n += 1;
    }
  }
  return out;
}

async function loadRoles(
  supabase: { from: (table: string) => any },
  userId: string,
): Promise<string[]> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return ((data ?? []) as Array<{ role?: string }>).map((r) => String(r.role ?? "")).filter(Boolean);
}

export const ingestProductUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        events: z.array(ingestEventSchema).min(1).max(40),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as UsageAuth;
    const userId = ctx.userId;
    if (!userId) return { ok: false as const, ingested: 0 };

    const sb = ctx.supabase;
    if (!sb) return { ok: false as const, ingested: 0 };

    let roles: string[] = [];
    try {
      roles = await loadRoles(sb, userId);
    } catch {
      roles = [];
    }

    const acting = Boolean(ctx.actingAsClientId);
    const rows = data.events.map((ev: IngestEvent) => {
      const surface: UsageSurface = ev.surface ?? (ev.path ? surfaceFromSafe(ev.path) : "other");
      const persona = resolveUsagePersona({
        roles,
        surface,
        actingAsClient: acting,
      });
      const featureKey = resolveFeatureKey({
        event: ev.event,
        featureKey: ev.featureKey,
        tab: ev.tab,
        path: ev.path,
        surface,
      });
      return {
        occurred_at: clampOccurredAt(ev.occurredAt),
        user_id: userId,
        persona,
        surface,
        event_name: ev.event.slice(0, 80),
        feature_key: featureKey.slice(0, 80),
        firm_id: ev.firmId,
        client_id: ev.clientId ?? ctx.actingAsClientId ?? null,
        session_id: ev.sessionId ?? null,
        properties: sanitizeProps(ev.properties),
      };
    });

    const { error } = await sb.from("lighthouse_product_usage").insert(rows);
    if (error) {
      if (missingRelation(error.message ?? "")) {
        return { ok: false as const, ingested: 0, migrationHint: migrationHintFor(USAGE_MIGRATION) };
      }
      // Never throw — tracking must not break the product.
      console.warn("product_usage.ingest_failed", error.message);
      return { ok: false as const, ingested: 0 };
    }

    // Dual-run A: also write allowlisted intent events to the analytics spine.
    try {
      const { mapUsageEventToSpine } = await import("@/lib/analytics-events");
      for (let i = 0; i < data.events.length; i++) {
        const ev = data.events[i] as IngestEvent;
        const mapped = mapUsageEventToSpine({ event: ev.event, tab: ev.tab, path: ev.path });
        const row = rows[i];
        if (!row) continue;
        for (const m of mapped) {
          const { error: spineErr } = await (
            sb as {
              rpc: (
                fn: string,
                args: Record<string, unknown>,
              ) => Promise<{ error: { message: string } | null }>;
            }
          ).rpc("analytics_track", {
            p_event_key: m.eventKey,
            p_properties: {
              ...sanitizeProps(ev.properties),
              surface: row.surface,
              tab: ev.tab ?? null,
              path: ev.path ?? null,
              feature_key: row.feature_key,
              ...(m.extra ?? {}),
            },
            p_session_id: row.session_id,
            p_entity_id: row.client_id,
            p_practice_id: row.firm_id,
            p_idempotency_key:
              ev.idempotencyKey && mapped.length === 1
                ? ev.idempotencyKey
                : `${m.eventKey}:${row.user_id}:${row.occurred_at}:${row.feature_key}:${ev.tab ?? ""}`,
          });
          if (spineErr && !/does not exist|42883|not client-writable/i.test(spineErr.message ?? "")) {
            console.warn("analytics_track failed", spineErr.message);
          }
        }
      }
    } catch {
      /* spine is optional until the migration is applied */
    }

    return { ok: true as const, ingested: rows.length };
  });

function surfaceFromSafe(path: string): UsageSurface {
  if (path.startsWith("/app")) return "owner_app";
  if (path.startsWith("/dashboard") || path.startsWith("/clients")) return "accountant_portal";
  if (path.startsWith("/reports")) return "reports";
  return "other";
}

export type LighthouseUsageReport = UsageRollup & {
  days: number;
  from: string;
  to: string;
  recent: Array<{
    at: string;
    persona: UsagePersona;
    personaLabel: string;
    featureKey: string;
    featureLabel: string;
    eventName: string;
  }>;
  migrationHint: string | null;
};

export const getLighthouseUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        days: z.coerce.number().int().min(1).max(90).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<LighthouseUsageReport> => {
    await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();
    const days = data.days ?? 30;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const empty = rollupUsage([], { fromIso, toIso });
    const base: LighthouseUsageReport = {
      ...empty,
      days,
      from: fromIso,
      to: toIso,
      recent: [],
      migrationHint: null,
    };

    const { data: rows, error } = await admin
      .from("lighthouse_product_usage")
      .select(
        "occurred_at, user_id, persona, surface, event_name, feature_key, firm_id, client_id",
      )
      .gte("occurred_at", fromIso)
      .order("occurred_at", { ascending: false })
      .limit(8000);

    if (error) {
      if (missingRelation(error.message ?? "")) {
        return { ...base, migrationHint: migrationHintFor(USAGE_MIGRATION) };
      }
      throw new Error(error.message);
    }

    const mapped: UsageEventRow[] = ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      occurredAt: String(r.occurred_at ?? ""),
      userId: String(r.user_id ?? ""),
      persona: (["firm", "founder", "customer"].includes(String(r.persona))
        ? r.persona
        : "customer") as UsagePersona,
      surface: (USAGE_SURFACES.includes(r.surface as UsageSurface)
        ? r.surface
        : "other") as UsageSurface,
      eventName: String(r.event_name ?? ""),
      featureKey: String(r.feature_key ?? "unknown"),
      firmId: (r.firm_id as string | null) ?? null,
      clientId: (r.client_id as string | null) ?? null,
    }));

    const firmIds = [...new Set(mapped.map((r) => r.firmId).filter((id): id is string => Boolean(id)))];
    const clientIds = [
      ...new Set(mapped.map((r) => r.clientId).filter((id): id is string => Boolean(id))),
    ];
    const entityLabels: Record<string, string> = {};

    if (firmIds.length) {
      const { data: firms } = await admin.from("firms").select("id, name").in("id", firmIds.slice(0, 200));
      for (const f of (firms ?? []) as Array<{ id: string; name: string | null }>) {
        const name = (f.name ?? "").trim() || "Firm";
        entityLabels[`firm:${f.id}`] = name;
        entityLabels[f.id] = name;
      }
    }
    if (clientIds.length) {
      const { data: clients } = await admin
        .from("clients")
        .select("id, name")
        .in("id", clientIds.slice(0, 200));
      for (const c of (clients ?? []) as Array<{ id: string; name: string | null }>) {
        const name = (c.name ?? "").trim() || "Client";
        entityLabels[`client:${c.id}`] = name;
        entityLabels[c.id] = name;
      }
    }

    const rollup = rollupUsage(mapped, { fromIso, toIso, entityLabels });
    const recent = mapped.slice(0, 25).map((r) => ({
      at: r.occurredAt,
      persona: r.persona,
      personaLabel: PERSONA_LABELS[r.persona],
      featureKey: r.featureKey,
      featureLabel: FEATURE_BY_KEY[r.featureKey]?.label ?? r.featureKey.replace(/[._]/g, " "),
      eventName: r.eventName,
    }));

    return {
      ...rollup,
      days,
      from: fromIso,
      to: toIso,
      recent,
      migrationHint: null,
    };
  });
