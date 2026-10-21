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
let planReadOverride: FirmPlanRead | null = null;

export function setFirmBillingPlanReadForTests(read: FirmPlanRead | null): void {
  planReadOverride = read;
}

async function loadFirmBillingPlanKnown(
  firmId: string | null | undefined,
): Promise<StoredFirmPlan | null> {
  const id = firmId?.trim() ?? "";
  if (!FIRM_UUID.test(id) || planColumnMissing) return null;
  const admin = getSupabaseAdminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from("firms")
    .select("billing_plan_known")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (noteMissingPlanColumn(error.message ?? "")) return null;
    throw new Error(error.message);
  }
  return storedPlan(data?.billing_plan_known);
}

export async function readFirmBillingPlanKnown(
  firmId: string | null | undefined,
): Promise<StoredFirmPlan | null> {
  try {
    return await loadFirmBillingPlanKnown(firmId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!noteMissingPlanColumn(message)) {
      console.warn("[stripe] firm plan read failed", message);
    }
    return null;
  }
}

/**
 * The stored-plan read on its own short clock. A timeout or a query error
 * rejects. A missing column or a null value resolves null.
 */
export async function readFirmBillingPlanKnownWithin(
  firmId: string | null | undefined,
  budgetMs: number,
  signal?: AbortSignal,
): Promise<StoredFirmPlan | null> {
  if (signal?.aborted) {
    throw Object.assign(new Error("firm plan read aborted"), { name: "AbortError" });
  }
  const budget = Math.max(1, Math.floor(budgetMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise((resolve, reject) => {
      const abort = () => {
        reject(Object.assign(new Error("firm plan read aborted"), { name: "AbortError" }));
      };
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => {
        reject(Object.assign(new Error("firm plan read timeout"), { name: "TimeoutError" }));
      }, budget);
      const read = planReadOverride
        ? planReadOverride(firmId ?? null)
        : loadFirmBillingPlanKnown(firmId);
      read.then(
        (plan) => {
          signal?.removeEventListener("abort", abort);
          resolve(plan);
        },
        (err: unknown) => {
          signal?.removeEventListener("abort", abort);
          reject(err);
        },
      );
    });
  } finally {
    if (timer) clearTimeout(timer);
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
