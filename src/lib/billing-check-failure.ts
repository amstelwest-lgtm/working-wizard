/**
 * A failed firm-entitlement read. The live call is getFirmBillingEntitlement,
 * production server function 6bfe9fa7
 * (sha256 of src/lib/stripe-checkout.functions.ts--getFirmBillingEntitlement_createServerFn_handler).
 */

import type { FirmBillingEntitlement } from "@/lib/stripe-entitlement";

export type BillingCheckFailureKind = "timeout" | "network" | "http_5xx";

export const FIRM_BILLING_ENTITLEMENT_SERVER_FN = "6bfe9fa7";

/** First quiet retry waits 2s, then doubles, and stops growing at 30s. */
export const BILLING_CHECK_RETRY_BASE_MS = 2_000;
export const BILLING_CHECK_RETRY_MAX_MS = 30_000;
/** The small notice appears on the second failure, not the first. */
export const BILLING_CHECK_NOTICE_AFTER_FAILURES = 2;

export function billingCheckRetryDelayMs(failureCount: number): number {
  const n = Math.max(1, Math.floor(failureCount));
  const delay = BILLING_CHECK_RETRY_BASE_MS * 2 ** (n - 1);
  return Math.min(BILLING_CHECK_RETRY_MAX_MS, delay);
}

export function billingCheckNoticeVisible(failureCount: number): boolean {
  return failureCount >= BILLING_CHECK_NOTICE_AFTER_FAILURES;
}

function readStatus(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const record = err as Record<string, unknown>;
  for (const key of ["statusCode", "status"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  const response = record.response;
  if (response && typeof response === "object" && "status" in response) {
    const status = (response as { status?: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  return null;
}

/**
 * Timeout, a transport failure, or an HTTP 5xx from the entitlement server
 * function. Anything else (a dropped connection, a failed fetch) is network.
 */
export function classifyBillingCheckFailure(err: unknown): BillingCheckFailureKind {
  const status = readStatus(err);
  if (status != null && status >= 500 && status < 600) return "http_5xx";
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const blob = `${name} ${message}`.toLowerCase();
  if (/timeout|timed out|etimedout|aborterror|\baborted\b/.test(blob)) return "timeout";
  return "network";
}

export function logBillingCheckFailure(
  kind: BillingCheckFailureKind,
  extra: Record<string, unknown>,
): void {
  console.warn("[billing-gate] check failed", {
    kind,
    serverFn: FIRM_BILLING_ENTITLEMENT_SERVER_FN,
    ...extra,
  });
}

/**
 * A live Stripe failure keeps the last successful decision when this isolate
 * still has one. No last success stays unknown (`stripe_error`), which is not
 * an unpaid firm.
 */
export function entitlementAfterLiveFailure(
  prior: FirmBillingEntitlement | null | undefined,
  kind: BillingCheckFailureKind,
): FirmBillingEntitlement {
  if (prior && prior.reason !== "stripe_error") {
    return { ...prior, checkFailed: kind };
  }
  return { entitled: false, reason: "stripe_error", checkFailed: kind };
}
