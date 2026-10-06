/**
 * Resolve a firm voucher with the Stripe promotion code list API.
 * Does not create Stripe objects.
 */

import {
  assessFirmVoucher,
  couponFromPromotionCode,
  FIRM_VOUCHER_INVALID_MESSAGE,
  FIRM_VOUCHER_LIST_EXPAND,
  FIRM_VOUCHER_UNAVAILABLE_MESSAGE,
  normalizeVoucherCode,
  withVoucherInterval,
  type FirmVoucherResult,
} from "./firm-voucher";
import type { FirmInterval } from "./stripe-plans";

type PromoList = {
  data: unknown[];
};

export type FirmVoucherStripe = {
  promotionCodes: {
    list: (params: {
      code: string;
      active: true;
      limit: 1;
      expand: string[];
    }) => Promise<PromoList>;
    retrieve?: (id: string, params?: { expand?: string[] }) => Promise<unknown>;
  };
  coupons?: {
    retrieve: (id: string) => Promise<unknown>;
  };
  invoices?: {
    list: (params: { customer: string; status?: string; limit: number }) => Promise<{
      data: Array<{ amount_paid?: number | null; total?: number | null; status?: string | null }>;
    }>;
  };
};

/**
 * A paid invoice or charge above $0 is a prior transaction. A $0 Starter
 * invoice is not, so a first-time voucher can still apply on upgrade.
 * Unknown means the invoice list could not be read; the caller does not
 * treat that as a prior transaction.
 */
export async function customerHasPriorPaidTransaction(
  stripe: FirmVoucherStripe,
  customerId: string,
): Promise<boolean | "unknown"> {
  if (!stripe.invoices?.list) return "unknown";
  try {
    const listed = await stripe.invoices.list({
      customer: customerId,
      status: "paid",
      limit: 20,
    });
    return listed.data.some(
      (invoice) => (invoice.amount_paid ?? 0) > 0 || (invoice.total ?? 0) > 0,
    );
  } catch (err) {
    console.warn(
      "[stripe] voucher history lookup failed",
      err instanceof Error ? err.message : err,
    );
    return "unknown";
  }
}

function couponIdOf(coupon: unknown): string | null {
  if (typeof coupon === "string" && coupon.trim()) return coupon.trim();
  if (!coupon || typeof coupon !== "object") return null;
  const id = (coupon as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * `applies_to`, `valid`, `percent_off`, and `amount_off` come from the coupon
 * itself. A promotion-code expand can omit them, so retrieve the coupon by id
 * whenever the client can. Does not create or redeem anything.
 */
async function couponExpanded(stripe: FirmVoucherStripe, promotionCode: unknown): Promise<unknown> {
  const coupon = couponFromPromotionCode(promotionCode);
  const couponId = couponIdOf(coupon);
  if (!couponId || !stripe.coupons?.retrieve) return promotionCode;
  let retrieved: unknown;
  try {
    retrieved = await stripe.coupons.retrieve(couponId);
  } catch (err) {
    console.warn(
      "[stripe] voucher coupon retrieve failed",
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
  const record =
    promotionCode && typeof promotionCode === "object"
      ? { ...(promotionCode as Record<string, unknown>) }
      : {};
  const promotion =
    record.promotion && typeof record.promotion === "object"
      ? (record.promotion as Record<string, unknown>)
      : null;
  if (promotion?.type === "coupon") {
    return { ...record, promotion: { ...promotion, coupon: retrieved } };
  }
  return { ...record, coupon: retrieved };
}

export async function resolveFirmVoucher(
  stripe: FirmVoucherStripe,
  input: {
    code?: string | null;
    promotionCodeId?: string | null;
    firmCustomerId: string | null;
    productId: string | null;
    listCents: number;
    interval: FirmInterval;
    nowSeconds?: number;
    /** `isSaMarketFirm` on the firm row. Omitted is not South Africa. */
    saMarket?: boolean;
  },
): Promise<FirmVoucherResult> {
  const code = normalizeVoucherCode(input.code);
  const storedId = input.promotionCodeId?.trim() ?? "";
  if (!code && !storedId) {
    return { ok: false, message: FIRM_VOUCHER_INVALID_MESSAGE, reason: "missing" };
  }
  if (input.code?.trim() && !code) {
    return { ok: false, message: FIRM_VOUCHER_INVALID_MESSAGE, reason: "missing" };
  }

  try {
    let promotionCode: unknown = null;
    if (code) {
      const listed = await stripe.promotionCodes.list({
        code,
        active: true,
        limit: 1,
        expand: [...FIRM_VOUCHER_LIST_EXPAND],
      });
      promotionCode = listed.data[0] ?? null;
    } else if (storedId && stripe.promotionCodes.retrieve) {
      promotionCode = await stripe.promotionCodes.retrieve(storedId, {
        expand: ["promotion.coupon"],
      });
    }
    if (!promotionCode) {
      return { ok: false, message: FIRM_VOUCHER_INVALID_MESSAGE, reason: "missing" };
    }
    promotionCode = await couponExpanded(stripe, promotionCode);

    const foundId =
      promotionCode && typeof promotionCode === "object" && "id" in promotionCode
        ? String((promotionCode as { id?: unknown }).id ?? "")
        : "";
    if (storedId && foundId && storedId !== foundId) {
      return { ok: false, message: FIRM_VOUCHER_INVALID_MESSAGE, reason: "missing" };
    }

    let hasPriorTransaction = false;
    const restrictions =
      promotionCode && typeof promotionCode === "object"
        ? (promotionCode as { restrictions?: { first_time_transaction?: boolean } }).restrictions
        : undefined;
    if (restrictions?.first_time_transaction && input.firmCustomerId) {
      const prior = await customerHasPriorPaidTransaction(stripe, input.firmCustomerId);
      hasPriorTransaction = prior === true;
    }

    const assessed = assessFirmVoucher({
      promotionCode,
      firmCustomerId: input.firmCustomerId,
      productId: input.productId,
      hasPriorTransaction,
      listCents: input.listCents,
      nowSeconds: input.nowSeconds,
      saMarket: input.saMarket,
    });
    return withVoucherInterval(assessed, input.interval, input.listCents);
  } catch (err) {
    console.warn("[stripe] voucher lookup failed", err instanceof Error ? err.message : err);
    return { ok: false, message: FIRM_VOUCHER_UNAVAILABLE_MESSAGE, reason: "unavailable" };
  }
}
