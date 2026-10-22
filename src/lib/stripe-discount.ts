/**
 * Stripe discount refs on a subscription. Vouchers use this.
 * The retired South Africa coupon is not applied here.
 *
 * Existing subscriptions can still carry MILON_ZA_50. An upgrade does not
 * attach it. LEGACY_ZA_COUPON_ON_UPGRADE decides whether that upgrade drops
 * it. 'clear' is the shipped behaviour. Flip to 'keep' only if Theo says so.
 */

/** Legacy coupon id. Not applied to new Checkout sessions. */
export const LEGACY_ZA_COUPON_ID = "MILON_ZA_50";

/** 'clear' drops the legacy coupon on upgrade. 'keep' leaves it on the subscription. */
export const LEGACY_ZA_COUPON_ON_UPGRADE: "keep" | "clear" = "clear";

export type StoredDiscountRef = {
  id: string | null;
  couponId: string | null;
  promotionCodeId?: string | null;
};

export type FirmCouponDiscount =
  | { discount: string }
  | { coupon: string }
  | { promotion_code: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * A discounts entry that is still a bare id. Stripe returns those unless
 * the retrieve or list expands `discounts`. Treating one as "no discount"
 * would leave MILON_ZA_50 on the subscription.
 */
export class UnexpandedStripeDiscountError extends Error {
  constructor() {
    super(
      "Stripe returned an unexpanded discount id. Retrieve the subscription with expand: ['discounts'].",
    );
    this.name = "UnexpandedStripeDiscountError";
  }
}

function couponIdOf(coupon: unknown): string | null {
  if (typeof coupon === "string" && coupon.trim()) return coupon.trim();
  const record = asRecord(coupon);
  const id = record?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function promotionCodeIdOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  const id = record?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * Dahlia (2026-07-29) puts the coupon on `source.coupon`. Older Discount
 * objects put it on `coupon`. Either value may be an id or `{ id }`.
 */
function couponOnDiscount(record: Record<string, unknown>): unknown {
  const source = asRecord(record.source);
  if (source && source.coupon != null && source.coupon !== "") return source.coupon;
  return record.coupon;
}

function discountRef(value: unknown): StoredDiscountRef | null {
  if (typeof value === "string") {
    if (value.trim()) throw new UnexpandedStripeDiscountError();
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  const couponId = couponIdOf(couponOnDiscount(record));
  const promotionCodeId = promotionCodeIdOf(record.promotion_code);
  if (!id && !couponId && !promotionCodeId) return null;
  return { id, couponId, promotionCodeId };
}

/** Stripe subscription.discount and subscription.discounts. Discounts must be expanded. */
export function readSubscriptionDiscountRefs(sub: {
  discount?: unknown;
  discounts?: unknown;
}): StoredDiscountRef[] {
  if (typeof sub.discounts === "string" && sub.discounts.trim()) {
    throw new UnexpandedStripeDiscountError();
  }
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
