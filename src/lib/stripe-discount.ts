/**
 * Stripe discount refs on a subscription. Vouchers use this.
 * The retired South Africa coupon is not applied here.
 */

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

function discountRef(value: unknown): StoredDiscountRef | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  const couponId = couponIdOf(record.coupon);
  const promotionCodeId = promotionCodeIdOf(record.promotion_code);
  if (!id && !couponId && !promotionCodeId) return null;
  return { id, couponId, promotionCodeId };
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
