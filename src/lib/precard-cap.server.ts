/**
 * Live pre-card check for pack generation and client-email drafts.
 * Phase comes from the existing firm subscription lookup. No new Stripe API.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { firmPrecardCapApplies } from "@/lib/firm-client-cap.server";
import {
  decidePrecardAllowance,
  missingPrecardColumn,
  precardUsageFromRow,
  type PrecardDecision,
  type PrecardLimitKind,
  type PrecardUsage,
} from "@/lib/precard-cap";
import { stripeConfigured } from "@/lib/stripe.server";

export type PrecardGateResult = PrecardDecision & { firmId: string | null };

const PLAN_CHECK_FAILED = "Could not check the plan. Nothing was generated.";

async function readPrecardUsage(firmId: string): Promise<PrecardUsage | null> {
  const admin = getSupabaseAdminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from("firms")
    .select("precard_pack_generations, precard_email_drafts, precard_bot_messages")
    .eq("id", firmId)
    .maybeSingle();
  if (error) {
    if (missingPrecardColumn(error.message)) return null;
    throw new Error(error.message);
  }
  return precardUsageFromRow(data as Record<string, unknown> | null);
}

export async function gatePrecardGeneration(input: {
  supabase: unknown;
  userId: string;
  email: string;
  firmId: string | null;
  kind: PrecardLimitKind;
}): Promise<PrecardGateResult> {
  const firmId = input.firmId?.trim() || null;
  if (!firmId || !stripeConfigured()) {
    return { allowed: true, applies: false, remaining: null, firmId };
  }
  let applies = false;
  try {
    applies = await firmPrecardCapApplies({
      supabase: input.supabase,
      userId: input.userId,
      email: input.email,
      firmId,
    });
  } catch (err) {
    console.warn("[precard-cap] plan check failed", err instanceof Error ? err.message : err);
    throw new Error(PLAN_CHECK_FAILED);
  }
  if (!applies) return { allowed: true, applies: false, remaining: null, firmId };
  let usage: PrecardUsage | null;
  try {
    usage = await readPrecardUsage(firmId);
  } catch (err) {
    console.warn("[precard-cap] counter read failed", err instanceof Error ? err.message : err);
    throw new Error(PLAN_CHECK_FAILED);
  }
  if (!usage) return { allowed: true, applies: false, remaining: null, firmId };
  return { ...decidePrecardAllowance({ applies: true, kind: input.kind, usage }), firmId };
}

/** Service-role increment. Returns the new count, or null when it could not be written. */
export async function recordPrecardGeneration(
  firmId: string,
  kind: PrecardLimitKind,
): Promise<number | null> {
  const id = firmId.trim();
  if (!id) return null;
  const admin = getSupabaseAdminOrNull();
  if (!admin) return null;
  const { data, error } = await admin.rpc("increment_precard_usage", {
    p_firm_id: id,
    p_kind: kind,
  });
  if (error) {
    if (!missingPrecardColumn(error.message) && !/increment_precard_usage/i.test(error.message)) {
      console.warn("[precard-cap] increment failed", error.message);
    }
    return null;
  }
  return typeof data === "number" && Number.isFinite(data) ? data : null;
}
