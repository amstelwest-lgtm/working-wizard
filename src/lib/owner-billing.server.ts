/**
 * Owner Checkout and entitlement writes. Service role only.
 * Does not create Stripe prices. A missing lookup key is a typed error.
 */

import type Stripe from "stripe";
import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  findOwnerCatalogPrice,
  isOwnerLookupKey,
  ownerCheckoutCharge,
  ownerLookupKey,
  ownerZarNeedsUsdFallback,
  type CatalogPrice,
} from "@/lib/stripe-checkout.core";
import {
  applyOwnerStripeEvent,
  emptyOwnerStripeSnapshot,
  firmLinkCoversOwner,
  getOwnerEntitlement,
  isFirmBandBillingSubscription,
  type PracticeGrantEvidence,
  OWNER_PRICE_UNAVAILABLE,
  ownerBillingEventSignal,
  pickCoveringFirmSubscription,
  planOwnerCheckout,
  storedOwnerMarket,
  type FirmSubscriptionLike,
  type OwnerEntitlement,
  type OwnerStripeSnapshot,
  type StartOwnerCheckoutResult,
} from "@/lib/owner-billing";
import { readStripeCustomerCountry } from "@/lib/pricing/za-checkout";
import { findCustomerIdByEmail } from "@/lib/stripe-entitlement";
import { getStripe, stripeConfigured } from "@/lib/stripe.server";
import type { FirmInterval, StripePlanMarket } from "@/lib/stripe-plans";

type OwnerRow = {
  user_id: string;
  plan: string;
  status: string;
  source: string;
  market: string | null;
  interval: string | null;
  current_period_end: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  lookup_key: string | null;
  firm_id: string | null;
  firm_name: string | null;
  grace_until: string | null;
};

type OwnerTable = {
  from: (table: "owner_subscriptions") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => Promise<{ data: OwnerRow | null; error: { message: string } | null }>;
      };
    };
    upsert: (
      row: Record<string, unknown>,
      options: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
};

const OWNER_COLUMNS =
  "user_id, plan, status, source, market, interval, current_period_end, stripe_customer_id, stripe_subscription_id, stripe_price_id, lookup_key, firm_id, firm_name, grace_until";

function ownerDb(admin: NonNullable<ReturnType<typeof getSupabaseAdminOrNull>>): OwnerTable {
  return admin as unknown as OwnerTable;
}

function asMarket(value: string | null): StripePlanMarket | null {
  return value === "za" || value === "us" ? value : null;
}

function asInterval(value: string | null): FirmInterval | null {
  return value === "month" || value === "year" ? value : null;
}

export function snapshotFromOwnerRow(row: OwnerRow | null): OwnerStripeSnapshot | null {
  if (!row) return null;
  // A firm grant with no Stripe subscription is not a paid owner plan.
  // A firm grant that kept an earlier Stripe subscription still reports that status.
  if (row.source !== "stripe" && !row.stripe_subscription_id) return null;
  return {
    status: row.status,
    market: asMarket(row.market),
    interval: asInterval(row.interval),
    currentPeriodEnd: row.current_period_end,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    lookupKey: row.lookup_key,
    userId: row.user_id,
  };
}

async function readOwnerSubscriptionRow(userId: string): Promise<OwnerRow | null> {
  const admin = getSupabaseAdminOrNull();
  if (!admin) return null;
  const { data, error } = await ownerDb(admin)
    .from("owner_subscriptions")
    .select(OWNER_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[owner-billing] entitlement read skipped", error.message);
    return null;
  }
  return data;
}

async function writeOwnerSubscription(row: Record<string, unknown>): Promise<void> {
  const admin = getSupabaseAdminOrNull();
  if (!admin) throw new Error("Owner entitlement could not be saved.");
  const { error } = await ownerDb(admin)
    .from("owner_subscriptions")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(error.message || "Owner entitlement could not be saved.");
}

