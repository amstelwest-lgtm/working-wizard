/**
 * Milōn Lighthouse — founder lead-generation and outreach engine.
 *
 * Funnel: sourced → researched → contacted → replied → meeting → trial →
 * activated → won. Every touch is AI-drafted, owner-approved, then sent via
 * Resend. The last CTA in every sequence is the tracked free-trial link, so
 * the funnel always terminates at a Milōn signup.
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
import { callClaudeMessages } from "@/lib/claude-messages";
import { applyLighthouseOptOut } from "@/lib/lighthouse-optout.server";

const MIGRATION = "20260820100000_milon_lighthouse.sql";
const ENGAGEMENT_MIGRATION = "20260822210000_lighthouse_engagement.sql";

export const LIGHTHOUSE_STAGES = [
  "sourced",
  "researched",
  "contacted",
  "replied",
  "meeting",
  "trial",
  "activated",
  "won",
  "lost",
  "nurture",
] as const;

export type LighthouseStage = (typeof LIGHTHOUSE_STAGES)[number];

export const STAGE_LABELS: Record<LighthouseStage, string> = {
  sourced: "Sourced",
  researched: "Researched",
  contacted: "In sequence",
  replied: "Replied",
  meeting: "Meeting set",
  trial: "Free trial",
  activated: "Activated",
  won: "Paying",
  lost: "Lost",
  nurture: "Nurture",
};

export type LighthouseLead = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  roleTitle: string | null;
  city: string | null;
  persona: "owner" | "accountant";
  stage: LighthouseStage;
  signal: string | null;
  notes: string | null;
  sequenceKey: string;
  sequenceStep: number;
  nextTouchOn: string | null;
  lastTouchAt: string | null;
  repliedAt: string | null;
  meetingAt: string | null;
  trialToken: string | null;
  trialLink: string | null;
  trialClickedAt: string | null;
  trialSignedUpAt: string | null;
  doNotContact: boolean;
  optOutLink: string | null;
  optedOutAt: string | null;
  lastClickedAt: string | null;
  lastClickedUrl: string | null;
  lastInboundAt: string | null;
  inbound: LighthouseInbound[];
  createdAt: string;
  touches: LighthouseTouch[];
};

export type LighthouseInbound = {
  id: string;
  fromEmail: string;
  subject: string | null;
  body: string | null;
  receivedAt: string;
};

export type LighthouseTouch = {
  id: string;
  stepNo: number;
  angle: string | null;
  subject: string | null;
  body: string | null;
  status: string;
  scheduledFor: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  clickedAt: string | null;
  lastClickedUrl: string | null;
  error: string | null;
};

export type LighthouseStep = {
  step: number;
  day: number;
  angle: string;
  goal: string;
  max_words: number;
  cta: string;
  asset: string | null;
  /** Linked only when the primary asset is still a placeholder. */
  asset_fallback?: string | null;
};

export type LighthouseSequence = {
  key: string;
  name: string;
  persona: "owner" | "accountant";
  steps: LighthouseStep[];
  active: boolean;
};

export type LighthouseAsset = {
  key: string;
  kind: string;
  title: string;
  purpose: string | null;
  usedInStep: number | null;
  usedIn: string | null;
  persona: string;
  url: string | null;
  status: "placeholder" | "in_progress" | "ready";
};

export type LighthouseSettings = {
  senderName: string;
  senderTitle: string;
  trialDays: number;
  dailySendCap: number;
  bookingUrl: string;
  sendWindow: string;
  autoSend: boolean;
  /** Postal or physical address shown in the cold-email footer. */
  senderAddress: string;
  /** Mailbox replies actually land in; falls back to the from address. */
  replyTo: string;
};

export type LighthouseDashboard = {
  leads: LighthouseLead[];
  stageCounts: Record<string, number>;
  sequences: LighthouseSequence[];
  assets: LighthouseAsset[];
  settings: LighthouseSettings;
  dueToday: { leadId: string; leadName: string; stepNo: number }[];
  funnel: {
    sourced: number;
    contacted: number;
    replied: number;
    meeting: number;
    trial: number;
    won: number;
    replyRatePct: number | null;
    trialRatePct: number | null;
  };
  capability: {
    aiConfigured: boolean;
    emailConfigured: boolean;
    siteUrl: string;
  };
  /** Sends already counted toward today's daily_send_cap (SAST calendar day). */
  sentToday: number;
  migrationHint: string | null;
};

const DEFAULT_SETTINGS: LighthouseSettings = {
  senderName: "Theo van der Westhuizen",
  senderTitle: "Founder, Milōn",
  trialDays: 14,
  dailySendCap: 25,
  bookingUrl: "",
  sendWindow: "Tue-Thu 07:00-09:00 SAST",
  autoSend: false,
  senderAddress: "",
  replyTo: "",
};

function siteUrl(): string {
  return (process.env.SITE_URL || process.env.VITE_APP_URL || "https://milon.co.za").replace(
    /\/$/,
    "",
  );
}

export function trialLinkFor(token: string | null): string | null {
  if (!token) return null;
  return `${siteUrl()}/?lh=${token}#register`;
}

export function optOutLinkFor(token: string | null): string | null {
  if (!token) return null;
  return `${siteUrl()}/unsubscribe?lh=${token}`;
}

/** One-click target for the List-Unsubscribe header (RFC 8058). */
function oneClickOptOutFor(token: string): string {
  return `${siteUrl()}/lh/unsubscribe?t=${token}`;
}

const FOOTER_MARK = "—\nYou are receiving this because";

/**
 * Cold mail needs an identifiable sender and a working way out. The footer is
 * appended at send time rather than being drafted, so it cannot be edited away
 * by accident and never eats into the model's word budget.
 */
