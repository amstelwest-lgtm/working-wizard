/**
 * Live client-cap check. Stripe subscription phase is source of truth;
 * the firm client count is read from Postgres (service role when present).
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  decideFirmClientCreate,
  eligibleForIntroTrial,
  formatFirmPlanStatus,
  idleStarterTrialBanner,
  phaseFromSubscriptionStatus,
  starterTrialForPlanState,
  type FirmClientCreateAllowance,
  type FirmPlanDisplay,
  type FirmSubscriptionPhase,
} from "@/lib/firm-client-cap";
import {
  readSubscriptionDiscountRefs,
  type StoredDiscountRef,
} from "@/lib/firm-sa-market";
import { noPlanTrialClock, starterTrialClock, type StarterTrialBanner } from "@/lib/firm-starter-trial";
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
  practiceDisplaysZarPlan,
  readSubscriptionPrice,
  type FirmUpgradeSnapshot,
} from "@/lib/firm-band-upgrade";
import { isOwnerCatalogPrice } from "@/lib/owner-price";
import { readStripeCustomerCountry } from "@/lib/pricing/za-checkout";
import { firmCheckoutCharge } from "@/lib/stripe-checkout.core";
import { coerceMarketSelection, parseMarketSelection } from "@/lib/market/parse";
import { resolveMarket } from "@/lib/market/resolve";
import { FIRM_BAND_CATALOG, isFirmCheckoutBand, type FirmBandId, type FirmInterval } from "@/lib/stripe-plans";
import {
  installMetadataFirmCustomerWrite,
  readFirmStripeCustomerId,
} from "@/lib/firm-stripe-customer.server";
import {
  findFirmCustomerId,
  FirmCustomerLookupUnknown,
  readWithinBudget,
  SUBSCRIPTION_LIST_BUDGET_MS,
  type FirmCustomerLookup,
} from "@/lib/stripe-entitlement";
import { getStripe, stripeConfigured } from "@/lib/stripe.server";
import { writePrecardCapApplies } from "@/lib/precard-cap-mirror.server";
import { writeStarterTrialGenerationBlock } from "@/lib/starter-trial-mirror.server";
import { collapseDuplicateClientShells } from "@/lib/client-display-name";

installMetadataFirmCustomerWrite();

/** Stripe address country for the charge line. A miss leaves the country unknown. */
async function checkoutBillingCountry(customerId: string | null | undefined): Promise<string | null> {
  const id = customerId?.trim() ?? "";
  if (!id || !stripeConfigured()) return null;
  try {
    return await readWithinBudget(
      readStripeCustomerCountry(
        getStripe() as Parameters<typeof readStripeCustomerCountry>[0],
        id,
      ),
      1_000,
    );
  } catch {
    return null;
  }
}

export type EntitlingFirmSubscription = {
  id: string;
  customerId: string;
  phase: Exclude<FirmSubscriptionPhase, "none">;
  band: FirmBandId | null;
  /** ISO timestamp when the subscription is trialing; otherwise null. */
  trialEnd: string | null;
  /** ISO current_period_end. Null when Stripe did not send one. */
  currentPeriodEnd: string | null;
  /** ISO subscription start (start_date, else created). */
  startedAt: string | null;
  interval: FirmInterval | null;
  /** Charge currency (subscription.currency), else the price currency. */
  currency: string | null;
  /** subscription.currency only. Null when Stripe did not send a charge currency. */
  chargeCurrency: string | null;
  itemId: string | null;
  /** Billed price lookup_key. */
  lookupKey: string | null;
  /** Billed price unit_amount. 0 is an existing price id; paid Starter is the catalog amount. */
  unitAmount: number | null;
  metadata: Record<string, string>;
  hasDefaultPaymentMethod: boolean;
  discounts: StoredDiscountRef[];
};

