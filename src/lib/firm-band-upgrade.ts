/**
 * In-app firm-band upgrade. Pure decisions — Stripe calls live in the
 * checkout server functions. Catalog amounts stay in stripe-plans.ts.
 * Do not invent ZAR list prices. Adaptive Pricing presents ZAR at Checkout.
 */

import { saDiscountedUsdCents, type FirmCouponDiscount } from "./firm-sa-market";
import {
  FIRM_BAND_CATALOG,
  FIRM_BAND_IDS,
  FIRM_CHECKOUT_BANDS,
  FIRM_TRIAL_CLIENT_LIMIT,
  bandIdFromLookupKey,
  firmClientLimitLabel,
  formatUsdFromCents,
  intervalFromLookupKey,
  isFirmCheckoutBand,
  type FirmBandId,
  type FirmCheckoutBand,
  type FirmInterval,
} from "./stripe-plans";
import { bandIdFromStripeMetadata, type FirmSubscriptionPhase } from "./firm-client-cap";

export const ASK_FIRM_OWNER_TO_UPGRADE = "Ask your firm owner to upgrade";
export const UPGRADE_CANCELLED_MESSAGE = "Checkout cancelled. Nothing was charged.";
export const UPGRADE_FAILED_MESSAGE = "Upgrade did not finish. Your plan was not changed.";
export const DOWNGRADE_BELOW_USAGE_MESSAGE =
  "This practice has more clients than that band allows. Choose a band that covers the current clients.";

/** Set on the subscription when a lower price would drop the client limit under usage. */
export const MILON_DOWNGRADE_BLOCKED = "milon_downgrade_blocked";

/**
 * Proration for a paid band changing to another paid band. This is what
 * Stripe applies when the field is omitted. Do not switch it to
 * always_invoice — that would change the charge timing of a mid-cycle
 * paid change.
 *
 * A $0 Starter (unit_amount 0 or lookup milon_starter_monthly) or a trial
 * does not use this. Those start the paid plan today, with
 * billing_cycle_anchor now and proration_behavior none, so the first
 * invoice is the new price and a voucher is not spent on a $0 cycle.
 */
export const FIRM_UPGRADE_PRORATION = "create_prorations" as const;

/** True when the current subscription should start the paid plan today. */
export function firmUpgradeBillsImmediately(input: {
  status?: string | null;
  lookupKey?: string | null;
  unitAmount?: number | null;
}): boolean {
  if (input.status === "trialing") return true;
  const lookup = input.lookupKey?.trim() ?? "";
  if (lookup && lookup === FIRM_BAND_CATALOG.starter.lookup.month) return true;
  return input.unitAmount === 0;
}

export type FirmPriceCurrency = "USD" | "ZAR";

export type ZarBandAmounts = { month: number | null; year: number | null };

export type FirmUpgradeSnapshot = {
  canUpgrade: boolean;
  band: FirmBandId | null;
  phase: FirmSubscriptionPhase;
  clientCount: number;
  clientLimit: number | null;
  /** e.g. "3 of 3 clients". */
  usageLabel: string;
  /** Single currency for every price in the upgrade list. */
  priceCurrency: FirmPriceCurrency;
  interval: FirmInterval;
  zarByBand: Partial<Record<FirmBandId, ZarBandAmounts>>;
  /** Signed-in SA firm only. Public pages never set this. */
  saDiscount: boolean;
};

export function emptyFirmUpgradeSnapshot(): FirmUpgradeSnapshot {
  return {
    canUpgrade: false,
    band: null,
    phase: "none",
    clientCount: 0,
    clientLimit: null,
    usageLabel: "0 clients",
    priceCurrency: "USD",
    interval: "month",
    zarByBand: {},
    saDiscount: false,
  };
}

/** Practice owner or firm admin. Members cannot start a charge. */
export function callerCanManageFirmBilling(input: {
  isOwner: boolean;
  membershipRole: string | null | undefined;
}): boolean {
  if (input.isOwner) return true;
  return input.membershipRole === "owner" || input.membershipRole === "admin";
}

export function firmUsageLimit(
  phase: FirmSubscriptionPhase,
  band: FirmBandId | null,
): number | null {
  if (phase === "trialing") return FIRM_TRIAL_CLIENT_LIMIT;
  if (phase === "active" && band) return FIRM_BAND_CATALOG[band].clientLimit;
  return null;
}

export function formatFirmClientUsage(count: number, limit: number | null): string {
  if (limit == null) return `${count} clients`;
  return `${count} of ${limit} clients`;
}

