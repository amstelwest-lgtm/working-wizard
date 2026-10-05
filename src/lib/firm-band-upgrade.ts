/**
 * In-app firm-band upgrade. Pure decisions — Stripe calls live in the
 * checkout server functions. Catalog amounts stay in stripe-plans.ts.
 * Do not invent ZAR list prices. Adaptive Pricing presents ZAR at Checkout.
 */

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
} from "@/lib/stripe-plans";
import { bandIdFromStripeMetadata, type FirmSubscriptionPhase } from "@/lib/firm-client-cap";

export const ASK_FIRM_OWNER_TO_UPGRADE = "Ask your firm owner to upgrade";
export const UPGRADE_CANCELLED_MESSAGE = "Checkout cancelled. Nothing was charged.";
export const UPGRADE_FAILED_MESSAGE = "Upgrade did not finish. Your plan was not changed.";

/**
 * Same proration Stripe applies when the field is omitted (end-trial update).
 * Do not switch to always_invoice here — that would change the charge timing.
 */
export const FIRM_UPGRADE_PRORATION = "create_prorations" as const;

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

/** Next self-serve band above the current one. Scale has none (Enterprise is a quote). */
export function nextBandUp(current: FirmBandId | null): FirmCheckoutBand | null {
  const start = current ? FIRM_BAND_IDS.indexOf(current) + 1 : FIRM_BAND_IDS.indexOf("solo");
  for (let i = Math.max(start, 0); i < FIRM_BAND_IDS.length; i += 1) {
    const id = FIRM_BAND_IDS[i];
    if (isFirmCheckoutBand(id)) return id;
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
}): void {
  if (input.phase === "trialing" && input.current === input.target) return;
  if (!isUpgradeTarget(input.current, input.target)) {
    throw new Error("Choose a larger band to upgrade.");
  }
}

export type FirmUpgradeRoute = "update_subscription" | "checkout";

/**
 * Update the existing subscription when a card is on file.
 * Starter at $0 has no payment method, so it goes to Checkout.
 * No entitling subscription also goes to Checkout (signup-style, no second trial).
 */
export function decideFirmUpgradeRoute(input: {
  hasEntitlingSubscription: boolean;
  hasPaymentMethod: boolean;
}): FirmUpgradeRoute {
  if (!input.hasEntitlingSubscription) return "checkout";
  if (!input.hasPaymentMethod) return "checkout";
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
  unitAmount: number | null;
  currency: string | null;
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
    }
  | null
  | undefined;

export function readSubscriptionPrice(sub: {
  currency?: string | null;
  items?: { data?: Array<{ id?: string; price?: PriceLike }> } | null;
}): SubscriptionPriceSnapshot {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  if (!price || typeof price === "string") {
    return {
      itemId: item?.id ?? null,
      priceId: typeof price === "string" ? price : null,
      lookupKey: null,
      unitAmount: null,
      currency: sub.currency ?? null,
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
    unitAmount: typeof price.unit_amount === "number" ? price.unit_amount : null,
    currency: price.currency ?? sub.currency ?? null,
    interval,
  };
}

/** The price lookup_key is what Stripe bills. Metadata is the fallback. */
export function bandFromSubscriptionSnapshot(input: {
  lookupKey?: string | null;
  metadataPlan?: string | null;
}): FirmBandId | null {
  return (
    bandIdFromLookupKey(input.lookupKey) ??
    bandIdFromStripeMetadata({ milon_plan: input.metadataPlan })
  );
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
): string | null {
  const entry = FIRM_BAND_CATALOG[band];
  if (entry.customQuote) return null;
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
  proration_behavior: typeof FIRM_UPGRADE_PRORATION;
  payment_behavior: "error_if_incomplete";
  metadata: Record<string, string>;
  trial_end?: "now";
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
}): FirmSubscriptionUpgradeParams {
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    if (typeof value === "string") metadata[key] = value;
  }
  metadata.milon_plan = input.band;
  metadata.milon_interval = input.interval;
  metadata.milon_lookup_key = input.lookupKey;
  const params: FirmSubscriptionUpgradeParams = {
    items: [{ id: input.itemId, price: input.priceId }],
    proration_behavior: FIRM_UPGRADE_PRORATION,
    payment_behavior: "error_if_incomplete",
    metadata,
  };
  if (input.endTrial) params.trial_end = "now";
  return params;
}

export function metadataPatchForPrice(input: {
  lookupKey: string | null;
  metadata?: Record<string, string> | null;
}): Record<string, string> | null {
  const band = bandIdFromLookupKey(input.lookupKey);
  if (!band || !input.lookupKey) return null;
  const interval = intervalFromLookupKey(input.lookupKey) ?? "month";
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    if (typeof value === "string") metadata[key] = value;
  }
  if (
    metadata.milon_plan === band &&
    metadata.milon_interval === interval &&
    metadata.milon_lookup_key === input.lookupKey
  ) {
    return null;
  }
  metadata.milon_plan = band;
  metadata.milon_interval = interval;
  metadata.milon_lookup_key = input.lookupKey;
  return metadata;
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
