/**
 * In-app firm-band upgrade. Pure decisions — Stripe calls live in the
 * checkout server functions. Catalog amounts stay in stripe-plans.ts.
 * Do not invent ZAR list prices. Adaptive Pricing presents ZAR at Checkout.
 */

import { resolveFirmMarket, resolveFirmPriceCurrency } from "@/lib/pricing/market-resolution";
import type { FirmCouponDiscount } from "./stripe-discount";
import { formatMoney } from "./market/format";
import { ZA_MARKET } from "./market/resolve";
import { parseMarketSelection } from "./market/parse";
import { isOwnerCatalogPrice } from "./owner-price";
import { parseZaLookupKey } from "./pricing/za-lookup";
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
  starterClientLimit,
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
 * A legacy $0 Starter (unit_amount 0 on the existing price id) or a trial
 * does not use this. Those start the paid plan today, with
 * billing_cycle_anchor now and proration_behavior none, so the first
 * invoice is the new price and a voucher is not spent on a $0 cycle.
 * The paid Starter lookup key is not a $0 signal: that key is the new
 * entry band, and a paid-to-paid change keeps create_prorations.
 */
export const FIRM_UPGRADE_PRORATION = "create_prorations" as const;

/** True when the current subscription should start the paid plan today. */
export function firmUpgradeBillsImmediately(input: {
  status?: string | null;
  lookupKey?: string | null;
  unitAmount?: number | null;
}): boolean {
  if (input.status === "trialing") return true;
  return input.unitAmount === 0;
}

export type FirmPriceCurrency = "USD" | "zar";

export type ZarBandAmounts = { month: number | null; year: number | null };

export type FirmUpgradeSnapshot = {
  canUpgrade: boolean;
  band: FirmBandId | null;
  phase: FirmSubscriptionPhase;
  clientCount: number;
  clientLimit: number | null;
  /** e.g. "8 active clients · Starter limit 5". */
  usageLabel: string;
  /** Single currency for every price in the upgrade list. */
  priceCurrency: FirmPriceCurrency;
  interval: FirmInterval;
  zarByBand: Partial<Record<FirmBandId, ZarBandAmounts>>;
  /** Server-built rand lines when the practice list is in rand. */
  zaLabels?: Partial<Record<FirmBandId, { month: string; year: string }>> | null;
  /**
   * Charge line for the current band. A firm with no subscription uses
   * Starter, the same plan as the Start trial wall. Set only when Checkout
   * would charge ZAR for this billing country (`firmCheckoutCharge`). A
   * client-mix firm leaves it empty until the billing country is known to be ZA.
   */
  zaPriceLabel?: string | null;
};