function complianceFooter(opts: {
  company: string | null;
  optOutLink: string;
  senderName: string;
  senderAddress: string;
}): string {
  const who = opts.company ? ` while researching South African businesses` : "";
  const address = opts.senderAddress.trim();
  return [
    "—",
    `You are receiving this because I came across ${opts.company || "your business"}${who} for Milōn, and I sent it myself.`,
    `If it is not for you, unsubscribe here and I will not contact you again: ${opts.optOutLink}`,
    address ? `Milōn · ${opts.senderName} · ${address}` : `Milōn · ${opts.senderName}`,
  ].join("\n");
}

function withComplianceFooter(body: string, footer: string): string {
  if (body.includes(FOOTER_MARK) || body.includes("/unsubscribe?lh=")) return body;
  return `${body.trimEnd()}\n\n${footer}`;
}

function sastDayBounds(now = new Date()): { startIso: string; endIso: string; label: string } {
  // Cap is a calendar day in South Africa, not UTC midnight.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const label = fmt.format(now); // YYYY-MM-DD
  // Convert SAST midnight ↔ next midnight into UTC ISO.
  const startIso = new Date(`${label}T00:00:00+02:00`).toISOString();
  const endLocal = new Date(`${label}T00:00:00+02:00`);
  endLocal.setUTCDate(endLocal.getUTCDate() + 1);
  const endIso = endLocal.toISOString();
  return { startIso, endIso, label };
}

async function countSentToday(admin: ReturnType<typeof adminLoose>): Promise<number> {
  const { startIso, endIso } = sastDayBounds();
  const { count, error } = await admin
    .from("lighthouse_touches")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("sent_at", startIso)
    .lt("sent_at", endIso);
  if (error) {
    // Fail closed on the cap check — better to block a send than blow past it.
    throw new Error(`Could not check today's send count: ${error.message}`);
  }
  return count ?? 0;
}

function parseDraftJson(raw: string): { subject: string; body: string } | null {
  const attempt = (text: string) => {
    const parsed = JSON.parse(text) as { subject?: string; body?: string };
    const subject = String(parsed.subject ?? "").trim();
    const body = String(parsed.body ?? "").trim();
    return subject && body ? { subject, body } : null;
  };

  try {
    return attempt(
      raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim(),
    );
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return attempt(match[0]);
    } catch {
      return null;
    }
  }
}

/** Assets may be stored as in-app paths ("/faq") or full external URLs. */
function absoluteUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${siteUrl()}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

type AssetLike = { key: string; title: string; url: string };

/**
 * Walk a preference list of asset keys and return the first that is genuinely
 * ready — status flipped and a URL filled in. Anything still a placeholder is
 * skipped, which is what keeps drafts from linking to work that does not exist.
 */
async function firstReadyAsset(
  admin: ReturnType<typeof adminLoose>,
  keys: Array<string | null>,
): Promise<AssetLike | null> {
  const wanted = keys.filter((k): k is string => Boolean(k));
  if (!wanted.length) return null;

  const { data } = await admin
    .from("lighthouse_assets")
    .select("key, title, url, status")
    .in("key", wanted);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  for (const key of wanted) {
    const row = rows.find((r) => String(r.key) === key);
    const url = String(row?.url ?? "").trim();
    if (row && row.status === "ready" && url) {
      return { key, title: String(row.title ?? key), url: absoluteUrl(url) };
    }
  }
  return null;
}

/**
 * The console offers a booking link in two places — Settings and the
 * `booking_link` asset. Settings wins, but a ready asset is honoured so that
 * filling in the slot is never a silent no-op.
 */
async function resolveBookingUrl(
  admin: ReturnType<typeof adminLoose>,
  settingsRaw: Record<string, unknown>,
): Promise<string> {
  const fromSettings = String(settingsRaw.booking_url ?? "").trim();
  if (fromSettings) return absoluteUrl(fromSettings);
  const asset = await firstReadyAsset(admin, ["booking_link"]);
  return asset?.url ?? "";
}

function randomToken(bytes = 12): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");
}

