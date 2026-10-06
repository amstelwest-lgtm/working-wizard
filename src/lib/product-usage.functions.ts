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
  isExcludedFromInstrument,
  mergeInternalEmails,
  realFirmCount,
} from "@/lib/metrics/internal-exclusion";
import {
  adminLoose,
  assertPlatformOwner,
  migrationHintFor,
  missingRelation,
  ownerEmailAllowlist,
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
  /** Same countable-firm definition as Platform signups. */
  firmCount: number;
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
    const days = data.days ?? 7;
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
      firmCount: 0,
    };

    const pageSize = 1000;
    const rows: Array<Record<string, unknown>> = [];
    let exactCount: number | null = null;
    for (let page = 0; page < 40; page++) {
      const from = page * pageSize;
      const { data, error, count } = await admin
        .from("lighthouse_product_usage")
        .select(
          "occurred_at, user_id, persona, surface, event_name, feature_key, firm_id, client_id",
          { count: "exact" },
        )
        .gte("occurred_at", fromIso)
        .order("occurred_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) {
        if (missingRelation(error.message ?? "")) {
          return { ...base, migrationHint: migrationHintFor(USAGE_MIGRATION) };
        }
        throw new Error(error.message);
      }
      if (typeof count === "number") exactCount = count;
      const batch = (data ?? []) as Array<Record<string, unknown>>;
      rows.push(...batch);
      if (batch.length < pageSize) break;
    }

    const mapped: UsageEventRow[] = rows.map((r) => ({
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

    const clientIds = [
      ...new Set(mapped.map((r) => r.clientId).filter((id): id is string => Boolean(id))),
    ];
    const [firmsRes, clientsRes, profilesRes, itRes] = await Promise.all([
      admin.from("firms").select("id, name, is_internal, owner_user_id"),
      clientIds.length
        ? admin
            .from("clients")
            .select("id, name, is_demo, owner_user_id")
            .in("id", clientIds.slice(0, 200))
        : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
      admin.from("profiles").select("id, full_name, email").limit(1000),
      admin.from("milon_it_members").select("email"),
    ]);
    const itEmails = ((itRes.data ?? []) as Array<{ email?: string | null }>).map((row) =>
      String(row.email ?? ""),
    );
    const ctx = { internalEmails: mergeInternalEmails(ownerEmailAllowlist(), itEmails) };
    const emailByUser = new Map<string, string>();
    const entityLabels: Record<string, string> = {};
    const excludedUsers = new Set<string>();
    for (const profile of (profilesRes.data ?? []) as Array<{
      id: string;
      full_name: string | null;
      email: string | null;
    }>) {
      const id = String(profile.id);
      emailByUser.set(id, String(profile.email ?? ""));
      const name = (profile.full_name ?? "").trim() || (profile.email ?? "").trim();
      if (name) entityLabels[`user:${id}`] = name;
      if (isExcludedFromInstrument({ name: profile.full_name, email: profile.email }, ctx)) {
        excludedUsers.add(id);
      }
    }
    const firmRows = (firmsRes.data ?? []) as Array<{
      id: string;
      name: string | null;
      is_internal?: boolean | null;
      owner_user_id?: string | null;
    }>;
    const firmSubjects = firmRows.map((firm) => ({
      name: firm.name,
      isInternal: Boolean(firm.is_internal),
      ownerEmail: emailByUser.get(String(firm.owner_user_id ?? "")) ?? null,
    }));
    const excludedFirms = new Set<string>();
    for (const firm of firmRows) {
      const id = String(firm.id);
      const name = (firm.name ?? "").trim() || "Firm";
      entityLabels[`firm:${id}`] = name;
      entityLabels[id] = name;
      if (
        isExcludedFromInstrument(
          {
            name: firm.name,
            isInternal: Boolean(firm.is_internal),
            ownerEmail: emailByUser.get(String(firm.owner_user_id ?? "")) ?? null,
          },
          ctx,
        )
      ) {
        excludedFirms.add(id);
      }
    }
    const clientRows = (clientsRes.data ?? []) as Array<{
      id: string;
      name: string | null;
      is_demo?: boolean | null;
      owner_user_id?: string | null;
    }>;
    const excludedClients = new Set<string>();
    const clientById = new Map<string, (typeof clientRows)[number]>();
    for (const client of clientRows) {
      const id = String(client.id);
      clientById.set(id, client);
      const name = (client.name ?? "").trim() || "Client";
      entityLabels[`client:${id}`] = name;
      entityLabels[id] = name;
      if (
        isExcludedFromInstrument(
          {
            name: client.name,
            isDemo: Boolean(client.is_demo),
            ownerEmail: emailByUser.get(String(client.owner_user_id ?? "")) ?? null,
          },
          ctx,
        )
      ) {
        excludedClients.add(id);
      }
    }
    const firmById = new Map(firmRows.map((firm) => [String(firm.id), firm]));
    const visible = mapped.filter((row) => {
      if (row.firmId && excludedFirms.has(row.firmId)) return false;
      if (row.userId && excludedUsers.has(row.userId)) return false;
      if (row.clientId && excludedClients.has(row.clientId)) return false;
      return true;
    });

    const rollup = rollupUsage(visible, { fromIso, toIso, entityLabels });
    rollup.entities = rollup.entities.filter((entity) => {
      if (entity.kind === "user") {
        const userId = entity.id.replace(/^user:/, "");
        return !isExcludedFromInstrument(
          { name: entity.label, email: emailByUser.get(userId) ?? null },
          ctx,
        );
      }
      if (entity.kind === "firm") {
        const firm = firmById.get(entity.id.replace(/^firm:/, ""));
        return !isExcludedFromInstrument(
          {
            name: firm?.name ?? entity.label,
            isInternal: Boolean(firm?.is_internal),
            ownerEmail: emailByUser.get(String(firm?.owner_user_id ?? "")) ?? null,
          },
          ctx,
        );
      }
      const client = clientById.get(entity.id.replace(/^client:/, ""));
      return !isExcludedFromInstrument(
        {
          name: client?.name ?? entity.label,
          isDemo: Boolean(client?.is_demo),
          ownerEmail: emailByUser.get(String(client?.owner_user_id ?? "")) ?? null,
        },
        ctx,
      );
    });
    const firmCount = realFirmCount(firmSubjects, ctx);
    rollup.totals.events = visible.length;
    const recent = visible.slice(0, 25).map((r) => ({
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
      firmCount,
    };
  });