type FirmRow = {
  id?: string;
  owner_user_id?: string | null;
  market?: unknown;
  starter_trial_enforced?: boolean | null;
  created_at?: string | null;
  /** QA clock start. Null keeps max(created_at, cutover). */
  trial_clock_start_override?: string | null;
};

type LoadedFirm = {
  id: string;
  ownerUserId: string | null;
  market: unknown;
  /** False when the column is missing or the firm is exempt. */
  starterTrialEnforced: boolean;
  /** Firm row created_at. Null on the legacy select, which does not start a clock. */
  createdAt: string | null;
  /** QA start. Null when the column is missing or empty, so the real clock stays. */
  trialClockStartOverride: string | null;
};

const FIRM_SELECT = "id, owner_user_id, market, starter_trial_enforced, created_at";
const FIRM_SELECT_CLOCK = `${FIRM_SELECT}, trial_clock_start_override`;
const FIRM_SELECT_LEGACY = "id, owner_user_id, market";

function isMissingTrialColumn(message: string): boolean {
  return /starter_trial_enforced/i.test(message);
}

function isMissingClockOverrideColumn(message: string): boolean {
  return /trial_clock_start_override/i.test(message);
}

function clockOverrideFromRow(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function toLoadedFirm(row: FirmRow, enforced: boolean): LoadedFirm | null {
  if (!row.id) return null;
  return {
    id: row.id,
    ownerUserId: row.owner_user_id ?? null,
    market: row.market ?? null,
    starterTrialEnforced: enforced,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    trialClockStartOverride: clockOverrideFromRow(row.trial_clock_start_override),
  };
}

type LooseQuery = {
  eq: (column: string, value: string) => LooseQuery;
  maybeSingle: () => Promise<{
    data: { role?: string | null } | null;
    error: { message: string } | null;
  }>;
};

type FirmSelect = {
  eq: (column: string, value: string | boolean) => FirmSelect;
  limit: (n: number) => Promise<{
    data: FirmRow[] | null;
    error: { message: string } | null;
  }>;
  maybeSingle: () => Promise<{
    data: FirmRow | null;
    error: { message: string } | null;
  }>;
} & Promise<{
  data?: Array<{
    id?: string | null;
    name?: string | null;
    created_at?: string | null;
    financials?: unknown;
    cashflow?: unknown;
  }> | null;
  count: number | null;
  error: { message: string } | null;
}>;

type CapDb = {
  from: (table: string) => {
    select: (columns: string, options?: { count: "exact"; head: true }) => FirmSelect;
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

type ListedSubscription = Record<string, unknown> & {
  id: string;
  status: string;
  created?: number;
};

/**
 * Same Stripe list Checkout uses for eligibleForIntroTrial.
 * No customer means zero prior subscriptions.
 */
async function listCustomerSubscriptions(
  email: string,
  ids?: FirmCustomerLookup,
): Promise<{
  customerId: string | null;
  data: ListedSubscription[];
}> {
  if (!stripeConfigured()) return { customerId: null, data: [] };
  const trimmed = email.trim();
  const userId = ids?.userId?.trim() ?? "";
  const firmId = ids?.firmId?.trim() ?? "";
  const storedCustomerId = ids?.storedCustomerId?.trim() ?? "";
  if (!trimmed && !userId && !firmId && !storedCustomerId) return { customerId: null, data: [] };
  const stripe = getStripe();
  const customerId = await findFirmCustomerId(stripe, {
    email: trimmed,
    userId,
    firmId,
    storedCustomerId,
  });
  if (!customerId) return { customerId: null, data: [] };
  const listOptions = { maxNetworkRetries: 0, timeout: SUBSCRIPTION_LIST_BUDGET_MS };
  let listed: { data: ListedSubscription[] };
  try {
    listed = await readWithinBudget(
      stripe.subscriptions.list(
        {
          customer: customerId,
          status: "all",
          limit: 20,
          expand: ["data.items.data.price"],
        },
        listOptions,
      ) as unknown as Promise<{ data: ListedSubscription[] }>,
      SUBSCRIPTION_LIST_BUDGET_MS,
    );
  } catch (err) {
    if (err instanceof FirmCustomerLookupUnknown && err.kind === "timeout") throw err;
    console.warn(
      "[stripe] subscription price expand failed",
      err instanceof Error ? err.message : err,
    );
    listed = await readWithinBudget(
      stripe.subscriptions.list(
        {
          customer: customerId,
          status: "all",
          limit: 20,
        },
        listOptions,
      ) as unknown as Promise<{ data: ListedSubscription[] }>,
      SUBSCRIPTION_LIST_BUDGET_MS,
    );
  }
  return { customerId, data: listed.data };
}

function entitlingFromListed(
  customerId: string | null,
  data: ListedSubscription[],
): EntitlingFirmSubscription | null {
  if (!customerId) return null;
  const ranked = data.map((sub) => {
    const price = readSubscriptionPrice(sub as Parameters<typeof readSubscriptionPrice>[0]);
    const metadata = stringMetadata((sub as { metadata?: unknown }).metadata);
    const owner = price.lookupKey
      ? isOwnerCatalogPrice({ lookupKey: price.lookupKey, productPlan: price.productPlan })
      : isOwnerCatalogPrice({
          lookupKey: metadata.milon_lookup_key,
          productPlan: price.productPlan || metadata.milon_plan,
        });
    return {
      raw: sub,
      id: sub.id,
      status: sub.status,
      created: typeof sub.created === "number" ? sub.created : 0,
      owner,
      band: owner
        ? null
        : bandFromSubscriptionSnapshot({
            lookupKey: price.lookupKey,
            productBand: price.productBand,
            productPlan: price.productPlan,
            metadataPlan: metadata.milon_plan,
            downgradeBlocked: metadata.milon_downgrade_blocked,
          }),
      price,
      metadata,
    };
  });
  const hit = pickEntitlingFirmSubscription(ranked);
  if (!hit) return null;
  const phase = phaseFromSubscriptionStatus(hit.status);
  if (phase === "none") return null;
  const rawTimes = hit.raw as {
    trial_end?: number | null;
    start_date?: number | null;
    created?: number | null;
    current_period_end?: number | null;
    items?: { data?: Array<{ current_period_end?: number | null }> } | null;
  };
  const trialEndSeconds = rawTimes.trial_end;
  const itemPeriodEnd = rawTimes.items?.data?.[0]?.current_period_end;
  const periodEndSeconds =
    typeof rawTimes.current_period_end === "number" &&
    Number.isFinite(rawTimes.current_period_end) &&
    rawTimes.current_period_end > 0
      ? rawTimes.current_period_end
      : typeof itemPeriodEnd === "number" && Number.isFinite(itemPeriodEnd) && itemPeriodEnd > 0
        ? itemPeriodEnd
        : null;
  const startedSeconds =
    typeof rawTimes.start_date === "number" && Number.isFinite(rawTimes.start_date)
      ? rawTimes.start_date
      : typeof rawTimes.created === "number" && Number.isFinite(rawTimes.created)
        ? rawTimes.created
        : hit.created || null;
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
    currentPeriodEnd:
      periodEndSeconds != null ? new Date(periodEndSeconds * 1000).toISOString() : null,
    startedAt:
      typeof startedSeconds === "number" && startedSeconds > 0
        ? new Date(startedSeconds * 1000).toISOString()
        : null,
    interval: hit.price.interval,
    chargeCurrency: hit.price.chargeCurrency,
    currency: hit.price.chargeCurrency ?? hit.price.currency,
    itemId: hit.price.itemId,
    lookupKey: hit.price.lookupKey,
    unitAmount: hit.price.unitAmount,
    metadata: hit.metadata,
    hasDefaultPaymentMethod: Boolean(defaultPaymentMethod || defaultSource),
    discounts: readSubscriptionDiscountRefs(hit.raw as { discount?: unknown; discounts?: unknown }),
  };
}

/**
 * One Stripe customer + subscription list per email for this Vercel isolate.
 * A fresh isolate misses it. The entitlement check fills it; the trial mirror
 * and the next call within 45s reuse it instead of scanning Stripe again.
 */
export const STRIPE_ISOLATE_CACHE_TTL_MS = 45_000;

type FirmSubscriptionHistory = {
  entitling: EntitlingFirmSubscription | null;
  priorSubscriptionCount: number;
};

const stripeHistoryCache = new Map<string, { at: number; value: FirmSubscriptionHistory }>();
const stripeHistoryInflight = new Map<string, Promise<FirmSubscriptionHistory>>();

/** Entitling subscription plus the prior-count Checkout already uses. */
function subscriptionHistoryKey(email: string, ids?: FirmCustomerLookup): string {
  return [
    ids?.userId?.trim() ?? "",
    ids?.firmId?.trim() ?? "",
    ids?.storedCustomerId?.trim() ?? "",
    email.trim().toLowerCase(),
  ].join("\n");
}

export async function readFirmSubscriptionHistory(
  email: string,
  opts?: { fresh?: boolean } & FirmCustomerLookup,
): Promise<FirmSubscriptionHistory> {
  const storedCustomerId =
    opts?.storedCustomerId !== undefined
      ? opts.storedCustomerId
      : opts?.firmId
        ? await readFirmStripeCustomerId(opts.firmId)
        : null;
  const ids = { userId: opts?.userId, firmId: opts?.firmId, storedCustomerId };
  const key = subscriptionHistoryKey(email, ids);
  if (!opts?.fresh && key.trim()) {
    const hit = stripeHistoryCache.get(key);
    if (hit && Date.now() - hit.at < STRIPE_ISOLATE_CACHE_TTL_MS) return hit.value;
    const pending = stripeHistoryInflight.get(key);
    if (pending) return pending;
  }
  const load = async (): Promise<FirmSubscriptionHistory> => {
    const listed = await listCustomerSubscriptions(email, ids);
    return {
      entitling: entitlingFromListed(listed.customerId, listed.data),
      priorSubscriptionCount: listed.data.length,
    };
  };
  if (!key) return load();
  const work = load();
  stripeHistoryInflight.set(key, work);
  try {
    const value = await work;
    stripeHistoryCache.set(key, { at: Date.now(), value });
    return value;
  } finally {
    if (stripeHistoryInflight.get(key) === work) stripeHistoryInflight.delete(key);
  }
}

export async function findEntitlingFirmSubscription(
  email: string,
  ids?: FirmCustomerLookup,
): Promise<EntitlingFirmSubscription | null> {
  return (await readFirmSubscriptionHistory(email, ids)).entitling;
}

async function loadFirm(
  db: CapDb,
  firmId: string | null,
  userId: string,
): Promise<LoadedFirm | null> {
  if (firmId) {
    let selected = await db.from("firms").select(FIRM_SELECT_CLOCK).eq("id", firmId).maybeSingle();
    if (selected.error && isMissingClockOverrideColumn(selected.error.message)) {
      selected = await db.from("firms").select(FIRM_SELECT).eq("id", firmId).maybeSingle();
    }
    if (selected.error && isMissingTrialColumn(selected.error.message)) {
      const legacy = await db
        .from("firms")
        .select(FIRM_SELECT_LEGACY)
        .eq("id", firmId)
        .maybeSingle();
      if (legacy.error) throw new Error(legacy.error.message);
      const legacyFirm = legacy.data ? toLoadedFirm(legacy.data, false) : null;
      if (!legacyFirm) return null;
      return (await actorCanUseFirm(db, legacyFirm, userId)) ? legacyFirm : null;
    }
    if (selected.error) throw new Error(selected.error.message);
    if (selected.data?.id) {
      const loaded = toLoadedFirm(selected.data, selected.data.starter_trial_enforced === true);
      return (await actorCanUseFirm(db, loaded, userId)) ? loaded : null;
    }
    return null;
  }
  let listed = await db.from("firms").select(FIRM_SELECT_CLOCK).eq("owner_user_id", userId).limit(1);
  if (listed.error && isMissingClockOverrideColumn(listed.error.message)) {
    listed = await db.from("firms").select(FIRM_SELECT).eq("owner_user_id", userId).limit(1);
  }
  if (listed.error && isMissingTrialColumn(listed.error.message)) {
    const legacy = await db
      .from("firms")
      .select(FIRM_SELECT_LEGACY)
      .eq("owner_user_id", userId)
      .limit(1);
    if (legacy.error) throw new Error(legacy.error.message);
    const row = legacy.data?.[0];
    if (!row?.id) return null;
    return toLoadedFirm({ ...row, owner_user_id: row.owner_user_id ?? userId }, false);
  }
  if (listed.error) throw new Error(listed.error.message);
  const row = listed.data?.[0];
  if (!row?.id) return null;
  return toLoadedFirm(
    { ...row, owner_user_id: row.owner_user_id ?? userId },
    row.starter_trial_enforced === true,
  );
}

/**
 * True when this firm has no entitling subscription (phase none).
 * Reuses the subscription lookup the client-cap gate already uses.
 * Writes the edge mirror. Does not create Stripe customers or prices.
 */
export async function firmPrecardCapApplies(input: {
  supabase: unknown;
  userId: string;
  email: string;
  firmId: string;
}): Promise<boolean> {
  if (!stripeConfigured()) return false;
  const userDb = asCapDb(input.supabase);
  let email = input.email.trim();
  if (!email && userDb.auth) {
    const { data } = await userDb.auth.getUser();
    email = data.user?.email?.trim() ?? "";
  }
  const admin = getSupabaseAdminOrNull();
  const db = admin ? asCapDb(admin) : userDb;
  const firm = await loadFirm(db, input.firmId, input.userId);
  if (!firm) return false;
  const billing = await billingEmailForFirm(input.userId, email, firm.ownerUserId);
  const sub = await findEntitlingFirmSubscription(billing.email, {
    userId: firm.ownerUserId,
    firmId: firm.id,
  });
  const applies = (sub?.phase ?? "none") === "none";
  await writePrecardCapApplies(firm.id, applies);
  return applies;
}

function trialBannerFor(
  firm: LoadedFirm | null,
  sub: EntitlingFirmSubscription | null,
): StarterTrialBanner {
  if (!firm) return idleStarterTrialBanner();
  const phase = sub?.phase ?? "none";
  if (!sub || phase === "none") {
    return starterTrialForPlanState(
      "none",
      noPlanTrialClock({
        enforced: firm.starterTrialEnforced,
        noPlan: true,
        startedAt: firm.createdAt,
        startOverride: firm.trialClockStartOverride,
      }),
    );
  }
  return starterTrialForPlanState(
    phase,
    starterTrialClock({
      enforced: firm.starterTrialEnforced,
      band: sub.band ?? null,
      stripeTrialEnd: sub.trialEnd,
      startedAt: sub.startedAt,
    }),
  );
}

/** Owner on the firm row, or a membership row. A client-sent firm id is not enough. */
async function actorCanUseFirm(db: CapDb, firm: LoadedFirm, userId: string): Promise<boolean> {
  if (firm.ownerUserId && firm.ownerUserId === userId) return true;
  const role = await loadMembershipRole(db, firm.id, userId);
  return Boolean(role);
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

/**
 * Client count the cap uses: non-demo rows, empty same-name shells collapsed.
 * Null when the firm is missing or the read failed. Callers must not treat
 * that as zero, or a card-free wall will say the first client is free.
 */
export async function loadFirmClientCount(input: {
  supabase: unknown;
  userId: string;
  firmId?: string | null;
}): Promise<number | null> {
  try {
    const userId = input.userId.trim();
    if (!userId) return null;
    const admin = getSupabaseAdminOrNull();
    const db = admin ? asCapDb(admin) : asCapDb(input.supabase);
    const firm = await loadFirm(db, input.firmId?.trim() || null, userId);
    if (!firm) return null;
    return await countFirmClients(db, firm.id);
  } catch {
    return null;
  }
}

async function listFirmClientMarkets(db: CapDb, firmId: string): Promise<unknown[]> {
  try {
    const { data, error } = await db.from("clients").select("market").eq("firm_id", firmId);
    if (error) return [];
    return (data ?? []).map((row) => (row as { market?: unknown } | null)?.market ?? null);
  } catch {
    return [];
  }
}

async function countFirmClients(db: CapDb, firmId: string): Promise<number> {
  // One book is one client. Demo rows are left out. Empty shells that share a
  // name collapse to the oldest, the same set the Clients list shows.
  const { data, error } = await db
    .from("clients")
    .select("id, name, created_at, financials, cashflow")
    .eq("firm_id", firmId)
    .eq("is_demo", false);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).flatMap((row) => {
    const id = row?.id ? String(row.id) : "";
    if (!id) return [];
    return [
      {
        id,
        name: String(row?.name ?? ""),
        created_at: row?.created_at ?? null,
        financials: row?.financials,
        cashflow: row?.cashflow,
      },
    ];
  });
  return collapseDuplicateClientShells(rows).length;
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
}): Promise<{ billingEmail: string; clientCount: number; market: unknown; ownerUserId: string }> {
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
  const clientCount = await countFirmClients(db, firm.id);
  return {
    billingEmail: billing.email,
    clientCount,
    market: firm.market,
    ownerUserId: firm.ownerUserId || input.userId,
  };
}

/** Firm market JSON for the signed-in owner. Null when they have no firm row. */
export async function loadCallerFirmMarket(input: {
  supabase: unknown;
  userId: string;
}): Promise<unknown> {
  const admin = getSupabaseAdminOrNull();
  const db = admin ? asCapDb(admin) : asCapDb(input.supabase);
  const firm = await loadFirm(db, null, input.userId);
  return firm?.market ?? null;
}

export async function loadFirmClientCreateAllowance(input: {
  supabase: unknown;
  userId: string;
  email: string;
  firmId: string | null;
}): Promise<FirmClientCreateAllowance> {
  if (!stripeConfigured()) {
    return { allowed: true, canEndTrial: false, starterTrial: idleStarterTrialBanner() };
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
      allowed: true,
      canEndTrial: false,
      upgrade: emptyFirmUpgradeSnapshot(),
      starterTrial: idleStarterTrialBanner(),
    };
  }

  const [clientCount, billing, role, clientMarkets] = await Promise.all([
    countFirmClients(db, firm.id),
    billingEmailForFirm(input.userId, email, firm.ownerUserId),
    loadMembershipRole(db, firm.id, input.userId),
    listFirmClientMarkets(db, firm.id),
  ]);
  const sub = await findEntitlingFirmSubscription(billing.email, {
    userId: firm.ownerUserId,
    firmId: firm.id,
  });
  const upgrade = await buildUpgradeSnapshot({
    isOwner: Boolean(firm.ownerUserId && firm.ownerUserId === input.userId),
    membershipRole: role,
    market: firm.market,
    clientMarkets,
    clientCount,
    sub,
    billingCountry: await checkoutBillingCountry(sub?.customerId),
  });
  const starterTrial = trialBannerFor(firm, sub);
  await writeStarterTrialGenerationBlock(firm.id, starterTrial.expired);
  await writePrecardCapApplies(firm.id, (sub?.phase ?? "none") === "none");
  const decision = decideFirmClientCreate({
    stripeConfigured: true,
    phase: sub?.phase ?? "none",
    band: sub?.band ?? null,
    clientCount,
    unitAmount: sub?.unitAmount,
    starterTrialExpired: starterTrial.expired,
    noPlanTrialEnforced: firm.starterTrialEnforced,
  });
  if (decision.allowed) return { allowed: true, canEndTrial: false, upgrade, starterTrial };
  return {
    ...decision,
    // No Stripe trial to end on a card-free trial; the band list carries Checkout.
    canEndTrial:
      decision.code === "trial_client_cap" && Boolean(sub) && billing.actorIsBillingCustomer,
    upgrade,
    starterTrial,
  };
}

