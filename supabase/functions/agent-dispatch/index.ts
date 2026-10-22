/**
 * Reads due agent events and asks Postgres (pg_net) to call the runner.
 * The cron job that posts here is created inactive. Each runner has its own
 * agent_settings flag, default false, so a disabled runner's queue is not read.
 * Completed Tax Specialist sends are placed on agent_tax when that firm's
 * flag is on. That path only enqueues. It does not call a model.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  planTaxDispatch,
  TAX_AGENT_QUEUE,
  TAX_DISPATCH_FIRM_ID,
  TAX_DISPATCH_FLAG,
  TAX_SEND_AGENT,
  type TaxDispatchSend,
} from "../../../src/lib/tax-specialist-dispatch.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RUNNERS = [
  { setting: "enabled", queue: "agent_analyst", fn: "agent-analyst", promote: true },
  { setting: "financial_manager_enabled", queue: "agent_fm", fn: "agent-financial-manager", promote: false },
  { setting: "advisor_enabled", queue: "agent_advisor", fn: "agent-advisor", promote: false },
] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

function bearerRole(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const pad = (s: string) => s + "=".repeat((4 - (s.length % 4)) % 4);
    const payload = JSON.parse(atob(pad(parts[1].replace(/-/g, "+").replace(/_/g, "/"))));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function flagOn(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return value === "true";
  return false;
}

type DbError = { message: string; code?: string } | null;
type Row = Record<string, unknown>;
type Rows = { data: Row[] | null; error: DbError };

type LooseFilter = {
  eq: (column: string, value: string) => LooseFilter;
  not: (column: string, op: string, value: null) => LooseFilter;
  in: (column: string, values: string[]) => Promise<Rows>;
  limit: (n: number) => Promise<Rows>;
  maybeSingle: () => Promise<{ data: Row | null; error: DbError }>;
};

type LooseDb = {
  from: (table: string) => {
    select: (cols: string) => LooseFilter;
    insert: (row: Row) => { select: (cols: string) => Promise<Rows> };
    delete: () => { eq: (column: string, value: string) => Promise<{ error: DbError }> };
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: DbError }>;
};

/**
 * Claim the send, then enqueue it. A failed send drops the claim so a later
 * tick can try once. A send already claimed is left alone.
 * The new tables are not in the generated Database type, so this uses a
 * narrow cast. It does not call a model.
 */
async function enqueueCompletedTaxSends(db: LooseDb): Promise<number> {
  const flag = await db
    .from("agent_firm_flags")
    .select("enabled")
    .eq("firm_id", TAX_DISPATCH_FIRM_ID)
    .eq("flag", TAX_DISPATCH_FLAG)
    .maybeSingle();
  if (flag.error || flag.data?.enabled !== true) return 0;

  const found = await db
    .from("client_agent_sends")
    .select("id, firm_id, client_id, agent, completed_at")
    .eq("firm_id", TAX_DISPATCH_FIRM_ID)
    .eq("agent", TAX_SEND_AGENT)
    .not("completed_at", "is", null)
    .limit(25);
  if (found.error || !found.data?.length) return 0;

  const ids = found.data.map((row) => String(row.id));
  const prior = await db.from("agent_tax_enqueued").select("send_id").in("send_id", ids);
  if (prior.error) return 0;
  const queued = new Set((prior.data ?? []).map((row) => String(row.send_id)));

  const sends: TaxDispatchSend[] = found.data.map((row) => ({
    id: String(row.id),
    firmId: String(row.firm_id),
    clientId: String(row.client_id),
    agent: String(row.agent),
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    alreadyQueued: queued.has(String(row.id)),
  }));
  const plans = planTaxDispatch({ sends, flagEnabled: true });

  let enqueued = 0;
  for (const plan of plans) {
    const claimed = await db
      .from("agent_tax_enqueued")
      .insert({ send_id: plan.sendId })
      .select("send_id");
    if (claimed.error || !claimed.data?.length) continue;
    const sent = await db.rpc("agent_queue_send", {
      p_queue: TAX_AGENT_QUEUE,
      p_payload: plan.payload,
      p_delay: 0,
    });
    if (sent.error) {
      await db.from("agent_tax_enqueued").delete().eq("send_id", plan.sendId);
      continue;
    }
    enqueued += 1;
  }
  return enqueued;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (bearerRole(req.headers.get("authorization") ?? "") !== "service_role") {
    return json({ error: "forbidden" }, 403);
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return json({ error: "not_configured" }, 500);
  const db = createClient(url, serviceKey);
  const taxEnqueued = await enqueueCompletedTaxSends(db as unknown as LooseDb);

  const { data: settings, error: settingError } = await db
    .from("agent_settings")
    .select("key, value")
    .in("key", RUNNERS.map((runner) => runner.setting));
  if (settingError) return json({ error: settingError.message }, 500);
  const flags = new Map((settings ?? []).map((row) => [row.key as string, flagOn(row.value)]));
  const enabled = RUNNERS.filter((runner) => flags.get(runner.setting) === true);
  if (enabled.length === 0) return json({ skipped: true, reason: "disabled", taxEnqueued });

  let promoted = 0;
  if (enabled.some((runner) => runner.promote)) {
    const { data, error: promoteError } = await db.rpc("promote_due_agent_events");
    if (promoteError) return json({ error: promoteError.message }, 500);
    promoted = (data as number | null) ?? 0;
  }

  let kicked = 0;
  for (const runner of enabled) {
    const { data: batch, error: readError } = await db.rpc("agent_queue_read", {
      p_queue: runner.queue,
      p_vt: 120,
      p_qty: 5,
    });
    if (readError) return json({ error: readError.message }, 500);
    const messages = (batch ?? []) as Array<{ msg_id: number; message: Record<string, unknown> }>;
    for (const message of messages) {
      const payload = message.message ?? {};
      const { error } = await db.rpc("agent_invoke", {
        p_function: runner.fn,
        p_body: { ...payload, msg_id: message.msg_id },
      });
      if (error) {
        console.warn("agent_invoke", error.message);
        continue;
      }
      kicked += 1;
    }
  }

  return json({ promoted, kicked, taxEnqueued });
});
