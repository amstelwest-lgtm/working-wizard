/**
 * Interim: one silent retry when the client billing check fails as network
 * or timeout. Not the root-cause fix.
 * Run: pnpm test:billing-gate-network-retry
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { FirmBillingGateView } from "../src/components/firm-billing-gate-view.tsx";
import {
  BILLING_GATE_QUIET_DEADLINES,
  resolveClientBillingGateCheck,
  shellDeadlineAfterQuietWait,
} from "../src/lib/billing-check-failure.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function renderSurface(surface: "content" | "error"): Promise<string> {
  const rootRoute = createRootRoute({
    component: () =>
      createElement(FirmBillingGateView, {
        surface,
        children: "Client figures",
      }),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/clients/file"] }),
  });
  await router.load();
  return renderToStaticMarkup(createElement(RouterProvider, { router }));
}

const openHtml = await renderSurface("content");
assert(openHtml.includes("Client figures"), "an open file shows the client page");
assert(!openHtml.includes("check billing"), "an open file does not show the billing card");
assert(!openHtml.includes('data-billing-gate="pending"'), "an open file is not the retry card");

const cardHtml = await renderSurface("error");
assert(cardHtml.includes("check billing"), "the card is the couldn't-check-billing state");
assert(cardHtml.includes('data-billing-gate="pending"'), "the card is the billing-gate error surface");
assert(!cardHtml.includes("Client figures"), "the card does not open the file");

let calls = 0;
const recovered = await resolveClientBillingGateCheck(async () => {
  calls += 1;
  if (calls === 1) throw new TypeError("Failed to fetch");
  return { entitled: true, reason: "active_subscription" };
});
assert(recovered.outcome === "open", "a network failure then an entitled result opens the file");
assert(recovered.calls === 2 && calls === 2, "the recovered file used exactly two checks");
assert(recovered.outcome === "open" && !openHtml.includes("check billing"), "the recovered file shows no card");

calls = 0;
const bothFailed = await resolveClientBillingGateCheck(async () => {
  calls += 1;
  throw new TypeError("Failed to fetch");
});
assert(bothFailed.outcome === "card", "two network failures show the card");
assert(bothFailed.calls === 2 && calls === 2, "the card waits until the second check fails");
assert(bothFailed.kind === "network", "the card keeps the network kind");

calls = 0;
let retriedNoPlan = false;
const noPlan = await resolveClientBillingGateCheck(
  async () => {
    calls += 1;
    return { entitled: false, reason: "no_active_subscription" };
  },
  {
    onRetry() {
      retriedNoPlan = true;
    },
  },
);
assert(noPlan.outcome === "closed", "a definite no-plan answer closes the file");
assert(noPlan.calls === 1 && calls === 1, "a definite no-plan answer does not retry");
assert(retriedNoPlan === false, "a definite no-plan answer does not start the silent retry");

calls = 0;
const timedOut = await resolveClientBillingGateCheck(async () => {
  calls += 1;
  if (calls === 1) throw new Error("Stripe request timed out");
  return { entitled: true, reason: "active_subscription" };
});
assert(timedOut.outcome === "open" && timedOut.calls === 2, "a timeout retries once and can open the file");

calls = 0;
const upstream = await resolveClientBillingGateCheck(async () => {
  calls += 1;
  throw Object.assign(new Error("upstream"), { statusCode: 502 });
});
assert(upstream.outcome === "card" && upstream.calls === 1, "an HTTP 5xx still shows the card with no retry");
assert(calls === 1, "an HTTP 5xx does not call the server fn again");

calls = 0;
const echoed = await resolveClientBillingGateCheck(async () => {
  calls += 1;
  if (calls === 1) {
    return { entitled: false, reason: "no_active_subscription", checkFailed: "timeout" as const };
  }
  return { entitled: true, reason: "active_subscription" };
});
assert(
  echoed.outcome === "open" && echoed.calls === 2,
  "an unpaid echo with a timeout is not a definite close, so it retries once",
);

assert(shellDeadlineAfterQuietWait(0) === "wait", "the first shell deadline stays on the skeleton");
assert(
  shellDeadlineAfterQuietWait(BILLING_GATE_QUIET_DEADLINES - 1) === "wait",
  "the skeleton stays up long enough for a 13–20s failure to retry",
);
assert(
  shellDeadlineAfterQuietWait(BILLING_GATE_QUIET_DEADLINES) === "card",
  "a read that never settles still reaches the card",
);

const gate = readFileSync(new URL("../src/routes/_authenticated.gate.tsx", import.meta.url), "utf8");
assert(gate.includes("resolveClientBillingGateCheck"), "the gate retries through the client billing check");
assert(gate.includes("shellDeadlineAfterQuietWait"), "the gate keeps the skeleton up before the card");
assert(gate.includes("noteFailure(\"timeout\")"), "a deadline that is done still records the timeout");
assert(gate.includes("<FirmShellLoading />"), "the still-checking state is the skeleton");
assert(!gate.includes("Checking billing…"), "the retry does not add a full-screen billing flash");

console.log("billing-gate-network-retry ok");
