/**
 * Prospect chat and lead capture. The edge function supplies the store,
 * the model, and the existing lead-alert sender. No SECURITY DEFINER RPC.
 */
import { marketingPackForGeo } from "./geo-country.ts";
import { TAX_TALK, taxFilingAsked } from "./prospect-tax-copy.ts";
import { prospectSystem } from "./prospect-talk-prompts.ts";
import {
  PROSPECT_LEAD_ASK,
  PROSPECT_NO_BOOKS_REPLY,
  PROSPECT_NO_FILING_REPLY,
  PROSPECT_TAX_SLUG,
  assessProspectTurn,
  guardProspectReply,
  looksLikeInjection,
  mentionsFiling,
  mentionsLiveWrite,
  newProspectToken,
  prospectEmailAllowed,
  prospectLeadUtm,
  publicProspectAgent,
  sanitizeProspectUtm,
  sanitizeRef,
  scriptedProspectReply,
  sha256Hex,
  shouldAskForLead,
  validateProspectLead,
  type ProspectAgentCopy,
  type ProspectSlug,
} from "./prospect-talk.ts";
import { deliverLeadAlert, trialStartMail, type AlertKind, type Mail } from "./trial-lead-alert.ts";

export type ProspectCountry = "US" | "ZA";

export type ProspectSession = {
  id: string;
  tokenHash: string;
  agent: ProspectSlug;
  ipHash: string;
  country: ProspectCountry;
  ref: string | null;
  visitorTurns: number;
  leadEmail: string | null;
  sampleNonce: string | null;
  createdAt: string;
  expiresAt: string;
};

export type ProspectLeadRow = {
  name: string;
  email: string;
  country: ProspectCountry;
  utm: Record<string, string>;
  consentAt: string;
  sessionId: string;
  sampleNonce: string;
};

export type ProspectStore = {
  countIpTurns(ipHash: string, sinceIso: string): Promise<number>;
  countIpSessions(ipHash: string, sinceIso: string): Promise<number>;
  countGlobalTurns(sinceIso: string): Promise<number>;
  insertSession(row: ProspectSession): Promise<boolean>;
  getSession(tokenHash: string, nowIso: string): Promise<ProspectSession | null>;
  bumpTurn(sessionId: string, ipHash: string, fromTurns: number, atIso: string): Promise<boolean>;
  markLead(sessionId: string, email: string, sampleNonce: string): Promise<void>;
  countLeads(email: string): Promise<number>;
  insertLead(row: ProspectLeadRow): Promise<boolean>;
};

export type ProspectHandlerCtx = {
  now: Date;
  ip: string;
  geoCountry: string | null;
  ipSalt: string;
  store: ProspectStore;
  model: (input: { system: string; user: string }) => Promise<string | null>;
  claimAlert: (
    kind: AlertKind,
    dedupeKey: string,
    detail: { country: string; email?: string; agent?: string; ref?: string },
  ) => Promise<boolean>;
  sendAlert: (mail: Mail) => Promise<{ ok: boolean }>;
};

export type ProspectHttp = { status: number; body: Record<string, unknown> };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function countryOf(geo: string | null, requested: unknown): ProspectCountry {
  const asked = typeof requested === "string" ? requested : null;
  return marketingPackForGeo((geo ?? "").trim().toUpperCase(), asked) === "za" ? "ZA" : "US";
}

async function agentOf(
  raw: unknown,
  country: ProspectCountry,
): Promise<{ ok: true; agent: ProspectAgentCopy } | { ok: false; status: number; error: string }> {
  const slug = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const agent = publicProspectAgent(slug);
  if (agent) return { ok: true, agent };
  if (slug === PROSPECT_TAX_SLUG) {
    if (country !== "ZA") {
      return { ok: false, status: 404, error: "That agent isn't available." };
    }
    return { ok: true, agent: TAX_TALK };
  }
  return { ok: false, status: 404, error: "That link doesn't match an agent." };
}

function replyFor(input: {
  agent: ProspectAgentCopy;
  message: string;
  country: ProspectCountry;
  askLead: boolean;
  modelText: string | null;
}): string {
  if (input.agent.slug === PROSPECT_TAX_SLUG && taxFilingAsked(input.message)) {
    return TAX_TALK.filingReply;
  }
  if (mentionsFiling(input.message)) return PROSPECT_NO_FILING_REPLY;
  if (mentionsLiveWrite(input.message)) return PROSPECT_NO_BOOKS_REPLY;
  if (input.askLead) return PROSPECT_LEAD_ASK;
  const drafted = input.modelText ?? scriptedProspectReply(input.agent, false);
  return guardProspectReply(drafted, input.country, false);
}

