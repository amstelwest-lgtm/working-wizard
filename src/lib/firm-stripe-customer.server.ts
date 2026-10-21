/**
 * firms.stripe_customer_id is the stable key for the firm plan.
 * Service role writes it on Checkout, webhook success, or a subscription
 * metadata hit for this firm. A metadata hit fills a null id and does not
 * replace a different one. A missing column (migration not applied yet) is
 * remembered for this process so later checks do not select it again.
 * This module does not update Stripe.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { registerMetadataFirmCustomerWrite } from "@/lib/stripe-entitlement";
import { writeFirmBillingPlanKnown } from "@/lib/firm-billing-plan.server";

const FIRM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** This process already saw firms.stripe_customer_id missing (42703). */
let stripeCustomerColumnMissing = false;
let stripeCustomerColumnProbes = 0;

export function firmStripeCustomerColumnKnownMissing(): boolean {
  return stripeCustomerColumnMissing;
}

export function firmStripeCustomerColumnProbes(): number {
  return stripeCustomerColumnProbes;
}

export function resetFirmStripeCustomerColumnProbe(): void {
  stripeCustomerColumnMissing = false;
  stripeCustomerColumnProbes = 0;
}

/** True when PostgREST or Postgres says the column is not there. */
export function noteMissingFirmStripeCustomerColumn(message: string): boolean {
  if (/stripe_customer_id/i.test(message) || /\b42703\b/.test(message)) {
    stripeCustomerColumnMissing = true;
    return true;
  }
  return false;
}

export function isStripeCustomerId(value: unknown): value is string {
  return typeof value === "string" && /^cus_[A-Za-z0-9]+$/.test(value.trim());
}

export async function readFirmStripeCustomerId(
  firmId: string | null | undefined,
): Promise<string | null> {
  const id = firmId?.trim() ?? "";
  if (!FIRM_UUID.test(id)) return null;
  if (stripeCustomerColumnMissing) return null;
  stripeCustomerColumnProbes += 1;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return null;
    const { data, error } = await admin
      .from("firms")
      .select("stripe_customer_id")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (!noteMissingFirmStripeCustomerColumn(error.message ?? "")) {
        console.warn("[stripe] firm customer id read failed", error.message);
      }
      return null;
    }
    const customerId = data?.stripe_customer_id;
    return isStripeCustomerId(customerId) ? customerId.trim() : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!noteMissingFirmStripeCustomerColumn(message)) {
      console.warn("[stripe] firm customer id read failed", message);
    }
    return null;
  }
}

/** Firm that already stores this Stripe customer. Null when none does. */
export async function firmIdForStripeCustomer(
  customerId: string | null | undefined,
): Promise<string | null> {
  const customer = customerId?.trim() ?? "";
  if (!isStripeCustomerId(customer) || stripeCustomerColumnMissing) return null;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return null;
    const { data, error } = await admin
      .from("firms")
      .select("id")
      .eq("stripe_customer_id", customer)
      .maybeSingle();
    if (error) {
      if (!noteMissingFirmStripeCustomerColumn(error.message ?? "")) {
        console.warn("[stripe] firm customer lookup failed");
      }
      return null;
    }
    const firmId = data?.id;
    return typeof firmId === "string" && FIRM_UUID.test(firmId) ? firmId : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!noteMissingFirmStripeCustomerColumn(message)) {
      console.warn("[stripe] firm customer lookup failed");
    }
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
  if (stripeCustomerColumnMissing) return;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return;
    const { error } = await admin
      .from("firms")
      .update({ stripe_customer_id: customer })
      .eq("id", id);
    if (error && !noteMissingFirmStripeCustomerColumn(error.message ?? "")) {
      console.warn("[stripe] firm customer id write failed", error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!noteMissingFirmStripeCustomerColumn(message)) {
      console.warn("[stripe] firm customer id write failed", message);
    }
  }
}

/**
 * Fill a null firms.stripe_customer_id. A stored id, including a different
 * one, is not updated. The unique index rejects a customer that already
 * belongs to another firm.
 */
async function fillFirmStripeCustomerIdIfNull(
  firmId: string,
  customerId: string,
): Promise<boolean> {
  if (!FIRM_UUID.test(firmId) || !isStripeCustomerId(customerId) || stripeCustomerColumnMissing) {
    return false;
  }
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return false;
    const { data, error } = await admin
      .from("firms")
      .update({ stripe_customer_id: customerId })
      .eq("id", firmId)
      .is("stripe_customer_id", null)
      .select("id");
    if (error) {
      if (!noteMissingFirmStripeCustomerColumn(error.message ?? "")) {
        console.warn("[stripe] firm customer id from metadata was not stored", error.message);
      }
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!noteMissingFirmStripeCustomerColumn(message)) {
      console.warn("[stripe] firm customer id from metadata was not stored", message);
    }
    return false;
  }
}

async function persistMetadataFirmCustomer(input: {
  firmId: string;
  customerId: string | null;
  plan: "entitled" | null;
  metadataCustomerId: string;
}): Promise<void> {
  try {
    let storedCustomerId: string | null = null;
    if (input.customerId) {
      const wrote = await fillFirmStripeCustomerIdIfNull(input.firmId, input.customerId);
      storedCustomerId = wrote ? input.customerId : null;
    }
    if (input.plan === "entitled") {
      await writeFirmBillingPlanKnown(input.firmId, "entitled");
    }
    console.info("[stripe] subscription metadata stored the firm plan", {
      firmId: input.firmId,
      customerId: storedCustomerId,
      plan: input.plan,
      metadataCustomerId: input.metadataCustomerId,
    });
  } catch (err) {
    console.warn(
      "[stripe] metadata firm customer was not stored",
      err instanceof Error ? err.message : err,
    );
  }
}

let metadataFirmWriteInstalled = false;

/** Service-role write for a subscription metadata hit. Idempotent. */
export function installMetadataFirmCustomerWrite(): void {
  if (metadataFirmWriteInstalled) return;
  metadataFirmWriteInstalled = true;
  registerMetadataFirmCustomerWrite((input) => {
    void persistMetadataFirmCustomer(input);
  });
}

/** Firm owned by this user, when subscription metadata has no firm_id yet. */
export async function firmIdForOwnerUser(
  userId: string | null | undefined,
): Promise<string | null> {
  const id = userId?.trim() ?? "";
  if (!FIRM_UUID.test(id)) return null;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return null;
    const { data, error } = await admin.from("firms").select("id").eq("owner_user_id", id).limit(1);
    if (error) return null;
    const firmId = data?.[0]?.id;
    return typeof firmId === "string" && FIRM_UUID.test(firmId) ? firmId : null;
  } catch {
    return null;
  }
}
