/**
 * Next Step — server function (P0.3).
 *
 * `getNextStep` gathers the facts the pure resolver needs (advisory state,
 * profile/financial presence, open brain questions, recommendation and
 * action counts, unmeasured outcomes) in one round of parallel queries and
 * returns exactly one `NextStep`. Every query tolerates an un-migrated
 * database (P0.1/P0.2 columns absent → count 0, state derived), so the
 * dashboard never dead-ends.
 *
 * Audience defaults to the seat the caller occupies: the client's
 * `owner_user_id` is the owner; anyone else with `has_client_access` is
 * treated as the accountant seat.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isMissingAdvisoryRelation } from "@/lib/advisory-state";
import { loadAdvisorySnapshot, type LooseSb } from "@/lib/advisory-state.functions";
import {
  NEXT_STEP_AUDIENCES,
  resolveNextStep,
  type NextStep,
  type NextStepAudience,
  type NextStepFacts,
} from "@/lib/next-step";
import { isMissingRecommendationRelation } from "@/lib/recommendations";

/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseQuery = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function jsonbBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function isMissingRelation(err: unknown): boolean {
  return (
    isMissingAdvisoryRelation(err) ||
    isMissingRecommendationRelation(err) ||
    /does not exist|schema cache/i.test(
      err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : "",
    )
  );
}

async function count(
  sb: LooseSb,
  table: string,
  clientId: string,
  filter?: (q: LooseQuery) => LooseQuery,
): Promise<number> {
  let q = sb.from(table).select("id", { count: "exact", head: true }).eq("client_id", clientId);
  if (filter) q = filter(q);
  const { count: n, error } = await q;
  if (error) {
    if (isMissingRelation(error)) return 0;
    throw new Error(error.message);
  }
  return n ?? 0;
}

/**
 * Approved/edited recommendations split into: no action yet, and actioned
 * but with no outcome recorded. Two small selects instead of a join so the
 * pre-P0.2 schema (no recommendation_id / recommendation_outcomes) degrades
 * to zeros rather than an error.
 */
