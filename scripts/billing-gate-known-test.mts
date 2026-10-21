/**
 * A known entitlement survives a failed plan check.
 * Run: pnpm test:billing-gate-known
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { FirmBillingGateView } from "../src/components/firm-billing-gate-view.tsx";
import {
  billingCheckNoticeVisible,
  billingCheckRetryDelayMs,
  classifyBillingCheckFailure,
  entitlementAfterLiveFailure,
  entitlementWhenBillingCheckFails,
  FIRM_BILLING_ENTITLEMENT_SERVER_FN,
  restoreLastFirmSuccess,
} from "../src/lib/billing-check-failure.ts";
import { decideFirmBillingEntitlement } from "../src/lib/stripe-entitlement.ts";
import {
  billingResultStillApplies,
  surfaceAfterBillingCheckFailure,
  surfaceAfterEntitlementFailure,
} from "../src/lib/firm-gate-access.ts";
import {
  clearCachedFirmEntitlement,
  lastKnownEntitlementForFirm,
  lastKnownFirmEntitlement,
  noteFirmEntitlement,
  readCachedFirmEntitlement,
  releaseFirmEntitlementForRetry,
} from "../src/lib/firm-entitlement-client.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const later = "/clients/22222222-2222-4222-8222-222222222222";
const first = "11111111-1111-4111-8111-111111111111";
const page = { pathname: later, firmClientCount: 2, firstClientId: first };

async function renderSurface(surface: "content" | "error" | "wall", notice = false): Promise<string> {
  const rootRoute = createRootRoute({
    component: () =>
      createElement(FirmBillingGateView, {
        surface,
        notice,
        children: "Client figures",
      }),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

const entitledSurface = surfaceAfterEntitlementFailure({ known: "entitled", ...page });
assert(entitledSurface === "content", "an entitled firm keeps the page");
const entitledHtml = await renderSurface("content", true);
assert(entitledHtml.includes("Client figures"), "entitled-cache plus a check error renders the client file");
assert(entitledHtml.includes('data-billing-gate="content"'), "the entitled failure stays on the content surface");
assert(!entitledHtml.includes("check billing"), "an entitled firm does not see the error screen");
assert(entitledHtml.includes('data-billing-gate="notice"'), "repeated failures show a small notice");
assert(entitledHtml.includes("You can keep working"), "the notice does not block the page");

const unknownSurface = surfaceAfterEntitlementFailure({ known: "none", ...page });
assert(unknownSurface === "error", "no known entitlement on a client file is the error screen");
const unknownHtml = await renderSurface("error");
assert(unknownHtml.includes("check billing"), "no-cache plus an error shows the error screen");
assert(unknownHtml.includes("Retry"), "the unknown firm can retry");
assert(!unknownHtml.includes("Client figures"), "the unknown firm does not render the client file");

const unpaidSurface = surfaceAfterEntitlementFailure({ known: "unpaid", ...page });
assert(unpaidSurface === "wall", "a known-unpaid firm on a later client is the wall");
const unpaidHtml = await renderSurface("wall");
assert(unpaidHtml.includes('data-billing-gate="wall"'), "unpaid-cache plus an error shows the wall");
assert(unpaidHtml.includes("Continue to billing"), "the wall sends the firm to billing");
assert(!unpaidHtml.includes("check billing"), "a known-unpaid firm does not see the error screen");

assert(
  surfaceAfterEntitlementFailure({
    known: "none",
    pathname: "/dashboard",
    firmClientCount: 2,
    firstClientId: first,
  }) === "content",
  "Home stays open while the check is unknown",
);
assert(
  surfaceAfterEntitlementFailure({
    known: "none",
    pathname: later,
    firmClientCount: null,
    firstClientId: null,
  }) === "error",
  "a client file with an unknown count still fails closed onto the error screen",
);

clearCachedFirmEntitlement();
noteFirmEntitlement("user-1", { entitled: true, reason: "active_subscription" }, "firm-ben");
let reads = 0;
await readCachedFirmEntitlement(
  "user-1",
  async () => {
    reads += 1;
    throw new Error("socket timeout");
  },
  true,
  "firm-ben",
).then(
  () => {
    throw new Error("a thrown check should reject");
  },
  () => undefined,
);
assert(reads === 1, "the failed check still ran");
assert(
  lastKnownFirmEntitlement("user-1", "firm-ben")?.entitled === true,
  "a thrown check leaves the entitled tab cache in place",
);
await readCachedFirmEntitlement(
  "user-1",
  async () => ({ entitled: false, reason: "stripe_error" }),
  true,
  "firm-ben",
);
assert(
  lastKnownFirmEntitlement("user-1", "firm-ben")?.entitled === true,
  "a stripe_error response does not replace a known entitlement",
);
assert(lastKnownFirmEntitlement("user-1", "firm-other") == null, "another firm does not inherit this entitlement");
assert(
  lastKnownEntitlementForFirm("user-1", "firm-ben")?.entitled === true,
  "the same firm id still has its known plan",
);
assert(lastKnownEntitlementForFirm("user-1", "firm-other") == null, "fail-open does not use another firm's plan");
assert(lastKnownEntitlementForFirm("user-1", null) == null, "a missing firm id is not a known plan");
assert(
  surfaceAfterBillingCheckFailure({ known: "entitled", ...page }) === "content",
  "a deadline with a known entitled plan opens the page",
);
assert(
  surfaceAfterBillingCheckFailure({ known: "unpaid", ...page }) === "content",
  "a deadline with a known unpaid plan does not go to the wall",
);
assert(
  surfaceAfterBillingCheckFailure({ known: "none", ...page }) === "error",
  "a deadline with no known plan keeps the error screen",
);
assert(
  surfaceAfterBillingCheckFailure({
    known: "none",
    pathname: "/dashboard",
    firmClientCount: 2,
    firstClientId: first,
  }) === "content",
  "a deadline on Home with no known plan stays open",
);
await readCachedFirmEntitlement(
  "user-1",
  async () => ({ entitled: false, reason: "no_active_subscription", checkFailed: "timeout" as const }),
  true,
  "firm-ben",
);
assert(
  lastKnownFirmEntitlement("user-1", "firm-ben")?.entitled === true,
  "a failed unpaid echo does not downgrade an entitled tab",
);

clearCachedFirmEntitlement();
assert(lastKnownFirmEntitlement("user-1", "firm-ben") == null, "no-cache has no last success");
noteFirmEntitlement("user-1", { entitled: false, reason: "no_active_subscription" }, "firm-ben");
await readCachedFirmEntitlement(
  "user-1",
  async () => {
    throw new TypeError("Failed to fetch");
  },
  true,
  "firm-ben",
).catch(() => undefined);
assert(
  lastKnownFirmEntitlement("user-1", "firm-ben")?.entitled === false,
  "an unpaid tab result survives the failed recheck",
);

const echoed = entitlementAfterLiveFailure(
  { entitled: true, reason: "active_subscription" },
  "timeout",
);
assert(echoed.entitled === true && echoed.checkFailed === "timeout", "the server returns its last entitled success");
const unpaidEcho = entitlementAfterLiveFailure(
  { entitled: false, reason: "no_active_subscription" },
  "http_5xx",
);
assert(
  unpaidEcho.entitled === false && unpaidEcho.reason === "no_active_subscription" && unpaidEcho.checkFailed === "http_5xx",
  "the server returns its last unpaid success",
);
const unknown = entitlementAfterLiveFailure(null, "network");
assert(unknown.reason === "stripe_error" && unknown.entitled === false, "no server success stays unknown");

const noPlan = decideFirmBillingEntitlement({
  stripeConfigured: true,
  hasEntitlingSubscription: false,
  ownsFirm: true,
  isFirmMember: false,
});
assert(
  noPlan.entitled === false && noPlan.reason === "no_active_subscription",
  "a firm with no plan is not entitled",
);
const cardlessPrior = restoreLastFirmSuccess({
  requestedFirmId: "firm-cardless",
  storedFirmId: "firm-cardless",
  prior: { entitled: false, reason: "no_active_subscription", introTrialEligible: true },
});
assert(
  cardlessPrior?.entitled === false && cardlessPrior.reason === "no_active_subscription",
  "last success for a no-plan firm stays unpaid",
);
const cardlessFailure = entitlementAfterLiveFailure(cardlessPrior, "timeout");
assert(
  cardlessFailure.entitled === false && cardlessFailure.reason === "no_active_subscription",
  "a billing error does not entitle a cardless firm",
);
const otherFirm = restoreLastFirmSuccess({
  requestedFirmId: "firm-cardless",
  storedFirmId: "firm-paid",
  prior: { entitled: true, reason: "active_subscription" },
});
assert(otherFirm == null, "an entitled last success does not restore for a different firm id");
const missingFirm = restoreLastFirmSuccess({
  requestedFirmId: "firm-cardless",
  storedFirmId: null,
  prior: { entitled: true, reason: "active_subscription" },
});
assert(missingFirm == null, "an entitled last success with no firm id does not grant a plan");
const sameFirm = restoreLastFirmSuccess({
  requestedFirmId: "firm-paid",
  storedFirmId: "firm-paid",
  prior: { entitled: true, reason: "active_subscription" },
});
assert(sameFirm?.entitled === true, "an entitled last success restores for that firm id");
const storedEntitled = entitlementWhenBillingCheckFails({
  storedPlan: "entitled",
  prior: { entitled: false, reason: "no_active_subscription" },
  kind: "timeout",
});
assert(
  storedEntitled.entitled === true && storedEntitled.checkFailed === "timeout",
  "a stored entitled plan stays open when the check fails",
);
const storedNone = entitlementWhenBillingCheckFails({
  storedPlan: "none",
  prior: { entitled: true, reason: "active_subscription" },
  kind: "timeout",
});
assert(
  storedNone.entitled === false && storedNone.reason === "stripe_error",
  "a stored none does not grant a plan when the check fails",
);
const storedNoneUnpaid = entitlementWhenBillingCheckFails({
  storedPlan: "none",
  prior: cardlessPrior,
  kind: "timeout",
});
assert(
  storedNoneUnpaid.entitled === false && storedNoneUnpaid.reason === "no_active_subscription",
  "a no-plan firm stays unpaid when the check fails",
);
const nullStored = entitlementWhenBillingCheckFails({
  storedPlan: null,
  prior: null,
  kind: "timeout",
});
assert(
  nullStored.entitled === false && nullStored.reason === "stripe_error",
  "a timeout with no stored plan is unknown, not unpaid",
);

clearCachedFirmEntitlement();
noteFirmEntitlement("user-1", { entitled: true, reason: "active_subscription" });
assert(
  lastKnownFirmEntitlement("user-1", "firm-cardless") == null,
  "a tab entitlement with no firm id does not cover a cardless firm",
);

assert(classifyBillingCheckFailure(new Error("Stripe request timeout")) === "timeout", "a timeout is a timeout");
assert(
  classifyBillingCheckFailure(Object.assign(new Error("upstream"), { statusCode: 502 })) === "http_5xx",
  "an HTTP 502 is a 5xx",
);
assert(classifyBillingCheckFailure(new TypeError("Failed to fetch")) === "network", "a failed fetch is network");
assert(!billingCheckNoticeVisible(1), "the first failure stays quiet");
assert(billingCheckNoticeVisible(2), "the second failure may show the notice");
assert(billingCheckRetryDelayMs(1) === 2_000, "the first quiet retry waits 2 seconds");
assert(billingCheckRetryDelayMs(2) === 4_000, "the next retry doubles");
assert(billingCheckRetryDelayMs(8) === 30_000, "backoff stops growing at 30 seconds");
assert(FIRM_BILLING_ENTITLEMENT_SERVER_FN === "6bfe9fa7", "logs name the entitlement server function");

const fn = readFileSync(new URL("../src/lib/stripe-checkout.functions.ts", import.meta.url), "utf8");
assert(
  fn.includes("entitlementWhenBillingCheckFails"),
  "a live Stripe failure uses the stored plan or the same-firm last success",
);
assert(fn.includes("restoreLastFirmSuccess"), "last success is restored only for that firm id");
assert(fn.includes("FIRM_BILLING_ENTITLEMENT_SERVER_FN"), "the server log names 6bfe9fa7");
assert(!fn.includes("rememberEntitlement(email, failed)"), "a Stripe error is not cached as unpaid");
const gate = readFileSync(new URL("../src/routes/_authenticated.gate.tsx", import.meta.url), "utf8");
assert(gate.includes("pageWhileEntitlementUnknown"), "unknown entitlement still uses the skeleton decision");
assert(gate.includes("<FirmShellLoading />"), "a gated page stays on the skeleton until the check settles");
assert(gate.includes("lastKnownEntitlementForFirm"), "the gate reads the last plan for this firm id");
assert(
  gate.includes("surfaceAfterBillingCheckFailure"),
  "a deadline or Stripe error uses the known plan and not the wall",
);
assert(!gate.includes("setShowWall(true)"), "a failed check does not open the billing wall");
assert(!gate.includes("setQuietAttempt"), "a failed check does not arm a second quiet deadline");
assert(gate.includes("SHELL_GATE_TIMEOUT_MS"), "the gate keeps one shell deadline");
assert(gate.includes("firmFileOnBillingResult"), "a stored plan opens the file when the check fails");
assert(gate.includes('file === "open"'), "the gate does not leave a stored plan on the retry card");
assert(gate.includes("billingResultStillApplies"), "a late result still applies for the same firm");
assert(gate.includes("releaseFirmEntitlementForRetry"), "Retry keeps the in-flight entitlement read");
assert(
  billingResultStillApplies({
    attemptUserId: "user-1",
    attemptFirmId: "firm-ben",
    currentUserId: "user-1",
    currentFirmId: "firm-ben",
  }),
  "the shell timer does not drop a result for the same firm",
);
assert(
  !billingResultStillApplies({
    attemptUserId: "user-1",
    attemptFirmId: "firm-ben",
    currentUserId: "user-2",
    currentFirmId: "firm-ben",
  }),
  "a different user does not receive the late result",
);
assert(
  !billingResultStillApplies({
    attemptUserId: "user-1",
    attemptFirmId: "firm-a",
    currentUserId: "user-1",
    currentFirmId: "firm-b",
  }),
  "a different firm does not receive the late result",
);

clearCachedFirmEntitlement();
let retryLoads = 0;
let resolveRetry: (value: { entitled: boolean; reason: string }) => void = () => {};
const firstRetryRead = readCachedFirmEntitlement(
  "user-1",
  () => {
    retryLoads += 1;
    return new Promise((resolve) => {
      resolveRetry = resolve;
    });
  },
  false,
  "firm-ben",
);
releaseFirmEntitlementForRetry();
const retryRead = readCachedFirmEntitlement(
  "user-1",
  () => {
    retryLoads += 1;
    return Promise.resolve({ entitled: false, reason: "no_active_subscription" });
  },
  true,
  "firm-ben",
);
assert(retryLoads === 1, "Retry reuses the in-flight entitlement read");
resolveRetry({ entitled: true, reason: "active_subscription" });
const lateSuccess = await retryRead;
assert(lateSuccess.entitled === true, "a late success still applies after Retry");
assert(lateSuccess.reason === "active_subscription", "the late success is the in-flight result");
await firstRetryRead;
clearCachedFirmEntitlement();

console.log("billing-gate-known ok");
