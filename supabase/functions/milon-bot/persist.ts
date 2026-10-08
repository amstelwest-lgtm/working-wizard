/**
 * Create-deliverable path. Writes through the tables the app already uses:
 * deliverable_drafts (same row brain-deliverable-draft inserts), advisory_packs
 * via advisory_pack_create, and action_plans / action_items (same insert as
 * Add to Action Plan). Does not send email.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  formatOverviewForPrompt,
  overviewFactLines,
  packContentFromOverview,
  planActionsFromOverview,
  rulesDraftBody,
  type OverviewBrief,
  type PlannedAction,
} from "../ask-ai/overview-brief.ts";
import { loadOverviewBrief } from "./load-overview.ts";
import { paidGenerationTrialBlock } from "../_shared/starter-trial-gate.ts";
import {
  finishPrecardAttempt,
  readPrecardGate,
  recordPrecardUse,
} from "../_shared/precard-cap-gate.ts";
import { PRECARD_CAP_CODE, PRECARD_CAP_MESSAGE } from "../../../src/lib/precard-cap.ts";
import { isStarterTrialEndedMessage } from "../../../src/lib/starter-trial-generation.ts";

export type CreateIntent = {
  draft: boolean;
  actions: boolean;
  pdf: boolean;
};

export type CreatedPayload = {
  draftInserted: boolean;
  draftAlreadyOpen: boolean;
  draftId: string | null;
  packId: string | null;
  actionItemIds: string[];
  items: Array<{ title: string; outcomeWhy: string }>;
  pdf: boolean;
  overview: {
    health: number | null;
    healthLabel: string | null;
    cash: number | null;
    revenue: number | null;
    runwayWeeks: number | null;
    creditorDays: number | null;
    debtorDays: number | null;
    grossMargin: number | null;
    facts: string[];
  };
  errors: string[];
};

function todayPlus(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function periodLabel(now = new Date()): string {
  return `Q${Math.floor(now.getUTCMonth() / 3) + 1} ${now.getUTCFullYear()}`;
}

function quarterEnd(now = new Date()): string {
  const q = Math.floor(now.getUTCMonth() / 3);
  return new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 0)).toISOString().slice(0, 10);
}

async function invokeDraft(
  token: string,
  clientId: string,
): Promise<{ draftInserted?: boolean; skippedReason?: string; error?: string; code?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl) return { error: "Draft service URL is not configured" };
  const res = await fetch(`${supabaseUrl}/functions/v1/brain-deliverable-draft`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
    },
    body: JSON.stringify({ clientId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = typeof body?.error === "string" ? body.error : `brain-deliverable-draft failed (${res.status})`;
    const code = typeof body?.code === "string" ? body.code : undefined;
    return { error: err, code };
  }
  return body as { draftInserted?: boolean; skippedReason?: string };
}

async function latestDraftId(client: SupabaseClient, clientId: string): Promise<string | null> {
  const { data } = await client
    .from("deliverable_drafts")
    .select("id")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

async function ensurePlan(client: SupabaseClient, clientId: string, brief: OverviewBrief): Promise<string | null> {
  const { data: plans, error } = await client
    .from("action_plans")
    .select("id")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const existing = plans?.[0]?.id;
  if (existing) return String(existing);
  const goal =
    brief.health != null
      ? `Improve overview health from ${brief.health}/100`
      : "Set the outcome goal for this quarter";
  const { data: created, error: insErr } = await client
    .from("action_plans")
    .insert({
      client_id: clientId,
      period_label: periodLabel(),
      outcome_goal: goal,
      target_date: quarterEnd(),
      why_statement: "Opened from Milōn Bot using the Overview figures already on file.",
    })
    .select("id")
    .single();
  if (insErr) throw new Error(insErr.message);
  return created?.id ? String(created.id) : null;
}

async function insertActions(
  client: SupabaseClient,
  clientId: string,
  planId: string,
  actions: PlannedAction[],
): Promise<string[]> {
  const ids: string[] = [];
  const { data: existing } = await client
    .from("action_items")
    .select("id, source_move_key, seq")
    .eq("plan_id", planId);
  const rows = (existing ?? []) as Array<{ id: string; source_move_key: string | null; seq: number }>;
  const byKey = new Map(rows.filter((r) => r.source_move_key).map((r) => [r.source_move_key as string, r.id]));
  let seq = rows.reduce((max, r) => Math.max(max, r.seq ?? 0), 0);
  for (const action of actions) {
    const already = byKey.get(action.sourceMoveKey);
    if (already) {
      ids.push(already);
      continue;
    }
    seq += 1;
    const { data, error } = await client
      .from("action_items")
      .insert({
        plan_id: planId,
        client_id: clientId,
        seq,
        title: action.title,
        outcome_why: action.outcomeWhy,
        source: "strategic_move",
        source_move_key: action.sourceMoveKey,
        driver_key: action.sourceMoveKey,
        due_date: todayPlus(14),
        status: "not_started",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (data?.id) ids.push(String(data.id));
  }
  return ids;
}

export function summarizeCreate(input: {
  brief: OverviewBrief;
  audience: "owner" | "accountant";
  intent: CreateIntent;
  created: CreatedPayload;
}): string {
  const who = input.audience === "accountant" ? "this client" : "the business";
  const facts = overviewFactLines(input.brief);
  const parts: string[] = [];
  if (input.intent.draft) {
    if (input.created.draftInserted) {
      parts.push(`Saved an advisory draft for ${who}. It is not sent.`);
    } else if (input.created.draftAlreadyOpen) {
      parts.push(`An advisory draft for ${who} is already open. Nothing new was duplicated, and it was not sent.`);
    } else {
      parts.push(`The advisory draft was not saved.`);
    }
    if (input.created.packId) {
      parts.push(`A review pack is on the Advisory Drafter for ${who}.`);
    }
  }
  if (input.intent.actions) {
    if (input.created.items.length) {
      const titles = input.created.items.map((i) => i.title).join("; ");
      parts.push(`Action Plan items are on file: ${titles}.`);
    } else {
      parts.push("No Action Plan items were written.");
    }
  }
  if (facts.length) {
    parts.push(`Overview figures used: ${facts.join("; ")}.`);
  }
  if (input.intent.pdf) {
    parts.push("The Action Plan PDF uses these same items. Download it from the Action Plan tab, or it will download with this reply when the studio can build it.");
  }
  if (input.created.errors.length) {
    parts.push(`Could not finish every write: ${input.created.errors.join(" ")}`);
  }
  parts.push("These figures are already on file. There is no need to re-enter them.");
  return parts.join(" ");
}

export async function persistAdvisoryCreate(input: {
  clientId: string;
  userId: string;
  email: string;
  token: string;
  audience: "owner" | "accountant";
  intent: CreateIntent;
  userClient: SupabaseClient;
  adminClient: SupabaseClient;
}): Promise<{
  answer: string;
  created: CreatedPayload;
  tools: Array<{ name: string; status: "ok" | "empty" | "error" }>;
  precard?: { code: typeof PRECARD_CAP_CODE; limit: "pack"; message: string } | null;
}> {
  const brief = await loadOverviewBrief(input.userClient, input.clientId);
  const emptyBrief = !brief || overviewFactLines(brief).length === 0;
  const created: CreatedPayload = {
    draftInserted: false,
    draftAlreadyOpen: false,
    draftId: null,
    packId: null,
    actionItemIds: [],
    items: [],
    pdf: input.intent.pdf,
    overview: {
      health: brief?.health ?? null,
      healthLabel: brief?.healthLabel ?? null,
      cash: brief?.cash ?? null,
      revenue: brief?.revenue ?? null,
      runwayWeeks: brief?.runwayWeeks ?? null,
      creditorDays: brief?.creditorDays ?? null,
      debtorDays: brief?.debtorDays ?? null,
      grossMargin: brief?.grossMargin ?? null,
      facts: brief ? overviewFactLines(brief) : [],
    },
    errors: [],
  };
  const tools: Array<{ name: string; status: "ok" | "empty" | "error" }> = [];

  if (!brief || emptyBrief) {
    return {
      answer:
        "Nothing on the Overview is filled in for this client yet, so no draft or Action Plan items were written. Add the figures on Overview first — Milōn Bot will not invent them.",
      created,
      tools: [{ name: "answer_from_brain", status: "empty" }],
    };
  }

  const trialBlock = await paidGenerationTrialBlock({
    db: input.adminClient,
    userId: input.userId,
    email: input.email,
    clientId: input.clientId,
  });
  if (trialBlock) {
    created.errors.push(trialBlock.message);
    return {
      answer: trialBlock.message,
      created,
      tools: [{ name: "draft_deliverable", status: "error" }],
    };
  }

  let packGate: Awaited<ReturnType<typeof readPrecardGate>> | null = null;
  if (input.intent.draft) {
    try {
      packGate = await readPrecardGate({
        db: input.adminClient,
        clientId: input.clientId,
        kind: "pack",
      });
    } catch (err) {
      const message = "Could not check the plan. Nothing was generated.";
      created.errors.push(err instanceof Error ? err.message : message);
      return { answer: message, created, tools };
    }
    if (!packGate.allowed) {
      return {
        answer: packGate.message || PRECARD_CAP_MESSAGE,
        created,
        tools: [{ name: "draft_deliverable", status: "error" }],
        precard: {
          code: PRECARD_CAP_CODE,
          limit: "pack",
          message: packGate.message || PRECARD_CAP_MESSAGE,
        },
      };
    }
  }

  if (input.intent.draft && packGate?.allowed) {
    const remote = await invokeDraft(input.token, input.clientId);
    if (remote.code === PRECARD_CAP_CODE) {
      const message = remote.error || PRECARD_CAP_MESSAGE;
      return {
        answer: message,
        created,
        tools: [{ name: "draft_deliverable", status: "error" }],
        precard: { code: PRECARD_CAP_CODE, limit: "pack", message },
      };
    }
    if (isStarterTrialEndedMessage(remote.error ?? "")) {
      const message = remote.error ?? "Your trial has ended, choose a plan";
      created.errors.push(message);
      return {
        answer: message,
        created,
        tools: [{ name: "draft_deliverable", status: "error" }],
      };
    }
    if (remote.draftInserted) {
      created.draftInserted = true;
      created.draftId = await latestDraftId(input.userClient, input.clientId);
      tools.push({ name: "draft_deliverable", status: "ok" });
    } else if (remote.skippedReason === "similar_open") {
      created.draftAlreadyOpen = true;
      created.draftId = await latestDraftId(input.userClient, input.clientId);
      tools.push({ name: "draft_deliverable", status: "ok" });
    } else {
      const { data, error } = await input.userClient
        .from("deliverable_drafts")
        .insert({
          client_id: input.clientId,
          kind: "advisory",
          body: rulesDraftBody(brief),
          assumption_checklist: [],
          status: "draft",
          created_by: input.userId,
        })
        .select("id")
        .maybeSingle();
      if (error || !data?.id) {
        created.errors.push(error?.message || remote.error || "Draft was not saved.");
        tools.push({ name: "draft_deliverable", status: "error" });
      } else {
        created.draftInserted = true;
        created.draftId = String(data.id);
        tools.push({ name: "draft_deliverable", status: "ok" });
        if (packGate.firmId) {
          try {
            await finishPrecardAttempt({
              decision: packGate,
              succeeded: true,
              record: async () => {
                await recordPrecardUse(input.adminClient, packGate!.firmId!, "pack");
              },
            });
          } catch (err) {
            console.error("precard record failed", err instanceof Error ? err.message : err);
          }
        }
      }
    }

    const again = await readPrecardGate({
      db: input.adminClient,
      clientId: input.clientId,
      kind: "pack",
    });
    if (!again.allowed && !created.draftInserted && !created.draftAlreadyOpen) {
      return {
        answer: again.message || PRECARD_CAP_MESSAGE,
        created,
        tools,
        precard: { code: PRECARD_CAP_CODE, limit: "pack", message: again.message || PRECARD_CAP_MESSAGE },
      };
    }

    const actionsForPack = planActionsFromOverview(brief);
    const { data: snap } = await input.userClient
      .from("client_financial_snapshots")
      .select("id")
      .eq("client_id", input.clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const packStillOpen = again.allowed;
    const createdPack = packStillOpen
      ? await input.userClient.rpc("advisory_pack_create", {
          p_client_id: input.clientId,
          p_content: packContentFromOverview(brief, actionsForPack, new Date().toISOString()),
          p_period_label: brief.periodLabel,
          p_figures_as_of: brief.figuresAsOf ? String(brief.figuresAsOf).slice(0, 10) : null,
          p_snapshot_id: snap?.id ?? null,
          p_generator: "rules",
        })
      : { data: null, error: null };
    const packId = createdPack.data;
    const packErr = createdPack.error;
    if (packStillOpen && (packErr || !packId)) {
      created.errors.push(packErr?.message || "Advisory pack was not saved.");
      tools.push({ name: "advisory_pack", status: "error" });
    } else if (packId) {
      created.packId = String(packId);
      tools.push({ name: "advisory_pack", status: "ok" });
      if (again.firmId) {
        try {
          await finishPrecardAttempt({
            decision: again,
            succeeded: true,
            record: async () => {
              await recordPrecardUse(input.adminClient, again.firmId!, "pack");
            },
          });
        } catch (err) {
          console.error("precard record failed", err instanceof Error ? err.message : err);
        }
      }
    }
  }

  if (input.intent.actions) {
    try {
      const planned = planActionsFromOverview(brief);
      const planId = await ensurePlan(input.userClient, input.clientId, brief);
      if (!planId) throw new Error("No Action Plan row was created.");
      created.actionItemIds = await insertActions(input.userClient, input.clientId, planId, planned);
      created.items = planned.map((a) => ({ title: a.title, outcomeWhy: a.outcomeWhy }));
      tools.push({ name: "create_action_plan", status: created.actionItemIds.length ? "ok" : "empty" });
    } catch (e) {
      created.errors.push((e as Error).message || "Action Plan items were not saved.");
      tools.push({ name: "create_action_plan", status: "error" });
    }
  }

  return {
    answer: summarizeCreate({ brief, audience: input.audience, intent: input.intent, created }),
    created,
    tools,
  };
}

export function overviewPrompt(brief: OverviewBrief, audience: "owner" | "accountant"): string {
  return formatOverviewForPrompt(brief, audience);
}