function addDays(from: Date, days: number): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function mapLead(row: Record<string, unknown>, touches: LighthouseTouch[]): LighthouseLead {
  const token = (row.trial_token as string | null) ?? null;
  return {
    id: String(row.id),
    name: (row.name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    roleTitle: (row.role_title as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    persona: (row.persona as string) === "accountant" ? "accountant" : "owner",
    stage: LIGHTHOUSE_STAGES.includes(row.stage as LighthouseStage)
      ? (row.stage as LighthouseStage)
      : "sourced",
    signal: (row.signal as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    sequenceKey: String(row.sequence_key ?? "owner_v1"),
    sequenceStep: Number(row.sequence_step ?? 0),
    nextTouchOn: (row.next_touch_on as string | null) ?? null,
    lastTouchAt: (row.last_touch_at as string | null) ?? null,
    repliedAt: (row.replied_at as string | null) ?? null,
    meetingAt: (row.meeting_at as string | null) ?? null,
    trialToken: token,
    trialLink: trialLinkFor(token),
    trialClickedAt: (row.trial_clicked_at as string | null) ?? null,
    trialSignedUpAt: (row.trial_signed_up_at as string | null) ?? null,
    doNotContact: Boolean(row.do_not_contact),
    optOutLink: optOutLinkFor((row.optout_token as string | null) ?? null),
    optedOutAt: (row.optout_at as string | null) ?? null,
    lastClickedAt: (row.last_clicked_at as string | null) ?? null,
    lastClickedUrl: (row.last_clicked_url as string | null) ?? null,
    lastInboundAt: (row.last_inbound_at as string | null) ?? null,
    inbound: [],
    createdAt: String(row.created_at ?? ""),
    touches,
  };
}

export const getLighthouse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();

    const capability = {
      aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      emailConfigured: Boolean(process.env.RESEND_API_KEY),
      siteUrl: siteUrl(),
    };

    const { data: leadRows, error: leadErr } = await admin
      .from("milon_ops_leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(400);

    if (leadErr && missingRelation(leadErr.message ?? "")) {
      const empty: LighthouseDashboard = {
        leads: [],
        stageCounts: {},
        sequences: [],
        assets: [],
        settings: DEFAULT_SETTINGS,
        dueToday: [],
        funnel: {
          sourced: 0,
          contacted: 0,
          replied: 0,
          meeting: 0,
          trial: 0,
          won: 0,
          replyRatePct: null,
          trialRatePct: null,
        },
        capability,
        sentToday: 0,
        migrationHint: migrationHintFor(MIGRATION),
      };
      return empty;
    }
    if (leadErr) throw new Error(leadErr.message);

    const rows = (leadRows ?? []) as Array<Record<string, unknown>>;
    const ids = rows.map((r) => String(r.id));

    const touchesByLead = new Map<string, LighthouseTouch[]>();
    let migrationHint: string | null = null;
    if (ids.length) {
      const { data: touchRows, error: touchErr } = await admin
        .from("lighthouse_touches")
        .select("*")
        .order("step_no", { ascending: true })
        .limit(2000);
      if (touchErr && missingRelation(touchErr.message ?? "")) {
        migrationHint = migrationHintFor(MIGRATION);
      } else if (touchRows) {
        for (const t of touchRows as Array<Record<string, unknown>>) {
          const leadId = String(t.lead_id);
          const list = touchesByLead.get(leadId) ?? [];
          list.push({
            id: String(t.id),
            stepNo: Number(t.step_no ?? 1),
            angle: (t.angle as string | null) ?? null,
            subject: (t.subject as string | null) ?? null,
            body: (t.body as string | null) ?? null,
            status: String(t.status ?? "draft"),
            scheduledFor: (t.scheduled_for as string | null) ?? null,
            sentAt: (t.sent_at as string | null) ?? null,
            deliveredAt: (t.delivered_at as string | null) ?? null,
            clickedAt: (t.clicked_at as string | null) ?? null,
            lastClickedUrl: (t.last_clicked_url as string | null) ?? null,
            error: (t.error as string | null) ?? null,
          });
          touchesByLead.set(leadId, list);
        }
      }
    }

    const leads = rows.map((r) => mapLead(r, touchesByLead.get(String(r.id)) ?? []));

    if (ids.length) {
      const { data: inboundRows, error: inboundErr } = await admin
        .from("lighthouse_inbound")
        .select("id, lead_id, from_email, subject, body, received_at")
        .order("received_at", { ascending: false })
        .limit(400);
      if (inboundErr && missingRelation(inboundErr.message ?? "")) {
        migrationHint = migrationHint ?? migrationHintFor(ENGAGEMENT_MIGRATION);
      } else if (inboundRows) {
        const inboundByLead = new Map<string, LighthouseInbound[]>();
        for (const row of inboundRows as Array<Record<string, unknown>>) {
          const leadId = String(row.lead_id ?? "");
          const list = inboundByLead.get(leadId) ?? [];
          list.push({
            id: String(row.id),
            fromEmail: String(row.from_email ?? ""),
            subject: (row.subject as string | null) ?? null,
            body: (row.body as string | null) ?? null,
            receivedAt: String(row.received_at ?? ""),
          });
          inboundByLead.set(leadId, list);
        }
        for (const lead of leads) {
          lead.inbound = inboundByLead.get(lead.id) ?? [];
        }
      }
    }

    const stageCounts: Record<string, number> = {};
    for (const s of LIGHTHOUSE_STAGES) stageCounts[s] = 0;
    for (const l of leads) stageCounts[l.stage] = (stageCounts[l.stage] ?? 0) + 1;

    const contactedPlus = leads.filter((l) =>
      ["contacted", "replied", "meeting", "trial", "activated", "won"].includes(l.stage),
    ).length;
    const repliedPlus = leads.filter((l) =>
      ["replied", "meeting", "trial", "activated", "won"].includes(l.stage),
    ).length;
    const trialPlus = leads.filter((l) => ["trial", "activated", "won"].includes(l.stage)).length;

    let sequences: LighthouseSequence[] = [];
    const { data: seqRows } = await admin.from("lighthouse_sequences").select("*");
    if (seqRows) {
      sequences = (seqRows as Array<Record<string, unknown>>).map((s) => ({
        key: String(s.key),
        name: String(s.name ?? s.key),
        persona: (s.persona as string) === "accountant" ? "accountant" : "owner",
        steps: Array.isArray(s.steps) ? (s.steps as LighthouseStep[]) : [],
        active: Boolean(s.active ?? true),
      }));
    } else if (!migrationHint) {
      migrationHint = migrationHintFor(MIGRATION);
    }

    let assets: LighthouseAsset[] = [];
    const { data: assetRows } = await admin
      .from("lighthouse_assets")
      .select("*")
      .order("used_in_step", { ascending: true });
    if (assetRows) {
      assets = (assetRows as Array<Record<string, unknown>>).map((a) => ({
        key: String(a.key),
        kind: String(a.kind ?? "video"),
        title: String(a.title ?? a.key),
        purpose: (a.purpose as string | null) ?? null,
        usedInStep: a.used_in_step == null ? null : Number(a.used_in_step),
        usedIn: (a.used_in as string | null) ?? null,
        persona: String(a.persona ?? "both"),
        url: (a.url as string | null) ?? null,
        status: String(a.status ?? "placeholder") as LighthouseAsset["status"],
      }));
    }

    let settings = { ...DEFAULT_SETTINGS };
    const { data: setRows } = await admin
      .from("milon_ops_settings")
      .select("key, value")
      .eq("key", "lighthouse")
      .maybeSingle();
    const raw = (setRows as { value?: Record<string, unknown> } | null)?.value;
    if (raw && typeof raw === "object") {
      settings = {
        senderName: String(raw.sender_name ?? settings.senderName),
        senderTitle: String(raw.sender_title ?? settings.senderTitle),
        trialDays: Number(raw.trial_days ?? settings.trialDays),
        dailySendCap: Number(raw.daily_send_cap ?? settings.dailySendCap),
        bookingUrl: String(raw.booking_url ?? ""),
        sendWindow: String(raw.send_window ?? settings.sendWindow),
        autoSend: Boolean(raw.auto_send ?? false),
        senderAddress: String(raw.sender_address ?? ""),
        replyTo: String(raw.reply_to ?? ""),
      };
    }

    const today = new Date().toISOString().slice(0, 10);
    const dueToday = leads
      .filter(
        (l) =>
          !l.doNotContact &&
          l.nextTouchOn != null &&
          l.nextTouchOn <= today &&
          !["won", "lost", "trial", "activated"].includes(l.stage),
      )
      .map((l) => ({
        leadId: l.id,
        leadName: l.name || l.company || l.email || "Unnamed",
        stepNo: Math.min(l.sequenceStep + 1, 5),
      }));

    let sentToday = 0;
    try {
      sentToday = await countSentToday(admin);
    } catch {
      sentToday = 0;
    }

    const dash: LighthouseDashboard = {
      leads,
      stageCounts,
      sequences,
      assets,
      settings,
      dueToday,
      funnel: {
        sourced: leads.length,
        contacted: contactedPlus,
        replied: repliedPlus,
        meeting: leads.filter((l) => ["meeting", "trial", "activated", "won"].includes(l.stage))
          .length,
        trial: trialPlus,
        won: stageCounts.won ?? 0,
        replyRatePct: contactedPlus ? Math.round((repliedPlus / contactedPlus) * 1000) / 10 : null,
        trialRatePct: contactedPlus ? Math.round((trialPlus / contactedPlus) * 1000) / 10 : null,
      },
      capability,
      sentToday,
      migrationHint,
    };
    return dash;
  });

export const upsertLighthouseLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().max(200).optional(),
        email: z.string().max(200).optional(),
        company: z.string().max(200).optional(),
        roleTitle: z.string().max(200).optional(),
        city: z.string().max(120).optional(),
        persona: z.enum(["owner", "accountant"]).optional(),
        stage: z.enum(LIGHTHOUSE_STAGES).optional(),
        signal: z.string().max(1000).optional(),
        notes: z.string().max(4000).optional(),
        meetingAt: z.string().max(40).optional(),
        doNotContact: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();

    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name.trim() || null;
    if (data.email !== undefined) patch.email = data.email.trim().toLowerCase() || null;
    if (data.company !== undefined) patch.company = data.company.trim() || null;
    if (data.roleTitle !== undefined) patch.role_title = data.roleTitle.trim() || null;
    if (data.city !== undefined) patch.city = data.city.trim() || null;
    if (data.signal !== undefined) patch.signal = data.signal.trim() || null;
    if (data.notes !== undefined) patch.notes = data.notes.trim() || null;
    if (data.doNotContact !== undefined) patch.do_not_contact = data.doNotContact;
    if (data.meetingAt !== undefined) {
      patch.meeting_at = data.meetingAt ? new Date(data.meetingAt).toISOString() : null;
    }
    if (data.persona) {
      patch.persona = data.persona;
      patch.sequence_key = data.persona === "accountant" ? "accountant_v1" : "owner_v1";
    }
    if (data.stage) {
      patch.stage = data.stage;
      if (data.stage === "replied") patch.replied_at = new Date().toISOString();
      if (data.stage === "trial") patch.trial_signed_up_at = new Date().toISOString();
    }

    if (data.id) {
      const { error } = await admin.from("milon_ops_leads").update(patch).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }

    patch.trial_token = randomToken();
    patch.stage = patch.stage ?? "sourced";
    patch.source = "lighthouse";
    const { data: inserted, error } = await admin
      .from("milon_ops_leads")
      .insert(patch)
      .select("id")
      .maybeSingle();
    if (error) {
      if (missingRelation(error.message)) throw new Error(migrationHintFor(MIGRATION));
      throw new Error(error.message);
    }
    return { id: String((inserted as { id?: string } | null)?.id ?? "") };
  });

