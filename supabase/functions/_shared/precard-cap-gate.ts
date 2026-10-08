/**
 * Edge read of the pre-card allowance. The flag is written by Vercel from
 * the live subscription. This file does not call Stripe. A missing column
 * or a flag that was never written fails open so a paying firm is not
 * blocked before the first billing sync.
 */
import {
  PRECARD_BOT_LIMIT,
  decidePrecardAllowance,
  finishPrecardAttempt,
  missingPrecardColumn,
  precardUsageFromRow,
  type PrecardDecision,
  type PrecardLimitKind,
} from "../../../src/lib/precard-cap.ts";

export type PrecardGateResult = PrecardDecision & { firmId: string | null };

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
  rpc?: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export async function readPrecardGate(input: {
  db: unknown;
  clientId: string;
  kind: PrecardLimitKind;
}): Promise<PrecardGateResult> {
  const db = input.db as GateDb;
  const client = await db.from("clients").select("firm_id").eq("id", input.clientId).maybeSingle();
  if (client.error) throw new Error(client.error.message);
  const firmId = client.data?.firm_id;
  if (typeof firmId !== "string" || !firmId) {
    return { allowed: true, applies: false, remaining: null, firmId: null };
  }

  const firm = await db
    .from("firms")
    .select(
      "id, precard_cap_applies, precard_pack_generations, precard_email_drafts, precard_bot_messages",
    )
    .eq("id", firmId)
    .maybeSingle();
  if (firm.error) {
    if (missingPrecardColumn(firm.error.message)) {
      return { allowed: true, applies: false, remaining: null, firmId };
    }
    throw new Error(firm.error.message);
  }
  if (firm.data?.precard_cap_applies !== true) {
    return { allowed: true, applies: false, remaining: null, firmId };
  }
  return {
    ...decidePrecardAllowance({
      applies: true,
      kind: input.kind,
      usage: precardUsageFromRow(firm.data),
    }),
    firmId,
  };
}

export async function recordPrecardUse(
  db: unknown,
  firmId: string,
  kind: PrecardLimitKind,
): Promise<number | null> {
  const id = firmId.trim();
  if (!id) return null;
  const rpc = (db as GateDb).rpc;
  if (!rpc) return null;
  const { data, error } = await rpc("increment_precard_usage", {
    p_firm_id: id,
    p_kind: kind,
  });
  if (error) return null;
  return typeof data === "number" && Number.isFinite(data) ? data : null;
}

export function precardMessagesLeft(nextCount: number | null, fallbackRemaining: number | null): number | null {
  if (typeof nextCount === "number" && Number.isFinite(nextCount)) {
    const left = Math.max(0, PRECARD_BOT_LIMIT - nextCount);
    return left > 0 ? left : null;
  }
  if (typeof fallbackRemaining === "number" && fallbackRemaining > 1) return fallbackRemaining - 1;
  return null;
}

export { finishPrecardAttempt };