async function recommendationGaps(
  sb: LooseSb,
  clientId: string,
): Promise<{ approvedWithoutAction: number; actionedUnmeasured: number }> {
  const approved = await sb
    .from("proposed_next_steps")
    .select("id")
    .eq("client_id", clientId)
    .in("status", ["approved", "edited"]);
  if (approved.error) {
    if (isMissingRelation(approved.error))
      return { approvedWithoutAction: 0, actionedUnmeasured: 0 };
    throw new Error(approved.error.message);
  }
  const ids: string[] = ((approved.data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return { approvedWithoutAction: 0, actionedUnmeasured: 0 };

  const [actions, outcomes] = await Promise.all([
    sb
      .from("action_items")
      .select("recommendation_id")
      .eq("client_id", clientId)
      .in("recommendation_id", ids),
    sb
      .from("recommendation_outcomes")
      .select("recommendation_id")
      .eq("client_id", clientId)
      .in("recommendation_id", ids),
  ]);
  if (actions.error && !isMissingRelation(actions.error)) throw new Error(actions.error.message);
  if (outcomes.error && !isMissingRelation(outcomes.error)) throw new Error(outcomes.error.message);

  const withAction = new Set(
    ((actions.data ?? []) as { recommendation_id: string | null }[])
      .map((r) => r.recommendation_id)
      .filter((v): v is string => typeof v === "string"),
  );
  const measured = new Set(
    ((outcomes.data ?? []) as { recommendation_id: string }[]).map((r) => r.recommendation_id),
  );

  let approvedWithoutAction = 0;
  let actionedUnmeasured = 0;
  for (const id of ids) {
    if (!withAction.has(id)) approvedWithoutAction++;
    else if (!measured.has(id)) actionedUnmeasured++;
  }
  return { approvedWithoutAction, actionedUnmeasured };
}

export type GetNextStepResult = {
  nextStep: NextStep;
  facts: NextStepFacts;
};

/**
 * Latest advisory pack that is not superseded (P1). null when none exists or
 * the P1.1 migration is not applied.
 */
async function latestPack(
  sb: LooseSb,
  clientId: string,
): Promise<{
  status: NonNullable<NextStepFacts["packStatus"]>;
  version: number;
  requiresReview: boolean;
  delivered: boolean;
} | null> {
  const { data, error } = await sb
    .from("advisory_packs")
    .select("status, version, requires_review, delivered_at")
    .eq("client_id", clientId)
    .neq("status", "superseded")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    status: string;
    version: number;
    requires_review: boolean;
    delivered_at: string | null;
  };
  const ok = ["draft", "in_review", "changes_requested", "approved", "rejected"];
  if (!ok.includes(row.status)) return null;
  return {
    status: row.status as NonNullable<NextStepFacts["packStatus"]>,
    version: row.version,
    requiresReview: row.requires_review === true,
    delivered: row.delivered_at != null,
  };
}

export const getNextStep = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        audience: z.enum(NEXT_STEP_AUDIENCES).optional(),
        /** Test hook; production callers leave it unset. */
        now: z.string().datetime().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<GetNextStepResult> => {
    const sb = context.supabase as unknown as LooseSb;
    const now = data.now ?? new Date().toISOString();
    const today = now.slice(0, 10);

    // loadAdvisorySnapshot enforces has_client_access and never throws on an
    // un-migrated DB (source: "derived").
    const snapshot = await loadAdvisorySnapshot(sb, context.userId, {
      clientId: data.clientId,
      eventLimit: 0,
    });

    const clientRes = await sb
      .from("clients")
      .select("id, owner_user_id, firm_id, operating_profile, financials, last_forecast_at")
      .eq("id", data.clientId)
      .maybeSingle();
    if (clientRes.error) throw new Error(clientRes.error.message);
    const client = clientRes.data as {
      owner_user_id: string;
      firm_id: string | null;
      operating_profile: unknown;
      financials: unknown;
      last_forecast_at: string | null;
    } | null;
    if (!client) throw new Error("Client not found");

    const audience: NextStepAudience =
      data.audience ?? (client.owner_user_id === context.userId ? "owner" : "accountant");
    const questionAudiences = audience === "owner" ? ["owner", "both"] : ["accountant", "both"];

    const [
      hasSnapshot,
      openQuestions,
      proposedRecommendations,
      openActions,
      overdueActions,
      blockedActions,
      gaps,
      openDataRequests,
      pack,
    ] = await Promise.all([
      count(sb, "client_financial_snapshots", data.clientId),
      count(sb, "client_brain_questions", data.clientId, (q) =>
        q.eq("status", "unanswered").in("audience", questionAudiences),
      ),
      count(sb, "proposed_next_steps", data.clientId, (q) => q.eq("status", "proposed")),
      count(sb, "action_items", data.clientId, (q) => q.neq("status", "done")),
      count(sb, "action_items", data.clientId, (q) =>
        q.neq("status", "done").lt("due_date", today),
      ),
      count(sb, "action_items", data.clientId, (q) => q.eq("status", "blocked")),
      recommendationGaps(sb, data.clientId),
      // P0.6: open or sent asks. 0 on a pre-P0.6 database.
      count(sb, "data_requests", data.clientId, (q) => q.in("status", ["open", "sent"])),
      latestPack(sb, data.clientId),
    ]);

    const facts: NextStepFacts = {
      clientId: data.clientId,
      state: snapshot.state,
      stateSource: snapshot.source,
      hasFirm: client.firm_id != null,
      hasProfile: !jsonbBlank(client.operating_profile),
      hasFinancials: !jsonbBlank(client.financials),
      hasSnapshot: hasSnapshot > 0,
      hasForecast: client.last_forecast_at != null,
      openQuestions,
      proposedRecommendations,
      approvedWithoutAction: gaps.approvedWithoutAction,
      openActions,
      overdueActions,
      blockedActions,
      actionedUnmeasured: gaps.actionedUnmeasured,
      openDataRequests,
      packStatus: pack?.status ?? null,
      packVersion: pack?.version ?? null,
      packRequiresReview: pack?.requiresReview ?? false,
      packDelivered: pack?.delivered ?? false,
      nextReviewAt: snapshot.nextReviewAt,
      now,
    };

    return { nextStep: resolveNextStep(facts, audience), facts };
  });
