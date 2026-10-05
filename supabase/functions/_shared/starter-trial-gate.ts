/**
 * Edge-function read of the Starter-trial generation mirror.
 * Vercel writes firms.starter_trial_generation_blocked from the live billing
 * clock. This file does not call the billing API. Null (never written) and a
 * missing column fail open so a paying firm is not blocked before the first sync.
 */
import { STARTER_TRIAL_ENDED_MESSAGE } from "../../../src/lib/firm-starter-trial.ts";
import { STARTER_TRIAL_ENDED_CODE } from "../../../src/lib/starter-trial-generation.ts";

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
  return /starter_trial_enforced|starter_trial_generation_blocked/i.test(message);
}

/**
 * Null when the firm may generate. A block when the mirror says the
 * enforced Starter trial has ended. Throws when the row cannot be read.
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
    if (missingMirrorColumn(firm.error.message)) return null;
    throw new Error(firm.error.message);
  }
  if (firm.data?.starter_trial_enforced !== true) return null;
  if (firm.data?.starter_trial_generation_blocked !== true) return null;
  return { code: STARTER_TRIAL_ENDED_CODE, message: STARTER_TRIAL_ENDED_MESSAGE };
}