type OwnedClient = {
  id: string;
  firm_id: string | null;
  market: unknown;
  firm_link_accepted_at: string | null;
};

type ClientQuery = {
  from: (table: "clients") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        limit: (n: number) => Promise<{
          data: Array<Record<string, unknown>> | null;
          error: { message: string } | null;
        }>;
      };
      in: (
        column: string,
        values: string[],
      ) => Promise<{
        data: Array<Record<string, unknown>> | null;
        error: { message: string } | null;
      }>;
    };
  };
};

function clientDb(admin: NonNullable<ReturnType<typeof getSupabaseAdminOrNull>>): ClientQuery {
  return admin as unknown as ClientQuery;
}

function asOwnedClient(row: Record<string, unknown>): OwnedClient {
  return {
    id: String(row.id ?? ""),
    firm_id: typeof row.firm_id === "string" ? row.firm_id : null,
    market: row.market,
    firm_link_accepted_at:
      typeof row.firm_link_accepted_at === "string" ? row.firm_link_accepted_at : null,
  };
}

async function loadOwnedClients(userId: string): Promise<OwnedClient[]> {
  const admin = getSupabaseAdminOrNull();
  if (!admin) return [];
  const db = clientDb(admin);
  const full = await db
    .from("clients")
    .select("id, firm_id, market, firm_link_accepted_at")
    .eq("owner_user_id", userId)
    .limit(50);
  if (!full.error) return (full.data ?? []).map(asOwnedClient);
  if (!/firm_link_accepted_at/i.test(full.error.message)) {
    console.warn("[owner-billing] client read skipped", full.error.message);
    return [];
  }
  const legacy = await db
    .from("clients")
    .select("id, firm_id, market")
    .eq("owner_user_id", userId)
    .limit(50);
  if (legacy.error) {
    console.warn("[owner-billing] client read skipped", legacy.error.message);
    return [];
  }
  return (legacy.data ?? []).map(asOwnedClient);
}

type InSelect = {
  from: (table: string) => {
    select: (columns: string) => {
      in: (
        column: string,
        values: string[],
      ) => Promise<{
        data: Array<Record<string, unknown>> | null;
        error: { message: string } | null;
      }>;
    };
  };
};

async function loadPracticeGrants(
  clientIds: string[],
): Promise<Map<string, PracticeGrantEvidence[]>> {
  const out = new Map<string, PracticeGrantEvidence[]>();
  if (!clientIds.length) return out;
  const admin = getSupabaseAdminOrNull();
  if (!admin) return out;
  const loose = admin as unknown as InSelect;
  const { data, error } = await loose
    .from("client_practice_access")
    .select("client_id, firm_id, status, requested_by, accountant_approved_by")
    .in("client_id", clientIds);
  if (error || !data?.length) return out;
  const firmIds = [
    ...new Set(
      data.map((row) => (typeof row.firm_id === "string" ? row.firm_id : "")).filter(Boolean),
    ),
  ];
  const members = new Map<string, Set<string>>();
  if (firmIds.length) {
    const firms = await loose.from("firms").select("id, owner_user_id").in("id", firmIds);
    for (const firm of firms.data ?? []) {
      const id = typeof firm.id === "string" ? firm.id : "";
      if (!id) continue;
      const set = members.get(id) ?? new Set<string>();
      if (typeof firm.owner_user_id === "string") set.add(firm.owner_user_id);
      members.set(id, set);
    }
    const mems = await loose
      .from("firm_memberships")
      .select("firm_id, user_id")
      .in("firm_id", firmIds);
    for (const mem of mems.data ?? []) {
      const firmId = typeof mem.firm_id === "string" ? mem.firm_id : "";
      const userId = typeof mem.user_id === "string" ? mem.user_id : "";
      if (!firmId || !userId) continue;
      const set = members.get(firmId) ?? new Set<string>();
      set.add(userId);
      members.set(firmId, set);
    }
  }
  for (const row of data) {
    const clientId = typeof row.client_id === "string" ? row.client_id : "";
    const firmId = typeof row.firm_id === "string" ? row.firm_id : "";
    if (!clientId || !firmId) continue;
    const set = members.get(firmId) ?? new Set<string>();
    const requested = typeof row.requested_by === "string" ? row.requested_by : "";
    const approved =
      typeof row.accountant_approved_by === "string" ? row.accountant_approved_by : "";
    const list = out.get(clientId) ?? [];
    list.push({
      firmId,
      status: typeof row.status === "string" ? row.status : null,
      grantedByMember: (requested !== "" && set.has(requested)) || (approved !== "" && set.has(approved)),
    });
    out.set(clientId, list);
  }
  return out;
}