/** Paste lines of "name, email, company, signal" — one lead per line. */
export const importLighthouseLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        text: z.string().min(1).max(20000),
        persona: z.enum(["owner", "accountant"]).default("owner"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();

    const rows = data.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((line) => {
        const [name, email, company, signal] = line.split(/\s*[,;\t]\s*/);
        return {
          name: name?.trim() || null,
          email: email?.trim().toLowerCase() || null,
          company: company?.trim() || null,
          signal: signal?.trim() || null,
          persona: data.persona,
          sequence_key: data.persona === "accountant" ? "accountant_v1" : "owner_v1",
          stage: "sourced",
          source: "lighthouse_import",
          trial_token: randomToken(),
        };
      })
      .filter((r) => r.name || r.email);

    if (!rows.length) return { imported: 0 };

    const { error } = await admin.from("milon_ops_leads").insert(rows);
    if (error) {
      if (missingRelation(error.message)) throw new Error(migrationHintFor(MIGRATION));
      throw new Error(error.message);
    }
    return { imported: rows.length };
  });

const SYSTEM_RULES = `You write cold outreach for Milōn, a South African financial-health platform for SMEs and their accountants.

Non-negotiable rules:
- Truth only. Never invent client names, results, percentages, awards, or peer benchmarks.
- If you have no proof point, use a hypothesis framed as a question instead of a fake stat.
- Plain text, no HTML, no markdown, no emoji, no exclamation marks.
- South African English and context (SARS, VAT, load-shedding, ZAR) when relevant.
- One clear ask per email. No stacked CTAs.
- Never say "just following up" or "circling back" with nothing new.
- Sound like one founder writing to one person, not a marketing department.
- Subject lines: lowercase or sentence case, under 6 words, no clickbait, no "Re:" fakery.`;

