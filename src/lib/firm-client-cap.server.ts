/**
 * Live client-cap check. Stripe subscription phase is source of truth;
 * the firm client count is read from Postgres (service role when present).
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  decideFirmClientCreate,
  formatFirmPlanStatus,
  phaseFromSubscriptionStatus,
  type FirmClientCreateAllowance,
  type FirmPlanDisplay,
  type FirmSubscriptionPhase,
} from "@/lib/firm-client-cap";
import {
  ASK_FIRM_OWNER_TO_UPGRADE,
  bandFromSubscriptionSnapshot,
  billingCurrencyCode,
  callerCanManageFirmBilling,
  emptyFirmUpgradeSnapshot,
  firmUpgradePriceCurrency,
  firmUsageLimit,
  formatFirmClientUsage,
  pickEntitlingFirmSubscription,
  readSubscriptionPrice,
  type FirmUpgradeSnapshot,
} from "@/lib/firm-band-upgrade";
import { parseMarketSelection } from "@/lib/market/parse";
import type { FirmBandId, FirmInterval } from "@/lib/stripe-plans";
import { findCustomerIdByEmail } from "@/lib/stripe-entitlement";
import { getStripe, stripeConfigured } from "@/lib/stripe.server";

export type EntitlingFirmSubscription = {
  id: string;
  customerId: string;
  phase: Exclude<FirmSubscriptionPhase, "none">;
  band: FirmBandId | null;
  /** ISO timestamp when the subscription is trialing; otherwise null. */
  trialEnd: string | null;
  interval: FirmInterval | null;
  currency: string | null;
  itemId: string | null;
  metadata: Record<string, string>;
  hasDefaultPaymentMethod: boolean;
};

type FirmRow = { id?: string; owner_user_id?: string | null; market?: unknown };

type LooseQuery = {
  eq: (column: string, value: string) => LooseQuery;
  maybeSingle: () => Promise<{
    data: { role?: string | null } | null;
    error: { message: string } | null;
  }>;
};

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

function stringMetadata(metadata: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!metadata || typeof metadata !== "object") return out;
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
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
  let listed: {
    data: Array<Record<string, unknown> & { id: string; status: string; created?: number }>;
  };
  try {
    listed = (await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
      expand: ["data.items.data.price"],
    })) as unknown as typeof listed;
  } catch (err) {
    console.warn(
      "[stripe] subscription price expand failed",
      err instanceof Error ? err.message : err,
    );
    listed = (await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    })) as unknown as typeof listed;
  }
  const ranked = listed.data.map((sub) => {
    const price = readSubscriptionPrice(sub as Parameters<typeof readSubscriptionPrice>[0]);
    const metadata = stringMetadata((sub as { metadata?: unknown }).metadata);
    return {
      raw: sub,
      id: sub.id,
      status: sub.status,
      created: typeof sub.created === "number" ? sub.created : 0,
      band: bandFromSubscriptionSnapshot({
        lookupKey: price.lookupKey,
        metadataPlan: metadata.milon_plan,
      }),
      price,
      metadata,
    };
  });
  const hit = pickEntitlingFirmSubscription(ranked);
  if (!hit) return null;
  const phase = phaseFromSubscriptionStatus(hit.status);
  if (phase === "none") return null;
  const trialEndSeconds = (hit.raw as { trial_end?: number | null }).trial_end;
  const defaultPaymentMethod = (hit.raw as { default_payment_method?: unknown })
    .default_payment_method;
  const defaultSource = (hit.raw as { default_source?: unknown }).default_source;
  return {
    id: hit.id,
    customerId,
    phase,
    band: hit.band,
    trialEnd:
      typeof trialEndSeconds === "number" && Number.isFinite(trialEndSeconds)
        ? new Date(trialEndSeconds * 1000).toISOString()
        : null,
    interval: hit.price.interval,
    currency: hit.price.currency,
    itemId: hit.price.itemId,
    metadata: hit.metadata,
    hasDefaultPaymentMethod: Boolean(defaultPaymentMethod || defaultSource),
  };
}

async function loadFirm(
  db: CapDb,
  firmId: string | null,
  userId: string,
): Promise<{ id: string; ownerUserId: string | null; market: unknown } | null> {
  if (firmId) {
    const { data, error } = await db
      .from("firms")
      .select("id, owner_user_id, market")
      .eq("id", firmId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data?.id) {
      return { id: data.id, ownerUserId: data.owner_user_id ?? null, market: data.market ?? null };
    }
  }
  const listed = await db
    .from("firms")
    .select("id, owner_user_id, market")
    .eq("owner_user_id", userId)
    .limit(1);
  if (listed.error) throw new Error(listed.error.message);
  const row = listed.data?.[0];
  if (!row?.id) return null;
  return { id: row.id, ownerUserId: row.owner_user_id ?? userId, market: row.market ?? null };
}

