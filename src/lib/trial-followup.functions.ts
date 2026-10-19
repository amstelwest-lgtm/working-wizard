/**
 * Server functions for /try lead alerts and call booking.
 * Service role only. Without the Google Calendar env vars, a call is saved
 * and emailed to the founder. Tests pass their own send and book functions
 * into the pure helpers; these handlers are the production wiring.
 *
 * Env:
 * - RESEND_API_KEY (optional; a missing key still saves the row)
 * - GOOGLE_CALENDAR_CLIENT_ID
 * - GOOGLE_CALENDAR_CLIENT_SECRET
 * - GOOGLE_CALENDAR_REFRESH_TOKEN
 * - GOOGLE_CALENDAR_ID
 * - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (required in production)
 * - TRIAL_IP_SALT (optional)
 */

import { createHash, randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setCookie } from "@tanstack/react-start/server";
import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { bookGoogleMeet } from "@/lib/google-calendar";
import {
  arrangeTrialCall,
  callRateAllowed,
  deliverLeadAlert,
  demoViewMail,
  sendTeamMail,
  trialStartMail,
  validateCallRequest,
  type AlertKind,
  type CallDraft,
  type Mail,
} from "@/lib/trial-followup";

const VISITOR_COOKIE = "milon_try_visitor";

type DbError = { message: string; code?: string };

type FollowupFilter = Promise<{
  data: unknown;
  error: DbError | null;
  count: number | null;
}> & {
  eq(col: string, value: string): FollowupFilter;
  gte(col: string, value: string): FollowupFilter;
};

type FollowupDb = {
  from(table: string): {
    select(cols: string, opts?: { count?: "exact"; head?: boolean }): FollowupFilter;
    insert(row: Record<string, unknown>): {
      select(cols: string): {
        single(): Promise<{ data: { id: string } | null; error: DbError | null }>;
      };
    };
  };
};

const memory = {
  alerts: [] as { kind: string; dedupeKey: string }[],
  calls: [] as { ipHash: string; createdAt: string }[],
};

function devRuntime(): boolean {
  return process.env.NODE_ENV !== "production";
}

function admin(): FollowupDb | null {
  const client = getSupabaseAdminOrNull();
  return client ? (client as unknown as FollowupDb) : null;
}

function storeReady(): boolean {
  return admin() != null || devRuntime();
}

function ipSalt(): string {
  return (process.env.TRIAL_IP_SALT ?? "").trim() || "milon-trial-ip-v1";
}

function hashIp(ip: string): string {
  return createHash("sha256").update(`${ipSalt()}|${ip}`).digest("hex");
}

function requestOf(): { headers: Headers; url: string } | null {
  try {
    const request = getRequest();
    return { headers: request.headers, url: request.url };
  } catch {
    return null;
  }
}