/**
 * True when the band's catalog limit is a number strictly below the current
 * client count. Equal is allowed. Unlimited (null) is allowed. An unknown
 * count is not treated as a block.
 */
export function downgradeDropsBelowUsage(
  band: FirmBandId | null,
  clientCount: number | null | undefined,
): boolean {
  if (clientCount == null || !Number.isFinite(clientCount)) return false;
  if (!band) return false;
  const limit = FIRM_BAND_CATALOG[band].clientLimit;
  if (limit == null) return false;
  return limit < clientCount;
}

/** Next self-serve band above the current one that still covers current clients. */
export function nextBandUp(
  current: FirmBandId | null,
  clientCount?: number | null,
): FirmCheckoutBand | null {
  const start = current ? FIRM_BAND_IDS.indexOf(current) + 1 : FIRM_BAND_IDS.indexOf("solo");
  for (let i = Math.max(start, 0); i < FIRM_BAND_IDS.length; i += 1) {
    const id = FIRM_BAND_IDS[i];
    if (!isFirmCheckoutBand(id)) continue;
    if (downgradeDropsBelowUsage(id, clientCount)) continue;
    return id;
  }
  return null;
}

export function isUpgradeTarget(current: FirmBandId | null, target: FirmCheckoutBand): boolean {
  if (!current) return true;
  return FIRM_BAND_IDS.indexOf(target) > FIRM_BAND_IDS.indexOf(current);
}

export function assertUpgradeTarget(input: {
  phase: FirmSubscriptionPhase;
  current: FirmBandId | null;
  target: FirmCheckoutBand;
  clientCount?: number | null;
}): void {
  if (downgradeDropsBelowUsage(input.target, input.clientCount)) {
    throw new Error(DOWNGRADE_BELOW_USAGE_MESSAGE);
  }
  if (input.phase === "trialing" && input.current === input.target) return;
  if (!isUpgradeTarget(input.current, input.target)) {
    throw new Error("Choose a larger band to upgrade.");
  }
}

export type FirmUpgradeRoute = "update_subscription" | "setup_checkout" | "checkout";

/**
 * An existing subscription is updated in place. A $0 Starter has no card, so
 * that case collects one with Checkout in setup mode and then updates the
 * same subscription. A new subscription Checkout is only used when there is
 * no entitling subscription. Charge currency is not a route: Starter is USD,
 * and Adaptive Pricing ZAR is presentment only.
 */
export function decideFirmUpgradeRoute(input: {
  hasEntitlingSubscription: boolean;
  hasPaymentMethod: boolean;
}): FirmUpgradeRoute {
  if (!input.hasEntitlingSubscription) return "checkout";
  if (!input.hasPaymentMethod) return "setup_checkout";
  return "update_subscription";
}