/**
 * Block a new pack or brain deliverable after an enforced Starter trial.
 * A client-count cap does not block existing-client work. Read access stays.
 */
export async function assertStarterTrialAllowsNewWork(input: {
  supabase: unknown;
  userId: string;
  email: string;
  firmId: string | null;
}): Promise<void> {
  if (!input.firmId) return;
  const allowance = await loadFirmClientCreateAllowance(input);
  if (!allowance.allowed && allowance.code === "starter_trial_ended") {
    throw new Error(allowance.message);
  }
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
      trialEndsOn: null,
      renewsOn: null,
      clientCount: null,
      clientLimit: null,
      usageLabel: null,
      canUpgrade: false,
      priceCurrency: "USD",
      interval: "month",
      zarByBand: {},
      starterTrial: idleStarterTrialBanner(),
      introTrialEligible: false,
      saDiscount: false,
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
      starterTrial: idleStarterTrialBanner(),
      introTrialEligible: false,
      saDiscount: false,
      zaLabels: null,
      zaPriceLabel: null,
    };
  }

  const [billing, role, clientCount, clientMarkets] = await Promise.all([
    billingEmailForFirm(input.userId, email, firm.ownerUserId),
    loadMembershipRole(db, firm.id, input.userId),
    countFirmClients(db, firm.id),
    listFirmClientMarkets(db, firm.id),
  ]);
  const history = await readFirmSubscriptionHistory(billing.email, {
    userId: firm.ownerUserId,
    firmId: firm.id,
  });
  const sub = history.entitling;
  const upgrade = await buildUpgradeSnapshot({
    isOwner: Boolean(firm.ownerUserId && firm.ownerUserId === input.userId),
    membershipRole: role,
    market: firm.market,
    clientMarkets,
    clientCount,
    sub,
    billingCountry: await checkoutBillingCountry(sub?.customerId),
  });
  const starterTrial = trialBannerFor(firm, sub);
  await writeStarterTrialGenerationBlock(firm.id, starterTrial.expired);
  await writePrecardCapApplies(firm.id, (sub?.phase ?? "none") === "none");
  return {
    configured: true,
    ...formatFirmPlanStatus({
      phase: sub?.phase ?? "none",
      band: sub?.band ?? null,
      trialEndIso: sub?.trialEnd ?? null,
      periodEndIso: sub?.currentPeriodEnd ?? null,
      market: resolveMarket(
        parseMarketSelection(firm.market) ?? coerceMarketSelection(firm.market),
      ),
    }),
    clientCount: upgrade.clientCount,
    clientLimit: upgrade.clientLimit,
    usageLabel: upgrade.usageLabel,
    canUpgrade: upgrade.canUpgrade,
    priceCurrency: upgrade.priceCurrency,
    interval: upgrade.interval,
    zarByBand: upgrade.zarByBand,
    starterTrial,
    introTrialEligible: eligibleForIntroTrial(history.priorSubscriptionCount),
    saDiscount: upgrade.saDiscount,
    zaLabels: upgrade.zaLabels ?? null,
    zaPriceLabel: upgrade.zaPriceLabel ?? null,
  };
}

