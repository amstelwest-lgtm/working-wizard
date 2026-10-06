/**
 * Firm upgrade vouchers are Stripe promotion codes. A valid code replaces
 * the South Africa 50% coupon. The two never stack, and a US firm never
 * receives the SA coupon.
 *
 * Setup Checkout collects a card only, so the code is checked here and
 * applied later on subscriptions.update.
 */

import {
  type FirmCouponDiscount,
  type StoredDiscountRef,
  zaSubscriptionDiscounts,
} from "./firm-sa-market";
import {
  FIRM_BAND_CATALOG,
  formatUsdFromCents,
  type FirmCheckoutBand,
  type FirmInterval,
} from "./stripe-plans";

export const FIRM_VOUCHER_INVALID_MESSAGE = "That code isn't valid for this plan";
export const FIRM_VOUCHER_UNAVAILABLE_MESSAGE =
  "Voucher codes can't be checked right now. Try again in a moment.";
export const FIRM_VOUCHER_NOT_APPLIED_MESSAGE =
  "The voucher code could not be applied, so it was not used on this upgrade.";

/** Checkout session metadata. The id is what subscriptions.update applies. */
export const FIRM_SETUP_PROMOTION_CODE_ID = "milon_promotion_code_id";
export const FIRM_SETUP_PROMOTION_CODE = "milon_promotion_code";

/** stripe-node 22 nests the coupon under promotion. Expand that, not data.coupon. */
export const FIRM_VOUCHER_LIST_EXPAND = ["data.promotion.coupon"] as const;

export type FirmVoucherRejectReason =
  | "missing"
  | "inactive"
  | "expired"
  | "wrong_customer"
  | "first_time_transaction"
  | "wrong_product"
  | "unavailable";

export type VoucherCouponView = {
  percentOff: number | null;
  amountOff: number | null;
  currency: string | null;
  duration: string | null;
  durationInMonths: number | null;
};

export type FirmVoucherResult =
  | { ok: true; promotionCodeId: string; preview: string; coupon: VoucherCouponView }
  | { ok: false; message: string; reason: FirmVoucherRejectReason };

type CouponShape = {
  id?: string | null;
  valid?: boolean | null;
  percent_off?: number | null;
  amount_off?: number | null;
  currency?: string | null;
  duration?: string | null;
  duration_in_months?: number | null;
  redeem_by?: number | null;
  max_redemptions?: number | null;
  times_redeemed?: number | null;
  applies_to?: { products?: string[] | null } | null;
};

export function normalizeVoucherCode(code: string | null | undefined): string | null {
  const trimmed = code?.trim() ?? "";
  if (!trimmed || trimmed.length > 40) return null;
  if (!/^[A-Za-z0-9-]+$/.test(trimmed)) return null;
  return trimmed;
}

