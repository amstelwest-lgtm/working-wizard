/**
 * The firm billing handler answers inside 6s when Stripe hangs.
 * Run: pnpm test:firm-billing-deadline
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { FirmBillingGateView } from "../src/components/firm-billing-gate-view.tsx";
import { classifyBillingCheckFailure } from "../src/lib/billing-check-failure.ts";
import {
  FIRM_BILLING_CLIENT_ABORT_MS,
  firmBillingClientAbortSignal,
  logFirmBillingDeadline,
  settleFirmBillingCheck,
} from "../src/lib/firm-billing-deadline.ts";
import { SUBSCRIPTION_LIST_BUDGET_MS } from "../src/lib/stripe-entitlement.ts";
import { firmFileOnBillingResult } from "../src/lib/firm-gate-access.ts";
import { setFirmBillingPlanReadForTests } from "../src/lib/firm-billing-plan.server.ts";
import {
  clearFirmSubscriptionHistoryCache,
  setFirmSubscriptionReaderForTests,
} from "../src/lib/firm-client-cap.server.ts";
import { resolveFirmBillingEntitlement } from "../src/lib/stripe-checkout.functions.ts";
import type { StripeCustomerSubscriptionReader } from "../src/lib/stripe-entitlement.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

if (!process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_RESTRICTED_KEY) {
  process.env.STRIPE_SECRET_KEY = "sk_test_firm_billing_deadline";
}

const timings: Record<string, number> = {};
const codes: string[] = [];
const warn = console.warn.bind(console);
const info = console.info.bind(console);
console.warn = (...args: unknown[]) => {
  const line = args[1];
  if (args[0] === "[billing-deadline]" && line && typeof line === "object" && "code" in line) {
    codes.push(String((line as { code: string }).code));
  }
  warn(...args);
};
console.info = (...args: unknown[]) => {
  const line = args[1];
  if (args[0] === "[billing-deadline]" && line && typeof line === "object" && "code" in line) {
    codes.push(String((line as { code: string }).code));
  }
  info(...args);
};

function hang(ms: number, settled: { done: boolean }): Promise<never> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      settled.done = true;
      resolve(undefined as never);
    }, ms);
    timer.unref?.();
  });
}

function actor(email: string, supabase?: unknown) {
  return { userId: "user-deadline", claims: { email }, supabase: supabase ?? null };
}

async function renderSurface(surface: "content" | "error", children: string): Promise<string> {
  const rootRoute = createRootRoute({
    component: () =>
      createElement(FirmBillingGateView, {
        surface,
        children,
      }),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

function resetStubs() {
  setFirmBillingPlanReadForTests(null);
  setFirmSubscriptionReaderForTests(null);
  clearFirmSubscriptionHistoryCache();
}

type ListOptions = { timeout?: number; maxNetworkRetries?: number };

assert(SUBSCRIPTION_LIST_BUDGET_MS === 3_000, "the bind-fix list budget is 3 seconds");
assert(FIRM_BILLING_CLIENT_ABORT_MS === 9_000, "the client abort is 9 seconds");

const clientSignal = firmBillingClientAbortSignal(30);
await new Promise((resolve) => clientSignal.addEventListener("abort", () => resolve(undefined)));
const aborted = new DOMException("The operation was aborted", "AbortError");
assert(classifyBillingCheckFailure(aborted) === "timeout", "a client abort is a timeout");
assert(
  firmFileOnBillingResult({ entitled: false, reason: "stripe_error", checkFailed: "timeout" }) === "retry",
  "an aborted check is a retryable unknown",
);

const gate = readFileSync(new URL("../src/routes/_authenticated.gate.tsx", import.meta.url), "utf8");
assert(gate.includes("firmBillingClientAbortSignal()"), "the gate aborts the entitlement call");
const checkout = readFileSync(new URL("../src/lib/stripe-checkout.functions.ts", import.meta.url), "utf8");
assert(checkout.includes("settleFirmBillingCheck"), "the handler uses the hard deadline");
assert(checkout.includes("entitlementWhenBillingCheckFails"), "a live failure still uses the stored plan");
assert(checkout.includes("waitUntil(bounded)"), "the trial mirror still uses waitUntil");
assert(checkout.includes("finishMetadataFirmCustomerWrites"), "the customer-id write stays inside the deadline");

let listStartedAt = 0;
let planReturnedAt = 0;
let listOptions: ListOptions | undefined;
const listSettled = { done: false };
setFirmBillingPlanReadForTests(
  () =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        planReturnedAt = Date.now();
        resolve("entitled");
      }, 800);
      timer.unref?.();
    }),
);
setFirmSubscriptionReaderForTests({
  customers: {
    list: async () => ({ data: [{ id: "cus_deadline" }] }),
  },
  subscriptions: {
    search: async () => hang(30_000, { done: false }),
    list: async (_params: unknown, options?: ListOptions) => {
      listStartedAt = Date.now();
      listOptions = options;
      await hang(30_000, listSettled);
      return { data: [] };
    },
  },
} as unknown as StripeCustomerSubscriptionReader);
codes.length = 0;
let started = Date.now();
let result = await resolveFirmBillingEntitlement(actor("list-hang@example.com"), true, null);
timings.listHangMs = Date.now() - started;
assert(timings.listHangMs < 7_000, `entitled list hang resolved in ${timings.listHangMs}ms`);
assert(result.entitled === true && result.reason === "active_subscription", "a hung list with a stored plan stays entitled");
assert(result.checkFailed === "timeout", "the hung list is a failed check, not a fresh unpaid read");
assert(listStartedAt > 0 && planReturnedAt > 0 && listStartedAt <= planReturnedAt, "Stripe starts while the plan read is still running");
assert(listOptions?.maxNetworkRetries === 0, "subscriptions.list does not retry");
assert(listOptions?.timeout === SUBSCRIPTION_LIST_BUDGET_MS, "subscriptions.list keeps the bind-fix budget");
assert(listSettled.done === false, "the handler does not wait out the 30s list");
assert(codes.includes("entitled-fallback"), "the stored-plan fallback logs entitled-fallback");
const openFile = firmFileOnBillingResult({
  entitled: result.entitled,
  reason: result.reason,
  checkFailed: result.checkFailed,
});
assert(openFile === "open", "an entitled fallback opens the file");
const openHtml = await renderSurface("content", "Client file");
assert(openHtml.includes("Client file"), "the gate renders the file");
assert(openHtml.includes('data-billing-gate="content"'), "the entitled file stays on the content surface");
assert(!openHtml.includes("check billing"), "an entitled fallback does not show the card");
resetStubs();

const searchSettled = { done: false };
setFirmBillingPlanReadForTests(async () => "entitled");
const searchUser = "d55084b0-43fe-417b-970b-37f22cee84f3";
setFirmSubscriptionReaderForTests({
  customers: {
    list: async () => ({ data: [] as Array<{ id: string }> }),
    search: () => hang(30_000, searchSettled),
  },
  subscriptions: {
    search: () => hang(30_000, searchSettled),
    list: () => hang(30_000, { done: false }).then(() => ({ data: [] })),
  },
} as unknown as StripeCustomerSubscriptionReader);
codes.length = 0;
started = Date.now();
result = await resolveFirmBillingEntitlement(
  { userId: searchUser, claims: { email: "search-hang@example.com" }, supabase: null },
  true,
  null,
);
timings.searchHangMs = Date.now() - started;
assert(timings.searchHangMs < 7_000, `search hang resolved in ${timings.searchHangMs}ms`);
assert(result.entitled === true && result.checkFailed, "a hung search with a stored plan stays entitled");
assert(searchSettled.done === false, "the handler does not wait out the 30s search");
assert(codes.includes("stripe-timeout") || codes.includes("entitled-fallback"), "a search timeout is logged");
resetStubs();

setFirmBillingPlanReadForTests(async () => {
  throw new Error("billing_plan_known read failed");
});
setFirmSubscriptionReaderForTests({
  customers: {
    list: async () => ({ data: [{ id: "cus_deadline" }] }),
  },
  subscriptions: {
    list: () => hang(30_000, { done: false }).then(() => ({ data: [] })),
  },
} as unknown as StripeCustomerSubscriptionReader);
codes.length = 0;
started = Date.now();
result = await resolveFirmBillingEntitlement(actor("plan-error@example.com"), true, null);
timings.planErrorMs = Date.now() - started;
assert(timings.planErrorMs < 7_000, `plan-read error resolved in ${timings.planErrorMs}ms`);
assert(result.entitled === false && result.reason === "stripe_error", "a plan-read error is unknown");
assert(result.checkFailed, "unknown carries checkFailed so the file is not closed");
assert(
  firmFileOnBillingResult({
    entitled: result.entitled,
    reason: result.reason,
    checkFailed: result.checkFailed,
  }) === "retry",
  "unknown shows the retry card",
);
assert(codes.includes("plan-read-error"), "a plan-read error logs plan-read-error");
assert(codes.includes("deadline-hit"), "the hard deadline logs deadline-hit");
const retryHtml = await renderSurface("error", "Client file");
assert(retryHtml.includes("check billing"), "unknown renders the retry card");
assert(retryHtml.includes("Retry"), "the card can be retried");
assert(!retryHtml.includes("Client file"), "unknown does not render the file");
resetStubs();

const pendingDb = new Promise(() => {});
const hangingSupabase = {
  from: () => ({
    select: () => hangingSupabase.from(),
    eq: () => hangingSupabase.from(),
    limit: () => pendingDb,
    maybeSingle: () => pendingDb,
  }),
};
setFirmBillingPlanReadForTests(async () => "entitled");
started = Date.now();
result = await resolveFirmBillingEntitlement(
  actor("firm-ids@example.com", hangingSupabase),
  true,
  "e8f7a440-a541-422c-8e4f-82ba33dd0604",
);
timings.firmIdsMs = Date.now() - started;
assert(timings.firmIdsMs < 7_000, `hung firm-id read resolved in ${timings.firmIdsMs}ms`);
assert(result.reason === "stripe_error" && result.entitled === false, "a hung firm-id read is unknown");
resetStubs();

setFirmBillingPlanReadForTests(async () => null);
setFirmSubscriptionReaderForTests({
  customers: {
    list: async () => ({ data: [{ id: "cus_deadline" }] }),
  },
  subscriptions: {
    list: async () => ({ data: [] }),
  },
} as unknown as StripeCustomerSubscriptionReader);
started = Date.now();
result = await resolveFirmBillingEntitlement(actor("close@example.com"), true, null);
timings.closedMs = Date.now() - started;
assert(result.entitled === false && result.reason === "no_active_subscription", "an empty list is no active subscription");
assert(!result.checkFailed, "a finished no-plan result is not a failed check");
assert(
  firmFileOnBillingResult({
    entitled: result.entitled,
    reason: result.reason,
    checkFailed: result.checkFailed,
  }) === "closed",
  "a definite no_active_subscription closes the file",
);
assert(timings.closedMs < 7_000, `a finished no-plan result resolved in ${timings.closedMs}ms`);

setFirmBillingPlanReadForTests(async () => "none");
setFirmSubscriptionReaderForTests({
  customers: {
    list: async () => ({ data: [{ id: "cus_deadline" }] }),
  },
  subscriptions: {
    list: () => hang(30_000, { done: false }).then(() => ({ data: [] })),
  },
} as unknown as StripeCustomerSubscriptionReader);
started = Date.now();
const prior = await resolveFirmBillingEntitlement(actor("close@example.com"), true, null);
timings.priorUnpaidMs = Date.now() - started;
assert(timings.priorUnpaidMs < 7_000, `stored none plus a hang resolved in ${timings.priorUnpaidMs}ms`);
assert(
  prior.entitled === false && prior.reason === "no_active_subscription" && prior.checkFailed,
  "a stored none plan does not grant access when Stripe hangs",
);
assert(
  firmFileOnBillingResult({
    entitled: prior.entitled,
    reason: prior.reason,
    checkFailed: prior.checkFailed,
  }) === "retry",
  "a failed recheck of an unpaid firm does not close as a fresh unpaid wall",
);
resetStubs();

started = Date.now();
const written = await settleFirmBillingCheck({
  deadlineMs: 6_000,
  readFirmIds: async () => ({ firmId: null }),
  readPlan: async () => null,
  readLive: async () => ({ entitled: false, reason: "no_active_subscription" }),
  prior: () => null,
  finishMetadata: async () => {
    await hang(30_000, { done: false });
    logFirmBillingDeadline("metadata-write-ok");
  },
});
timings.metadataWriteMs = Date.now() - started;
assert(timings.metadataWriteMs < 7_000, `a hung customer-id write resolved in ${timings.metadataWriteMs}ms`);
assert(
  written.reason === "no_active_subscription" && written.entitled === false,
  "a slow customer-id write does not replace a finished no-plan result",
);
resetStubs();

console.log(JSON.stringify({ timings, codes }));
console.warn = warn;
console.info = info;
