/**
 * Edge-function read of the Starter-trial generation mirror.
 * Vercel writes firms.starter_trial_generation_blocked from the live billing
 * clock. This file does not call the billing API. Null (never written) and a
 * missing column fail open so a paying firm is not blocked before the first sync.
 */
import {
  STARTER_TRIAL_ENDED_CODE,
  STARTER_TRIAL_ENDED_MESSAGE,
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
 * Null when the firm may generate. A block when the mirror says the
 * enforced Starter trial has ended. A stored entitled plan, or an exempt
 * firm, stays open when that mirror read fails. Throws when neither the
 * mirror nor the stored plan can be read.
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

  const firm = await db
    .from("firms")
    .select("id, starter_trial_enforced, starter_trial_generation_blocked")
    .eq("id", firmId)
    .maybeSingle();
  if (firm.error) {
    if (missingMirrorColumn(firm.error.message ?? "")) return null;
    if (await knownPlanKeepsAiOpen(db, firmId)) return null;
    throw new Error(firm.error.message);
  }
  if (firm.data?.starter_trial_enforced !== true) return null;
  if (firm.data?.starter_trial_generation_blocked !== true) return null;
  if (await knownPlanKeepsAiOpen(db, firmId)) return null;
  return ENDED_BLOCK;
}

/**
 * Ask AI and Milōn Bot Q&A after the trial, when this firm has no plan.
 * A card-on-file trial does not set the pre-card flag, so Q&A stays open
 * there. A missing column fails open.
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

  const firm = await db
    .from("firms")
    .select("id, precard_cap_applies, starter_trial_generation_blocked")
    .eq("id", firmId)
    .maybeSingle();
  if (firm.error) {
    if (missingMirrorColumn(firm.error.message ?? "")) return null;
    if (await knownPlanKeepsAiOpen(db, firmId)) return null;
    throw new Error(firm.error.message);
  }
  if (firm.data?.precard_cap_applies !== true) return null;
  if (firm.data?.starter_trial_generation_blocked !== true) return null;
  if (await knownPlanKeepsAiOpen(db, firmId)) return null;
  return ENDED_BLOCK;
}