export function emptyFirmUpgradeSnapshot(): FirmUpgradeSnapshot {
  return {
    canUpgrade: false,
    band: null,
    phase: "none",
    clientCount: 0,
    clientLimit: null,
    usageLabel: "0 clients",
    priceCurrency: resolveFirmPriceCurrency(null),
    interval: "month",
    zarByBand: {},
    zaLabels: null,
    zaPriceLabel: null,
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
  unitAmount?: number | null,
): number | null {
  if (band === "starter" && (phase === "trialing" || phase === "active")) {
    return FIRM_BAND_CATALOG.starter.clientLimit;
  }
  if (phase === "trialing") return FIRM_TRIAL_CLIENT_LIMIT;
  if (phase === "active" && band === "starter") return starterClientLimit(unitAmount);
  if (phase === "active" && band) return FIRM_BAND_CATALOG[band].clientLimit;
  return null;
}

export function activeClientsLabel(count: number): string {
  return count === 1 ? "1 active client" : `${count} active clients`;
}

export function formatFirmClientUsage(
  count: number,
  limit: number | null,
  planName?: string | null,
): string {
  const clients = activeClientsLabel(count);
  if (limit == null) return clients;
  const name = planName?.trim();
  if (name) return `${clients} · ${name} limit ${limit}`;
  return `${clients} · limit ${limit}`;
}

/**
 * Shown on Settings → Plan when the practice has more active clients than the
 * band allows. Demo rows are not in `count`. There is no archived flag on
 * clients, and each row is one client even when two share a name.
 */
export function formatFirmOverLimitNote(input: {
  count: number | null | undefined;
  limit: number | null | undefined;
  planName?: string | null;
}): string | null {
  const count = input.count;
  const limit = input.limit;
  if (count == null || limit == null || !Number.isFinite(count) || !Number.isFinite(limit)) return null;
  if (count <= limit) return null;
  const name = input.planName?.trim() || "This plan";
  const extra = count - limit;
  return `${name} includes ${activeClientsLabel(limit)}. This practice has ${activeClientsLabel(count)}, ${extra} over the limit. Upgrade to raise it.`;
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

/**
 * True when this band cannot take another client. A limit equal to the
 * active count is full. Unlimited is never full. An unknown count is not
 * treated as full, so a new practice still starts on Starter.
 */
function bandIsFull(
  band: FirmBandId,
  clientCount: number | null | undefined,
): boolean {
  if (clientCount == null || !Number.isFinite(clientCount)) return false;
  const limit = FIRM_BAND_CATALOG[band].clientLimit;
  if (limit == null) return false;
  return limit <= clientCount;
}

/**
 * Default upgrade: the smallest self-serve band above the current one whose
 * client limit is above the active count. A full plan (limit <= count) is
 * never the default. With no current band, the search starts at Starter.
 * Starter can still be chosen in the list when its limit equals the count.
 */
export function nextBandUp(
  current: FirmBandId | null,
  clientCount?: number | null,
): FirmCheckoutBand | null {
  const start = current ? FIRM_BAND_IDS.indexOf(current) + 1 : FIRM_BAND_IDS.indexOf("starter");
  for (let i = Math.max(start, 0); i < FIRM_BAND_IDS.length; i += 1) {
    const id = FIRM_BAND_IDS[i];
    if (!isFirmCheckoutBand(id)) continue;
    if (bandIsFull(id, clientCount)) continue;
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
  /** Product metadata.plan. Owner prices use plan=owner and no band. */
  productPlan: string | null;
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

function productMetaOf(price: Exclude<PriceLike, string | null | undefined>): {
  band: string | null;
  plan: string | null;
} {
  const product = price.product;
  if (!product || typeof product !== "object") return { band: null, plan: null };
  const metadata = (product as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return { band: null, plan: null };
  const band = (metadata as { band?: unknown }).band;
  const plan = (metadata as { plan?: unknown }).plan;
  return {
    band: typeof band === "string" && band.trim() ? band.trim() : null,
    plan: typeof plan === "string" && plan.trim() ? plan.trim() : null,
  };
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
      productPlan: null,
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
  const meta = productMetaOf(price);
  return {
    itemId: item?.id ?? null,
    priceId: price.id ?? null,
    lookupKey: price.lookup_key ?? null,
    productBand: meta.band,
    productPlan: meta.plan,
    unitAmount: typeof price.unit_amount === "number" ? price.unit_amount : null,
    currency: price.currency ?? chargeCurrency,
    chargeCurrency,
    interval,
  };
}

/** lookup_key first, then product metadata.band. Owner prices are not a band. */
export function billedBandFromPrice(input: {
  lookupKey?: string | null;
  productBand?: string | null;
  productPlan?: string | null;
}): FirmBandId | null {
  if (isOwnerCatalogPrice(input)) return null;
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
  productPlan?: string | null;
  metadataPlan?: string | null;
  downgradeBlocked?: boolean | string | null;
}): FirmBandId | null {
  if (isOwnerCatalogPrice(input)) return null;
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
  /** Owner catalog price. Never selected as the firm's plan. */
  owner?: boolean;
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
  const firmSubs = subs.filter((sub) => !sub.owner);
  const trialing = firmSubs.filter((sub) => sub.status === "trialing");
  if (trialing.length) {
    return trialing.slice().sort((a, b) => b.created - a.created)[0] ?? null;
  }
  const active = firmSubs.filter((sub) => sub.status === "active");
  if (!active.length) return null;
  return (
    active.slice().sort((a, b) => {
      const byLimit = limitRank(b.band) - limitRank(a.band);
      if (byLimit !== 0) return byLimit;
      return b.created - a.created;
    })[0] ?? null
  );
}

function pricedInZar(currency: string): boolean {
  return currency.toLowerCase() === "zar";
}

export function formatFirmPriceCents(cents: number, currency: FirmPriceCurrency): string {
  if (pricedInZar(currency)) {
    const rands = cents / 100;
    return formatMoney(
      rands,
      ZA_MARKET,
      Number.isInteger(rands) ? undefined : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
    );
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
  return complete ? "zar" : "USD";
}

const VAT_PHRASE = /\b(?:excl\.?|incl\.?|excluding|including)\s+vat\b|\bvat\b/gi;

/**
 * Display line for a South African practice. Uses a stored rand label when
 * one is already on the row, otherwise the published ZA ladder. Charge
 * currency and Checkout routing stay on the existing path.
 */
export function saFirmDisplayPrice(
  band: FirmBandId,
  interval: FirmInterval,
  zaLabel?: string | null,
): string {
  const cleaned = (zaLabel ?? "")
    .replace(VAT_PHRASE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+·/g, " ·")
    .trim();
  if (cleaned && !cleaned.includes("$")) return cleaned;
  const entry = FIRM_BAND_CATALOG[band];
  if (!entry || entry.customQuote) return cleaned || "—";
  return `${entry.name} plan`;
}

/**
 * Whether a practice's plan list is in rand. Settings and the Add client
 * cap snapshot both use this. True when the firm row is South Africa, or
 * when more clients are in South Africa than in the United States.
 *
 * The list can be rand while Checkout still charges USD. `firmCheckoutCharge`
 * charges ZAR for a non-ZA firm row only when this is true and the billing
 * country is known to be ZA. A ZA firm row still charges ZAR when the
 * country is ZA or unknown.
 */
export function practiceDisplaysZarPlan(input: {
  firmMarket: unknown;
  clientMarkets?: readonly unknown[] | null;
}): boolean {
  if (resolveFirmMarket(input.firmMarket) === "za") return true;
  let za = 0;
  let us = 0;
  for (const raw of input.clientMarkets ?? []) {
    const country = parseMarketSelection(raw)?.country;
    if (country === "ZA") za += 1;
    else if (country === "US") us += 1;
  }
  return za > 0 && za > us;
}

/** An SA plan hides the US state list and any VAT sentence. */
export function saPlanRegionControls(zarPlan: boolean): { stateDropdown: boolean; vatCopy: boolean } {
  if (zarPlan) return { stateDropdown: false, vatCopy: false };
  return { stateDropdown: true, vatCopy: true };
}

export function firmBandPriceLabel(
  band: FirmBandId,
  interval: FirmInterval,
  currency: FirmPriceCurrency,
  zarByBand?: Partial<Record<FirmBandId, ZarBandAmounts>> | null,
): string | null {
  const entry = FIRM_BAND_CATALOG[band];
  if (entry.customQuote) return null;
  if (pricedInZar(currency)) {
    const slot = zarByBand?.[band];
    const zar = interval === "year" ? slot?.year : slot?.month;
    if (typeof zar === "number") return formatFirmPriceCents(zar, "zar");
    const usd = interval === "year" ? entry.yearlyUsdCents : entry.monthlyUsdCents;
    if (usd === 0) return formatFirmPriceCents(0, "zar");
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
  /** Present when a voucher is attached. */
  discounts?: FirmCouponDiscount[];
  automatic_tax?: { enabled: boolean };
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
  if (input.discounts) params.discounts = input.discounts;
  if (parseZaLookupKey(input.lookupKey)) params.automatic_tax = { enabled: false };
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
  productPlan?: string | null;
  metadata?: Record<string, string> | null;
  clientCount?: number | null;
}): Record<string, string> | null {
  if (isOwnerCatalogPrice(input)) return null;
  const band = billedBandFromPrice({
    lookupKey: input.lookupKey,
    productBand: input.productBand,
    productPlan: input.productPlan,
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

/** Names the band the firm is on, so an upgrade is not a bare "Upgrade to Solo". */
export function currentPlanLabel(band: FirmBandId | null | undefined): string | null {
  if (!band) return null;
  return `Current plan: ${FIRM_BAND_CATALOG[band].name}`;
}

export function upgradeButtonLabel(band: FirmCheckoutBand): string {
  const entry = FIRM_BAND_CATALOG[band];
  const cap = entry.clientLimit == null ? "unlimited clients" : `up to ${entry.clientLimit} clients`;
  return `Upgrade to ${entry.name} (${cap})`;
}
