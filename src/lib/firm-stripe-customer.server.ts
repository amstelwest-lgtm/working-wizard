/**
 * firms.stripe_customer_id is the stable key for the firm plan.
 * Service role writes it on Checkout or webhook success. A missing column
 * (migration not applied yet) leaves the lookup on metadata search, then email.
 * This module does not update Stripe.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";

const FIRM_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isStripeCustomerId(value: unknown): value is string {
  return typeof value === "string" && /^cus_[A-Za-z0-9]+$/.test(value.trim());
}

export async function readFirmStripeCustomerId(
  firmId: string | null | undefined,
): Promise<string | null> {
  const id = firmId?.trim() ?? "";
  if (!FIRM_UUID.test(id)) return null;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return null;
    const { data, error } = await admin
      .from("firms")
      .select("stripe_customer_id")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (!/stripe_customer_id/i.test(error.message)) {
        console.warn("[stripe] firm customer id read failed", error.message);
      }
      return null;
    }
    const customerId = data?.stripe_customer_id;
    return isStripeCustomerId(customerId) ? customerId.trim() : null;
  } catch (err) {
    console.warn(
      "[stripe] firm customer id read failed",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function writeFirmStripeCustomerId(
  firmId: string | null | undefined,
  customerId: string | null | undefined,
): Promise<void> {
  const id = firmId?.trim() ?? "";
  const customer = customerId?.trim() ?? "";
  if (!FIRM_UUID.test(id) || !isStripeCustomerId(customer)) return;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return;
    const { error } = await admin
      .from("firms")
      .update({ stripe_customer_id: customer })
      .eq("id", id);
    if (error && !/stripe_customer_id/i.test(error.message)) {
      console.warn("[stripe] firm customer id write failed", error.message);
    }
  } catch (err) {
    console.warn(
      "[stripe] firm customer id write failed",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Firm owned by this user, when subscription metadata has no firm_id yet. */
export async function firmIdForOwnerUser(userId: string | null | undefined): Promise<string | null> {
  const id = userId?.trim() ?? "";
  if (!FIRM_UUID.test(id)) return null;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return null;
    const { data, error } = await admin
      .from("firms")
      .select("id")
      .eq("owner_user_id", id)
      .limit(1);
    if (error) return null;
    const firmId = data?.[0]?.id;
    return typeof firmId === "string" && FIRM_UUID.test(firmId) ? firmId : null;
  } catch {
    return null;
  }
}
