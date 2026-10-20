/**
 * Anon chat for /talk/:agent. verify_jwt is false.
 * Rate limits, the turn cap, and lead inserts run here with the service role.
 * There is no anon-executable database function on this path.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { claudeRequestFields } from "../../../src/lib/claude-request.ts";
import {
  closedTaxTalk,
  handleProspectRequest,
  type ProspectLeadRow,
  type ProspectSession,
  type ProspectStore,
} from "../../../src/lib/prospect-talk-handler.ts";
import { PROSPECT_DEFAULT_MODEL } from "../../../src/lib/prospect-talk.ts";
import { sendTeamMail, type AlertKind } from "../../../src/lib/trial-lead-alert.ts";

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = Deno.env.get("ALLOWED_ORIGINS");
  let allowOrigin = "*";
  if (allowed && origin) {
    const list = allowed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    allowOrigin = list.includes(origin) ? origin : (list[0] ?? "*");
  }
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

type Db = {
  from(table: string): {
    select(cols: string, opts?: { count?: "exact"; head?: boolean }): DbFilter;
    insert(row: Record<string, unknown>): {
      select(cols: string): {
        single(): Promise<{
          data: { id: string } | null;
          error: { message: string; code?: string } | null;
        }>;
        maybeSingle(): Promise<{
          data: { id: string } | null;
          error: { message: string; code?: string } | null;
        }>;
      };
    };
    update(row: Record<string, unknown>): DbFilter;
  };
};

type DbFilter = Promise<{
  data: unknown;
  error: { message: string; code?: string } | null;
  count: number | null;
}> & {
  eq(col: string, value: string | number): DbFilter;
  gte(col: string, value: string): DbFilter;
  gt(col: string, value: string): DbFilter;
  select(cols: string): DbFilter;
  maybeSingle(): Promise<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>;
};

function duplicate(error: { message: string; code?: string }): boolean {
  return error.code === "23505" || /duplicate key/i.test(error.message);
}

function storeOf(db: Db): ProspectStore {
  return {
    async countIpTurns(ipHash, sinceIso) {
      const { count, error } = await db
        .from("prospect_talk_turns")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", sinceIso);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    async countIpSessions(ipHash, sinceIso) {
      const { count, error } = await db
        .from("prospect_talk_sessions")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", sinceIso);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    async countGlobalTurns(sinceIso) {
      const { count, error } = await db
        .from("prospect_talk_turns")
        .select("id", { count: "exact", head: true })
        .gte("created_at", sinceIso);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    async insertSession(row: ProspectSession) {
      const { error } = await db
        .from("prospect_talk_sessions")
        .insert({
          id: row.id,
          token_hash: row.tokenHash,
          agent: row.agent,
          ip_hash: row.ipHash,
          country: row.country,
          ref: row.ref,
          visitor_turns: row.visitorTurns,
          lead_email: row.leadEmail,
          sample_nonce: row.sampleNonce,
          created_at: row.createdAt,
          expires_at: row.expiresAt,
        })
        .select("id")
        .single();
      return !error;
    },
    async getSession(tokenHash, nowIso) {
      const { data, error } = await db
        .from("prospect_talk_sessions")
        .select(
          "id, token_hash, agent, ip_hash, country, ref, visitor_turns, lead_email, pending_message, sample_nonce, created_at, expires_at",
        )
        .eq("token_hash", tokenHash)
        .gt("expires_at", nowIso)
        .maybeSingle();
      if (error || !data) return null;
      const country = data.country === "ZA" ? "ZA" : "US";
      const agent = String(data.agent ?? "");
      if (
        agent !== "financial-manager" &&
        agent !== "analyst" &&
        agent !== "advisor" &&
        agent !== "tax-specialist"
      ) {
        return null;
      }
      return {
        id: String(data.id),
        tokenHash: String(data.token_hash),
        agent,
        ipHash: String(data.ip_hash),
        country,
        ref: typeof data.ref === "string" ? data.ref : null,
        visitorTurns: Number(data.visitor_turns ?? 0),
        leadEmail: typeof data.lead_email === "string" ? data.lead_email : null,
        pendingMessage: typeof data.pending_message === "string" ? data.pending_message : null,
        sampleNonce: typeof data.sample_nonce === "string" ? data.sample_nonce : null,
        createdAt: String(data.created_at),
        expiresAt: String(data.expires_at),
      };
    },
    async bumpTurn(sessionId, ipHash, fromTurns, atIso) {
      const { data, error } = await db
        .from("prospect_talk_sessions")
        .update({ visitor_turns: fromTurns + 1 })
        .eq("id", sessionId)
        .eq("visitor_turns", fromTurns)
        .select("id")
        .maybeSingle();
      if (error || !data) return false;
      const inserted = await db
        .from("prospect_talk_turns")
        .insert({ session_id: sessionId, ip_hash: ipHash, created_at: atIso })
        .select("id")
        .single();
      return !inserted.error;
    },
    async setPending(sessionId, message) {
      await db
        .from("prospect_talk_sessions")
        .update({ pending_message: message })
        .eq("id", sessionId);
    },
    async markLead(sessionId, email, sampleNonce) {
      await db
        .from("prospect_talk_sessions")
        .update({ lead_email: email, sample_nonce: sampleNonce })
        .eq("id", sessionId);
    },
    async countLeads(email) {
      const { count, error } = await db
        .from("trial_leads")
        .select("id", { count: "exact", head: true })
        .eq("email", email);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    async insertLead(row: ProspectLeadRow) {
      const { error } = await db
        .from("trial_leads")
        .insert({
          session_id: null,
          name: row.name,
          email: row.email,
          country: row.country,
          consent_at: row.consentAt,
          sample_nonce: row.sampleNonce,
          utm: { ...row.utm, talk_session: row.sessionId },
        })
        .select("id")
        .single();
      return !error;
    },
  };
}

async function callModel(input: { system: string; user: string }): Promise<string | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!apiKey) return null;
  const model = Deno.env.get("PROSPECT_TALK_MODEL") || PROSPECT_DEFAULT_MODEL;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      system: input.system,
      messages: [{ role: "user", content: input.user.slice(0, 500) }],
      max_tokens: 280,
      ...claudeRequestFields({ model, temperature: 0.3 }),
    }),
  });
  if (!res.ok) return null;
  const payload = (await res.json()) as { content?: { type?: string; text?: string }[] };
  const text = (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
  return text || null;
}

Deno.serve((req: Request) =>
  handle(req).catch((err) => {
    console.error("prospect-talk failed", err instanceof Error ? err.message : err);
    return json(
      { ok: false, error: "The conversation isn't available right now." },
      500,
      corsHeaders(req.headers.get("Origin")),
    );
  }),
);

async function handle(req: Request): Promise<Response> {
  const headers = corsHeaders(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405, headers);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "The conversation isn't available right now." }, 503, headers);
  }

  const raw = await req.text();
  if (raw.length > 8000)
    return json({ ok: false, error: "Keep that to a few sentences." }, 400, headers);
  let body: unknown = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ ok: false, error: "Send a message." }, 400, headers);
  }

  const closed = closedTaxTalk(body, req.headers.get("x-vercel-ip-country"));
  if (closed) return json({ ok: false, error: closed.error }, closed.status, headers);

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as Db;

  const result = await handleProspectRequest(body, {
    now: new Date(),
    ip: clientIp(req.headers),
    geoCountry: req.headers.get("x-vercel-ip-country"),
    ipSalt: (Deno.env.get("TRIAL_IP_SALT") ?? "").trim() || "milon-prospect-ip-v1",
    store: storeOf(db),
    model: callModel,
    claimAlert: async (kind: AlertKind, dedupeKey: string, detail) => {
      const { error } = await db
        .from("trial_lead_alerts")
        .insert({
          kind,
          dedupe_key: dedupeKey,
          country: detail.country,
          email: detail.email ?? null,
          detail,
        })
        .select("id")
        .single();
      if (!error) return true;
      if (duplicate(error)) return false;
      throw new Error(error.message);
    },
    sendAlert: (mail) =>
      sendTeamMail(mail, {
        apiKey: Deno.env.get("RESEND_API_KEY") ?? "",
        fetchImpl: fetch,
      }).then((sent) => ({ ok: sent.ok })),
  });

  return json(result.body, result.status, headers);
}