export async function handleProspectRequest(
  body: unknown,
  ctx: ProspectHandlerCtx,
): Promise<ProspectHttp> {
  const raw = asRecord(body);
  const action = raw.action === "lead" ? "lead" : raw.action === "turn" ? "turn" : "";
  if (!action) return { status: 400, body: { ok: false, error: "Send a message." } };

  const country = countryOf(ctx.geoCountry, raw.market);
  const resolved = await agentOf(raw.agent, country);
  if (!resolved.ok) return { status: resolved.status, body: { ok: false, error: resolved.error } };
  const agent = resolved.agent;
  const ref = sanitizeRef(raw.ref);
  const ipHash = await sha256Hex(`${ctx.ipSalt}|${ctx.ip || "unknown"}`);
  const nowIso = ctx.now.toISOString();
  const token = typeof raw.sessionToken === "string" ? raw.sessionToken.trim() : "";
  const tokenHash = token ? await sha256Hex(token) : "";
  const existing = tokenHash ? await ctx.store.getSession(tokenHash, nowIso) : null;

  if (action === "lead") return submitLead(raw, ctx, { agent, country, ref, ipHash, existing });
  return takeTurn(raw, ctx, { agent, country, ref, ipHash, existing });
}

async function takeTurn(
  raw: Record<string, unknown>,
  ctx: ProspectHandlerCtx,
  scope: {
    agent: ProspectAgentCopy;
    country: ProspectCountry;
    ref: string | null;
    ipHash: string;
    existing: ProspectSession | null;
  },
): Promise<ProspectHttp> {
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  const session =
    scope.existing && scope.existing.agent === scope.agent.slug ? scope.existing : null;
  const isNew = !session;
  const hourAgo = new Date(ctx.now.getTime() - HOUR_MS).toISOString();
  const dayStart = startOfUtcDay(ctx.now).toISOString();
  const [ipTurns, ipSessions, globalTurns] = await Promise.all([
    ctx.store.countIpTurns(scope.ipHash, hourAgo),
    ctx.store.countIpSessions(scope.ipHash, dayStart),
    ctx.store.countGlobalTurns(dayStart),
  ]);
  const gate = assessProspectTurn({
    messageLength: message.length,
    sessionTurns: session?.visitorTurns ?? 0,
    ipTurnsLastHour: ipTurns,
    ipSessionsToday: ipSessions,
    isNewSession: isNew,
    globalTurnsToday: globalTurns,
  });
  if (!gate.ok) return { status: gate.status, body: { ok: false, error: gate.error } };

  let active = session;
  let sessionToken = typeof raw.sessionToken === "string" ? raw.sessionToken.trim() : "";
  if (!active) {
    sessionToken = newProspectToken();
    const createdAt = ctx.now.toISOString();
    active = {
      id: crypto.randomUUID(),
      tokenHash: await sha256Hex(sessionToken),
      agent: scope.agent.slug,
      ipHash: scope.ipHash,
      country: scope.country,
      ref: scope.ref,
      visitorTurns: 0,
      leadEmail: null,
      sampleNonce: null,
      createdAt,
      expiresAt: new Date(ctx.now.getTime() + DAY_MS).toISOString(),
    };
    const saved = await ctx.store.insertSession(active);
    if (!saved) {
      return {
        status: 503,
        body: { ok: false, error: "The conversation isn't available right now." },
      };
    }
  }

  const fromTurns = active.visitorTurns;
  const bumped = await ctx.store.bumpTurn(
    active.id,
    scope.ipHash,
    fromTurns,
    ctx.now.toISOString(),
  );
  if (!bumped) {
    return { status: 429, body: { ok: false, error: "Send that once more." } };
  }
  const visitorTurns = fromTurns + 1;
  const askLead = shouldAskForLead(visitorTurns);
  const injected = looksLikeInjection(message);
  let modelText: string | null = null;
  if (!askLead && !injected && scope.agent.slug !== PROSPECT_TAX_SLUG) {
    try {
      modelText = await ctx.model({
        system: prospectSystem(scope.agent.slug, scope.country),
        user: message,
      });
    } catch {
      modelText = null;
    }
  }
  if (!askLead && !injected && scope.agent.slug === PROSPECT_TAX_SLUG && !taxFilingAsked(message)) {
    try {
      modelText = await ctx.model({
        system: prospectSystem(PROSPECT_TAX_SLUG, scope.country),
        user: message,
      });
    } catch {
      modelText = null;
    }
  }
  const reply = injected
    ? guardProspectReply("I can only talk about the sample on this page.", scope.country, false)
    : replyFor({
        agent: scope.agent,
        message,
        country: scope.country,
        askLead,
        modelText,
      });
  const refusal =
    reply === PROSPECT_NO_FILING_REPLY ||
    reply === PROSPECT_NO_BOOKS_REPLY ||
    reply === TAX_TALK.filingReply;
  const spoken = askLead && !injected && !refusal ? PROSPECT_LEAD_ASK : reply;
  return {
    status: 200,
    body: {
      ok: true,
      sessionToken,
      reply: spoken,
      askLead,
      visitorTurns,
      country: scope.country,
    },
  };
}