export const draftLighthouseTouch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        leadId: z.string().uuid(),
        stepNo: z.number().int().min(1).max(8),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();

    const { data: leadRow, error: leadErr } = await admin
      .from("milon_ops_leads")
      .select("*")
      .eq("id", data.leadId)
      .maybeSingle();
    if (leadErr) throw new Error(leadErr.message);
    if (!leadRow) throw new Error("Lead not found");
    const lead = leadRow as Record<string, unknown>;
    if (lead.do_not_contact) {
      throw new Error("This lead has unsubscribed — drafting is disabled for them.");
    }

    const seqKey = String(lead.sequence_key ?? "owner_v1");
    const { data: seqRow } = await admin
      .from("lighthouse_sequences")
      .select("*")
      .eq("key", seqKey)
      .maybeSingle();
    const steps = Array.isArray((seqRow as { steps?: unknown } | null)?.steps)
      ? (seqRow as { steps: LighthouseStep[] }).steps
      : [];
    const step = steps.find((s) => s.step === data.stepNo);
    if (!step) throw new Error(`Step ${data.stepNo} is not defined for ${seqKey}`);

    // Primary asset first, then the fallback slot. Only when neither is ready
    // does the copy degrade to describing the point without a link.
    const readyAsset = await firstReadyAsset(admin, [step.asset, step.asset_fallback ?? null]);
    const assetUrl = readyAsset?.url ?? null;

    const { data: setRow } = await admin
      .from("milon_ops_settings")
      .select("value")
      .eq("key", "lighthouse")
      .maybeSingle();
    const settingsRaw = (setRow as { value?: Record<string, unknown> } | null)?.value ?? {};
    const senderName = String(settingsRaw.sender_name ?? DEFAULT_SETTINGS.senderName);
    const senderTitle = String(settingsRaw.sender_title ?? DEFAULT_SETTINGS.senderTitle);
    const trialDays = Number(settingsRaw.trial_days ?? DEFAULT_SETTINGS.trialDays);
    const bookingUrl = await resolveBookingUrl(admin, settingsRaw);

    const trialLink = trialLinkFor((lead.trial_token as string | null) ?? null);

    // Previous touches so the model does not repeat an angle already used.
    const { data: priorRows } = await admin
      .from("lighthouse_touches")
      .select("step_no, angle, subject, body")
      .eq("lead_id", data.leadId);
    const prior = ((priorRows ?? []) as Array<Record<string, unknown>>)
      .filter((p) => Number(p.step_no) < data.stepNo)
      .map((p) => `Step ${p.step_no} (${p.angle}): ${p.subject}\n${p.body}`)
      .join("\n\n---\n\n");

    const persona = String(lead.persona ?? "owner");
    const personaBrief =
      persona === "accountant"
        ? "The recipient runs or works in an accounting/advisory practice in South Africa. Their pain is advisory work that does not scale across a client book, and clients who only hear from them at year-end."
        : "The recipient owns a South African small or medium business. Their pain is not knowing their real cash runway or which lever to pull next, and only seeing numbers months late.";

    const ctaBrief =
      step.cta === "start_trial"
        ? `Ask them to start the free ${trialDays}-day trial using exactly this link: ${trialLink ?? "(link pending)"}`
        : step.cta === "reply_interest"
          ? "Ask for a one-word reply only. Do not include any link."
          : step.cta === "watch_60s" || step.cta === "watch_walkthrough"
            ? assetUrl
              ? `Point to exactly this link and nothing else: ${assetUrl}`
              : "The video is not produced yet, so describe the insight in one sentence instead of linking to anything."
            : step.cta === "read_case"
              ? assetUrl
                ? `Point to exactly this link and nothing else: ${assetUrl}`
                : "There is no published case study yet, so use an honest first-pilot framing without linking."
              : "Close with a simple, low-pressure question.";

    const prompt = `${SYSTEM_RULES}

PROSPECT
Name: ${lead.name ?? "unknown"}
Company: ${lead.company ?? "unknown"}
Role: ${lead.role_title ?? "unknown"}
City: ${lead.city ?? "unknown"}
Persona: ${persona}
Observed signal (the specific, true reason we are reaching out): ${lead.signal ?? "none recorded"}
Notes: ${lead.notes ?? "none"}

${personaBrief}

THIS EMAIL
Sequence: ${seqKey}, step ${step.step} of 5, sent day ${step.day}.
Angle: ${step.angle}
Goal: ${step.goal}
Hard limit: ${step.max_words} words in the body.
Call to action: ${ctaBrief}

${prior ? `ALREADY SENT TO THIS PERSON (do not repeat these angles or openings):\n\n${prior}` : "This is the first message to this person."}

SIGN OFF as ${senderName}, ${senderTitle}.
${bookingUrl ? `If they ask to talk, the booking link is ${bookingUrl}.` : ""}

Return ONLY JSON: {"subject": "...", "body": "..."}
The body must be plain text with line breaks, already signed off, ready to send.`;

    const raw = await callClaudeMessages({
      content: [{ type: "text", text: prompt }],
      maxTokens: 1200,
    });

    const draft = parseDraftJson(raw);
    if (!draft) throw new Error("Claude returned an unusable draft — try again.");
    const { subject, body } = draft;

    const scheduledFor = addDays(new Date(), 0);

    const { data: existing } = await admin
      .from("lighthouse_touches")
      .select("id")
      .eq("lead_id", data.leadId)
      .eq("step_no", data.stepNo)
      .maybeSingle();

    if (existing && (existing as { id?: string }).id) {
      const { error } = await admin
        .from("lighthouse_touches")
        .update({ subject, body, angle: step.angle, status: "draft", error: null })
        .eq("id", (existing as { id: string }).id);
      if (error) throw new Error(error.message);
      return { subject, body, touchId: (existing as { id: string }).id };
    }

    const { data: inserted, error } = await admin
      .from("lighthouse_touches")
      .insert({
        lead_id: data.leadId,
        step_no: data.stepNo,
        angle: step.angle,
        subject,
        body,
        status: "draft",
        scheduled_for: scheduledFor,
        created_by: userId,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      if (missingRelation(error.message)) throw new Error(migrationHintFor(MIGRATION));
      throw new Error(error.message);
    }
    return { subject, body, touchId: String((inserted as { id?: string } | null)?.id ?? "") };
  });

