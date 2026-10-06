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
import { loadLighthouseWorkbenchBook, type LighthouseLead } from "@/lib/lighthouse.functions";
import {
  adminLoose,
  assertOpsConsoleAccess,
  type AuthCtx,
} from "@/lib/owner-ops.guard";

const PHASE1_PROBES = [
  "lighthouse_activities",
  "lighthouse_campaigns",
  "lighthouse_cadence_steps",
] as const;

/** SQLSTATE undefined_table. A missing column (42703) or an RLS denial is not this. */
export function isUndefinedTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01";
}

function logBookReadError(table: string, error: { code?: string; message?: string } | null | undefined) {
  console.error("lighthouse.chat.book", table, error?.code ?? "", error?.message ?? "");
}

function chatLeadFromWorkbench(lead: LighthouseLead): ChatLeadInput {
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    company: lead.company,
    city: lead.city,
    country: lead.country,
    region: lead.region,
    timezone: lead.timezone,
    stage: lead.stage,
    doNotContact: lead.doNotContact,
    conversationHeld: lead.conversationHeld,
    nextTouchOn: lead.nextTouchOn,
    nextFollowUpAt: lead.nextFollowUpAt,
    lastTouchAt: lead.lastTouchAt,
    lastDeliveryStatus: lead.lastDeliveryStatus,
    lastEngagement: lead.lastEngagement,
    repliedAt: lead.repliedAt,
    lastInboundAt: lead.lastInboundAt,
    sequenceStep: lead.sequenceStep,
    touches: lead.touches.map((touch) => ({
      id: touch.id,
      stepNo: touch.stepNo,
      angle: touch.angle,
      subject: touch.subject,
      body: touch.body,
      status: touch.status,
      sentAt: touch.sentAt,
      deliveredAt: touch.deliveredAt,
      clickedAt: touch.clickedAt,
    })),
    inbound: lead.inbound.map((row) => ({
      id: row.id,
      fromEmail: row.fromEmail,
      subject: row.subject,
      receivedAt: row.receivedAt,
    })),
  };
}

async function probePhase1Table(
  admin: ReturnType<typeof adminLoose>,
  table: (typeof PHASE1_PROBES)[number],
): Promise<boolean> {
  const { error } = await admin.from(table).select("id").limit(1);
  if (!error) return false;
  if (isUndefinedTableError(error)) return true;
  logBookReadError(table, error);
  return false;
}

export async function loadLighthouseChatSnapshot(
  admin: ReturnType<typeof adminLoose>,
  now = new Date(),
): Promise<ChatSnapshot> {
  const book = await loadLighthouseWorkbenchBook(admin);
  if (book.leadError) {
    if (isUndefinedTableError(book.leadError)) {
      return snapshotFromBook({ leads: null, missingTables: ["milon_ops_leads"] }, now);
    }
    logBookReadError("milon_ops_leads", book.leadError);
    return snapshotFromBook({ leads: [], bookUnreadable: true }, now);
  }

  const missingTables: string[] = [];
  const related: Array<[string, { code?: string; message?: string } | null]> = [
    ["lighthouse_touches", book.touchError],
    ["lighthouse_inbound", book.inboundError],
    ["lighthouse_firms", book.firmError],
    ["lighthouse_contacts", book.contactError],
  ];
  for (const [table, error] of related) {
    if (!error) continue;
    if (isUndefinedTableError(error)) missingTables.push(table);
    else logBookReadError(table, error);
  }

  const phase1Missing = await Promise.all(PHASE1_PROBES.map((table) => probePhase1Table(admin, table)));
  PHASE1_PROBES.forEach((table, index) => {
    if (phase1Missing[index]) missingTables.push(table);
  });

  return snapshotFromBook(
    { leads: book.leads.map(chatLeadFromWorkbench), missingTables },
    now,
  );
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
    let snapshot: ChatSnapshot;
    try {
      snapshot = await loadLighthouseChatSnapshot(admin);
    } catch (error) {
      logBookReadError("milon_ops_leads", {
        message: error instanceof Error ? error.message : "read failed",
      });
      snapshot = snapshotFromBook({ leads: [], bookUnreadable: true });
    }
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
