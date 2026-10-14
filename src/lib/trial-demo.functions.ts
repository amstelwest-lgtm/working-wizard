/**
 * Server functions for /try. Service role only, after the session cookie
 * is checked. The opaque token is stored as a hash.
 *
 * Env:
 * - TURNSTILE_SECRET_KEY (test secret when unset outside production)
 * - VITE_TURNSTILE_SITE_KEY (test site key when unset outside production)
 * - TRIAL_DAILY_AI_CAP (optional, default 100 model calls per UTC day)
 * - TRIAL_IP_SALT (optional)
 * - ANTHROPIC_API_KEY (analyst call; the fallback reading is only used when this key is missing)
 * - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (required in production)
 */

import { createHash, randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setCookie } from "@tanstack/react-start/server";
import { CLAUDE_MODEL } from "@/lib/claude-config";
import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  analystUsageTokens,
  findingsFromAnalystContent,
  trialAnalystRequest,
  trialAnalystSystem,
  trialAnalystUserMessage,
} from "@/lib/trial-analyst";
import {
  TRIAL_COOKIE,
  TRIAL_DISCLAIMER,
  TRIAL_RETENTION_DAYS,
  buildTrialBoard,
  buildTrialCash,
  buildTrialProfit,
  clientIpFromHeaders,
  deliverTrialFindings,
  deterministicTrialFindings,
  emailLeadAllowed,
  gateErrorCopy,
  ipSessionAllowed,
  sanitizeUtm,
  sessionRunAllowed,
  startOfUtcDay,
  TRIAL_RUNS_PER_SESSION,
  trialAnalystMode,
  trialDailyCap,
  trialMarketFromCountry,
  turnstileSecret,
  turnstileSiteKey,
  validateTrialGate,
  verifyTurnstileToken,
  type TrialBoard,
  type TrialCash,
  type TrialFinding,
  type TrialMarketId,
  type TrialProfit,
} from "@/lib/trial-demo";

type SessionRow = {
  id: string;
  token_hash: string;
  ip_hash: string;
  country: TrialMarketId;
  created_at: string;
  expires_at: string;
};

