/**
 * South Africa 50% off the USD firm bands. Coupon, not a second price list.
 *
 * firms.market is jsonb {country: "ZA"|"US", regionCode}. There is no
 * currency or locale column. Currency and locale are read only when those
 * keys are present on that JSON (or passed beside it). A missing market is
 * not South Africa. Request IP, geo headers, and the Checkout `market`
 * field are not inputs.
 */

export const STRIPE_ZA_COUPON_ID_DEFAULT = "MILON_ZA_50";
export const SA_FIRM_DISCOUNT_NOTE = "South Africa pricing: 50% off";
export const SA_FIRM_DISCOUNT_PERCENT = 50;

export function stripeZaCouponId(envValue?: string | null): string {
  const trimmed = (envValue ?? "").trim();
  return trimmed || STRIPE_ZA_COUPON_ID_DEFAULT;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/**
 * True when the stored firm country is ZA, or, when country is not ZA,
 * a stored currency is ZAR or a stored locale is en-ZA.
 */
export function isSaMarketFirm(
  firm:
    | {
        market?: unknown;
        currency?: string | null;
        locale?: string | null;
      }
    | null
    | undefined,
): boolean {
  if (!firm) return false;
  const market = asRecord(firm.market);
  const country = text(market?.country);
  if (country === "za") return true;
  const currency = text(firm.currency) || text(market?.currency);
  const locale = text(firm.locale) || text(market?.locale);
  if (currency === "zar") return true;
  if (locale === "en-za") return true;
  return false;
}

export type StoredDiscountRef = { id: string | null; couponId: string | null };

function couponIdOf(coupon: unknown): string | null {
  if (typeof coupon === "string" && coupon.trim()) return coupon.trim();
  const record = asRecord(coupon);
  const id = record?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function discountRef(value: unknown): StoredDiscountRef | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  const couponId = couponIdOf(record.coupon);
  if (!id && !couponId) return null;
  return { id, couponId };
}

/** Stripe subscription.discount and subscription.discounts, either shape. */
export function readSubscriptionDiscountRefs(sub: {
  discount?: unknown;
  discounts?: unknown;
}): StoredDiscountRef[] {
  const out: StoredDiscountRef[] = [];
  const list = Array.isArray(sub.discounts) ? sub.discounts : [];
  for (const entry of list) {
    const ref = discountRef(entry);
    if (ref) out.push(ref);
  }
  const single = discountRef(sub.discount);
  if (single && !out.some((row) => row.id && row.id === single.id)) out.push(single);
  return out;
}

export type FirmCouponDiscount = { discount: string } | { coupon: string };

/**
 * Discounts to send on subscriptions.update. Undefined when the coupon is
 * absent or already on the subscription, so a second call does not stack it.
 * Existing discount ids are kept.
 */
export function zaSubscriptionDiscounts(input: {
  couponId: string | null | undefined;
  existing?: StoredDiscountRef[] | null;
}): FirmCouponDiscount[] | undefined {
  const couponId = input.couponId?.trim() ?? "";
  if (!couponId) return undefined;
  const existing = input.existing ?? [];
  if (existing.some((row) => row.couponId === couponId)) return undefined;
  const kept: FirmCouponDiscount[] = [];
  const seen = new Set<string>();
  for (const row of existing) {
    const id = row.id?.trim() ?? "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    kept.push({ discount: id });
  }
  kept.push({ coupon: couponId });
  return kept;
}

/** Half of a USD catalog amount. Starter stays 0. */
export function saDiscountedUsdCents(cents: number): number {
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return Math.round((cents * (100 - SA_FIRM_DISCOUNT_PERCENT)) / 100);
}