/**
 * Refresh the edge mirror from the live entitling subscription.
 * Checkout return, the billing webhook, and entitlement resolve call this.
 * The no-plan clock includes trial_clock_start_override, so the generation
 * flag the edge reads follows that QA start. A failed lookup does not write,
 * so an unsynced firm stays fail-open.
 */
export async function syncStarterTrialMirrorForActor(input: {
  supabase: unknown;
  userId: string;
  email: string;
}): Promise<void> {
  if (!stripeConfigured()) return;
  try {
    const admin = getSupabaseAdminOrNull();
    const db = admin ? asCapDb(admin) : asCapDb(input.supabase);
    let userId = input.userId.trim();
    let email = input.email.trim();
    if (!userId && email && admin) {
      const { data } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
      userId = data?.id ? String(data.id) : "";
    }
    if (!userId) return;
    let firm = await loadFirm(db, null, userId);
    if (!firm && admin) {
      const membership = await admin
        .from("firm_memberships")
        .select("firm_id")
        .eq("user_id", userId)
        .limit(1);
      const firmId = membership.data?.[0]?.firm_id ? String(membership.data[0].firm_id) : "";
      if (firmId) firm = await loadFirm(db, firmId, userId);
    }
    if (!firm) return;
    const billing = await billingEmailForFirm(userId, email, firm.ownerUserId);
    const sub = await findEntitlingFirmSubscription(billing.email, {
      userId: firm.ownerUserId,
      firmId: firm.id,
    });
    const trial = trialBannerFor(firm, sub);
    await writeStarterTrialGenerationBlock(firm.id, trial.expired);
    await writePrecardCapApplies(firm.id, (sub?.phase ?? "none") === "none");
  } catch (err) {
    console.warn(
      "[starter-trial] mirror sync skipped",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function buildUpgradeSnapshot(input: {
  isOwner: boolean;
  membershipRole: string | null;
  market: unknown;
  clientMarkets?: readonly unknown[] | null;
  /** Checkout billing country. Omitted means still unknown. */
  billingCountry?: string | null;
  clientCount: number;
  sub: EntitlingFirmSubscription | null;
}): Promise<FirmUpgradeSnapshot> {
  const phase = input.sub?.phase ?? "none";
  const band = input.sub?.band ?? null;
  const clientLimit = firmUsageLimit(phase, band, input.sub?.unitAmount);
  const interval = input.sub?.interval === "year" ? "year" : "month";
  const marketCountry = parseMarketSelection(input.market)?.country ?? null;
  const billingCurrency = billingCurrencyCode({
    stripeCurrency: input.sub?.currency,
    marketCountry,
  });
  const showZar = practiceDisplaysZarPlan({
    firmMarket: input.market,
    clientMarkets: input.clientMarkets,
  });
  const charge = firmCheckoutCharge({
    firmMarket: input.market,
    clientMarkets: input.clientMarkets,
    requested: "us",
    billingCountry: input.billingCountry,
    band: band && isFirmCheckoutBand(band) ? band : "starter",
    interval,
  });
  let zarByBand: FirmUpgradeSnapshot["zarByBand"] = {};
  let zaLabels: FirmUpgradeSnapshot["zaLabels"] = null;
  let zaPriceLabel: string | null = null;
  if (showZar) {
    try {
      const { loadSaPricingCopy } = await import("@/lib/pricing/za-pricing-chunk.server");
      const copy = loadSaPricingCopy();
      zaLabels = copy.labels;
      // Same choice as Checkout and the ZA coupon. The list above can still
      // be rand for a client mix whose billing country is not yet ZA.
      if (charge.priceMarket === "za") {
        const key = band && isFirmCheckoutBand(band) ? band : "solo";
        zaPriceLabel = copy.labels[key][interval];
      }
    } catch (err) {
      console.warn(
        "[stripe] local price labels unavailable",
        err instanceof Error ? err.message : err,
      );
    }
  }
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
    usageLabel: formatFirmClientUsage(
      input.clientCount,
      clientLimit,
      band ? FIRM_BAND_CATALOG[band].name : null,
    ),
    priceCurrency: firmUpgradePriceCurrency({
      billingCurrency,
      interval,
      zarByBand,
    }),
    interval,
    zarByBand,
    saDiscount: showZar,
    zaLabels,
    zaPriceLabel,
  };
}