function productPlanOf(price: Stripe.Price | string | null | undefined): string | null {
  if (!price || typeof price === "string") return null;
  const product = price.product;
  if (!product || typeof product === "string" || ("deleted" in product && product.deleted)) {
    return null;
  }
  const plan = product.metadata?.plan;
  return typeof plan === "string" && plan.trim() ? plan.trim() : null;
}

function subscriptionLookup(sub: {
  metadata?: Stripe.Metadata | null;
  items?: Stripe.Subscription["items"];
}): { lookupKey: string | null; plan: string | null } {
  const price = sub.items?.data?.[0]?.price;
  const lookupKey =
    sub.metadata?.milon_lookup_key ||
    (price && typeof price !== "string" ? price.lookup_key : null) ||
    null;
  const catalogPlan = productPlanOf(price);
  if (catalogPlan?.toLowerCase() === "owner") return { lookupKey, plan: "owner" };
  return { lookupKey, plan: sub.metadata?.milon_plan ?? null };
}

function toFirmLike(sub: Stripe.Subscription): FirmSubscriptionLike {
  const { lookupKey, plan } = subscriptionLookup(sub);
  const periodEnd =
    "current_period_end" in sub && typeof sub.current_period_end === "number"
      ? sub.current_period_end
      : null;
  return {
    status: sub.status,
    canceled_at: sub.canceled_at,
    ended_at: sub.ended_at,
    current_period_end: periodEnd,
    items: {
      data: sub.items?.data?.map((item) => ({
        current_period_end:
          "current_period_end" in item && typeof item.current_period_end === "number"
            ? item.current_period_end
            : null,
      })),
    },
    metadata: {
      ...(sub.metadata ?? {}),
      ...(plan ? { milon_plan: plan } : {}),
      ...(lookupKey ? { milon_lookup_key: lookupKey } : {}),
    },
    lookupKey,
  };
}

async function firmOwnerEmail(ownerUserId: string): Promise<string | null> {
  const admin = getSupabaseAdminOrNull();
  if (!admin) return null;
  const { data, error } = await admin.auth.admin.getUserById(ownerUserId);
  if (error) return null;
  const email = data.user?.email?.trim() ?? "";
  return email || null;
}

export type OwnerFirmCoverage = {
  firmId: string;
  firmName: string;
  graceUntil: string | null;
  currentPeriodEnd: string | null;
};

