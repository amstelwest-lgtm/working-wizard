/**
 * Firm billing webhooks that can remove a stored plan.
 * customer.subscription.deleted sets the plan to none only when Stripe
 * shows no other active or trialing firm subscription.
 * invoice.payment_failed keeps the firm entitled for FIRM_PAYMENT_FAILED_GRACE_MS.
 * After that, the plan becomes none only when the customer still has no
 * active or trialing firm subscription.
 * A Stripe miss does not downgrade. Owner subscriptions are not written here.
 * An internal firm (firms.is_internal) is never written to none.
 * This module does not change what a none firm can still open.
 */

import {
  bandFromSubscriptionSnapshot,
  billedBandFromPrice,
  idOfStripeRef,
  pickEntitlingFirmSubscription,
  readSubscriptionPrice,
  type RankedSubscription,
} from "@/lib/firm-band-upgrade";
import {
  readFirmBillingPastDueAt,
  readFirmBillingPlanState,
  readFirmIsInternal,
  writeFirmBillingPastDueAt,
  writeFirmBillingPlanKnown,
  clearFirmBillingPastDueAt,
} from "@/lib/firm-billing-plan.server";
import { firmIdForOwnerUser, firmIdForStripeCustomer } from "@/lib/firm-stripe-customer.server";
import { isOwnerCatalogPrice } from "@/lib/owner-price";
import { SUBSCRIPTION_LIST_BUDGET_MS } from "@/lib/stripe-entitlement";
import type { StoredFirmPlan } from "@/lib/billing-check-failure";

/** One grace for a failed firm invoice. The firm stays entitled until it ends. */
export const FIRM_PAYMENT_FAILED_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

const FIRM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FirmBillingWebhookOutcome = {
  handled: boolean;
  /** Plan after the handler. Null when this event did not read or write one. */
  plan: StoredFirmPlan | null;
  pastDueAt: string | null;
  downgraded: boolean;
  /** The live subscription list did not finish. The stored plan was left as it was. */
  stripeUnreachable: boolean;
};

export type FirmSubscriptionLister = {
  subscriptions: {
    list: (
      params: {
        customer: string;
        status: string;
        limit: number;
        expand?: string[];
      },
      options?: { maxNetworkRetries?: number; timeout?: number },
    ) => Promise<{ data: unknown[] }>;
    retrieve?: (id: string, params?: { expand?: string[] }) => Promise<unknown>;
  };
};

type ColumnKind = "owner" | "firm" | "unknown";

const IGNORED: FirmBillingWebhookOutcome = {
  handled: false,
  plan: null,
  pastDueAt: null,
  downgraded: false,
  stripeUnreachable: false,
};

