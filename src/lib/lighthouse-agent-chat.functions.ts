/**
 * Ops chat for the Lighthouse Agent tab.
 *
 * Same gate as the other /ops admin server functions. Non-admins get 403.
 * Reads the live book and may save a pending draft. It does not import the
 * send or approve server functions, and it cannot call them.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  requireLighthouseChatAdmin,
  runLighthouseChatTurn,
  snapshotFromBook,
  type ChatLeadInput,
  type ChatSnapshot,
} from "@/lib/lighthouse-agent-chat";
import { persistPendingLighthouseDraft } from "@/lib/lighthouse-draft-persist";
import { callClaudeMessages } from "@/lib/claude-messages";
import {
  adminLoose,
  assertOpsConsoleAccess,
  missingRelation,
  type AuthCtx,
} from "@/lib/owner-ops.guard";

const PHASE1_PROBES = [
  "lighthouse_activities",
  "lighthouse_campaigns",
  "lighthouse_cadence_steps",
] as const;

async function readRows(
  admin: ReturnType<typeof adminLoose>,
  table: string,
  columns: string,
  limit: number,
): Promise<{ missing: boolean; rows: Array<Record<string, unknown>> }> {
  const { data, error } = await admin.from(table).select(columns).limit(limit);
  if (error) {
    if (missingRelation(error.message ?? "")) return { missing: true, rows: [] };
    throw new Error(error.message);
  }
  return { missing: false, rows: (data ?? []) as Array<Record<string, unknown>> };
}

async function readOptional(
  admin: ReturnType<typeof adminLoose>,
  table: string,
  columns: string,
  limit: number,
): Promise<{ missing: boolean; rows: Array<Record<string, unknown>> }> {
  try {
    return await readRows(admin, table, columns, limit);
  } catch {
    return { missing: true, rows: [] };
  }
}

export async function loadLighthouseChatSnapshot(
  admin: ReturnType<typeof adminLoose>,
  now = new Date(),
): Promise<ChatSnapshot> {
  const leadsRes = await readRows(
    admin,
    "milon_ops_leads",
    "id, name, email, company, city, country, region, timezone, stage, do_not_contact, next_touch_on, last_touch_at, replied_at, last_inbound_at, sequence_step, signal",
    400,
  );
  if (leadsRes.missing) {
    return snapshotFromBook({ leads: null, missingTables: ["milon_ops_leads"] }, now);
  }

  const ids = new Set(leadsRes.rows.map((row) => String(row.id)));
  const [touchesRes, inboundRes, firmsRes, contactsRes, ...phase1] = await Promise.all([
    readOptional(
      admin,
      "lighthouse_touches",
      "id, lead_id, step_no, angle, subject, status, sent_at, delivered_at",
      2000,
    ),
    readOptional(
      admin,
      "lighthouse_inbound",
      "id, lead_id, from_email, subject, received_at",
      80,
    ),
    readOptional(
      admin,
      "lighthouse_firms",
      "legacy_lead_id, name, country, suppress_reason",
      500,
    ),
    readOptional(
      admin,
      "lighthouse_contacts",
      "legacy_lead_id, last_touch_at, last_delivery_status, last_engagement, next_follow_up_at, suppress",
      500,
    ),
    ...PHASE1_PROBES.map((table) => readOptional(admin, table, "id", 1)),
  ]);

  const missingTables: string[] = [];
  if (touchesRes.missing) missingTables.push("lighthouse_touches");
  if (inboundRes.missing) missingTables.push("lighthouse_inbound");
  if (firmsRes.missing) missingTables.push("lighthouse_firms");
  if (contactsRes.missing) missingTables.push("lighthouse_contacts");
  PHASE1_PROBES.forEach((table, index) => {
    if (phase1[index]?.missing) missingTables.push(table);
  });

  const touchesByLead = new Map<string, ChatLeadInput["touches"]>();
  if (!touchesRes.missing) {
    for (const row of touchesRes.rows) {
      const leadId = String(row.lead_id ?? "");
      if (!ids.has(leadId)) continue;
      const list = touchesByLead.get(leadId) ?? [];
      list.push({
        id: String(row.id),
        stepNo: Number(row.step_no ?? 1),
        angle: (row.angle as string | null) ?? null,
        subject: (row.subject as string | null) ?? null,
        body: null,
        status: String(row.status ?? "draft"),
        sentAt: (row.sent_at as string | null) ?? null,
        deliveredAt: (row.delivered_at as string | null) ?? null,
      });
      touchesByLead.set(leadId, list);
    }
  }

  const inboundByLead = new Map<string, NonNullable<ChatLeadInput["inbound"]>>();
  if (!inboundRes.missing) {
    for (const row of inboundRes.rows) {
      const leadId = String(row.lead_id ?? "");
      if (!ids.has(leadId)) continue;
      const list = inboundByLead.get(leadId) ?? [];
      list.push({
        id: String(row.id),
        fromEmail: String(row.from_email ?? ""),
        subject: (row.subject as string | null) ?? null,
        receivedAt: String(row.received_at ?? ""),
      });
      inboundByLead.set(leadId, list);
    }
  }

  const firmByLead = new Map<string, Record<string, unknown>>();
  if (!firmsRes.missing) {
    for (const row of firmsRes.rows) {
      if (!row.legacy_lead_id) continue;
      firmByLead.set(String(row.legacy_lead_id), row);
    }
  }
  const contactByLead = new Map<string, Record<string, unknown>>();
  if (!contactsRes.missing) {
    for (const row of contactsRes.rows) {
      if (!row.legacy_lead_id) continue;
      contactByLead.set(String(row.legacy_lead_id), row);
    }
  }

  const leads: ChatLeadInput[] = leadsRes.rows.map((row) => {
    const id = String(row.id);
    const firm = firmByLead.get(id);
    const contact = contactByLead.get(id);
    const suppressed = Boolean(row.do_not_contact) || Boolean(firm?.suppress_reason) || Boolean(contact?.suppress);
    return {
      id,
      name: (row.name as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      company: (row.company as string | null) ?? (firm?.name ? String(firm.name) : null),
      city: (row.city as string | null) ?? null,
      country: (row.country as string | null) ?? (firm?.country ? String(firm.country) : null),
      region: (row.region as string | null) ?? null,
      timezone: (row.timezone as string | null) ?? null,
      stage: (row.stage as string | null) ?? "sourced",
      doNotContact: suppressed,
      nextTouchOn: (row.next_touch_on as string | null) ?? null,
      nextFollowUpAt: (contact?.next_follow_up_at as string | null) ?? null,
      lastTouchAt:
        (contact?.last_touch_at as string | null) ?? (row.last_touch_at as string | null) ?? null,
      lastDeliveryStatus: (contact?.last_delivery_status as string | null) ?? null,
      lastEngagement: (contact?.last_engagement as string | null) ?? null,
      repliedAt: (row.replied_at as string | null) ?? null,
      lastInboundAt: (row.last_inbound_at as string | null) ?? null,
      sequenceStep: Number(row.sequence_step ?? 0),
      touches: touchesByLead.get(id) ?? [],
      inbound: inboundByLead.get(id) ?? [],
    };
  });

  return snapshotFromBook({ leads, missingTables }, now);
}

export const askLighthouseAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        message: z.string().trim().min(1).max(4000),
        history: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().max(8000),
            }),
          )
          .max(20)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const gate = (await requireLighthouseChatAdmin(context as AuthCtx, assertOpsConsoleAccess)) as {
      userId: string;
    };
    const admin = adminLoose();
    const snapshot = await loadLighthouseChatSnapshot(admin);
    const turn = await runLighthouseChatTurn({
      message: data.message,
      history: data.history,
      snapshot,
      createdBy: gate.userId,
      complete: process.env.ANTHROPIC_API_KEY
        ? (prompt) =>
            callClaudeMessages({
              content: [{ type: "text", text: prompt }],
              maxTokens: 1200,
            })
        : undefined,
      persistDraft: async (write) => {
        const saved = await persistPendingLighthouseDraft(admin, write, new Date(), {
          refuseLocked: true,
        });
        return saved;
      },
    });
    return {
      reply: turn.reply,
      chips: turn.chips,
      draft: turn.draft,
    };
  });
