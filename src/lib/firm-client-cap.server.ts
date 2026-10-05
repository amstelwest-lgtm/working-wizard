/**
 * Live client-cap check. Stripe subscription phase is source of truth;
 * the firm client count is read from Postgres (service role when present).
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  bandIdFromStripeMetadata,
  decideFirmClientCreate,
  formatFirmPlanStatus,
  phaseFromSubscriptionStatus,
  type FirmClientCreateAllowance,
  type FirmPlanDisplay,
  type FirmSubscriptionPhase,
} from "@/lib/firm-client-cap";
import type { FirmBandId } from "@/lib/stripe-plans";
import { findCustomerIdByEmail } from "@/lib/stripe-entitlement";
import { getStripe, stripeConfigured } from "@/lib/stripe.server";

export type EntitlingFirmSubscription = {
  id: string;
  phase: Exclude<FirmSubscriptionPhase, "none">;
  band: FirmBandId | null;
  /** ISO timestamp when the subscription is trialing; otherwise null. */
  trialEnd: string | null;
};

type FirmRow = { id?: string; owner_user_id?: string | null };

type CapDb = {
  from: (table: string) => {
    select: (
      columns: string,
      options?: { count: "exact"; head: true },
    ) => {
      eq: (
        column: string,
        value: string,
      ) => {
        limit: (n: number) => Promise<{
          data: FirmRow[] | null;
          error: { message: string } | null;
        }>;
        maybeSingle: () => Promise<{
          data: FirmRow | null;
          error: { message: string } | null;
        }>;
      } & Promise<{ count: number | null; error: { message: string } | null }>;
    };
  };
  auth?: {
    getUser: () => Promise<{ data: { user: { email?: string | null } | null } }>;
  };
};

function asCapDb(client: unknown): CapDb {
  return client as CapDb;
}

export async function findEntitlingFirmSubscription(
  email: string,
): Promise<EntitlingFirmSubscription | null> {
  if (!stripeConfigured()) return null;
  const trimmed = email.trim();
  if (!trimmed) return null;
  const stripe = getStripe();
  const customerId = await findCustomerIdByEmail(stripe, trimmed);
  if (!customerId) return null;
  const listed = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
  });
  const hit =
    listed.data.find((sub) => sub.status === "trialing") ??
    listed.data.find((sub) => sub.status === "active");
  if (!hit) return null;
  const phase = phaseFromSubscriptionStatus(hit.status);
  if (phase === "none") return null;
  const trialEndSeconds = (hit as { trial_end?: number | null }).trial_end;
  return {
    id: hit.id,
    phase,
    band: bandIdFromStripeMetadata({ milon_plan: hit.metadata?.milon_plan }),
    trialEnd:
      typeof trialEndSeconds === "number" && Number.isFinite(trialEndSeconds)
        ? new Date(trialEndSeconds * 1000).toISOString()
        : null,
  };
}

async function loadFirm(
  db: CapDb,
  firmId: string | null,
  userId: string,
): Promise<{ id: string; ownerUserId: string | null } | null> {
  if (firmId) {
    const { data, error } = await db
      .from("firms")
      .select("id, owner_user_id")
      .eq("id", firmId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.id) return { id: data.id, ownerUserId: data.owner_user_id ?? null };
  }
  const listed = await db
    .from("firms")
    .select("id, owner_user_id")
    .eq("owner_user_id", userId)
    .limit(1);
  if (listed.error) throw new Error(listed.error.message);
  const row = listed.data?.[0];
  if (!row?.id) return null;
  return { id: row.id, ownerUserId: row.owner_user_id ?? userId };
}

async function countFirmClients(db: CapDb, firmId: string): Promise<number> {
  const { count, error } = await db
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("firm_id", firmId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function billingEmailForFirm(
  actorUserId: string,
  actorEmail: string,
  ownerUserId: string | null,
): Promise<{ email: string; actorIsBillingCustomer: boolean }> {
  if (!ownerUserId || ownerUserId === actorUserId) {
    return { email: actorEmail, actorIsBillingCustomer: true };
  }
  const admin = getSupabaseAdminOrNull();
  if (!admin) return { email: actorEmail, actorIsBillingCustomer: false };
  const { data } = await admin.auth.admin.getUserById(ownerUserId);
  const ownerEmail = data.user?.email?.trim() ?? "";
  if (!ownerEmail) return { email: actorEmail, actorIsBillingCustomer: false };
  return { email: ownerEmail, actorIsBillingCustomer: false };
}

export async function loadFirmClientCreateAllowance(input: {
  supabase: unknown;
  userId: string;
  email: string;
  firmId: string | null;
}): Promise<FirmClientCreateAllowance> {
  if (!stripeConfigured()) return { allowed: true, canEndTrial: false };

  const userDb = asCapDb(input.supabase);
  let email = input.email.trim();
  if (!email && userDb.auth) {
    const { data } = await userDb.auth.getUser();
    email = data.user?.email?.trim() ?? "";
  }

  const admin = getSupabaseAdminOrNull();
  const db = admin ? asCapDb(admin) : userDb;
  const firm = await loadFirm(db, input.firmId, input.userId);
  if (!firm) return { allowed: true, canEndTrial: false };

  const [clientCount, billing] = await Promise.all([
    countFirmClients(db, firm.id),
    billingEmailForFirm(input.userId, email, firm.ownerUserId),
  ]);
  const sub = billing.email ? await findEntitlingFirmSubscription(billing.email) : null;
  const decision = decideFirmClientCreate({
    stripeConfigured: true,
    phase: sub?.phase ?? "none",
    band: sub?.band ?? null,
    clientCount,
  });
  if (decision.allowed) return { allowed: true, canEndTrial: false };
  return {
    ...decision,
    canEndTrial: decision.code === "trial_client_cap" && billing.actorIsBillingCustomer,
  };
}

/**
 * Read-only plan/trial line. Reuses the subscription lookup the client-cap
 * gate already performs. Does not create Stripe customers, subscriptions, or prices.
 */
export async function loadFirmPlanDisplay(input: {
  supabase: unknown;
  userId: string;
  email: string;
  firmId: string | null;
}): Promise<FirmPlanDisplay> {
  if (!stripeConfigured()) {
    return { configured: false, phase: "none", band: null, headline: null, detail: null };
  }

  const userDb = asCapDb(input.supabase);
  let email = input.email.trim();
  if (!email && userDb.auth) {
    const { data } = await userDb.auth.getUser();
    email = data.user?.email?.trim() ?? "";
  }

  const admin = getSupabaseAdminOrNull();
  const db = admin ? asCapDb(admin) : userDb;
  const firm = await loadFirm(db, input.firmId, input.userId);
  if (!firm) {
    return {
      configured: true,
      ...formatFirmPlanStatus({ phase: "none", band: null }),
    };
  }

  const billing = await billingEmailForFirm(input.userId, email, firm.ownerUserId);
  const sub = billing.email ? await findEntitlingFirmSubscription(billing.email) : null;
  return {
    configured: true,
    ...formatFirmPlanStatus({
      phase: sub?.phase ?? "none",
      band: sub?.band ?? null,
      trialEndIso: sub?.trialEnd ?? null,
    }),
  };
}