async function submitLead(
  raw: Record<string, unknown>,
  ctx: ProspectHandlerCtx,
  scope: {
    agent: ProspectAgentCopy;
    country: ProspectCountry;
    ref: string | null;
    ipHash: string;
    existing: ProspectSession | null;
  },
): Promise<ProspectHttp> {
  const session = scope.existing;
  if (!session || session.agent !== scope.agent.slug) {
    return { status: 400, body: { ok: false, error: "Start the conversation again." } };
  }
  if (!shouldAskForLead(session.visitorTurns)) {
    return { status: 400, body: { ok: false, error: "Tell me a little more first." } };
  }
  if (session.leadEmail) {
    return { status: 200, body: { ok: true, already: true, sampleNonce: session.sampleNonce } };
  }

  const gate = validateProspectLead({
    name: typeof raw.name === "string" ? raw.name : "",
    email: typeof raw.email === "string" ? raw.email : "",
    consent: raw.consent === true,
    honeypot: typeof raw.milon_leave_blank === "string" ? raw.milon_leave_blank : "",
  });
  if (!gate.ok) {
    if ("silent" in gate) return { status: 200, body: { ok: false, silent: true } };
    return { status: 400, body: { ok: false, error: gate.error } };
  }
  const leads = await ctx.store.countLeads(gate.email);
  if (!prospectEmailAllowed(leads)) {
    return {
      status: 400,
      body: { ok: false, error: "That email has already opened two samples." },
    };
  }
  const utm = prospectLeadUtm({
    agent: scope.agent.slug,
    ref: scope.ref ?? session.ref,
    utm: sanitizeProspectUtm(raw.utm),
  });
  const sampleNonce = newProspectToken();
  const saved = await ctx.store.insertLead({
    name: gate.name,
    email: gate.email,
    country: session.country,
    utm,
    consentAt: ctx.now.toISOString(),
    sessionId: session.id,
    sampleNonce,
  });
  if (!saved) {
    return { status: 503, body: { ok: false, error: "The sample isn't available right now." } };
  }
  await ctx.store.markLead(session.id, gate.email, sampleNonce);
  try {
    const mail = trialStartMail({
      name: gate.name,
      email: gate.email,
      country: session.country,
      agent: scope.agent.slug,
      ref: utm.ref,
    });
    await deliverLeadAlert({
      kind: "trial_start",
      dedupeKey: gate.email,
      mail,
      claim: (kind, key) =>
        ctx.claimAlert(kind, key, {
          country: session.country,
          email: gate.email,
          agent: scope.agent.slug,
          ref: utm.ref,
        }),
      send: ctx.sendAlert,
    });
  } catch {
    /* The sample still opens when the alert cannot be sent. */
  }
  return { status: 200, body: { ok: true, sampleNonce } };
}

export function createMemoryProspectStore(): {
  store: ProspectStore;
  leads: ProspectLeadRow[];
  sessions: ProspectSession[];
} {
  const sessions: ProspectSession[] = [];
  const turns: { sessionId: string; ipHash: string; createdAt: string }[] = [];
  const leads: ProspectLeadRow[] = [];
  const store: ProspectStore = {
    async countIpTurns(ipHash, sinceIso) {
      return turns.filter((row) => row.ipHash === ipHash && row.createdAt >= sinceIso).length;
    },
    async countIpSessions(ipHash, sinceIso) {
      return sessions.filter((row) => row.ipHash === ipHash && row.createdAt >= sinceIso).length;
    },
    async countGlobalTurns(sinceIso) {
      return turns.filter((row) => row.createdAt >= sinceIso).length;
    },
    async insertSession(row) {
      sessions.push(row);
      return true;
    },
    async getSession(tokenHash, nowIso) {
      return sessions.find((row) => row.tokenHash === tokenHash && row.expiresAt > nowIso) ?? null;
    },
    async bumpTurn(sessionId, ipHash, fromTurns, atIso) {
      const row = sessions.find((item) => item.id === sessionId);
      if (!row || row.visitorTurns !== fromTurns) return false;
      row.visitorTurns += 1;
      turns.push({ sessionId, ipHash, createdAt: atIso });
      return true;
    },
    async markLead(sessionId, email, sampleNonce) {
      const row = sessions.find((item) => item.id === sessionId);
      if (row) {
        row.leadEmail = email;
        row.sampleNonce = sampleNonce;
      }
    },
    async countLeads(email) {
      return leads.filter((row) => row.email === email).length;
    },
    async insertLead(row) {
      leads.push(row);
      return true;
    },
  };
  return { store, leads, sessions };
}
