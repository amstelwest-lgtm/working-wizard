/**
 * Cold open with a stored firm plan.
 * Stripe calls must be 0. The gate, Start here, and the practice allowance
 * must share one server read.
 *
 * On main those are separate reads and the stored entitled plan still starts
 * a Stripe list. This file fails there and passes once the open path answers
 * from firms.billing_plan_known.
 *
 * Run: pnpm test:billing-open-calls
 */
import { readFileSync } from "node:fs";
import type Stripe from "stripe";

process.env.STRIPE_SECRET_KEY ??= "sk_test_billing_open";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_SECRET_KEY;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const USER = "11111111-1111-4111-8111-111111111111";
const ENTITLED_FIRM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const NONE_FIRM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const STALE_FIRM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const OPEN_FIRM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";

function firmSupabase(firmId: string) {
  const row = { id: firmId, owner_user_id: USER };
  return {
    auth: {
      getUser: async () => ({ data: { user: { email: null } } }),
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                limit: async () => ({ data: [row] }),
              };
            },
          };
        },
      };
    },
  };
}

function actor(email: string, firmId: string) {
  return { userId: USER, claims: { email }, supabase: firmSupabase(firmId) };
}

let stripeCalls = 0;

function countingStripe(): Stripe {
  const call = () => {
    stripeCalls += 1;
    return Promise.resolve({ data: [], id: "cus_open", deleted: false, email: null, metadata: {} });
  };
  return {
    customers: { list: call, search: call, retrieve: call },
    subscriptions: { list: call },
    paymentMethods: { list: call },
  } as unknown as Stripe;
}