function kept(partial: Partial<FirmBillingWebhookOutcome> = {}): FirmBillingWebhookOutcome {
  return {
    handled: true,
    plan: null,
    pastDueAt: null,
    downgraded: false,
    stripeUnreachable: false,
    ...partial,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function stringMetadata(value: unknown): Record<string, string> {
  const raw = asRecord(value);
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function logFailure(scope: string, err: unknown): void {
  const name = err instanceof Error ? err.name : "Error";
  console.warn(`[stripe] ${scope}`, name);
}

function isTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /timeout|timed out|etimedout/i.test(message);
}

async function withinBudget<T>(work: Promise<T>): Promise<T> {
  void work.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), SUBSCRIPTION_LIST_BUDGET_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function classifySubscription(record: Record<string, unknown>): ColumnKind {
  const metadata = stringMetadata(record.metadata);
  const price = readSubscriptionPrice(record as Parameters<typeof readSubscriptionPrice>[0]);
  const lookupKey = price.lookupKey || metadata.milon_lookup_key || null;
  const productPlan = price.productPlan || metadata.milon_plan || null;
  if (isOwnerCatalogPrice({ lookupKey, productPlan })) return "owner";
  if ((metadata.milon_plan ?? "").trim().toLowerCase() === "owner") return "owner";
  const band = billedBandFromPrice({
    lookupKey,
    productBand: price.productBand,
    productPlan,
  });
  if (band) return "firm";
  if (FIRM_UUID.test((metadata.firm_id ?? "").trim())) return "firm";
  return "unknown";
}

function rankListed(data: unknown[]): RankedSubscription[] {
  const ranked: RankedSubscription[] = [];
  for (const row of data) {
    const record = asRecord(row);
    if (!record || typeof record.id !== "string") continue;
    const metadata = stringMetadata(record.metadata);
    const price = readSubscriptionPrice(record as Parameters<typeof readSubscriptionPrice>[0]);
    const owner = isOwnerCatalogPrice({
      lookupKey: price.lookupKey || metadata.milon_lookup_key,
      productPlan: price.productPlan || metadata.milon_plan,
    });
    ranked.push({
      id: record.id,
      status: typeof record.status === "string" ? record.status : "",
      created: typeof record.created === "number" ? record.created : 0,
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
    });
  }
  return ranked;
}

type Listed = { ok: true; subs: RankedSubscription[] } | { ok: false };

async function listFirmSubscriptions(
  stripe: FirmSubscriptionLister,
  customerId: string,
): Promise<Listed> {
  const options = { maxNetworkRetries: 0, timeout: SUBSCRIPTION_LIST_BUDGET_MS };
  const list = (expand: boolean) =>
    withinBudget(
      stripe.subscriptions.list(
        {
          customer: customerId,
          status: "all",
          limit: 20,
          ...(expand ? { expand: ["data.items.data.price"] } : {}),
        },
        options,
      ),
    );
  try {
    const listed = await list(true);
    return { ok: true, subs: rankListed(listed.data ?? []) };
  } catch (err) {
    if (isTimeoutError(err)) {
      logFailure("firm subscription list failed", err);
      return { ok: false };
    }
    try {
      const listed = await list(false);
      return { ok: true, subs: rankListed(listed.data ?? []) };
    } catch (retryErr) {
      logFailure("firm subscription list failed", retryErr);
      return { ok: false };
    }
  }
}

async function firmIdForRecord(record: Record<string, unknown>): Promise<string | null> {
  const metadata = stringMetadata(record.metadata);
  const direct = (metadata.firm_id ?? "").trim();
  if (FIRM_UUID.test(direct)) return direct;
  const userId = (metadata.milon_user_id ?? "").trim();
  if (FIRM_UUID.test(userId)) {
    const owned = await firmIdForOwnerUser(userId);
    if (owned) return owned;
  }
  return firmIdForStripeCustomer(idOfStripeRef(record.customer));
}

async function applyPlan(
  firmId: string,
  plan: StoredFirmPlan,
): Promise<"written" | "noop" | "blocked" | "internal"> {
  const state = await readFirmBillingPlanState(firmId);
  if (plan === "none" && !state.ok) return "blocked";
  if (plan === "none") {
    const internal = await readFirmIsInternal(firmId);
    if (internal === true) return "internal";
    if (internal === null) return "blocked";
  }
  if (state.ok && state.value === plan) return "noop";
  await writeFirmBillingPlanKnown(firmId, plan);
  return state.ok ? "written" : "blocked";
}

async function keptPlanAfterInternalSkip(firmId: string): Promise<StoredFirmPlan> {
  const state = await readFirmBillingPlanState(firmId);
  return state.ok && state.value ? state.value : "entitled";
}

function entitlingExcept(subs: RankedSubscription[], exceptId: string | null): boolean {
  const pool = exceptId ? subs.filter((sub) => sub.id !== exceptId) : subs;
  return pickEntitlingFirmSubscription(pool) != null;
}

function graceOpen(pastDueAt: string, nowMs: number): boolean {
  const started = Date.parse(pastDueAt);
  if (!Number.isFinite(started)) return true;
  return nowMs - started < FIRM_PAYMENT_FAILED_GRACE_MS;
}

type InvoiceRef = {
  subscriptionId: string | null;
  customerId: string | null;
  metadata: Record<string, string>;
  lookupKey: string | null;
  productPlan: string | null;
  productBand: string | null;
  unitAmount: number | null;
};

function refId(value: unknown): string | null {
  return idOfStripeRef(value);
}

function linePrice(line: Record<string, unknown>): {
  lookupKey: string | null;
  productPlan: string | null;
  productBand: string | null;
  unitAmount: number | null;
} {
  const price = asRecord(line.price);
  const pricing = asRecord(line.pricing);
  const details = asRecord(pricing?.price_details);
  const nested = asRecord(details?.price);
  const source = price ?? nested;
  const product = asRecord(source?.product);
  const productMeta = stringMetadata(product?.metadata);
  const lookupKey =
    (typeof source?.lookup_key === "string" ? source.lookup_key : null) ??
    (typeof details?.lookup_key === "string" ? details.lookup_key : null);
  const unit = source?.unit_amount;
  return {
    lookupKey,
    productPlan: productMeta.plan ?? null,
    productBand: productMeta.band ?? null,
    unitAmount: typeof unit === "number" ? unit : null,
  };
}

function parseInvoice(invoice: unknown): InvoiceRef {
  const record = asRecord(invoice);
  const empty: InvoiceRef = {
    subscriptionId: null,
    customerId: null,
    metadata: {},
    lookupKey: null,
    productPlan: null,
    productBand: null,
    unitAmount: null,
  };
  if (!record) return empty;
  const parent = asRecord(record.parent);
  const parentDetails = asRecord(parent?.subscription_details);
  const classicDetails = asRecord(record.subscription_details);
  const metadata = {
    ...stringMetadata(record.metadata),
    ...stringMetadata(classicDetails?.metadata),
    ...stringMetadata(parentDetails?.metadata),
  };
  let subscriptionId =
    refId(record.subscription) ??
    refId(parentDetails?.subscription) ??
    refId(classicDetails?.subscription);
  const lines = asRecord(record.lines);
  const data = Array.isArray(lines?.data) ? lines.data : [];
  let price = {
    lookupKey: metadata.milon_lookup_key ?? null,
    productPlan: metadata.milon_plan ?? null,
    productBand: null as string | null,
    unitAmount: null as number | null,
  };
  for (const line of data) {
    const row = asRecord(line);
    if (!row) continue;
    const lineParent = asRecord(row.parent);
    const itemDetails = asRecord(lineParent?.subscription_item_details);
    subscriptionId = subscriptionId ?? refId(row.subscription) ?? refId(itemDetails?.subscription);
    const parsed = linePrice(row);
    if (!price.lookupKey && parsed.lookupKey) price = { ...price, lookupKey: parsed.lookupKey };
    if (!price.productPlan && parsed.productPlan)
      price = { ...price, productPlan: parsed.productPlan };
    if (!price.productBand && parsed.productBand)
      price = { ...price, productBand: parsed.productBand };
    if (price.unitAmount == null && parsed.unitAmount != null) {
      price = { ...price, unitAmount: parsed.unitAmount };
    }
  }
  return {
    subscriptionId,
    customerId: refId(record.customer),
    metadata,
    lookupKey: price.lookupKey,
    productPlan: price.productPlan,
    productBand: price.productBand,
    unitAmount: price.unitAmount,
  };
}

function recordFromInvoice(invoice: InvoiceRef): Record<string, unknown> | null {
  if (!invoice.subscriptionId) return null;
  const price =
    invoice.lookupKey || invoice.productPlan || invoice.productBand || invoice.unitAmount != null
      ? {
          lookup_key: invoice.lookupKey,
          unit_amount: invoice.unitAmount,
          product:
            invoice.productPlan || invoice.productBand
              ? { metadata: { plan: invoice.productPlan, band: invoice.productBand } }
              : undefined,
        }
      : undefined;
  return {
    id: invoice.subscriptionId,
    customer: invoice.customerId,
    metadata: invoice.metadata,
    ...(price ? { items: { data: [{ price }] } } : {}),
  };
}

async function resolveInvoiceSubscription(
  invoice: unknown,
  stripe: FirmSubscriptionLister,
): Promise<{ ok: true; record: Record<string, unknown> } | { ok: false; unreachable: boolean }> {
  const parsed = parseInvoice(invoice);
  if (!parsed.subscriptionId) return { ok: false, unreachable: false };
  const draft = recordFromInvoice(parsed);
  if (draft && classifySubscription(draft) !== "unknown") return { ok: true, record: draft };
  if (!stripe.subscriptions.retrieve) return { ok: false, unreachable: true };
  try {
    const retrieved = await withinBudget(
      stripe.subscriptions.retrieve(parsed.subscriptionId, {
        expand: ["items.data.price"],
      }),
    );
    const record = asRecord(retrieved);
    if (!record) return { ok: false, unreachable: true };
    if (!record.customer && parsed.customerId) record.customer = parsed.customerId;
    const metadata = stringMetadata(record.metadata);
    if (!metadata.firm_id && parsed.metadata.firm_id) {
      record.metadata = { ...metadata, ...parsed.metadata };
    }
    return { ok: true, record };
  } catch (err) {
    logFailure("firm subscription retrieve failed", err);
    return { ok: false, unreachable: true };
  }
}

async function keepEntitledThroughGrace(
  firmId: string,
  pastDueAt: string,
  stripe: FirmSubscriptionLister,
  customerId: string | null,
): Promise<FirmBillingWebhookOutcome> {
  const state = await readFirmBillingPlanState(firmId);
  if (!state.ok) return kept({ pastDueAt, stripeUnreachable: false });
  if (state.value !== "none") {
    await applyPlan(firmId, "entitled");
    return kept({ plan: "entitled", pastDueAt });
  }
  if (!customerId) return kept({ plan: "none", pastDueAt, stripeUnreachable: true });
  const listed = await listFirmSubscriptions(stripe, customerId);
  if (!listed.ok) return kept({ plan: "none", pastDueAt, stripeUnreachable: true });
  if (entitlingExcept(listed.subs, null)) {
    await applyPlan(firmId, "entitled");
    return kept({ plan: "entitled", pastDueAt });
  }
  return kept({ plan: "none", pastDueAt });
}

/**
 * A deleted firm subscription drops the stored plan only when no other
 * active or trialing firm subscription remains on the customer.
 */
export async function syncFirmSubscriptionDeleted(
  subscription: unknown,
  stripe: FirmSubscriptionLister,
): Promise<FirmBillingWebhookOutcome> {
  try {
    const record = asRecord(subscription);
    if (!record || typeof record.id !== "string") return IGNORED;
    const kind = classifySubscription(record);
    if (kind === "owner") return IGNORED;
    const firmId = await firmIdForRecord(record);
    if (!firmId || kind === "unknown") return IGNORED;
    const customerId = idOfStripeRef(record.customer);
    if (!customerId) return kept({ stripeUnreachable: true });
    const listed = await listFirmSubscriptions(stripe, customerId);
    if (!listed.ok) return kept({ stripeUnreachable: true });
    if (entitlingExcept(listed.subs, record.id)) {
      await applyPlan(firmId, "entitled");
      return kept({ plan: "entitled" });
    }
    const wrote = await applyPlan(firmId, "none");
    if (wrote === "internal") {
      return kept({ plan: await keptPlanAfterInternalSkip(firmId), downgraded: false });
    }
    if (wrote === "blocked") return kept();
    if (wrote === "written") {
      console.info("[stripe] firm plan cleared after subscription deleted", { firmId });
    }
    return kept({ plan: "none", downgraded: wrote === "written" });
  } catch (err) {
    logFailure("firm subscription deleted sync failed", err);
    return kept({ stripeUnreachable: true });
  }
}

/**
 * Marks the firm past due and leaves it entitled through the grace.
 * A later failure, once the grace has ended, sets none only when Stripe
 * still shows no active or trialing firm subscription.
 */
export async function syncFirmInvoicePaymentFailed(
  invoice: unknown,
  stripe: FirmSubscriptionLister,
  options?: { nowMs?: number },
): Promise<FirmBillingWebhookOutcome> {
  try {
    const resolved = await resolveInvoiceSubscription(invoice, stripe);
    if (!resolved.ok) {
      return resolved.unreachable ? kept({ stripeUnreachable: true }) : IGNORED;
    }
    if (classifySubscription(resolved.record) !== "firm") return IGNORED;
    const firmId = await firmIdForRecord(resolved.record);
    if (!firmId) return IGNORED;
    const nowMs = options?.nowMs ?? Date.now();
    const past = await readFirmBillingPastDueAt(firmId);
    if (!past.ok) return kept();
    let pastDueAt = past.value;
    if (!pastDueAt) {
      pastDueAt = new Date(nowMs).toISOString();
      const wrote = await writeFirmBillingPastDueAt(firmId, pastDueAt);
      if (!wrote) return kept();
    }
    const customerId = idOfStripeRef(resolved.record.customer);
    if (graceOpen(pastDueAt, nowMs)) {
      return keepEntitledThroughGrace(firmId, pastDueAt, stripe, customerId);
    }
    if (!customerId) return kept({ pastDueAt, stripeUnreachable: true });
    const listed = await listFirmSubscriptions(stripe, customerId);
    if (!listed.ok) return kept({ pastDueAt, stripeUnreachable: true });
    if (entitlingExcept(listed.subs, null)) {
      await applyPlan(firmId, "entitled");
      return kept({ plan: "entitled", pastDueAt });
    }
    const wrote = await applyPlan(firmId, "none");
    if (wrote === "internal") {
      return kept({
        plan: await keptPlanAfterInternalSkip(firmId),
        pastDueAt,
        downgraded: false,
      });
    }
    if (wrote === "blocked") return kept({ pastDueAt });
    return kept({ plan: "none", pastDueAt, downgraded: wrote === "written" });
  } catch (err) {
    logFailure("firm payment failed sync failed", err);
    return kept({ stripeUnreachable: true });
  }
}

/**
 * A paid firm invoice clears the past-due marker.
 * An active or trialing subscription stores entitled. A miss does not set none.
 */
export async function syncFirmInvoicePaid(
  invoice: unknown,
  stripe: FirmSubscriptionLister,
): Promise<FirmBillingWebhookOutcome> {
  try {
    const resolved = await resolveInvoiceSubscription(invoice, stripe);
    if (!resolved.ok) {
      return resolved.unreachable ? kept({ stripeUnreachable: true }) : IGNORED;
    }
    if (classifySubscription(resolved.record) !== "firm") return IGNORED;
    const firmId = await firmIdForRecord(resolved.record);
    if (!firmId) return IGNORED;
    await clearFirmBillingPastDueAt(firmId);
    const customerId = idOfStripeRef(resolved.record.customer);
    if (!customerId) return kept({ plan: null, pastDueAt: null, stripeUnreachable: true });
    const listed = await listFirmSubscriptions(stripe, customerId);
    if (!listed.ok) return kept({ stripeUnreachable: true });
    if (entitlingExcept(listed.subs, null)) {
      await applyPlan(firmId, "entitled");
      return kept({ plan: "entitled", pastDueAt: null });
    }
    const state = await readFirmBillingPlanState(firmId);
    return kept({ plan: state.ok ? state.value : null, pastDueAt: null });
  } catch (err) {
    logFailure("firm invoice paid sync failed", err);
    return kept({ stripeUnreachable: true });
  }
}