export function idOfStripeRef(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

export function subscriptionHasCollectiblePaymentMethod(input: {
  subscriptionPaymentMethod: unknown;
  subscriptionSource: unknown;
  customerPaymentMethod: unknown;
  customerSource: unknown;
  attachedPaymentMethodCount?: number;
}): boolean {
  if (idOfStripeRef(input.subscriptionPaymentMethod)) return true;
  if (idOfStripeRef(input.subscriptionSource)) return true;
  if (idOfStripeRef(input.customerPaymentMethod)) return true;
  if (idOfStripeRef(input.customerSource)) return true;
  return (input.attachedPaymentMethodCount ?? 0) > 0;
}

export type SubscriptionPriceSnapshot = {
  itemId: string | null;
  priceId: string | null;
  lookupKey: string | null;
  /** Product metadata.band, when the Product is expanded. */
  productBand: string | null;
  unitAmount: number | null;
  /** Price object currency. Live catalog prices, including $0 Starter, are USD. */
  currency: string | null;
  /** subscription.currency. Adaptive Pricing presentment is not this field. */
  chargeCurrency: string | null;
  interval: FirmInterval | null;
};

type PriceLike =
  | string
  | {
      id?: string;
      lookup_key?: string | null;
      unit_amount?: number | null;
      currency?: string | null;
      recurring?: { interval?: string | null } | null;
      currency_options?: { zar?: { unit_amount?: number | null } | null } | null;
      product?: unknown;
    }
  | null
  | undefined;

function productBandOf(price: Exclude<PriceLike, string | null | undefined>): string | null {
  const product = price.product;
  if (!product || typeof product !== "object") return null;
  const metadata = (product as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const band = (metadata as { band?: unknown }).band;
  return typeof band === "string" && band.trim() ? band.trim() : null;
}

export function readSubscriptionPrice(sub: {
  currency?: string | null;
  items?: { data?: Array<{ id?: string; price?: PriceLike }> } | null;
}): SubscriptionPriceSnapshot {
  const chargeCurrency = sub.currency?.trim() ? sub.currency : null;
  const item = sub.items?.data?.[0];
  const price = item?.price;
  if (!price || typeof price === "string") {
    return {
      itemId: item?.id ?? null,
      priceId: typeof price === "string" ? price : null,
      lookupKey: null,
      productBand: null,
      unitAmount: null,
      currency: chargeCurrency,
      chargeCurrency,
      interval: null,
    };
  }
  const recurring = price.recurring?.interval;
  const interval =
    recurring === "month" || recurring === "year"
      ? recurring
      : intervalFromLookupKey(price.lookup_key);
  return {
    itemId: item?.id ?? null,
    priceId: price.id ?? null,
    lookupKey: price.lookup_key ?? null,
    productBand: productBandOf(price),
    unitAmount: typeof price.unit_amount === "number" ? price.unit_amount : null,
    currency: price.currency ?? chargeCurrency,
    chargeCurrency,
    interval,
  };
}

/** lookup_key first, then product metadata.band. Never a hardcoded price id. */
export function billedBandFromPrice(input: {
  lookupKey?: string | null;
  productBand?: string | null;
}): FirmBandId | null {
  return (
    bandIdFromLookupKey(input.lookupKey) ??
    bandIdFromStripeMetadata({ milon_plan: input.productBand })
  );
}

/**
 * The price lookup_key is what Stripe bills. Product metadata.band is next.
 * Subscription metadata is the fallback. A flagged downgrade keeps the
 * metadata band so the client limit does not fall below usage.
 */
export function bandFromSubscriptionSnapshot(input: {
  lookupKey?: string | null;
  productBand?: string | null;
  metadataPlan?: string | null;
  downgradeBlocked?: boolean | string | null;
}): FirmBandId | null {
  const fromPrice = billedBandFromPrice(input);
  const fromMeta = bandIdFromStripeMetadata({ milon_plan: input.metadataPlan });
  const blocked = input.downgradeBlocked === true || input.downgradeBlocked === "1";
  if (blocked && fromMeta) return fromMeta;
  return fromPrice ?? fromMeta;
}

export type RankedSubscription = {
  id: string;
  status: string;
  created: number;
  band: FirmBandId | null;
};

function limitRank(band: FirmBandId | null): number {
  if (!band) return -1;
  const limit = FIRM_BAND_CATALOG[band].clientLimit;
  if (limit == null) return Number.POSITIVE_INFINITY;
  return limit;
}

/**
 * Trial still wins (the 3-client cap is the phase, not the paid limit).
 * Among active subscriptions, the larger band wins so a leftover Starter
 * subscription cannot hide a Solo upgrade.
 */
export function pickEntitlingFirmSubscription<T extends RankedSubscription>(subs: T[]): T | null {
  const trialing = subs.filter((sub) => sub.status === "trialing");
  if (trialing.length) {
    return trialing.slice().sort((a, b) => b.created - a.created)[0] ?? null;
  }
  const active = subs.filter((sub) => sub.status === "active");
  if (!active.length) return null;
  return (
    active.slice().sort((a, b) => {
      const byLimit = limitRank(b.band) - limitRank(a.band);
      if (byLimit !== 0) return byLimit;
      return b.created - a.created;
    })[0] ?? null
  );
}

export function formatFirmPriceCents(cents: number, currency: FirmPriceCurrency): string {
  if (currency === "ZAR") {
    const rands = cents / 100;
    const body = Number.isInteger(rands)
      ? rands.toLocaleString("en-ZA")
      : rands.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `R${body}`;
  }
  return formatUsdFromCents(cents);
}

export function zarCentsFromPrice(price: {
  currency?: string | null;
  unit_amount?: number | null;
  currency_options?: { zar?: { unit_amount?: number | null } | null } | null;
}): number | null {
  const option = price.currency_options?.zar?.unit_amount;
  if (typeof option === "number") return option;
  if (price.currency?.toLowerCase() === "zar" && typeof price.unit_amount === "number") {
    return price.unit_amount;
  }
  return null;
}

/**
 * One currency for the whole list. ZAR only when Stripe actually returned a
 * rand amount for every paid band. Otherwise stay on the USD catalog so the
 * UI never mixes $0.00 with "Charged in ZAR".
 */
export function firmUpgradePriceCurrency(input: {
  billingCurrency: string | null | undefined;
  interval: FirmInterval;
  zarByBand: Partial<Record<FirmBandId, ZarBandAmounts>>;
}): FirmPriceCurrency {
  if ((input.billingCurrency ?? "").trim().toLowerCase() !== "zar") return "USD";
  const complete = FIRM_CHECKOUT_BANDS.every((id) => {
    const entry = FIRM_BAND_CATALOG[id];
    const usd = input.interval === "year" ? entry.yearlyUsdCents : entry.monthlyUsdCents;
    if (usd == null) return true;
    const zar = input.zarByBand[id];
    const amount = input.interval === "year" ? zar?.year : zar?.month;
    return typeof amount === "number";
  });
  return complete ? "ZAR" : "USD";
}

export function firmBandPriceLabel(
  band: FirmBandId,
  interval: FirmInterval,
  currency: FirmPriceCurrency,
  zarByBand?: Partial<Record<FirmBandId, ZarBandAmounts>> | null,
  options?: { saDiscount?: boolean },
): string | null {
  const entry = FIRM_BAND_CATALOG[band];
  if (entry.customQuote) return null;
  if (options?.saDiscount) {
    const usd = interval === "year" ? entry.yearlyUsdCents : entry.monthlyUsdCents;
    if (usd == null) return null;
    return formatFirmPriceCents(saDiscountedUsdCents(usd), "USD");
  }
  if (currency === "ZAR") {
    const slot = zarByBand?.[band];
    const zar = interval === "year" ? slot?.year : slot?.month;
    if (typeof zar === "number") return formatFirmPriceCents(zar, "ZAR");
    const usd = interval === "year" ? entry.yearlyUsdCents : entry.monthlyUsdCents;
    if (usd === 0) return formatFirmPriceCents(0, "ZAR");
    return null;
  }
  const cents = interval === "year" ? entry.yearlyUsdCents : entry.monthlyUsdCents;
  if (cents == null) return null;
  return formatFirmPriceCents(cents, "USD");
}

export function billingCurrencyCode(input: {
  stripeCurrency?: string | null;
  marketCountry?: "ZA" | "US" | null;
}): string {
  const stripe = input.stripeCurrency?.trim().toLowerCase();
  if (stripe) return stripe;
  if (input.marketCountry === "ZA") return "zar";
  return "usd";
}

export type FirmSubscriptionUpgradeParams = {
  items: Array<{ id: string; price: string }>;
  proration_behavior: "none" | typeof FIRM_UPGRADE_PRORATION;
  payment_behavior: "error_if_incomplete";
  /** Set only when a $0 Starter or a trial starts the paid plan today. */
  billing_cycle_anchor?: "now";
  metadata: Record<string, string>;
  trial_end?: "now";
  /** Present only when the SA coupon or a voucher still needs attaching. */
  discounts?: FirmCouponDiscount[];
};

export function firmSubscriptionUpgradeParams(input: {
  itemId: string;
  priceId: string;
  band: FirmCheckoutBand;
  interval: FirmInterval;
  lookupKey: string;
  metadata?: Record<string, string> | null;
  /** Trial cap stays at 3 until the subscription is active. */
  endTrial: boolean;
  /**
   * The subscription being updated. A $0 Starter or a trial starts the
   * paid plan today. A paid band keeps create_prorations.
   */
  current?: {
    status?: string | null;
    lookupKey?: string | null;
    unitAmount?: number | null;
  } | null;
  /** Already-idempotent list from firmUpgradeDiscounts. Omit when undefined. */
  discounts?: FirmCouponDiscount[];
}): FirmSubscriptionUpgradeParams {
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    if (typeof value === "string") metadata[key] = value;
  }
  metadata.milon_plan = input.band;
  metadata.milon_interval = input.interval;
  metadata.milon_lookup_key = input.lookupKey;
  const trialing = input.endTrial || input.current?.status === "trialing";
  const startToday =
    trialing ||
    firmUpgradeBillsImmediately({
      lookupKey: input.current?.lookupKey,
      unitAmount: input.current?.unitAmount,
    });
  const params: FirmSubscriptionUpgradeParams = {
    items: [{ id: input.itemId, price: input.priceId }],
    proration_behavior: startToday ? "none" : FIRM_UPGRADE_PRORATION,
    payment_behavior: "error_if_incomplete",
    metadata,
  };
  if (startToday) params.billing_cycle_anchor = "now";
  if (trialing) params.trial_end = "now";
  if (input.discounts?.length) params.discounts = input.discounts;
  return params;
}

function copyStringMetadata(metadata?: Record<string, string> | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * Align milon_plan with the billed band. When that band's limit is below the
 * firm's client count, leave milon_plan where it is and set
 * milon_downgrade_blocked instead of lowering the cap.
 * An unknown client count does not block.
 */
export function metadataPatchForPrice(input: {
  lookupKey: string | null;
  productBand?: string | null;
  metadata?: Record<string, string> | null;
  clientCount?: number | null;
}): Record<string, string> | null {
  const band = billedBandFromPrice({
    lookupKey: input.lookupKey,
    productBand: input.productBand,
  });
  if (!band) return null;
  const interval = intervalFromLookupKey(input.lookupKey) ?? "month";
  const metadata = copyStringMetadata(input.metadata);
  const lookupKey = input.lookupKey?.trim() ?? "";

  if (downgradeDropsBelowUsage(band, input.clientCount)) {
    if (
      metadata[MILON_DOWNGRADE_BLOCKED] === "1" &&
      metadata.milon_downgrade_blocked_band === band
    ) {
      return null;
    }
    metadata[MILON_DOWNGRADE_BLOCKED] = "1";
    metadata.milon_downgrade_blocked_band = band;
    return metadata;
  }

  const unchanged =
    metadata.milon_plan === band &&
    metadata.milon_interval === interval &&
    (lookupKey ? metadata.milon_lookup_key === lookupKey : true) &&
    metadata[MILON_DOWNGRADE_BLOCKED] !== "1";
  if (unchanged) return null;
  metadata.milon_plan = band;
  metadata.milon_interval = interval;
  if (lookupKey) metadata.milon_lookup_key = lookupKey;
  if (metadata[MILON_DOWNGRADE_BLOCKED] === "1") metadata[MILON_DOWNGRADE_BLOCKED] = "0";
  return metadata;
}

/** Restore the previous price when a portal or API change would under-cover usage. */
export function shouldRevertBlockedDowngrade(input: {
  blocked: boolean;
  currentPriceId: string | null | undefined;
  previousPriceId: string | null | undefined;
  itemId: string | null | undefined;
}): boolean {
  if (!input.blocked) return false;
  if (!input.itemId?.trim()) return false;
  const previous = input.previousPriceId?.trim() ?? "";
  const current = input.currentPriceId?.trim() ?? "";
  if (!previous || !current || previous === current) return false;
  return true;
}

export function previousPriceIdFromSubscriptionEvent(event: {
  type?: string;
  data?: { previous_attributes?: unknown };
}): string | null {
  if (event.type !== "customer.subscription.updated") return null;
  const prev = event.data?.previous_attributes;
  if (!prev || typeof prev !== "object") return null;
  const items = (prev as { items?: { data?: Array<{ price?: unknown }> } }).items;
  const price = items?.data?.[0]?.price;
  if (typeof price === "string" && price.trim()) return price.trim();
  if (price && typeof price === "object" && "id" in price) {
    const id = (price as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

export function shouldCancelReplacedSubscription(input: {
  newStatus: string | null | undefined;
  replacedId: string | null | undefined;
  newId: string;
}): boolean {
  const replaced = input.replacedId?.trim();
  if (!replaced || replaced === input.newId) return false;
  return input.newStatus === "active" || input.newStatus === "trialing";
}

export function firmUpgradeReturnPath(outcome: "success" | "cancelled"): string {
  if (outcome === "cancelled") return "/dashboard?addClient=1&upgrade=cancelled";
  return "/dashboard?addClient=1&upgrade=success&session_id={CHECKOUT_SESSION_ID}";
}

export function parseFirmUpgradeReturn(search: string): {
  reopenAddClient: boolean;
  outcome: "success" | "cancelled" | "failed" | null;
  sessionId: string | null;
} {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const upgrade = params.get("upgrade");
  const outcome =
    upgrade === "success" || upgrade === "cancelled" || upgrade === "failed" ? upgrade : null;
  const session = params.get("session_id");
  const sessionId = session && /^cs_[A-Za-z0-9_]+$/.test(session) ? session : null;
  return {
    reopenAddClient: params.get("addClient") === "1" || outcome === "success",
    outcome,
    sessionId,
  };
}

export function upgradeSuccessMessage(band: FirmCheckoutBand): string {
  return `Upgraded to ${FIRM_BAND_CATALOG[band].name}. ${firmClientLimitLabel(band)}.`;
}

export function upgradeButtonLabel(band: FirmCheckoutBand): string {
  return `Upgrade to ${FIRM_BAND_CATALOG[band].name}`;
}
