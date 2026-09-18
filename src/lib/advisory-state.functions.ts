/**
 * Advisory state — server functions (P0.1).
 *
 * `getAdvisoryState` always returns a state: from `clients.advisory_state`
 * once `20260918120000_advisory_state.sql` is applied, otherwise derived from
 * existing tables via inferAdvisoryStateFromFacts() so the app (and the P0.3
 * Next Step resolver) never dead-ends on an un-migrated database.
 *
 * `appendAdvisoryEvent` is the only app-side write. It goes through the
 * allowlisted `advisory_record_event` RPC; everything else is emitted by DB
 * triggers so the audit trail cannot be forged from a browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import {
  ADVISORY_EVENTS,
  APP_WRITABLE_ADVISORY_EVENTS,
  inferAdvisoryStateFromFacts,
  isAdvisoryState,
  isMissingAdvisoryRelation,
  type AdvisoryActorKind,
  type AdvisoryEvent,
  type AdvisoryState,
} from "@/lib/advisory-state";

// Tables added by the advisory migration are typed in types.ts, but the new
// clients.advisory_* columns are read loosely here so this compiles against a
// regenerated Database type with or without them (same pattern as
// review-signoffs.functions.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
export type LooseSb = {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
type LooseQuery = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type AdvisoryEventRow = {
  id: number;
  cycle_id: string | null;
  event: AdvisoryEvent;
  from_state: AdvisoryState | null;
  to_state: AdvisoryState;
  changed: boolean;
  actor_kind: AdvisoryActorKind;
  actor_id: string | null;
  source: "db_trigger" | "rpc" | "cron" | "backfill";
  ref_table: string | null;
  ref_id: string | null;
  payload: Json;
  created_at: string;
};

export type AdvisoryCycleRow = {
  id: string;
  seq: number;
  state: AdvisoryState;
  trigger_event: AdvisoryEvent;
  started_at: string;
  closed_at: string | null;
  next_review_at: string | null;
};

export type AdvisoryStateSnapshot = {
  clientId: string;
  state: AdvisoryState;
  /** `persisted` = read from clients.advisory_state; `derived` = migration not applied yet. */
  source: "persisted" | "derived";
  hasFirm: boolean;
  nextReviewAt: string | null;
  cycle: AdvisoryCycleRow | null;
  /** Newest first. Empty when derived. */
  recentEvents: AdvisoryEventRow[];
};

