/**
 * Last confirmed firm plan, on the firm row.
 * A live check writes it. A timeout reads it and does not replace it.
 * Null until a check succeeds. This module does not update Stripe.
 * Apply the billing_plan_known migration before this column exists.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import type { StoredFirmPlan } from "@/lib/billing-check-failure";

const FIRM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let planColumnMissing = false;
let pastDueColumnMissing = false;

export function resetFirmBillingPlanColumnProbe(): void {
  planColumnMissing = false;
  pastDueColumnMissing = false;
}

function noteMissingPlanColumn(message: string): boolean {
  if (/billing_plan_known/i.test(message)) {
    planColumnMissing = true;
    return true;
  }
  return false;
}

function noteMissingPastDueColumn(message: string): boolean {
  if (/billing_past_due_at/i.test(message)) {
    pastDueColumnMissing = true;
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

export type FirmBillingColumnRead<T> = { ok: true; value: T } | { ok: false };

/**
 * In-memory stand-in for the firm plan columns. Production leaves this unset.
 * A webhook test uses it so a missing service-role key cannot hide a write.
 */
export type FirmBillingWebhookStore = {
  readPlan: (firmId: string) => Promise<FirmBillingColumnRead<StoredFirmPlan | null>>;
  writePlan: (firmId: string, plan: StoredFirmPlan) => Promise<void>;
  readPastDueAt: (firmId: string) => Promise<FirmBillingColumnRead<string | null>>;
  writePastDueAt: (firmId: string, at: string | null) => Promise<boolean>;
  /** When set, webhook tests decide firms.is_internal without a database. */
  isInternal?: (firmId: string) => Promise<boolean>;
};

let webhookStore: FirmBillingWebhookStore | null = null;

export function setFirmBillingWebhookStoreForTests(store: FirmBillingWebhookStore | null): void {
  webhookStore = store;
}

/**
 * firms.is_internal. True skips a downgrade. False is a normal firm.
 * Null means the read failed, which must not be treated as a downgrade.
 */
export async function readFirmIsInternal(
  firmId: string | null | undefined,
): Promise<boolean | null> {
  const id = firmId?.trim() ?? "";
  if (!FIRM_UUID.test(id)) return false;
  if (webhookStore?.isInternal) return webhookStore.isInternal(id);
  if (webhookStore) return false;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return null;
    const { data, error } = await admin
      .from("firms")
      .select("is_internal")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.warn("[stripe] firm internal read failed");
      return null;
    }
    return data?.is_internal === true;
  } catch {
    console.warn("[stripe] firm internal read failed");
    return null;
  }
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

/**
 * Distinguishes a stored plan from a failed read.
 * A failed read must not be treated as "none".
 */
export async function readFirmBillingPlanState(
  firmId: string | null | undefined,
): Promise<FirmBillingColumnRead<StoredFirmPlan | null>> {
  const id = firmId?.trim() ?? "";
  if (!FIRM_UUID.test(id)) return { ok: false };
  if (webhookStore) return webhookStore.readPlan(id);
  if (planColumnMissing) return { ok: false };
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return { ok: false };
    const { data, error } = await admin
      .from("firms")
      .select("billing_plan_known")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (!noteMissingPlanColumn(error.message ?? "")) {
        console.warn("[stripe] firm plan read failed");
      }
      return { ok: false };
    }
    return { ok: true, value: storedPlan(data?.billing_plan_known) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!noteMissingPlanColumn(message)) {
      console.warn("[stripe] firm plan read failed");
    }
    return { ok: false };
  }
}

/** When the invoice failed, and null when the firm is not past due. */
export async function readFirmBillingPastDueAt(
  firmId: string | null | undefined,
): Promise<FirmBillingColumnRead<string | null>> {
  const id = firmId?.trim() ?? "";
  if (!FIRM_UUID.test(id)) return { ok: false };
  if (webhookStore) return webhookStore.readPastDueAt(id);
  if (pastDueColumnMissing) return { ok: false };
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return { ok: false };
    const { data, error } = await admin
      .from("firms")
      .select("billing_past_due_at")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (!noteMissingPastDueColumn(error.message ?? "")) {
        console.warn("[stripe] firm past-due read failed");
      }
      return { ok: false };
    }
    const at = data?.billing_past_due_at;
    return { ok: true, value: typeof at === "string" && at.trim() ? at : null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!noteMissingPastDueColumn(message)) {
      console.warn("[stripe] firm past-due read failed");
    }
    return { ok: false };
  }
}

/** Stores the grace start, or clears it. False when the column was not written. */
export async function writeFirmBillingPastDueAt(
  firmId: string | null | undefined,
  at: string | null,
): Promise<boolean> {
  const id = firmId?.trim() ?? "";
  if (!FIRM_UUID.test(id)) return false;
  if (webhookStore) return webhookStore.writePastDueAt(id, at);
  if (pastDueColumnMissing) return false;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return false;
    const { error } = await admin.from("firms").update({ billing_past_due_at: at }).eq("id", id);
    if (error) {
      if (!noteMissingPastDueColumn(error.message ?? "")) {
        console.warn("[stripe] firm past-due write failed");
      }
      return false;
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!noteMissingPastDueColumn(message)) {
      console.warn("[stripe] firm past-due write failed");
    }
    return false;
  }
}

/** Clears a past-due marker. A missing marker or a failed read does not write. */
export async function clearFirmBillingPastDueAt(firmId: string | null | undefined): Promise<void> {
  const current = await readFirmBillingPastDueAt(firmId);
  if (!current.ok || current.value == null) return;
  await writeFirmBillingPastDueAt(firmId, null);
}

export async function writeFirmBillingPlanKnown(
  firmId: string | null | undefined,
  plan: StoredFirmPlan,
): Promise<void> {
  const id = firmId?.trim() ?? "";
  if (!FIRM_UUID.test(id)) return;
  if (webhookStore) {
    await webhookStore.writePlan(id, plan);
    return;
  }
  if (planColumnMissing) return;
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