/** Owner's client linked to a firm with a live plan, or inside the 14-day grace. */
export async function findOwnerFirmCoverage(
  userId: string,
  clients?: OwnedClient[],
  nowSec = Math.floor(Date.now() / 1000),
): Promise<OwnerFirmCoverage | null> {
  if (!stripeConfigured()) return null;
  const rows = clients ?? (await loadOwnedClients(userId));
  const grants = await loadPracticeGrants(rows.map((row) => row.id).filter(Boolean));
  const linked = rows.filter((row) =>
    firmLinkCoversOwner({
      firmId: row.firm_id,
      acceptedAt: row.firm_link_accepted_at,
      grants: grants.get(row.id) ?? [],
    }),
  );
  const firmIds = [
    ...new Set(linked.map((row) => row.firm_id).filter((id): id is string => Boolean(id))),
  ];
  if (!firmIds.length) return null;
  const admin = getSupabaseAdminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from("firms")
    .select("id, name, owner_user_id")
    .in("id", firmIds);
  if (error || !data?.length) return null;
  const stripe = getStripe();
  for (const firm of data) {
    const ownerUserId = firm.owner_user_id;
    if (!ownerUserId) continue;
    const email = await firmOwnerEmail(ownerUserId);
    if (!email) continue;
    const customerId = await findCustomerIdByEmail(stripe, email);
    if (!customerId) continue;
    const listed = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
      expand: ["data.items.data.price"],
    });
    const firmSubs = listed.data.filter((sub) => {
      const read = subscriptionLookup(sub);
      return isFirmBandBillingSubscription(read);
    });
    const decision = pickCoveringFirmSubscription(firmSubs.map(toFirmLike), nowSec);
    if (!decision?.covered) continue;
    const name = firm.name?.trim() || "Your accountant";
    return {
      firmId: firm.id,
      firmName: name,
      graceUntil: decision.graceUntil,
      currentPeriodEnd: decision.currentPeriodEnd,
    };
  }
  return null;
}

async function grantOwnerFirmCoverage(
  userId: string,
  coverage: OwnerFirmCoverage,
  ownerMarket: unknown,
): Promise<void> {
  const existing = await readOwnerSubscriptionRow(userId);
  const keepStripe = Boolean(existing?.stripe_subscription_id);
  const market = storedOwnerMarket([{ market: ownerMarket }]);
  const country =
    market && typeof market === "object" && !Array.isArray(market)
      ? (market as { country?: unknown }).country
      : null;
  const charged: StripePlanMarket =
    typeof country === "string" && country.trim().toUpperCase() === "ZA" ? "za" : "us";
  await writeOwnerSubscription({
    user_id: userId,
    plan: "owner",
    status: keepStripe ? (existing?.status ?? "active") : "active",
    source: "firm",
    market: charged,
    interval: null,
    current_period_end: coverage.currentPeriodEnd,
    stripe_customer_id: existing?.stripe_customer_id ?? null,
    stripe_subscription_id: existing?.stripe_subscription_id ?? null,
    stripe_price_id: existing?.stripe_price_id ?? null,
    lookup_key: existing?.source === "stripe" ? existing.lookup_key : null,
    firm_id: coverage.firmId,
    firm_name: coverage.firmName,
    grace_until: coverage.graceUntil,
  });
}

function subscriptionIsLiveOwner(sub: Stripe.Subscription): boolean {
  if (sub.status !== "active" && sub.status !== "trialing") return false;
  const read = subscriptionLookup(sub);
  return read.plan === "owner" || isOwnerLookupKey(read.lookupKey);
}

async function customerHasLiveOwnerSubscription(
  stripe: Stripe,
  customerId: string,
): Promise<boolean> {
  const listed = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
    expand: ["data.items.data.price"],
  });
  return listed.data.some(subscriptionIsLiveOwner);
}