type TrialDb = {
  from(table: string): {
    select(cols: string, opts?: { count?: "exact"; head?: boolean }): TrialFilter;
    insert(row: Record<string, unknown>): {
      select(cols: string): {
        single(): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
  };
};

type TrialFilter = Promise<{
  data: unknown;
  error: { message: string } | null;
  count: number | null;
}> & {
  eq(col: string, value: string): TrialFilter;
  gte(col: string, value: string): TrialFilter;
  gt(col: string, value: string): TrialFilter;
  maybeSingle(): Promise<{ data: SessionRow | null; error: { message: string } | null }>;
};

const memory = {
  sessions: [] as SessionRow[],
  leads: [] as { email: string; session_id: string }[],
  usage: [] as { session_id: string; kind: string; tokens: number; created_at: string }[],
};

function devRuntime(): boolean {
  return process.env.NODE_ENV !== "production";
}

function ipSalt(): string {
  return (process.env.TRIAL_IP_SALT ?? "").trim() || "milon-trial-ip-v1";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashIp(ip: string): string {
  return createHash("sha256").update(`${ipSalt()}|${ip}`).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function requestOf(): { headers: Headers; url: string } | null {
  try {
    const request = getRequest();
    return { headers: request.headers, url: request.url };
  } catch {
    return null;
  }
}

function writeSessionCookie(token: string) {
  const maxAge = TRIAL_RETENTION_DAYS * 24 * 60 * 60;
  setCookie(TRIAL_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

function readSessionToken(): string | null {
  const req = requestOf();
  if (!req) return null;
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== TRIAL_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

function admin(): TrialDb | null {
  const client = getSupabaseAdminOrNull();
  return client ? (client as unknown as TrialDb) : null;
}

async function countSessions(ipHash: string, sinceIso: string): Promise<number> {
  const db = admin();
  if (!db) {
    return memory.sessions.filter((row) => row.ip_hash === ipHash && row.created_at >= sinceIso)
      .length;
  }
  const { count, error } = await db
    .from("trial_sessions")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", sinceIso);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function insertSession(row: SessionRow): Promise<boolean> {
  const db = admin();
  if (!db) {
    if (!devRuntime()) return false;
    memory.sessions.push(row);
    return true;
  }
  const { error } = await db
    .from("trial_sessions")
    .insert({
      id: row.id,
      token_hash: row.token_hash,
      ip_hash: row.ip_hash,
      country: row.country,
      created_at: row.created_at,
      expires_at: row.expires_at,
    })
    .select("id")
    .single();
  return !error;
}

async function sessionByHash(tokenHash: string, nowIso: string): Promise<SessionRow | null> {
  const db = admin();
  if (!db) {
    return (
      memory.sessions.find((row) => row.token_hash === tokenHash && row.expires_at > nowIso) ?? null
    );
  }
  const { data, error } = await db
    .from("trial_sessions")
    .select("id, token_hash, ip_hash, country, created_at, expires_at")
    .eq("token_hash", tokenHash)
    .gt("expires_at", nowIso)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function countLeads(email: string): Promise<number> {
  const db = admin();
  if (!db) return memory.leads.filter((row) => row.email === email).length;
  const { count, error } = await db
    .from("trial_leads")
    .select("id", { count: "exact", head: true })
    .eq("email", email);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function insertLead(row: Record<string, unknown>): Promise<boolean> {
  const db = admin();
  if (!db) {
    if (!devRuntime()) return false;
    memory.leads.push({ email: String(row.email), session_id: String(row.session_id) });
    return true;
  }
  const { error } = await db.from("trial_leads").insert(row).select("id").single();
  return !error;
}

async function countRuns(sessionId: string): Promise<number> {
  const db = admin();
  if (!db) return memory.usage.filter((row) => row.session_id === sessionId).length;
  const { count, error } = await db
    .from("trial_usage")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countAnalystSince(sinceIso: string): Promise<number> {
  const db = admin();
  if (!db) {
    return memory.usage.filter(
      (row) => row.kind === "analyst" && row.tokens > 0 && row.created_at >= sinceIso,
    ).length;
  }
  const { count, error } = await db
    .from("trial_usage")
    .select("id", { count: "exact", head: true })
    .eq("kind", "analyst")
    .gte("created_at", sinceIso)
    .gt("tokens", "0");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function insertUsage(row: {
  session_id: string;
  kind: string;
  tokens: number;
}): Promise<boolean> {
  const db = admin();
  const created_at = new Date().toISOString();
  if (!db) {
    if (!devRuntime()) return false;
    memory.usage.push({ ...row, created_at });
    return true;
  }
  const { error } = await db
    .from("trial_usage")
    .insert({ ...row, created_at })
    .select("id")
    .single();
  return !error;
}

function storeReady(): boolean {
  return admin() != null || devRuntime();
}

async function requireSession(): Promise<SessionRow | null> {
  const token = readSessionToken();
  if (!token) return null;
  return sessionByHash(hashToken(token), new Date().toISOString());
}

export const readTrialPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  return {
    siteKey: turnstileSiteKey(process.env.VITE_TURNSTILE_SITE_KEY, devRuntime()),
  };
});

export const startTrialSample = createServerFn({ method: "POST" }).handler(async () => {
  if (!storeReady()) return { ok: false as const, error: "The sample isn't available right now." };
  const req = requestOf();
  const headers = req?.headers ?? new Headers();
  const country = trialMarketFromCountry(
    headers.get("x-vercel-ip-country") || (devRuntime() ? process.env.MILON_DEV_GEO : "") || "",
  );
  const ipHash = hashIp(clientIpFromHeaders(headers));
  const since = startOfUtcDay(new Date()).toISOString();
  const existing = await countSessions(ipHash, since);
  if (!ipSessionAllowed(existing)) {
    return {
      ok: false as const,
      error: "This network has already started three samples today. Try again tomorrow.",
    };
  }
  const now = new Date();
  const token = newToken();
  const row: SessionRow = {
    id: crypto.randomUUID(),
    token_hash: hashToken(token),
    ip_hash: ipHash,
    country,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + TRIAL_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  };
  const saved = await insertSession(row);
  if (!saved) return { ok: false as const, error: "The sample isn't available right now." };
  writeSessionCookie(token);
  return { ok: true as const, country };
});

type LeadBody = {
  name?: string;
  email?: string;
  consent?: boolean;
  turnstileToken?: string;
  utm?: unknown;
};

export const submitTrialLead = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => (input ?? {}) as LeadBody)
  .handler(async ({ data }) => {
    if (!storeReady())
      return { ok: false as const, error: "The sample isn't available right now." };
    const gate = validateTrialGate({
      name: data.name ?? "",
      email: data.email ?? "",
      consent: data.consent === true,
      turnstileToken: data.turnstileToken ?? "",
    });
    if (!gate.ok) return { ok: false as const, error: gateErrorCopy(gate.error) };
    const session = await requireSession();
    if (!session) return { ok: false as const, error: "Start again with Use sample." };
    const secret = turnstileSecret(process.env.TURNSTILE_SECRET_KEY, devRuntime());
    if (!secret) return { ok: false as const, error: "The check isn't available right now." };
    const req = requestOf();
    const ip = clientIpFromHeaders(req?.headers ?? new Headers());
    const passed = await verifyTurnstileToken({
      token: data.turnstileToken ?? "",
      secret,
      remoteIp: ip,
    });
    if (!passed) return { ok: false as const, error: "The check didn't pass. Try it again." };
    const leads = await countLeads(gate.email);
    if (!emailLeadAllowed(leads)) {
      return { ok: false as const, error: "That email has already opened two samples." };
    }
    let utm = sanitizeUtm(data.utm);
    if (req) {
      try {
        const url = new URL(req.url);
        const fromUrl: Record<string, string> = {};
        for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
          const value = url.searchParams.get(key);
          if (value) fromUrl[key] = value;
        }
        utm = { ...sanitizeUtm(fromUrl), ...utm };
      } catch {
        /* ignore a bad request url */
      }
    }
    const saved = await insertLead({
      session_id: session.id,
      name: gate.name,
      email: gate.email,
      country: session.country,
      consent_at: new Date().toISOString(),
      utm,
    });
    if (!saved) return { ok: false as const, error: "The sample isn't available right now." };
    const board = buildTrialBoard(session.country);
    return { ok: true as const, board };
  });

async function spendRun(sessionId: string, kind: string, tokens: number): Promise<number | null> {
  const used = await countRuns(sessionId);
  if (!sessionRunAllowed(used)) return null;
  const saved = await insertUsage({ session_id: sessionId, kind, tokens });
  if (!saved) return null;
  return TRIAL_RUNS_PER_SESSION - (used + 1);
}

export const runTrialAnalyst = createServerFn({ method: "POST" }).handler(async () => {
  if (!storeReady()) return { ok: false as const, error: "The sample isn't available right now." };
  const session = await requireSession();
  if (!session) return { ok: false as const, error: "Start again with Use sample." };
  const board = buildTrialBoard(session.country);
  const cap = trialDailyCap(process.env.TRIAL_DAILY_AI_CAP);
  const aiConfigured = Boolean((process.env.ANTHROPIC_API_KEY ?? "").trim());
  const runsToday = await countAnalystSince(startOfUtcDay(new Date()).toISOString());
  const mode = trialAnalystMode({ runsToday, cap, aiConfigured });
  if (mode === "paused") {
    return { ok: false as const, error: "The sample review is paused until tomorrow." };
  }
  let modelFindings: TrialFinding[] = [];
  let tokens = 0;
  if (mode === "model") {
    try {
      const called = await callTrialAnalyst(board);
      modelFindings = called.findings;
      tokens = called.tokens;
    } catch {
      modelFindings = [];
      tokens = 0;
    }
  }
  const delivered = deliverTrialFindings({
    mode,
    modelFindings,
    fallback: deterministicTrialFindings(board),
  });
  if (!delivered.ok) {
    return { ok: false as const, error: "The Analyst didn't return a reading. Try again." };
  }
  const runsLeft = await spendRun(
    session.id,
    "analyst",
    delivered.delivered === "model" ? tokens : 0,
  );
  if (runsLeft == null) return { ok: false as const, error: "This sample has used its ten runs." };
  return {
    ok: true as const,
    findings: delivered.findings,
    mode: delivered.delivered,
    runsLeft,
    disclaimer: TRIAL_DISCLAIMER,
  };
});

async function callTrialAnalyst(
  board: TrialBoard,
): Promise<{ findings: TrialFinding[]; tokens: number }> {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!apiKey) return { findings: [], tokens: 0 };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(
        trialAnalystRequest({
          model: CLAUDE_MODEL,
          system: trialAnalystSystem(),
          user: trialAnalystUserMessage(board),
        }),
      ),
    });
    if (!res.ok) return { findings: [], tokens: 0 };
    const json = (await res.json()) as {
      content?: unknown;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    return {
      findings: findingsFromAnalystContent(json.content),
      tokens: analystUsageTokens(json.usage ?? null),
    };
  } finally {
    clearTimeout(timeout);
  }
}

type ChipBody = { chip?: string };

export const runTrialChip = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => (input ?? {}) as ChipBody)
  .handler(async ({ data }) => {
    if (!storeReady())
      return { ok: false as const, error: "The sample isn't available right now." };
    const chip = data.chip;
    if (chip !== "profit" && chip !== "cash") {
      return { ok: false as const, error: "Coming soon." };
    }
    const session = await requireSession();
    if (!session) return { ok: false as const, error: "Start again with Use sample." };
    const kind = chip === "profit" ? "profitability" : "cash";
    const runsLeft = await spendRun(session.id, kind, 0);
    if (runsLeft == null)
      return { ok: false as const, error: "This sample has used its ten runs." };
    if (chip === "profit") {
      const profit: TrialProfit = buildTrialProfit(session.country);
      return { ok: true as const, chip, profit, runsLeft };
    }
    const cash: TrialCash = buildTrialCash(session.country);
    return { ok: true as const, chip, cash, runsLeft };
  });
