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

const MIGRATION = "20260820100000_milon_lighthouse.sql";

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
  createdAt: string;
  touches: LighthouseTouch[];
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
};

function siteUrl(): string {
  return (
    process.env.SITE_URL ||
    process.env.VITE_APP_URL ||
    "https://milon.co.za"
  ).replace(/\/$/, "");
}

export function trialLinkFor(token: string | null): string | null {
  if (!token) return null;
  return `${siteUrl()}/?lh=${token}#register`;
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
    persona: ((row.persona as string) === "accountant" ? "accountant" : "owner"),
    stage: (LIGHTHOUSE_STAGES.includes(row.stage as LighthouseStage)
      ? (row.stage as LighthouseStage)
      : "sourced"),
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
        migrationHint: migrationHintFor(MIGRATION),
      };
      return empty;
    }
    if (leadErr) throw new Error(leadErr.message);

    const rows = (leadRows ?? []) as Array<Record<string, unknown>>;
    const ids = rows.map((r) => String(r.id));

    let touchesByLead = new Map<string, LighthouseTouch[]>();
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
            error: (t.error as string | null) ?? null,
          });
          touchesByLead.set(leadId, list);
        }
      }
    }

    const leads = rows.map((r) => mapLead(r, touchesByLead.get(String(r.id)) ?? []));

    const stageCounts: Record<string, number> = {};
    for (const s of LIGHTHOUSE_STAGES) stageCounts[s] = 0;
    for (const l of leads) stageCounts[l.stage] = (stageCounts[l.stage] ?? 0) + 1;

    const contactedPlus = leads.filter((l) =>
      ["contacted", "replied", "meeting", "trial", "activated", "won"].includes(l.stage),
    ).length;
    const repliedPlus = leads.filter((l) =>
      ["replied", "meeting", "trial", "activated", "won"].includes(l.stage),
    ).length;
    const trialPlus = leads.filter((l) =>
      ["trial", "activated", "won"].includes(l.stage),
    ).length;

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
        persona: String(a.persona ?? "both"),
        url: (a.url as string | null) ?? null,
        status: (String(a.status ?? "placeholder") as LighthouseAsset["status"]),
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
        meeting: leads.filter((l) =>
          ["meeting", "trial", "activated", "won"].includes(l.stage),
        ).length,
        trial: trialPlus,
        won: stageCounts.won ?? 0,
        replyRatePct: contactedPlus ? Math.round((repliedPlus / contactedPlus) * 1000) / 10 : null,
        trialRatePct: contactedPlus ? Math.round((trialPlus / contactedPlus) * 1000) / 10 : null,
      },
      capability,
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
      const { error } = await admin
        .from("milon_ops_leads")
        .update(patch)
        .eq("id", data.id);
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

    const seqKey = String(lead.sequence_key ?? "owner_v1");
    const { data: seqRow } = await admin
      .from("lighthouse_sequences")
      .select("*")
      .eq("key", seqKey)
      .maybeSingle();
    const steps = Array.isArray((seqRow as { steps?: unknown } | null)?.steps)
      ? ((seqRow as { steps: LighthouseStep[] }).steps)
      : [];
    const step = steps.find((s) => s.step === data.stepNo);
    if (!step) throw new Error(`Step ${data.stepNo} is not defined for ${seqKey}`);

    const { data: assetRow } = step.asset
      ? await admin.from("lighthouse_assets").select("*").eq("key", step.asset).maybeSingle()
      : { data: null };
    const asset = assetRow as Record<string, unknown> | null;
    const assetReady = asset && asset.status === "ready" && asset.url;

    const { data: setRow } = await admin
      .from("milon_ops_settings")
      .select("value")
      .eq("key", "lighthouse")
      .maybeSingle();
    const settingsRaw = (setRow as { value?: Record<string, unknown> } | null)?.value ?? {};
    const senderName = String(settingsRaw.sender_name ?? DEFAULT_SETTINGS.senderName);
    const senderTitle = String(settingsRaw.sender_title ?? DEFAULT_SETTINGS.senderTitle);
    const trialDays = Number(settingsRaw.trial_days ?? DEFAULT_SETTINGS.trialDays);
    const bookingUrl = String(settingsRaw.booking_url ?? "");

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
            ? assetReady
              ? `Point to this short video: ${String(asset?.url)}`
              : "The video is not produced yet, so describe the insight in one sentence instead of linking to anything."
            : step.cta === "read_case"
              ? assetReady
                ? `Point to: ${String(asset?.url)}`
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

    let subject = "";
    let body = "";
    try {
      const parsed = JSON.parse(
        raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim(),
      ) as { subject?: string; body?: string };
      subject = String(parsed.subject ?? "").trim();
      body = String(parsed.body ?? "").trim();
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as { subject?: string; body?: string };
        subject = String(parsed.subject ?? "").trim();
        body = String(parsed.body ?? "").trim();
      }
    }
    if (!subject || !body) throw new Error("Claude returned an unusable draft — try again.");

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
          body: data.body,
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
        from: `${DEFAULT_SETTINGS.senderName} <${fromAddr}>`,
        to: [to],
        subject: data.subject,
        text: data.body,
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

    const now = new Date();
    const stepNo = Number(touch.step_no ?? 1);

    await admin
      .from("lighthouse_touches")
      .update({
        subject: data.subject,
        body: data.body,
        status: "sent",
        sent_at: now.toISOString(),
        error: null,
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
      ? ((seqRow as { steps: LighthouseStep[] }).steps)
      : [];
    const thisStep = steps.find((s) => s.step === stepNo);
    const nextStep = steps.find((s) => s.step === stepNo + 1);
    const gap = nextStep && thisStep ? Math.max(1, nextStep.day - thisStep.day) : null;

    const stage = String(lead?.stage ?? "sourced");
    const advanced =
      stage === "sourced" || stage === "researched" ? "contacted" : stage;

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
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.url !== undefined) patch.url = data.url.trim() || null;
    if (data.status) patch.status = data.status;
    const { error } = await admin.from("lighthouse_assets").update(patch).eq("key", data.key);
    if (error) throw new Error(error.message);
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

    const { error } = await admin.from("milon_ops_settings").upsert({
      key: "lighthouse",
      value: next,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    });
    if (error) throw new Error(error.message);
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