async function assertClientAccess(sb: LooseSb, userId: string, clientId: string) {
  const { data, error } = await sb.rpc("has_client_access", {
    _user_id: userId,
    _client_id: clientId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have access to this client");
}

async function countRows(
  sb: LooseSb,
  table: string,
  clientId: string,
  filter?: (q: LooseQuery) => LooseQuery,
) {
  let q = sb.from(table).select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) {
    if (isMissingAdvisoryRelation(error) || /does not exist|schema cache/i.test(error.message))
      return 0;
    throw new Error(error.message);
  }
  return count ?? 0;
}

function jsonbBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

/**
 * Derive a state from the tables that exist today. Mirrors the migration's
 * backfill CASE so a derived and a persisted answer agree on day one.
 */
async function deriveAdvisoryState(
  sb: LooseSb,
  clientId: string,
  client: {
    firm_id: string | null;
    operating_profile: unknown;
    financials: unknown;
    last_forecast_at: string | null;
  },
): Promise<AdvisoryState> {
  const [hasSnapshot, proposedSteps, approvedSteps, openActions, doneActions] = await Promise.all([
    countRows(sb, "client_financial_snapshots", clientId),
    countRows(sb, "proposed_next_steps", clientId, (q) => q.eq("status", "proposed")),
    countRows(sb, "proposed_next_steps", clientId, (q) => q.in("status", ["approved", "edited"])),
    countRows(sb, "action_items", clientId, (q) => q.neq("status", "done")),
    countRows(sb, "action_items", clientId, (q) => q.eq("status", "done")),
  ]);
  return inferAdvisoryStateFromFacts({
    hasFirm: client.firm_id != null,
    hasProfile: !jsonbBlank(client.operating_profile),
    hasFinancials: !jsonbBlank(client.financials),
    hasSnapshot: hasSnapshot > 0,
    hasForecast: client.last_forecast_at != null,
    proposedSteps,
    approvedSteps,
    openActions,
    doneActions,
  });
}

/** Shared with the P0.3 Next Step resolver; not a server fn so it can be composed. */
export async function loadAdvisorySnapshot(
  sb: LooseSb,
  userId: string,
  data: { clientId: string; eventLimit?: number },
): Promise<AdvisoryStateSnapshot> {
  await assertClientAccess(sb, userId, data.clientId);

  const base = "id, firm_id, operating_profile, financials, last_forecast_at";
  let row: Record<string, unknown> | null = null;
  let persisted = true;

  const withAdvisory = await sb
    .from("clients")
    .select(`${base}, advisory_state, advisory_cycle_id, next_review_at`)
    .eq("id", data.clientId)
    .maybeSingle();
  if (withAdvisory.error) {
    if (!isMissingAdvisoryRelation(withAdvisory.error)) throw new Error(withAdvisory.error.message);
    persisted = false;
    const plain = await sb.from("clients").select(base).eq("id", data.clientId).maybeSingle();
    if (plain.error) throw new Error(plain.error.message);
    row = plain.data;
  } else {
    row = withAdvisory.data;
  }
  if (!row) throw new Error("Client not found");

  const client = {
    firm_id: (row.firm_id as string | null) ?? null,
    operating_profile: row.operating_profile,
    financials: row.financials,
    last_forecast_at: (row.last_forecast_at as string | null) ?? null,
  };

  const persistedState =
    persisted && isAdvisoryState(row.advisory_state) ? row.advisory_state : null;
  if (!persistedState) {
    // Migration missing, or applied but this client was created before the
    // backfill ran and no trigger has fired yet.
    return {
      clientId: data.clientId,
      state: await deriveAdvisoryState(sb, data.clientId, client),
      source: "derived",
      hasFirm: client.firm_id != null,
      nextReviewAt: null,
      cycle: null,
      recentEvents: [],
    };
  }

  const limit = data.eventLimit ?? 20;
  const [cycleRes, eventsRes] = await Promise.all([
    row.advisory_cycle_id
      ? sb
          .from("advisory_cycles")
          .select("id, seq, state, trigger_event, started_at, closed_at, next_review_at")
          .eq("id", row.advisory_cycle_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    limit > 0
      ? sb
          .from("advisory_events")
          .select(
            "id, cycle_id, event, from_state, to_state, changed, actor_kind, actor_id, source, ref_table, ref_id, payload, created_at",
          )
          .eq("client_id", data.clientId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (cycleRes.error && !isMissingAdvisoryRelation(cycleRes.error))
    throw new Error(cycleRes.error.message);
  if (eventsRes.error && !isMissingAdvisoryRelation(eventsRes.error))
    throw new Error(eventsRes.error.message);

  return {
    clientId: data.clientId,
    state: persistedState,
    source: "persisted",
    hasFirm: client.firm_id != null,
    nextReviewAt: (row.next_review_at as string | null) ?? null,
    cycle: (cycleRes.data as AdvisoryCycleRow | null) ?? null,
    recentEvents: ((eventsRes.data ?? []) as AdvisoryEventRow[]).map((e) => ({
      ...e,
      payload: (e.payload ?? {}) as Json,
    })),
  };
}

export const getAdvisoryState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        eventLimit: z.number().int().min(0).max(100).optional(),
      })
      .parse(input),
  )
  .handler(
    async ({ data, context }): Promise<AdvisoryStateSnapshot> =>
      loadAdvisorySnapshot(context.supabase as unknown as LooseSb, context.userId, data),
  );

const AppWritableEventSchema = z.enum(
  APP_WRITABLE_ADVISORY_EVENTS as unknown as [AdvisoryEvent, ...AdvisoryEvent[]],
);

export type AppendAdvisoryEventResult =
  | { ok: true; eventId: number; state: AdvisoryState }
  | { ok: false; reason: "not_migrated"; state: AdvisoryState };

export const appendAdvisoryEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        event: AppWritableEventSchema,
        payload: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<AppendAdvisoryEventResult> => {
    const sb = context.supabase as unknown as LooseSb;
    // RPC re-checks has_client_access and the allowlist server-side; this is
    // only so the caller gets a readable error before the round-trip.
    if (!(ADVISORY_EVENTS as readonly string[]).includes(data.event)) {
      throw new Error(`Unknown advisory event: ${data.event}`);
    }

    const { data: eventId, error } = await sb.rpc("advisory_record_event", {
      p_client_id: data.clientId,
      p_event: data.event,
      p_payload: data.payload ?? {},
    });
    if (error) {
      if (isMissingAdvisoryRelation(error)) {
        const snap = await loadAdvisorySnapshot(sb, context.userId, {
          clientId: data.clientId,
          eventLimit: 0,
        });
        return { ok: false, reason: "not_migrated", state: snap.state };
      }
      throw new Error(error.message);
    }

    const { data: row, error: readErr } = await sb
      .from("clients")
      .select("advisory_state")
      .eq("id", data.clientId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const state = isAdvisoryState(row?.advisory_state) ? row.advisory_state : "onboarding";
    return { ok: true, eventId: Number(eventId), state };
  });