async function flushBackground() {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const { setStripeClientForTests } = await import("../src/lib/stripe.server.ts");
const { setFirmBillingPlanReadForTests } = await import("../src/lib/firm-billing-plan.server.ts");
const { resolveFirmBillingEntitlement } = await import("../src/lib/stripe-checkout.functions.ts");
const client = await import("../src/lib/firm-entitlement-client.ts");
const planClient = await import("../src/lib/firm-plan-client.ts");

let setRefreshAt: ((firmId: string, at: number) => void) | null = null;
let resetRefresh: (() => void) | null = null;
let refreshMs: number | null = null;
try {
  const open = await import("../src/lib/firm-billing-open.server.ts");
  setRefreshAt = open.setFirmBillingStripeRefreshForTests ?? null;
  resetRefresh = open.resetFirmBillingStripeRefreshForTests ?? null;
  refreshMs = open.FIRM_BILLING_STRIPE_REFRESH_MS ?? null;
} catch {
  setRefreshAt = null;
}

const failures: string[] = [];

async function check(name: string, fn: () => Promise<void>) {
  stripeCalls = 0;
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${message}`);
    console.log(`FAIL  ${name}: ${message}`);
  } finally {
    setStripeClientForTests(null);
    setFirmBillingPlanReadForTests(null);
    resetRefresh?.();
  }
}

await check("stored entitled cold open makes 0 Stripe calls", async () => {
  setFirmBillingPlanReadForTests(async () => "entitled");
  setStripeClientForTests(countingStripe());
  const result = await resolveFirmBillingEntitlement(
    actor("entitled-open@example.com", ENTITLED_FIRM),
    false,
    ENTITLED_FIRM,
  );
  await flushBackground();
  assert(result.entitled === true, `stored entitled should stay entitled, saw ${JSON.stringify(result)}`);
  assert(result.reason === "active_subscription", `stored entitled reason, saw ${result.reason}`);
  assert(stripeCalls === 0, `cold open made ${stripeCalls} Stripe calls`);
});

await check("stored none cold open makes 0 Stripe calls", async () => {
  setFirmBillingPlanReadForTests(async () => "none");
  setStripeClientForTests(countingStripe());
  const result = await resolveFirmBillingEntitlement(
    actor("none-open@example.com", NONE_FIRM),
    false,
    NONE_FIRM,
  );
  await flushBackground();
  assert(result.entitled === false, "a stored none stays unpaid");
  assert(result.reason === "no_active_subscription", `stored none reason, saw ${result.reason}`);
  assert(!result.checkFailed, "a stored none is a confirmed plan, not a failed check");
  assert(stripeCalls === 0, `cold open made ${stripeCalls} Stripe calls`);
});

await check("one server call per open", async () => {
  const loader = readFileSync(new URL("../src/components/firm-band-upgrade.tsx", import.meta.url), "utf8");
  const board = readFileSync(new URL("../src/components/practice-board.tsx", import.meta.url), "utf8");
  const insight = readFileSync(new URL("../src/components/checkout-after-insight.tsx", import.meta.url), "utf8");
  const gate = readFileSync(new URL("../src/routes/_authenticated.gate.tsx", import.meta.url), "utf8");
  const shared = typeof client.readFirmBillingOpen === "function";
  let serverCalls = 0;
  client.clearCachedFirmEntitlement();
  if (shared && loader.includes("readFirmBillingOpen") && board.includes("readFirmBillingOpen")) {
    const load = async () => {
      serverCalls += 1;
      return { entitled: true, reason: "active_subscription" as const };
    };
    await Promise.all([
      client.readFirmBillingOpen("open-user", load, false, OPEN_FIRM),
      client.readFirmBillingOpen("open-user", load, false, OPEN_FIRM),
      client.readFirmBillingOpen("open-user", load, false, OPEN_FIRM),
    ]);
  } else {
    await Promise.all([
      client.readCachedFirmEntitlement(
        "open-user",
        async () => {
          serverCalls += 1;
          return { entitled: true, reason: "active_subscription" as const };
        },
        false,
        OPEN_FIRM,
      ),
      planClient.readCachedFirmPlan(OPEN_FIRM, async () => {
        serverCalls += 1;
        return { configured: true, band: "starter", phase: "active" };
      }),
    ]);
    if (board.includes("loadTrialAllowance")) serverCalls += 1;
  }
  assert(serverCalls === 1, `open made ${serverCalls} server calls`);
  assert(gate.includes("readCachedFirmEntitlement"), "the gate still reuses one entitlement read");
  assert(
    insight.includes("firmId"),
    "checkout after insight passes the firm id into the shared read",
  );
  assert(
    loader.includes("readFirmBillingOpen"),
    "Start here joins the open billing read",
  );
  const mount = board.slice(board.indexOf("const [trialAllowance"), board.indexOf("const [firstClientOpen"));
  assert(mount.includes("readFirmBillingOpen"), "the practice board open joins the shared billing read");
  assert(
    !mount.includes("loadTrialAllowance"),
    "the practice board open does not start a second allowance server call",
  );
});

await check("a stale stored plan refreshes at most once per 10-15 min", async () => {
  assert(setRefreshAt != null && resetRefresh != null && refreshMs != null, "in-process refresh stamp is missing");
  assert(refreshMs >= 10 * 60 * 1000 && refreshMs <= 15 * 60 * 1000, `refresh window ${refreshMs} is outside 10-15 min`);
  setRefreshAt(STALE_FIRM, Date.now() - refreshMs - 1_000);
  setFirmBillingPlanReadForTests(async () => "entitled");
  setStripeClientForTests(countingStripe());
  const result = await resolveFirmBillingEntitlement(
    actor("stale-open@example.com", STALE_FIRM),
    false,
    STALE_FIRM,
  );
  await flushBackground();
  assert(result.reason !== "stripe_unconfigured", "the stale refresh is a real billing read");
  assert(stripeCalls > 0, "a plan older than the refresh window reads Stripe once");
  const after = stripeCalls;
  stripeCalls = 0;
  const again = await resolveFirmBillingEntitlement(
    actor("stale-open-2@example.com", STALE_FIRM),
    false,
    STALE_FIRM,
  );
  await flushBackground();
  assert(again.entitled === true, "the following open still answers entitled");
  assert(stripeCalls === 0, `the refresh window still made ${stripeCalls} Stripe calls after ${after}`);
});

if (failures.length) {
  console.log(`\n${failures.length} failed`);
  for (const failure of failures) console.log(`  ${failure}`);
  process.exit(1);
}

console.log("billing open calls ok");