function readCookie(name: string): string | null {
  const req = requestOf();
  const raw = req?.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

function ensureVisitorId(): string {
  const existing = readCookie(VISITOR_COOKIE);
  if (existing && /^[A-Za-z0-9_-]{16,80}$/.test(existing)) return existing;
  const id = randomBytes(18).toString("base64url");
  setCookie(VISITOR_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return id;
}

function clientIpFromHeaders(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  return real || "unknown";
}

function countryOf(): "US" | "ZA" {
  const headers = requestOf()?.headers ?? new Headers();
  const raw =
    headers.get("x-vercel-ip-country") || (devRuntime() ? process.env.MILON_DEV_GEO : "") || "";
  return raw.trim().toUpperCase() === "ZA" ? "ZA" : "US";
}

function duplicate(error: DbError): boolean {
  return error.code === "23505" || /duplicate key/i.test(error.message);
}

async function claimAlert(
  kind: AlertKind,
  dedupeKey: string,
  detail: { country: string; email?: string },
): Promise<boolean> {
  const db = admin();
  if (!db) {
    if (!devRuntime()) return false;
    if (memory.alerts.some((row) => row.kind === kind && row.dedupeKey === dedupeKey)) return false;
    memory.alerts.push({ kind, dedupeKey });
    return true;
  }
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
}

async function countCalls(ipHash: string, sinceIso: string): Promise<number> {
  const db = admin();
  if (!db) {
    return memory.calls.filter((row) => row.ipHash === ipHash && row.createdAt >= sinceIso).length;
  }
  const { count, error } = await db
    .from("trial_call_requests")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", sinceIso);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function insertCall(row: {
  draft: CallDraft;
  status: "saved" | "booked";
  meetUrl: string | null;
  calendarEventId: string | null;
}): Promise<boolean> {
  const createdAt = new Date().toISOString();
  const db = admin();
  if (!db) {
    if (!devRuntime()) return false;
    memory.calls.push({ ipHash: row.draft.ipHash, createdAt });
    return true;
  }
  const { error } = await db
    .from("trial_call_requests")
    .insert({
      name: row.draft.name,
      email: row.draft.email,
      country: row.draft.country,
      slot_start: row.draft.start.toISOString(),
      slot_end: row.draft.end.toISOString(),
      visitor_timezone: row.draft.timeZone,
      status: row.status,
      meet_url: row.meetUrl,
      calendar_event_id: row.calendarEventId,
      ip_hash: row.draft.ipHash,
      consent_at: createdAt,
    })
    .select("id")
    .single();
  return !error;
}

function sender(): (mail: Mail) => Promise<{ ok: boolean }> {
  return (mail) =>
    sendTeamMail(mail, { apiKey: process.env.RESEND_API_KEY ?? "", fetchImpl: fetch }).then(
      (result) => ({
        ok: result.ok,
      }),
    );
}

export async function alertTrialStart(input: {
  name: string;
  email: string;
  country: "US" | "ZA";
}): Promise<void> {
  if (!storeReady()) return;
  const mail = trialStartMail(input);
  await deliverLeadAlert({
    kind: "trial_start",
    dedupeKey: input.email,
    mail,
    claim: (kind, key) => claimAlert(kind, key, { country: input.country, email: input.email }),
    send: sender(),
  });
}

export const noteTrialDemoView = createServerFn({ method: "POST" }).handler(async () => {
  try {
    if (!storeReady()) return { ok: true as const, alerted: false };
    const visitor = ensureVisitorId();
    const country = countryOf();
    const mail = demoViewMail({
      country,
      when: new Date().toISOString(),
      visitor,
    });
    const result = await deliverLeadAlert({
      kind: "demo_view",
      dedupeKey: visitor,
      mail,
      claim: (kind, key) => claimAlert(kind, key, { country }),
      send: sender(),
    });
    return { ok: true as const, alerted: result.sent };
  } catch {
    return { ok: true as const, alerted: false };
  }
});

type CallBody = {
  name?: string;
  email?: string;
  consent?: boolean;
  honeypot?: string;
  start?: string;
  timeZone?: string;
};

export const bookTrialCall = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => (input ?? {}) as CallBody)
  .handler(async ({ data }) => {
    const now = new Date();
    const gate = validateCallRequest({
      name: data.name ?? "",
      email: data.email ?? "",
      consent: data.consent === true,
      honeypot: data.honeypot ?? "",
      start: data.start ?? "",
      timeZone: data.timeZone,
      now,
    });
    if (!gate.ok) {
      if ("silent" in gate) return { ok: false as const, silent: true as const };
      return { ok: false as const, error: gate.error };
    }
    if (!storeReady())
      return { ok: false as const, error: "The sample isn't available right now." };
    const headers = requestOf()?.headers ?? new Headers();
    const ipHash = hashIp(clientIpFromHeaders(headers));
    const since = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    ).toISOString();
    const existing = await countCalls(ipHash, since);
    if (!callRateAllowed(existing)) {
      return { ok: false as const, error: "This network has already asked for three calls today." };
    }
    const country = countryOf();
    const draft: CallDraft = {
      name: gate.name,
      email: gate.email,
      country,
      start: gate.start,
      end: gate.end,
      timeZone: gate.timeZone,
      ipHash,
    };
    const arranged = await arrangeTrialCall({
      env: process.env,
      draft,
      save: insertCall,
      book: (config, active) =>
        bookGoogleMeet({
          config,
          fetchImpl: fetch,
          booking: {
            summary: `Milōn sample call — ${active.name}`,
            description: `Sample call from /try. ${active.name} <${active.email}>. Country ${active.country}.`,
            start: active.start,
            end: active.end,
            attendeeEmail: active.email,
            requestId: `${active.email}-${active.start.toISOString()}`,
          },
        }),
      send: sender(),
    });
    if (!arranged.ok) return { ok: false as const, error: arranged.error };
    if (arranged.status === "booked") {
      return { ok: true as const, status: "booked" as const, meetUrl: arranged.meetUrl };
    }
    return { ok: true as const, status: "saved" as const, meetUrl: null };
  });
