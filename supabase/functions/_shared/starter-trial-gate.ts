/**
 * Edge-function read of the Starter-trial generation mirror.
 * Vercel writes firms.starter_trial_generation_blocked from the live billing
 * clock. This file does not call the billing API. Null (never written) and a
 * missing column fail open so a paying firm is not blocked before the first sync.
 */
import {
  STARTER_TRIAL_ENDED_CODE,
  STARTER_TRIAL_ENDED_MESSAGE,
  TRIAL_CLOCK_CUTOVER,
  noPlanTrialEndMs,
  noPlanTrialStartMs,
} from "../../../src/lib/starter-trial-constants.ts";

export type PaidGenerationBlock = {
  code: typeof STARTER_TRIAL_ENDED_CODE;
  message: typeof STARTER_TRIAL_ENDED_MESSAGE;
};

type GateResult = {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
};

type GateDb = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<GateResult>;
      };
    };
  };
};

function missingMirrorColumn(message: string): boolean {
  return /starter_trial_enforced|starter_trial_generation_blocked|precard_cap_applies/i.test(message);
}

const ENDED_BLOCK: PaidGenerationBlock = {
  code: STARTER_TRIAL_ENDED_CODE,
  message: STARTER_TRIAL_ENDED_MESSAGE,
};

/** A stored entitled plan, or an exempt firm, stays open. */
function rowKeepsAiOpen(row: Record<string, unknown> | null): boolean {
  if (!row) return false;
  if (row.billing_plan_known === "entitled") return true;
  return row.starter_trial_enforced === false;
}

/**
 * The mirror read failed, or it says the trial ended. Read the stored plan
 * before refusing. A second failure does not invent a plan.
 */
async function knownPlanKeepsAiOpen(db: GateDb, firmId: string): Promise<boolean> {
  try {
    const plan = await db
      .from("firms")
      .select("id, billing_plan_known, starter_trial_enforced")
      .eq("id", firmId)
      .maybeSingle();
    if (plan.error) {
      if (!/billing_plan_known/i.test(plan.error.message ?? "")) return false;
      const legacy = await db
        .from("firms")
        .select("id, starter_trial_enforced")
        .eq("id", firmId)
        .maybeSingle();
      if (legacy.error) return false;
      return legacy.data?.starter_trial_enforced === false;
    }
    return rowKeepsAiOpen(plan.data);
  } catch {
    return false;
  }
}

/**
 * A QA start override uses the same no-plan clock as the server banner.
 * An empty override leaves the mirror in charge. A stored entitled plan
 * stays open. The column is ignored when this select cannot see it.
 */
function qaClockEnded(row: Record<string, unknown> | null, nowMs = Date.now()): boolean {
  if (!row || row.billing_plan_known === "entitled" || row.starter_trial_enforced !== true) return false;
  const override = row.trial_clock_start_override;
  if (typeof override !== "string" || !override.trim()) return false;
  const start = noPlanTrialStartMs(
    typeof row.created_at === "string" ? row.created_at : null,
    TRIAL_CLOCK_CUTOVER,
    override,
  );
  if (start == null) return false;
  return nowMs >= noPlanTrialEndMs(start);
}

async function readFirmForGate(db: GateDb, firmId: string, withClock: string, withoutClock: string): Promise<GateResult> {
  const firm = await db.from("firms").select(withClock).eq("id", firmId).maybeSingle();
  if (firm.error && /trial_clock_start_override|billing_plan_known/i.test(firm.error.message ?? "")) {
    return db.from("firms").select(withoutClock).eq("id", firmId).maybeSingle();
  }
  return firm;
}

/** Mirror flag or QA clock says stop, unless the stored plan keeps AI open. */
async function blockUnlessKnownPlan(db: GateDb, firmId: string, row: Record<string, unknown> | null): Promise<PaidGenerationBlock | null> {
  if (row?.starter_trial_generation_blocked !== true && !qaClockEnded(row)) return null;
  if (rowKeepsAiOpen(row)) return null;
  if (await knownPlanKeepsAiOpen(db, firmId)) return null;
  return ENDED_BLOCK;
}

/**
 * Null when the firm may generate. A block when the mirror says the
 * enforced Starter trial has ended, or the QA clock has. A stored entitled
 * plan, or an exempt firm, stays open when that read fails or the flags are
 * stale. Throws when neither the mirror nor the stored plan can be read.
 */
export async function paidGenerationTrialBlock(input: {
  db: unknown;
  userId: string;
  email?: string;
  clientId: string;
}): Promise<PaidGenerationBlock | null> {
  const db = input.db as GateDb;
  const client = await db.from("clients").select("firm_id").eq("id", input.clientId).maybeSingle();
  if (client.error) throw new Error(client.error.message);
  const firmId = client.data?.firm_id;
  if (typeof firmId !== "string" || !firmId) return null;

  const firm = await readFirmForGate(
    db,
    firmId,
    "id, starter_trial_enforced, starter_trial_generation_blocked, created_at, billing_plan_known, trial_clock_start_override",
    "id, starter_trial_enforced, starter_trial_generation_blocked",
  );
  if (firm.error) {
    if (missingMirrorColumn(firm.error.message ?? "")) return null;
    if (await knownPlanKeepsAiOpen(db, firmId)) return null;
    throw new Error(firm.error.message);
  }
  if (firm.data?.starter_trial_enforced !== true) return null;
  return blockUnlessKnownPlan(db, firmId, firm.data);
}

/**
 * Ask AI and Milōn Bot Q&A after the trial, when this firm has no plan.
 * A card-on-file trial does not set the pre-card flag, so Q&A stays open
 * there. A missing column fails open. A stored entitled plan, or an exempt
 * firm, stays open when the mirror read fails or the flags are stale.
 */
export async function cardlessTrialAiBlock(input: {
  db: unknown;
  clientId: string;
}): Promise<PaidGenerationBlock | null> {
  const db = input.db as GateDb;
  const client = await db.from("clients").select("firm_id").eq("id", input.clientId).maybeSingle();
  if (client.error) throw new Error(client.error.message);
  const firmId = client.data?.firm_id;
  if (typeof firmId !== "string" || !firmId) return null;

  const firm = await readFirmForGate(
    db,
    firmId,
    "id, precard_cap_applies, starter_trial_generation_blocked, starter_trial_enforced, created_at, billing_plan_known, trial_clock_start_override",
    "id, precard_cap_applies, starter_trial_generation_blocked",
  );
  if (firm.error) {
    if (missingMirrorColumn(firm.error.message ?? "")) return null;
    if (await knownPlanKeepsAiOpen(db, firmId)) return null;
    throw new Error(firm.error.message);
  }
  if (firm.data?.precard_cap_applies !== true) return null;
  return blockUnlessKnownPlan(db, firmId, firm.data);
}