async function loadMembershipRole(
  db: unknown,
  firmId: string,
  userId: string,
): Promise<string | null> {
  const query = (db as { from: (table: string) => { select: (columns: string) => LooseQuery } })
    .from("firm_memberships")
    .select("role")
    .eq("firm_id", firmId)
    .eq("user_id", userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data?.role ?? null;
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

export async function assertCallerCanUpgradeFirm(input: {
  supabase: unknown;
  userId: string;
  email: string;
  firmId: string;
}): Promise<{ billingEmail: string }> {
  const userDb = asCapDb(input.supabase);
  let email = input.email.trim();
  if (!email && userDb.auth) {
    const { data } = await userDb.auth.getUser();
    email = data.user?.email?.trim() ?? "";
  }
  const admin = getSupabaseAdminOrNull();
  const db = admin ? asCapDb(admin) : userDb;
  const firm = await loadFirm(db, input.firmId, input.userId);
  if (!firm) throw new Error("Practice not found.");
  const role = await loadMembershipRole(db, firm.id, input.userId);
  const allowed = callerCanManageFirmBilling({
    isOwner: Boolean(firm.ownerUserId && firm.ownerUserId === input.userId),
    membershipRole: role,
  });
  if (!allowed) throw new Error(ASK_FIRM_OWNER_TO_UPGRADE);
  const billing = await billingEmailForFirm(input.userId, email, firm.ownerUserId);
  if (!billing.email) throw new Error("The firm owner has no billing email.");
  return { billingEmail: billing.email };
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
  if (!firm) return { allowed: true, canEndTrial: false, upgrade: emptyFirmUpgradeSnapshot() };

  const [clientCount, billing, role] = await Promise.all([
    countFirmClients(db, firm.id),
    billingEmailForFirm(input.userId, email, firm.ownerUserId),
    loadMembershipRole(db, firm.id, input.userId),
  ]);
  const sub = billing.email ? await findEntitlingFirmSubscription(billing.email) : null;
  const upgrade = await buildUpgradeSnapshot({
    isOwner: Boolean(firm.ownerUserId && firm.ownerUserId === input.userId),
    membershipRole: role,
    market: firm.market,
    clientCount,
    sub,
  });
  const decision = decideFirmClientCreate({
    stripeConfigured: true,
    phase: sub?.phase ?? "none",
    band: sub?.band ?? null,
    clientCount,
  });
  if (decision.allowed) return { allowed: true, canEndTrial: false, upgrade };
  return {
    ...decision,
    canEndTrial: decision.code === "trial_client_cap" && billing.actorIsBillingCustomer,
    upgrade,
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
    return {
      configured: false,
      phase: "none",
      band: null,
      headline: null,
      detail: null,
      clientCount: null,
      clientLimit: null,
      usageLabel: null,
      canUpgrade: false,
      priceCurrency: "USD",
      interval: "month",
      zarByBand: {},
    };
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
    const empty = emptyFirmUpgradeSnapshot();
    return {
      configured: true,
      ...formatFirmPlanStatus({ phase: "none", band: null }),
      clientCount: null,
      clientLimit: null,
      usageLabel: null,
      canUpgrade: false,
      priceCurrency: empty.priceCurrency,
      interval: empty.interval,
      zarByBand: {},
    };
  }

  const [billing, role, clientCount] = await Promise.all([
    billingEmailForFirm(input.userId, email, firm.ownerUserId),
    loadMembershipRole(db, firm.id, input.userId),
    countFirmClients(db, firm.id),
  ]);
  const sub = billing.email ? await findEntitlingFirmSubscription(billing.email) : null;
  const upgrade = await buildUpgradeSnapshot({
    isOwner: Boolean(firm.ownerUserId && firm.ownerUserId === input.userId),
    membershipRole: role,
    market: firm.market,
    clientCount,
    sub,
  });
  return {
    configured: true,
    ...formatFirmPlanStatus({
      phase: sub?.phase ?? "none",
      band: sub?.band ?? null,
      trialEndIso: sub?.trialEnd ?? null,
    }),
    clientCount: upgrade.clientCount,
    clientLimit: upgrade.clientLimit,
    usageLabel: upgrade.usageLabel,
    canUpgrade: upgrade.canUpgrade,
    priceCurrency: upgrade.priceCurrency,
    interval: upgrade.interval,
    zarByBand: upgrade.zarByBand,
  };
}

async function buildUpgradeSnapshot(input: {
  isOwner: boolean;
  membershipRole: string | null;
  market: unknown;
  clientCount: number;
  sub: EntitlingFirmSubscription | null;
}): Promise<FirmUpgradeSnapshot> {
  const phase = input.sub?.phase ?? "none";
  const band = input.sub?.band ?? null;
  const clientLimit = firmUsageLimit(phase, band);
  const interval = input.sub?.interval === "year" ? "year" : "month";
  const marketCountry = parseMarketSelection(input.market)?.country ?? null;
  const billingCurrency = billingCurrencyCode({
    stripeCurrency: input.sub?.currency,
    marketCountry,
  });
  let zarByBand: FirmUpgradeSnapshot["zarByBand"] = {};
  if (billingCurrency === "zar" && stripeConfigured()) {
    try {
      const { loadZarCatalogAmounts } = await import("@/lib/stripe-billing-sync.server");
      zarByBand = await loadZarCatalogAmounts(getStripe());
    } catch (err) {
      console.warn(
        "[stripe] ZAR catalog amounts unavailable",
        err instanceof Error ? err.message : err,
      );
    }
  }
  return {
    canUpgrade: callerCanManageFirmBilling({
      isOwner: input.isOwner,
      membershipRole: input.membershipRole,
    }),
    band,
    phase,
    clientCount: input.clientCount,
    clientLimit,
    usageLabel: formatFirmClientUsage(input.clientCount, clientLimit),
    priceCurrency: firmUpgradePriceCurrency({
      billingCurrency,
      interval,
      zarByBand,
    }),
    interval,
    zarByBand,
  };
}