export function stripeProductId(product: unknown): string | null {
  if (typeof product === "string" && product.trim()) return product.trim();
  if (!product || typeof product !== "object") return null;
  if ("deleted" in product && (product as { deleted?: unknown }).deleted === true) return null;
  const id = (product as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function firmBandListCents(band: FirmCheckoutBand, interval: FirmInterval): number | null {
  const entry = FIRM_BAND_CATALOG[band];
  const cents = interval === "year" ? entry.yearlyUsdCents : entry.monthlyUsdCents;
  return typeof cents === "number" ? cents : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function customerIdOf(customer: unknown): string | null {
  if (typeof customer === "string" && customer.trim()) return customer.trim();
  const record = asRecord(customer);
  if (!record) return null;
  if (record.deleted === true) return null;
  return typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
}

function couponRecord(value: unknown): CouponShape | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.deleted === true) return null;
  return record as CouponShape;
}

/** Coupon object from the current promotion.coupon shape, or a legacy top-level coupon. */
export function couponFromPromotionCode(promotionCode: unknown): CouponShape | string | null {
  const record = asRecord(promotionCode);
  if (!record) return null;
  const promotion = asRecord(record.promotion);
  const nested = promotion?.coupon;
  if (nested && typeof nested === "object") return couponRecord(nested);
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  const legacy = record.coupon;
  if (legacy && typeof legacy === "object") return couponRecord(legacy);
  if (typeof legacy === "string" && legacy.trim()) return legacy.trim();
  return null;
}

function reject(reason: FirmVoucherRejectReason): FirmVoucherResult {
  const message =
    reason === "unavailable" ? FIRM_VOUCHER_UNAVAILABLE_MESSAGE : FIRM_VOUCHER_INVALID_MESSAGE;
  return { ok: false, message, reason };
}

export function voucherDiscountedCents(
  listCents: number,
  coupon: { percentOff?: number | null; amountOff?: number | null },
): number {
  if (!Number.isFinite(listCents) || listCents <= 0) return 0;
  const percent = coupon.percentOff;
  if (typeof percent === "number" && percent > 0) {
    const off = Math.min(100, percent);
    return Math.max(0, Math.round((listCents * (100 - off)) / 100));
  }
  const amount = coupon.amountOff;
  if (typeof amount === "number" && amount > 0) return Math.max(0, listCents - amount);
  return Math.round(listCents);
}

/**
 * "$0 for your first month, then $99/mo" for a one-time 100% coupon.
 * Forever coupons show only the discounted amount.
 */
export function firmVoucherPricePreview(input: {
  listCents: number;
  interval: FirmInterval;
  coupon: VoucherCouponView;
}): string {
  const list = formatUsdFromCents(input.listCents);
  const discounted = formatUsdFromCents(voucherDiscountedCents(input.listCents, input.coupon));
  const suffix = input.interval === "year" ? "/yr" : "/mo";
  const duration = input.coupon.duration;
  if (duration === "once") {
    const first = input.interval === "year" ? "year" : "month";
    return `${discounted} for your first ${first}, then ${list}${suffix}`;
  }
  if (duration === "repeating") {
    const months = input.coupon.durationInMonths ?? 1;
    if (input.interval === "year" && months === 12) {
      return `${discounted} for your first year, then ${list}/yr`;
    }
    const span = months === 1 ? "month" : `${months} months`;
    return `${discounted} for your first ${span}, then ${list}${suffix}`;
  }
  return `${discounted}${suffix}`;
}

export function assessFirmVoucher(input: {
  promotionCode: unknown;
  firmCustomerId: string | null;
  productId: string | null;
  hasPriorTransaction: boolean;
  listCents: number;
  nowSeconds?: number;
}): FirmVoucherResult {
  const record = asRecord(input.promotionCode);
  const promotionCodeId = typeof record?.id === "string" ? record.id.trim() : "";
  if (!record || !promotionCodeId) return reject("missing");
  if (record.active === false) return reject("inactive");

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const expiresAt = record.expires_at;
  if (typeof expiresAt === "number" && expiresAt <= now) return reject("expired");

  const max = record.max_redemptions;
  const used = record.times_redeemed;
  if (typeof max === "number" && typeof used === "number" && used >= max) return reject("inactive");

  const restrictedTo = customerIdOf(record.customer);
  if (restrictedTo && restrictedTo !== (input.firmCustomerId?.trim() ?? "")) {
    return reject("wrong_customer");
  }

  const restrictions = asRecord(record.restrictions);
  if (restrictions?.first_time_transaction === true && input.hasPriorTransaction) {
    return reject("first_time_transaction");
  }
  const minimum = restrictions?.minimum_amount;
  const minimumCurrency =
    typeof restrictions?.minimum_amount_currency === "string"
      ? restrictions.minimum_amount_currency.trim().toLowerCase()
      : "";
  if (typeof minimum === "number" && minimum > 0) {
    if (minimumCurrency && minimumCurrency !== "usd") return reject("wrong_product");
    if (input.listCents < minimum) return reject("wrong_product");
  }

  const couponOrId = couponFromPromotionCode(record);
  if (!couponOrId || typeof couponOrId === "string") return reject("missing");
  const coupon = couponOrId;
  if (coupon.valid === false) return reject("inactive");
  if (typeof coupon.redeem_by === "number" && coupon.redeem_by <= now) return reject("expired");
  if (
    typeof coupon.max_redemptions === "number" &&
    typeof coupon.times_redeemed === "number" &&
    coupon.times_redeemed >= coupon.max_redemptions
  ) {
    return reject("inactive");
  }
  if (coupon.currency && coupon.amount_off && coupon.currency.trim().toLowerCase() !== "usd") {
    return reject("wrong_product");
  }

  const products = coupon.applies_to?.products;
  if (Array.isArray(products) && products.length > 0) {
    const productId = input.productId?.trim() ?? "";
    if (!productId || !products.includes(productId)) return reject("wrong_product");
  }

  const view: VoucherCouponView = {
    percentOff: typeof coupon.percent_off === "number" ? coupon.percent_off : null,
    amountOff: typeof coupon.amount_off === "number" ? coupon.amount_off : null,
    currency: coupon.currency?.trim() ? coupon.currency.trim().toLowerCase() : null,
    duration: coupon.duration?.trim() ? coupon.duration.trim() : null,
    durationInMonths:
      typeof coupon.duration_in_months === "number" ? coupon.duration_in_months : null,
  };
  return {
    ok: true,
    promotionCodeId,
    preview: firmVoucherPricePreview({
      listCents: input.listCents,
      interval: "month",
      coupon: view,
    }),
    coupon: view,
  };
}

/** Preview uses the selected interval. assessFirmVoucher's preview is replaced by the caller. */
export function withVoucherInterval(
  result: FirmVoucherResult,
  interval: FirmInterval,
  listCents: number,
): FirmVoucherResult {
  if (!result.ok) return result;
  return {
    ...result,
    preview: firmVoucherPricePreview({ listCents, interval, coupon: result.coupon }),
  };
}

/**
 * One discount on the subscription update. A voucher replaces the SA coupon
 * and any other discount already on the subscription. Without a voucher,
 * an SA firm still gets the SA coupon and a US firm gets none.
 */
export function firmUpgradeDiscounts(input: {
  promotionCodeId?: string | null;
  zaCouponId?: string | null;
  existing?: StoredDiscountRef[] | null;
}): FirmCouponDiscount[] | undefined {
  const promo = input.promotionCodeId?.trim() ?? "";
  if (promo) {
    const existing = input.existing ?? [];
    const za = input.zaCouponId?.trim() ?? "";
    const voucherAlreadyOnly =
      existing.length > 0 &&
      existing.every((row) => row.promotionCodeId === promo) &&
      existing.every((row) => !za || row.couponId !== za);
    if (voucherAlreadyOnly) return undefined;
    return [{ promotion_code: promo }];
  }
  return zaSubscriptionDiscounts({
    couponId: input.zaCouponId,
    existing: input.existing,
  });
}

export function firmUpgradeResultMessage(base: string, notice?: string | null): string {
  const extra = notice?.trim() ?? "";
  if (!extra) return base;
  return `${base} ${extra}`;
}

/** Stripe rejected the promotion code. Card declines are not this. */
export function isPromotionCodeStripeError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (!message) return false;
  if (/declin|insufficient funds|authentication|do not honor/.test(message)) return false;
  return /promotion code|coupon code|coupon is|prior transaction|first[- ]time/.test(message);
}

