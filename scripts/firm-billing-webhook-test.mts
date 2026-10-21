/**
 * Firm subscription.deleted and invoice.payment_failed.
 * Run: pnpm test:firm-billing-webhook
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  setFirmBillingWebhookStoreForTests,
  type FirmBillingWebhookStore,
} from "../src/lib/firm-billing-plan.server";
import {
  FIRM_PAYMENT_FAILED_GRACE_MS,
  syncFirmInvoicePaid,
  syncFirmInvoicePaymentFailed,
  syncFirmSubscriptionDeleted,
  type FirmSubscriptionLister,
} from "../src/lib/firm-billing-webhook.server";
import { syncFirmSubscriptionBand } from "../src/lib/stripe-billing-sync.server";
import type { StoredFirmPlan } from "../src/lib/billing-check-failure";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const FIRM = "11111111-1111-4111-8111-111111111111";
const CUSTOMER = "cus_firmwebhook";
const T0 = Date.UTC(2026, 9, 1);

type Memory = {
  plan: StoredFirmPlan | null;
  pastDueAt: string | null;
  writes: string[];
};

function memory(
  plan: StoredFirmPlan | null,
  pastDueAt: string | null = null,
): Memory & FirmBillingWebhookStore {
  const state: Memory = { plan, pastDueAt, writes: [] };
  return {
    get plan() {
      return state.plan;
    },
    set plan(value) {
      state.plan = value;
    },
    get pastDueAt() {
      return state.pastDueAt;
    },
    set pastDueAt(value) {
      state.pastDueAt = value;
    },
    get writes() {
      return state.writes;
    },
    readPlan: async () => ({ ok: true, value: state.plan }),
    writePlan: async (_firmId, next) => {
      state.writes.push(`plan:${next}`);
      state.plan = next;
    },
    readPastDueAt: async () => ({ ok: true, value: state.pastDueAt }),
    writePastDueAt: async (_firmId, at) => {
      state.writes.push(`past:${at ?? "cleared"}`);
      state.pastDueAt = at;
      return true;
    },
  };
}

function useStore(store: FirmBillingWebhookStore): void {
  setFirmBillingWebhookStoreForTests(store);
}

type ListedSub = {
  id: string;
  status: string;
  created?: number;
  customer?: string;
  metadata?: Record<string, string>;
  items?: { data?: Array<{ id?: string; price?: unknown }> };
};

function firmPrice(lookup: string, unitAmount: number) {
  const band = lookup.includes("starter") ? "starter" : "solo";
  return {
    id: `price_${lookup}`,
    lookup_key: lookup,
    unit_amount: unitAmount,
    currency: "usd",
    recurring: { interval: "month" },
    product: { metadata: { band, plan: band } },
  };
}

function firmSub(
  id: string,
  status: string,
  options?: { lookup?: string; unitAmount?: number; created?: number },
): ListedSub {
  const lookup = options?.lookup ?? "milon_solo_monthly";
  const band = lookup.includes("starter") ? "starter" : "solo";
  return {
    id,
    status,
    created: options?.created ?? 1_700_000_000,
    customer: CUSTOMER,
    metadata: {
      firm_id: FIRM,
      milon_plan: band,
      milon_interval: "month",
      milon_lookup_key: lookup,
    },
    items: {
      data: [
        {
          id: `si_${id}`,
          price: firmPrice(lookup, options?.unitAmount ?? 9900),
        },
      ],
    },
  };
}

function firmInvoice(subscriptionId: string) {
  const sub = firmSub(subscriptionId, "past_due");
  return {
    id: "in_firm",
    customer: CUSTOMER,
    subscription: subscriptionId,
    metadata: sub.metadata,
    lines: { data: [{ price: sub.items?.data?.[0]?.price }] },
  };
}

function lister(data: ListedSub[] | Error): FirmSubscriptionLister & { calls: number } {
  let calls = 0;
  const stripe = {
    get calls() {
      return calls;
    },
    subscriptions: {
      list: async (params: { customer: string; status: string; limit: number }) => {
        calls += 1;
        assert(params.customer === CUSTOMER, "list uses the firm customer");
        assert(params.status === "all", "list reads every subscription before pick");
        assert(params.limit === 20, "list uses the same page size as the entitling pick");
        if (data instanceof Error) throw data;
        return { data };
      },
    },
  };
  return stripe;
}

function snapshot(store: Memory) {
  return { plan: store.plan, pastDueAt: store.pastDueAt, writes: store.writes.length };
}

const logs: string[] = [];
const prevWarn = console.warn;
const prevInfo = console.info;
console.warn = (...args: unknown[]) => {
  logs.push(args.map((part) => String(part)).join(" "));
};
console.info = (...args: unknown[]) => {
  logs.push(args.map((part) => String(part)).join(" "));
};

try {
  assert(
    FIRM_PAYMENT_FAILED_GRACE_MS === 3 * 24 * 60 * 60 * 1000,
    "payment failure grace is 3 days",
  );

  const deletedOnly = memory("entitled");
  useStore(deletedOnly);
  const deletedNone = await syncFirmSubscriptionDeleted(
    firmSub("sub_old", "canceled"),
    lister([firmSub("sub_old", "canceled")]),
  );
  assert(
    deletedNone.plan === "none" && deletedNone.downgraded,
    "deleted with no other sub sets none",
  );
  assert(deletedOnly.plan === "none", "the stored plan is none after the only sub is deleted");

  const kept = memory("entitled");
  useStore(kept);
  const keptResult = await syncFirmSubscriptionDeleted(
    firmSub("sub_old", "canceled"),
    lister([
      firmSub("sub_old", "canceled", { created: 10 }),
      firmSub("sub_new", "active", { created: 20 }),
    ]),
  );
  assert(
    keptResult.plan === "entitled" && kept.plan === "entitled" && !keptResult.downgraded,
    "deleted while another active sub exists stays entitled",
  );

  const trialing = memory("entitled");
  useStore(trialing);
  const trialingResult = await syncFirmSubscriptionDeleted(
    firmSub("sub_old", "canceled"),
    lister([firmSub("sub_old", "canceled"), firmSub("sub_trial", "trialing", { created: 30 })]),
  );
  assert(
    trialingResult.plan === "entitled" && trialing.plan === "entitled",
    "a remaining trialing firm subscription stays entitled",
  );

  const ownerSibling = memory("entitled");
  useStore(ownerSibling);
  await syncFirmSubscriptionDeleted(
    firmSub("sub_old", "canceled"),
    lister([
      firmSub("sub_old", "canceled"),
      {
        id: "sub_owner",
        status: "active",
        created: 40,
        customer: CUSTOMER,
        metadata: { milon_plan: "owner", milon_lookup_key: "milon_owner_monthly" },
        items: {
          data: [
            {
              price: {
                lookup_key: "milon_owner_monthly",
                product: { metadata: { plan: "owner" } },
              },
            },
          ],
        },
      },
    ]),
  );
  assert(ownerSibling.plan === "none", "an owner subscription does not keep the firm entitled");

  const ownerEvent = memory("entitled");
  useStore(ownerEvent);
  const ownerBefore = snapshot(ownerEvent);
  const ownerLister = lister([firmSub("sub_firm", "active")]);
  const ownerIgnored = await syncFirmSubscriptionDeleted(
    {
      id: "sub_owner",
      status: "canceled",
      customer: "cus_owner",
      metadata: { milon_plan: "owner", milon_lookup_key: "milon_owner_monthly" },
      items: {
        data: [
          {
            price: {
              lookup_key: "milon_owner_monthly",
              product: { metadata: { plan: "owner" } },
            },
          },
        ],
      },
    },
    ownerLister,
  );
  assert(
    !ownerIgnored.handled && ownerLister.calls === 0,
    "an owner deletion is not a firm plan write",
  );
  assert(
    snapshot(ownerEvent).plan === ownerBefore.plan &&
      snapshot(ownerEvent).writes === ownerBefore.writes,
    "an owner deletion leaves the firm plan untouched",
  );

  const grace = memory("entitled");
  useStore(grace);
  const graceStripe = lister([firmSub("sub_firm", "past_due")]);
  const firstFail = await syncFirmInvoicePaymentFailed(firmInvoice("sub_firm"), graceStripe, {
    nowMs: T0,
  });
  assert(
    firstFail.plan === "entitled" && grace.plan === "entitled",
    "payment_failed inside grace stays entitled",
  );
  assert(
    grace.pastDueAt === new Date(T0).toISOString(),
    "the first failure records the past-due timestamp",
  );
  assert(graceStripe.calls === 0, "grace does not ask Stripe before keeping the firm entitled");
  const afterFirst = snapshot(grace);
  const duplicate = await syncFirmInvoicePaymentFailed(firmInvoice("sub_firm"), graceStripe, {
    nowMs: T0,
  });
  assert(
    duplicate.plan === "entitled" &&
      grace.plan === "entitled" &&
      grace.pastDueAt === afterFirst.pastDueAt &&
      snapshot(grace).writes === afterFirst.writes,
    "a duplicate event is a no-op",
  );
  const stillInside = await syncFirmInvoicePaymentFailed(firmInvoice("sub_firm"), graceStripe, {
    nowMs: T0 + FIRM_PAYMENT_FAILED_GRACE_MS - 1,
  });
  assert(
    stillInside.plan === "entitled" &&
      grace.plan === "entitled" &&
      grace.pastDueAt === new Date(T0).toISOString() &&
      graceStripe.calls === 0,
    "a later failure inside the grace stays entitled and does not move the timestamp",
  );
  const afterGrace = await syncFirmInvoicePaymentFailed(firmInvoice("sub_firm"), graceStripe, {
    nowMs: T0 + FIRM_PAYMENT_FAILED_GRACE_MS,
  });
  assert(
    afterGrace.plan === "none" && afterGrace.downgraded && grace.plan === "none",
    "after grace with the sub still past_due goes to none",
  );
  assert(graceStripe.calls === 1, "after grace re-checks Stripe once");

  const recovered = memory("entitled", new Date(T0).toISOString());
  useStore(recovered);
  const recoveredBefore = snapshot(recovered);
  const recoveredStripe = lister([firmSub("sub_firm", "active")]);
  const recoveredResult = await syncFirmInvoicePaymentFailed(
    firmInvoice("sub_firm"),
    recoveredStripe,
    {
      nowMs: T0 + FIRM_PAYMENT_FAILED_GRACE_MS,
    },
  );
  assert(
    recoveredResult.plan === "entitled" &&
      recovered.plan === "entitled" &&
      !recoveredResult.downgraded,
    "after grace with the sub recovered to active stays entitled",
  );
  assert(
    recovered.pastDueAt === recoveredBefore.pastDueAt &&
      snapshot(recovered).writes === recoveredBefore.writes,
    "payment_failed does not clear the past-due marker when the subscription is active",
  );

  const duplicateDeleted = memory("entitled");
  useStore(duplicateDeleted);
  const deletedStripe = lister([firmSub("sub_old", "canceled")]);
  await syncFirmSubscriptionDeleted(firmSub("sub_old", "canceled"), deletedStripe);
  const deletedOnce = snapshot(duplicateDeleted);
  await syncFirmSubscriptionDeleted(firmSub("sub_old", "canceled"), deletedStripe);
  assert(
    duplicateDeleted.plan === "none" && snapshot(duplicateDeleted).writes === deletedOnce.writes,
    "a duplicate deletion is a no-op",
  );

  const downError = new Error("connect ECONNREFUSED for ada@example.com");
  downError.name = "StripeConnectionError";
  const unreachableDeleted = memory("entitled", new Date(T0).toISOString());
  useStore(unreachableDeleted);
  const unreachableDeletedBefore = snapshot(unreachableDeleted);
  const deletedDown = await syncFirmSubscriptionDeleted(
    firmSub("sub_old", "canceled"),
    lister(downError),
  );
  assert(
    deletedDown.stripeUnreachable &&
      !deletedDown.downgraded &&
      unreachableDeleted.plan === "entitled" &&
      snapshot(unreachableDeleted).writes === unreachableDeletedBefore.writes,
    "Stripe unreachable on deletion never downgrades",
  );

  const unreachableFailed = memory("entitled", new Date(T0).toISOString());
  useStore(unreachableFailed);
  const unreachableFailedBefore = snapshot(unreachableFailed);
  const failedDown = await syncFirmInvoicePaymentFailed(
    firmInvoice("sub_firm"),
    lister(downError),
    {
      nowMs: T0 + FIRM_PAYMENT_FAILED_GRACE_MS + 1,
    },
  );
  assert(
    failedDown.stripeUnreachable &&
      !failedDown.downgraded &&
      unreachableFailed.plan === "entitled" &&
      unreachableFailed.pastDueAt === unreachableFailedBefore.pastDueAt &&
      snapshot(unreachableFailed).writes === unreachableFailedBefore.writes,
    "Stripe unreachable after grace never downgrades",
  );
  assert(
    !logs.join("\n").includes("ada@example.com") && !logs.join("\n").includes("@"),
    "webhook logs do not include an email address",
  );

  const paid = memory("entitled", new Date(T0).toISOString());
  useStore(paid);
  const paidResult = await syncFirmInvoicePaid(
    { ...firmInvoice("sub_firm"), status: "paid" },
    lister([firmSub("sub_firm", "active")]),
  );
  assert(
    paidResult.plan === "entitled" && paid.plan === "entitled",
    "a paid firm invoice stays entitled",
  );
  assert(paid.pastDueAt === null, "invoice.paid clears the past-due marker");

  const starter = memory("entitled", new Date(T0).toISOString());
  useStore(starter);
  let starterUpdates = 0;
  const starterSub = firmSub("sub_starter", "active", {
    lookup: "milon_starter_monthly",
    unitAmount: 0,
  });
  assert(
    starterSub.items?.data?.[0]?.price &&
      (starterSub.items.data[0].price as { unit_amount: number }).unit_amount === 0,
    "the legacy Starter price is $0",
  );
  const starterSync = await syncFirmSubscriptionBand("sub_starter", {
    subscriptions: {
      retrieve: async () => starterSub,
      update: async () => {
        starterUpdates += 1;
        throw new Error("a legacy Starter renewal must not retarget the price");
      },
      cancel: async () => {
        throw new Error("a legacy Starter renewal must not cancel");
      },
    },
    prices: { list: async () => ({ data: [] }) },
  });
  assert(starterUpdates === 0, "a legacy Starter renewal does not rewrite the subscription");
  assert(
    starterSync.band === "starter" && starter.plan === "entitled",
    "a renewal sends subscription.updated active and the $0 Starter stays entitled",
  );
  assert(starter.pastDueAt === null, "subscription.updated to active clears the past-due marker");

  const webhookSrc = readFileSync(resolve("src/routes/api/stripe/webhook.ts"), "utf8");
  const ownerAt = webhookSrc.indexOf("ownerBillingEventSignal(event)");
  const firmDeletedAt = webhookSrc.indexOf("await syncFirmSubscriptionDeleted");
  assert(
    ownerAt !== -1 && firmDeletedAt > ownerAt,
    "owner events are handled before firm deletion",
  );
  const syncSrc = readFileSync(resolve("src/lib/stripe-billing-sync.server.ts"), "utf8");
  assert(
    syncSrc.includes('"customer.subscription.deleted"'),
    "firm webhooks accept subscription.deleted",
  );
  assert(
    syncSrc.includes('"invoice.payment_failed"'),
    "firm webhooks accept invoice.payment_failed",
  );
  const rememberStart = syncSrc.indexOf("async function rememberFirmStripeCustomer");
  const rememberEnd = syncSrc.indexOf("export async function syncFirmSubscriptionBand");
  const rememberFn = syncSrc.slice(rememberStart, rememberEnd);
  assert(
    rememberFn.includes("clearFirmBillingPastDueAt"),
    "an active subscription clears the past-due marker",
  );
  assert(
    !rememberFn.includes('"none"'),
    "a live subscription sync does not store a confirmed no-plan",
  );
  const handlerSrc = readFileSync(resolve("src/lib/firm-billing-webhook.server.ts"), "utf8");
  assert(!handlerSrc.includes("firm-gate-access"), "the webhook does not import the client gate");
  assert(
    !handlerSrc.includes("firm-entitlement-client"),
    "the webhook does not import the client entitlement",
  );
  assert(!handlerSrc.includes("_authenticated.gate"), "the webhook does not import the route gate");
  assert(
    !handlerSrc.includes("owner_subscriptions"),
    "the webhook does not write owner subscriptions",
  );
  assert(
    !/sk_(?:live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|rk_(?:live|test)_[A-Za-z0-9]/.test(handlerSrc),
    "the webhook source has no Stripe secret",
  );
  const migration = readFileSync(
    resolve("supabase/migrations/20261021203000_firm_billing_past_due_at.sql"),
    "utf8",
  );
  assert(
    migration.includes("ADD COLUMN IF NOT EXISTS billing_past_due_at timestamptz"),
    "migration adds a nullable past-due timestamp",
  );
  assert(
    !/UPDATE\s+public\.firms/i.test(migration),
    "the past-due migration does not backfill firm rows",
  );
  assert(
    migration.includes("NEW.billing_past_due_at := OLD.billing_past_due_at"),
    "signed-in users cannot set the past-due timestamp",
  );
  assert(
    !/sk_(?:live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|rk_(?:live|test)_[A-Za-z0-9]/.test(
      readFileSync(resolve("scripts/firm-billing-webhook-test.mts"), "utf8"),
    ),
    "the webhook test has no Stripe secret",
  );

  console.log("firm-billing-webhook ok");
} finally {
  console.warn = prevWarn;
  console.info = prevInfo;
  setFirmBillingWebhookStoreForTests(null);
}