export const sendLighthouseTouch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        touchId: z.string().uuid(),
        subject: z.string().min(1).max(300),
        body: z.string().min(1).max(20000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();

    const { data: touchRow, error: tErr } = await admin
      .from("lighthouse_touches")
      .select("*")
      .eq("id", data.touchId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!touchRow) throw new Error("Touch not found");
    const touch = touchRow as Record<string, unknown>;

    const { data: leadRow } = await admin
      .from("milon_ops_leads")
      .select("*")
      .eq("id", String(touch.lead_id))
      .maybeSingle();
    const lead = leadRow as Record<string, unknown> | null;
    const to = (lead?.email as string | null) ?? "";
    if (!to || !to.includes("@")) throw new Error("Lead has no email address.");
    if (lead?.do_not_contact) throw new Error("Lead is marked do-not-contact.");

    // Fail closed against the platform-wide suppression list: someone who
    // unsubscribed from any Milōn email must not receive cold outreach either.
    const { data: suppressed, error: suppErr } = await admin
      .from("suppressed_emails")
      .select("email")
      .eq("email", to.toLowerCase())
      .maybeSingle();
    if (suppErr && !missingRelation(suppErr.message ?? "")) {
      throw new Error("Could not verify the suppression list, so nothing was sent.");
    }
    if (suppressed) {
      await admin
        .from("lighthouse_touches")
        .update({ status: "skipped", error: "Recipient is on the suppression list." })
        .eq("id", data.touchId);
      await admin
        .from("milon_ops_leads")
        .update({ do_not_contact: true, next_touch_on: null })
        .eq("id", String(touch.lead_id));
      throw new Error("This address is on the suppression list — nothing was sent.");
    }

    // Every cold send carries a sender identity and a working way out.
    let optOutToken = String(lead?.optout_token ?? "").trim();
    if (!optOutToken) {
      optOutToken = randomToken();
      await admin
        .from("milon_ops_leads")
        .update({ optout_token: optOutToken })
        .eq("id", String(touch.lead_id));
    }
    const optOutLink = optOutLinkFor(optOutToken) ?? "";

    const { data: sendSetRow } = await admin
      .from("milon_ops_settings")
      .select("value")
      .eq("key", "lighthouse")
      .maybeSingle();
    const sendSettings = (sendSetRow as { value?: Record<string, unknown> } | null)?.value ?? {};
    const senderName = String(sendSettings.sender_name ?? DEFAULT_SETTINGS.senderName);
    const senderAddress = String(sendSettings.sender_address ?? "");
    const replyTo = String(sendSettings.reply_to ?? "").trim();
    const dailyCap = Number(sendSettings.daily_send_cap ?? DEFAULT_SETTINGS.dailySendCap);

    // Enforce the daily send cap — previously this setting was decorative.
    const sentToday = await countSentToday(admin);
    if (sentToday >= dailyCap) {
      throw new Error(
        `Daily send cap reached (${sentToday}/${dailyCap} today, SAST). Raise the cap in Settings or wait until tomorrow.`,
      );
    }

    const bodyWithFooter = withComplianceFooter(
      data.body,
      complianceFooter({
        company: (lead?.company as string | null) ?? null,
        optOutLink,
        senderName,
        senderAddress,
      }),
    );

    const apiKey = process.env.RESEND_API_KEY;
    const fromRaw = process.env.RESEND_FROM_EMAIL || "noreply@milon.co.za";
    const fromAddr = fromRaw.includes("<")
      ? fromRaw.replace(/^.*<([^>]+)>.*$/, "$1").trim()
      : fromRaw.trim();

    if (!apiKey) {
      await admin
        .from("lighthouse_touches")
        .update({
          subject: data.subject,
          body: bodyWithFooter,
          status: "approved",
          error: "RESEND_API_KEY not configured — approved but not sent.",
        })
        .eq("id", data.touchId);
      throw new Error(
        "RESEND_API_KEY is not configured, so nothing was sent. The draft is saved as approved.",
      );
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `lighthouse-${data.touchId}`,
      },
      body: JSON.stringify({
        from: `${senderName} <${fromAddr}>`,
        to: [to],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject: data.subject,
        text: bodyWithFooter,
        tags: [
          { name: "source", value: "lighthouse" },
          { name: "touch_id", value: data.touchId },
        ],
        headers: {
          // RFC 8058 one-click: mail clients show a native Unsubscribe control
          // and POST to the https target. Gmail and Yahoo bulk-sender rules
          // both expect this on anything that is not strictly transactional.
          "List-Unsubscribe": `<${oneClickOptOutFor(optOutToken)}>, <mailto:${fromAddr}?subject=unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });

    if (!res.ok) {
      const errText = (await res.text().catch(() => "")).slice(0, 300);
      await admin
        .from("lighthouse_touches")
        .update({ status: "failed", error: `Resend ${res.status}: ${errText}` })
        .eq("id", data.touchId);
      throw new Error(`Send failed — Resend ${res.status}: ${errText}`);
    }

    let providerMessageId: string | null = null;
    try {
      const body = (await res.json()) as { id?: string };
      providerMessageId = body.id ?? null;
    } catch {
      /* Resend usually returns { id }; missing id just weakens bounce matching */
    }

    const now = new Date();
    const stepNo = Number(touch.step_no ?? 1);

    await admin
      .from("lighthouse_touches")
      .update({
        subject: data.subject,
        body: bodyWithFooter,
        status: "sent",
        sent_at: now.toISOString(),
        error: null,
        ...(providerMessageId ? { provider_message_id: providerMessageId } : {}),
      })
      .eq("id", data.touchId);

    // Schedule the next touch using the sequence's widening gaps.
    const seqKey = String(lead?.sequence_key ?? "owner_v1");
    const { data: seqRow } = await admin
      .from("lighthouse_sequences")
      .select("steps")
      .eq("key", seqKey)
      .maybeSingle();
    const steps = Array.isArray((seqRow as { steps?: unknown } | null)?.steps)
      ? (seqRow as { steps: LighthouseStep[] }).steps
      : [];
    const thisStep = steps.find((s) => s.step === stepNo);
    const nextStep = steps.find((s) => s.step === stepNo + 1);
    const gap = nextStep && thisStep ? Math.max(1, nextStep.day - thisStep.day) : null;

    const stage = String(lead?.stage ?? "sourced");
    const advanced = stage === "sourced" || stage === "researched" ? "contacted" : stage;

    await admin
      .from("milon_ops_leads")
      .update({
        stage: advanced,
        sequence_step: stepNo,
        last_touch_at: now.toISOString(),
        next_touch_on: gap ? addDays(now, gap) : null,
      })
      .eq("id", String(touch.lead_id));

    return { ok: true as const, sentAt: now.toISOString() };
  });

export const upsertLighthouseAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        key: z.string().min(1).max(80),
        url: z.string().max(600).optional(),
        status: z.enum(["placeholder", "in_progress", "ready"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();

    const url = data.url?.trim() ?? undefined;

    // "Ready" is what makes the drafter start linking, so it must never be
    // reachable without something to link to.
    if (data.status === "ready") {
      const existingUrl =
        url ??
        String(
          (
            (await admin.from("lighthouse_assets").select("url").eq("key", data.key).maybeSingle())
              .data as { url?: string | null } | null
          )?.url ?? "",
        );
      if (!existingUrl.trim()) {
        throw new Error(
          "Add a URL before marking this asset ready — emails must have somewhere to point.",
        );
      }
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (url !== undefined) patch.url = url || null;
    if (data.status) patch.status = data.status;
    const { error } = await admin.from("lighthouse_assets").update(patch).eq("key", data.key);
    if (error) throw new Error(error.message);

    // The booking link exists in two places by design (an asset slot and a
    // Settings field). Mirror it so filling either one takes effect.
    if (data.key === "booking_link" && url) {
      const { data: existing } = await admin
        .from("milon_ops_settings")
        .select("value")
        .eq("key", "lighthouse")
        .maybeSingle();
      const prev = ((existing as { value?: Record<string, unknown> } | null)?.value ??
        {}) as Record<string, unknown>;
      await admin.from("milon_ops_settings").upsert({
        key: "lighthouse",
        value: { ...prev, booking_url: url },
        updated_at: new Date().toISOString(),
      });
    }

    return { ok: true as const };
  });

export const upsertLighthouseSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        senderName: z.string().max(200).optional(),
        senderTitle: z.string().max(200).optional(),
        trialDays: z.number().int().min(1).max(90).optional(),
        dailySendCap: z.number().int().min(1).max(200).optional(),
        bookingUrl: z.string().max(600).optional(),
        sendWindow: z.string().max(120).optional(),
        autoSend: z.boolean().optional(),
        senderAddress: z.string().max(300).optional(),
        replyTo: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();

    const { data: existing } = await admin
      .from("milon_ops_settings")
      .select("value")
      .eq("key", "lighthouse")
      .maybeSingle();
    const prev = ((existing as { value?: Record<string, unknown> } | null)?.value ?? {}) as Record<
      string,
      unknown
    >;

    const next: Record<string, unknown> = { ...prev };
    if (data.senderName !== undefined) next.sender_name = data.senderName;
    if (data.senderTitle !== undefined) next.sender_title = data.senderTitle;
    if (data.trialDays !== undefined) next.trial_days = data.trialDays;
    if (data.dailySendCap !== undefined) next.daily_send_cap = data.dailySendCap;
    if (data.bookingUrl !== undefined) next.booking_url = data.bookingUrl;
    if (data.sendWindow !== undefined) next.send_window = data.sendWindow;
    if (data.autoSend !== undefined) next.auto_send = data.autoSend;
    if (data.senderAddress !== undefined) next.sender_address = data.senderAddress;
    if (data.replyTo !== undefined) next.reply_to = data.replyTo.trim().toLowerCase();

    const { error } = await admin.from("milon_ops_settings").upsert({
      key: "lighthouse",
      value: next,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    });
    if (error) throw new Error(error.message);

    // Keep the booking_link asset slot in step with Settings so the console
    // never shows a booking link in one tab and a placeholder in the other.
    if (data.bookingUrl !== undefined) {
      const trimmed = data.bookingUrl.trim();
      await admin
        .from("lighthouse_assets")
        .update({
          url: trimmed || null,
          status: trimmed ? "ready" : "placeholder",
          updated_at: new Date().toISOString(),
        })
        .eq("key", "booking_link");
    }

    return { ok: true as const };
  });

/**
 * Draft a reply to something a prospect actually wrote.
 *
 * This is where the objection FAQ and the booking link earn their keep: a
 * reply is the one message where pointing at an answers page or proposing a
 * time is the natural move rather than a stacked CTA.
 */
export const draftLighthouseReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        leadId: z.string().uuid(),
        theirMessage: z.string().min(1).max(6000),
        intent: z.enum(["answer", "book", "trial"]).default("answer"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();

    const { data: leadRow, error: leadErr } = await admin
      .from("milon_ops_leads")
      .select("*")
      .eq("id", data.leadId)
      .maybeSingle();
    if (leadErr) throw new Error(leadErr.message);
    if (!leadRow) throw new Error("Lead not found");
    const lead = leadRow as Record<string, unknown>;
    if (lead.do_not_contact) {
      throw new Error("This lead has unsubscribed — drafting is disabled for them.");
    }

    const { data: setRow } = await admin
      .from("milon_ops_settings")
      .select("value")
      .eq("key", "lighthouse")
      .maybeSingle();
    const settingsRaw = (setRow as { value?: Record<string, unknown> } | null)?.value ?? {};
    const senderName = String(settingsRaw.sender_name ?? DEFAULT_SETTINGS.senderName);
    const senderTitle = String(settingsRaw.sender_title ?? DEFAULT_SETTINGS.senderTitle);
    const trialDays = Number(settingsRaw.trial_days ?? DEFAULT_SETTINGS.trialDays);
    const bookingUrl = await resolveBookingUrl(admin, settingsRaw);

    const faq = await firstReadyAsset(admin, ["faq_objections"]);
    const sandbox = await firstReadyAsset(admin, ["demo_sandbox"]);
    const trialLink = trialLinkFor((lead.trial_token as string | null) ?? null);

    const { data: priorRows } = await admin
      .from("lighthouse_touches")
      .select("step_no, angle, subject, body")
      .eq("lead_id", data.leadId);
    const priorTouches = ((priorRows ?? []) as Array<Record<string, unknown>>).sort(
      (a, b) => Number(a.step_no) - Number(b.step_no),
    );
    const prior = priorTouches
      .map((p) => `Step ${p.step_no} (${p.angle}): ${p.subject}\n${p.body}`)
      .join("\n\n---\n\n");

    const intentBrief =
      data.intent === "book"
        ? bookingUrl
          ? `Propose a short call and give exactly this booking link: ${bookingUrl}`
          : "Propose a short call and ask them to name two times that suit them. Do not invent a booking link."
        : data.intent === "trial"
          ? `Point them at the free ${trialDays}-day trial using exactly this link: ${trialLink ?? "(link pending)"}`
          : "Answer what they actually asked, plainly and completely. Do not pivot to a pitch.";

    const supporting = [
      faq
        ? `If a question is already answered in detail there, you may link the answers page once: ${faq.url}`
        : "",
      sandbox && data.intent !== "book"
        ? `If they want to look before committing, you may offer the read-only demo once: ${sandbox.url}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const prompt = `${SYSTEM_RULES}

You are writing a REPLY to a real message from a prospect. This is not cold outreach — they wrote to you first, so drop the introductions and answer like a person.

PROSPECT
Name: ${lead.name ?? "unknown"}
Company: ${lead.company ?? "unknown"}
Role: ${lead.role_title ?? "unknown"}
Persona: ${String(lead.persona ?? "owner")}
Observed signal: ${lead.signal ?? "none recorded"}
Notes: ${lead.notes ?? "none"}

WHAT THEY WROTE
${data.theirMessage}

${prior ? `WHAT WE SENT THEM BEFORE:\n\n${prior}` : "No prior emails on record."}

YOUR REPLY
Goal: ${intentBrief}
${supporting}
Answer every direct question they asked. If you do not know something, say so plainly rather than guessing.
Keep it under 140 words. One ask at the end, at most.

SIGN OFF as ${senderName}, ${senderTitle}.

Return ONLY JSON: {"subject": "...", "body": "..."}
The body must be plain text with line breaks, already signed off, ready to send.`;

    const raw = await callClaudeMessages({
      content: [{ type: "text", text: prompt }],
      maxTokens: 1200,
    });

    const parsed = parseDraftJson(raw);
    if (!parsed) throw new Error("Claude returned an unusable draft — try again.");

    // Replies live above the five sequence steps so they never collide with a
    // scheduled touch. The touch table caps step_no at 8.
    const usedSteps = priorTouches.map((p) => Number(p.step_no));
    const stepNo = [6, 7, 8].find((n) => !usedSteps.includes(n)) ?? 8;

    const { data: existing } = await admin
      .from("lighthouse_touches")
      .select("id")
      .eq("lead_id", data.leadId)
      .eq("step_no", stepNo)
      .maybeSingle();

    if (existing && (existing as { id?: string }).id) {
      await admin
        .from("lighthouse_touches")
        .update({
          subject: parsed.subject,
          body: parsed.body,
          angle: "reply",
          status: "draft",
          error: null,
        })
        .eq("id", (existing as { id: string }).id);
      return { ...parsed, touchId: (existing as { id: string }).id, stepNo };
    }

    const { data: inserted, error } = await admin
      .from("lighthouse_touches")
      .insert({
        lead_id: data.leadId,
        step_no: stepNo,
        angle: "reply",
        subject: parsed.subject,
        body: parsed.body,
        status: "draft",
        scheduled_for: addDays(new Date(), 0),
        created_by: userId,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      if (missingRelation(error.message)) throw new Error(migrationHintFor(MIGRATION));
      throw new Error(error.message);
    }

    // A prospect who wrote back is, by definition, at least at "replied".
    if (["sourced", "researched", "contacted"].includes(String(lead.stage ?? ""))) {
      await admin
        .from("milon_ops_leads")
        .update({ stage: "replied", replied_at: new Date().toISOString(), next_touch_on: null })
        .eq("id", data.leadId);
    }

    return { ...parsed, touchId: String((inserted as { id?: string } | null)?.id ?? ""), stepNo };
  });

/** Owner-side opt-out — for when someone asks to be removed by phone or reply. */
export const optOutLighthouseLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();

    const { data: leadRow } = await admin
      .from("milon_ops_leads")
      .select("optout_token")
      .eq("id", data.leadId)
      .maybeSingle();
    const token = String((leadRow as { optout_token?: string } | null)?.optout_token ?? "");
    if (!token) throw new Error("This lead has no opt-out token — run the latest migration.");

    const result = await applyLighthouseOptOut(token, "manual");
    if (!result.ok) throw new Error("Could not record the opt-out.");
    return { ok: true as const };
  });

/**
 * Public: landing page calls this when a prospect arrives on ?lh=<token>.
 * Records the click, and (when signup=true) marks the trial as started.
 */
export const registerLighthouseTrialVisit = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(6).max(64),
        signedUp: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    let admin;
    try {
      admin = adminLoose();
    } catch {
      return { ok: false as const };
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { trial_clicked_at: now };
    if (data.signedUp) {
      patch.trial_signed_up_at = now;
      patch.stage = "trial";
    }

    try {
      await admin.from("milon_ops_leads").update(patch).eq("trial_token", data.token);
    } catch {
      return { ok: false as const };
    }
    return { ok: true as const };
  });