/**
 * A 100% coupon finalizes a $0 invoice with no PaymentIntent. That is paid,
 * not a failed charge. Card declines and minimum-amount errors are not this.
 */
export function isBenignZeroInvoiceError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (!message) return false;
  if (/declin|insufficient funds|amount must be at least|amount_too_small/.test(message))
    return false;
  const mentionsZero = /amount (is|of) 0\b|invoice amount is 0|zero[- ]amount|amount_due of 0/.test(
    message,
  );
  const mentionsNoPayment =
    /no payment (is )?required|nothing to (invoice|pay|collect)|invoice is already paid|missing payment_intent|payment_intent.{0,48}(null|missing)/.test(
      message,
    );
  return mentionsZero || mentionsNoPayment;
}

export type FirmSetupInvoiceView = {
  amountDue: number | null;
  status: string | null;
  paid: boolean;
};

export function readFirmSetupInvoice(invoice: unknown): FirmSetupInvoiceView | null {
  if (!invoice || typeof invoice !== "object") return null;
  const record = invoice as {
    amount_due?: unknown;
    total?: unknown;
    status?: unknown;
    paid?: unknown;
  };
  const amountDue =
    typeof record.amount_due === "number"
      ? record.amount_due
      : typeof record.total === "number"
        ? record.total
        : null;
  return {
    amountDue,
    status: typeof record.status === "string" ? record.status : null,
    paid: record.paid === true || record.status === "paid",
  };
}

/**
 * True when the update produced an active band, including a paid $0 invoice
 * that has no PaymentIntent. A non-zero unpaid invoice is not accepted.
 */
export function firmSetupUpdateAccepted(input: {
  status: string | null;
  amountDue: number | null;
  invoiceStatus: string | null;
  paid: boolean;
}): { accepted: boolean; zeroInvoice: boolean } {
  const zeroInvoice = input.amountDue === 0 && (input.paid || input.invoiceStatus === "paid");
  if (zeroInvoice) return { accepted: true, zeroInvoice: true };
  const blocked =
    input.status === "incomplete" ||
    input.status === "incomplete_expired" ||
    input.status === "past_due" ||
    input.status === "unpaid" ||
    input.status === "canceled";
  if (blocked) return { accepted: false, zeroInvoice: false };
  return { accepted: true, zeroInvoice: false };
}