export async function startOwnerCheckoutForUser(input: {
  userId: string;
  email: string;
  interval: FirmInterval;
  requestedMarket: StripePlanMarket;
  origin: string;
  geoCountry: string | null;
}): Promise<StartOwnerCheckoutResult> {
  if (!stripeConfigured()) {
    throw new Error("STRIPE_SECRET_KEY is not set on this deploy.");
  }
  const clients = await loadOwnedClients(input.userId);
  const ownerMarket = storedOwnerMarket(clients);
  const coverage = await findOwnerFirmCoverage(input.userId, clients);
  if (coverage) {
    await grantOwnerFirmCoverage(input.userId, coverage, ownerMarket);
    return { status: "covered_by_firm", firm_name: coverage.firmName };
  }

  const stripe = getStripe();
  const customerId = input.email ? await findCustomerIdByEmail(stripe, input.email) : undefined;
  if (customerId && (await customerHasLiveOwnerSubscription(stripe, customerId))) {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${input.origin.replace(/\/$/, "")}/app`,
    });
    if (!session.url) throw new Error("Stripe Customer Portal did not return a URL.");
    return { status: "portal", url: session.url };
  }

  const billingCountry = await readStripeCustomerCountry(
    stripe as unknown as Parameters<typeof readStripeCustomerCountry>[0],
    customerId,
  );
  const planned = await planOwnerCheckout({
    stripe,
    interval: input.interval,
    requestedMarket: input.requestedMarket,
    ownerMarket,
    billingCountry,
    geoCountry: input.geoCountry,
    userId: input.userId,
    email: input.email,
    customerId,
    origin: input.origin,
    firmCoverage: null,
  });
  if (planned.status === "checkout") return { status: "checkout", url: planned.url };
  return planned;
}

function firmGrantStillValid(row: OwnerRow, nowMs = Date.now()): boolean {
  if (row.source !== "firm" || row.status !== "active") return false;
  if (!row.grace_until) return true;
  const until = Date.parse(row.grace_until);
  return Number.isFinite(until) && until >= nowMs;
}

/** Live firm coverage, then the stored Stripe row. For Eng2's UI. */
export async function loadOwnerEntitlement(userId: string): Promise<OwnerEntitlement> {
  const row = await readOwnerSubscriptionRow(userId);
  let firm: { firmName: string; graceUntil: string | null } | null = null;
  try {
    const coverage = await findOwnerFirmCoverage(userId);
    if (coverage) firm = { firmName: coverage.firmName, graceUntil: coverage.graceUntil };
  } catch (err) {
    console.warn(
      "[owner-billing] firm coverage check failed",
      err instanceof Error ? err.message : err,
    );
    if (row && firmGrantStillValid(row)) {
      firm = { firmName: row.firm_name?.trim() || "Your accountant", graceUntil: row.grace_until };
    }
  }
  return getOwnerEntitlement({
    stripe: snapshotFromOwnerRow(row),
    firm,
  });
}

async function userIdForSignal(
  signal: ReturnType<typeof ownerBillingEventSignal>,
): Promise<string | null> {
  if (signal.userId) return signal.userId;
  const admin = getSupabaseAdminOrNull();
  if (!admin || !signal.customerId) return null;
  try {
    const customer = await getStripe().customers.retrieve(signal.customerId);
    if (customer.deleted) return null;
    const email = customer.email?.trim() ?? "";
    if (!email) return null;
    const { data, error } = await (
      admin as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc("user_id_by_email", { p_email: email });
    if (error || typeof data !== "string" || !data) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeStripeSnapshot(
  snapshot: OwnerStripeSnapshot,
  existing: OwnerRow | null,
): Promise<void> {
  if (!snapshot.userId) throw new Error("Owner entitlement is missing a user.");
  await writeOwnerSubscription({
    user_id: snapshot.userId,
    plan: "owner",
    status: snapshot.status ?? "canceled",
    source: "stripe",
    market: snapshot.market,
    interval: snapshot.interval,
    current_period_end: snapshot.currentPeriodEnd,
    stripe_customer_id: snapshot.stripeCustomerId,
    stripe_subscription_id: snapshot.stripeSubscriptionId,
    stripe_price_id: snapshot.stripePriceId,
    lookup_key: snapshot.lookupKey,
    firm_id: existing?.firm_id ?? null,
    firm_name: existing?.firm_name ?? null,
    grace_until: null,
  });
}

/**
 * Rand owner price is kept only when Checkout collected a ZA billing country.
 * Anything else moves that subscription onto the USD owner price. Never a firm price.
 */
export async function enforceOwnerBillingCountry(session: {
  mode?: string | null;
  subscription?: string | { id?: string } | null;
  metadata?: Record<string, string> | null;
  customer_details?: { address?: { country?: string | null } | null } | null;
}): Promise<boolean> {
  if (session.mode && session.mode !== "subscription") return false;
  const lookup = session.metadata?.milon_lookup_key ?? "";
  if (!ownerZarNeedsUsdFallback(lookup, session.customer_details?.address?.country)) return false;
  const interval = lookup.endsWith("_annual") ? "year" : "month";
  const stripe = getStripe();
  const usd = await findOwnerCatalogPrice(stripe, "us", interval);
  if (!usd?.price.id) {
    console.warn("[owner-billing] usd owner price missing; left the session price unchanged");
    return false;
  }
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subscriptionId) return false;
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const itemId = sub.items?.data?.[0]?.id;
  if (!itemId) return false;
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(sub.metadata ?? {})) {
    if (typeof value === "string") metadata[key] = value;
  }
  metadata.milon_plan = "owner";
  metadata.milon_interval = interval;
  metadata.milon_lookup_key = ownerLookupKey("us", interval);
  metadata.milon_za_billing_fallback = "usd";
  await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: itemId, price: usd.price.id }],
    metadata,
    proration_behavior: "none",
    automatic_tax: { enabled: false },
  });
  return true;
}

/** checkout.session.completed and customer.subscription.created/updated/deleted. */
export async function syncOwnerBillingEvent(event: {
  type?: string;
  data?: { object?: unknown };
}): Promise<{ synced: boolean; status: string | null }> {
  let signal = ownerBillingEventSignal(event);
  if (!signal.owner) return { synced: false, status: null };

  if (event.type === "checkout.session.completed") {
    const session = (event.data?.object ?? {}) as Parameters<typeof enforceOwnerBillingCountry>[0];
    await enforceOwnerBillingCountry(session);
  }

  if (event.type !== "customer.subscription.deleted" && signal.subscriptionId) {
    try {
      const sub = await getStripe().subscriptions.retrieve(signal.subscriptionId, {
        expand: ["items.data.price"],
      });
      const refreshed = ownerBillingEventSignal({ type: event.type, data: { object: sub } });
      signal = {
        ...refreshed,
        owner: refreshed.owner || signal.owner,
        userId: refreshed.userId ?? signal.userId,
        type: signal.type,
      };
    } catch (err) {
      console.warn(
        "[owner-billing] subscription retrieve failed",
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!signal.owner) return { synced: false, status: null };
  if (signal.lookupKey && !isOwnerLookupKey(signal.lookupKey)) {
    return { synced: false, status: null };
  }
  const userId = await userIdForSignal(signal);
  if (!userId) {
    console.warn("[owner-billing] owner event has no user");
    return { synced: false, status: signal.status };
  }
  const existing = await readOwnerSubscriptionRow(userId);
  const next = applyOwnerStripeEvent(snapshotFromOwnerRow(existing) ?? emptyOwnerStripeSnapshot(), {
    type: signal.type,
    lookupKey: signal.lookupKey,
    plan: "owner",
    status: signal.status,
    market: signal.market,
    interval: signal.interval,
    currentPeriodEnd: signal.currentPeriodEnd,
    customerId: signal.customerId,
    subscriptionId: signal.subscriptionId,
    priceId: signal.priceId,
    userId,
  });
  if (!next?.userId) return { synced: false, status: null };
  await writeStripeSnapshot(next, existing);
  return { synced: true, status: next.status };
}

export async function syncOwnerCheckoutSession(session: {
  mode?: string | null;
  subscription?: string | { id?: string } | null;
  metadata?: Record<string, string> | null;
  customer_details?: { address?: { country?: string | null } | null } | null;
  customer?: unknown;
  client_reference_id?: string | null;
}): Promise<{ synced: boolean; status: string | null }> {
  return syncOwnerBillingEvent({
    type: "checkout.session.completed",
    data: { object: session },
  });
}

export { OWNER_PRICE_UNAVAILABLE, ownerCheckoutCharge, type CatalogPrice };
