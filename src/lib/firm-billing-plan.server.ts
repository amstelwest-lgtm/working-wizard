/**
 * Last confirmed firm plan, on the firm row.
 * A live check writes it. A timeout reads it and does not replace it.
 * Null until a check succeeds. This module does not update Stripe.
 * Apply the billing_plan_known migration before this column exists.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import type { StoredFirmPlan } from "@/lib/billing-check-failure";

const FIRM_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let planColumnMissing = false;

export function resetFirmBillingPlanColumnProbe(): void {
  planColumnMissing = false;
}

function noteMissingPlanColumn(message: string): boolean {
  if (/billing_plan_known/i.test(message)) {
    planColumnMissing = true;
    return true;
  }
  return false;
}

function storedPlan(value: unknown): StoredFirmPlan | null {
  if (value === "entitled" || value === "none") return value;
  return null;
}

type FirmPlanRead = (firmId: string | null) => Promise<StoredFirmPlan | null>;

/** Tests replace the column read. Production leaves this unset. */
let planReadForTests: FirmPlanRead | null = null;

export function setFirmBillingPlanReadForTests(read: FirmPlanRead | null): void {
  planReadForTests = read;
}

export async function readFirmBillingPlanKnown(
  firmId: string | null | undefined,
): Promise<StoredFirmPlan | null> {
  if (planReadForTests) return planReadForTests(firmId?.trim() ? firmId.trim() : null);
  const id = firmId?.trim() ?? "";
  if (!FIRM_UUID.test(id) || planColumnMissing) return null;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return null;
    const { data, error } = await admin
      .from("firms")
      .select("billing_plan_known")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (!noteMissingPlanColumn(error.message ?? "")) {
        console.warn("[stripe] firm plan read failed", error.message);
      }
      return null;
    }
    return storedPlan(data?.billing_plan_known);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!noteMissingPlanColumn(message)) {
      console.warn("[stripe] firm plan read failed", message);
    }
    return null;
  }
}

export async function writeFirmBillingPlanKnown(
  firmId: string | null | undefined,
  plan: StoredFirmPlan,
): Promise<void> {
  const id = firmId?.trim() ?? "";
  if (!FIRM_UUID.test(id) || planColumnMissing) return;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return;
    const { error } = await admin.from("firms").update({ billing_plan_known: plan }).eq("id", id);
    if (error && !noteMissingPlanColumn(error.message ?? "")) {
      console.warn("[stripe] firm plan write failed", error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!noteMissingPlanColumn(message)) {
      console.warn("[stripe] firm plan write failed", message);
    }
  }
}
