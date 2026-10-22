/**
 * Stripe resource methods call this._makeRequest.
 * Detaching them throws "Cannot read properties of undefined (reading '_makeRequest')",
 * which is the Add client toast and the failed billing entitlement lookup.
 *
 * Run: pnpm test:stripe-resource-this
 */
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyBillingCheckFailure,
  entitlementWhenBillingCheckFails,
} from "../src/lib/billing-check-failure";
import { loadFirmClientCreateAllowance, readFirmSubscriptionHistory } from "../src/lib/firm-client-cap.server";
import { readStripeCustomerCountry } from "../src/lib/pricing/za-checkout";
import { setTestStripe } from "@/lib/stripe.server";
import {
  customerHasEntitlingSubscription,
  findFirmCustomerId,
  FirmCustomerLookupUnknown,
  STORED_CUSTOMER_READ_BUDGET_MS,
} from "../src/lib/stripe-entitlement";

const LIST_BUDGET_MS = 3_000;

const USER = "d55084b0-43fe-417b-970b-37f22cee84f3";
const FIRM = "e8f7a440-a541-422c-8e4f-82ba33dd0604";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

type Handler = (...args: unknown[]) => Promise<unknown>;
type Recorded = { name: string; args: unknown[] };

function boundStripe(handlers: Record<string, Handler> = {}) {
  const calls: Recorded[] = [];
  class Resource {
    constructor(private readonly prefix: string) {}
    _makeRequest(name: string, args: unknown[]): Promise<unknown> {
      const key = `${this.prefix}.${name}`;
      calls.push({ name: key, args });
      const handler = handlers[key];
      if (!handler) return Promise.resolve({ data: [] });
      return handler(...args);
    }
  }
  class Customers extends Resource {
    constructor() {
      super("customers");
    }
    list(params: unknown, options?: unknown) {
      return this._makeRequest("list", [params, options]);
    }
    retrieve(id: unknown, params?: unknown, options?: unknown) {
      return this._makeRequest("retrieve", [id, params, options]);
    }
    search(params: unknown, options?: unknown) {
      return this._makeRequest("search", [params, options]);
    }
  }
  class Subscriptions extends Resource {
    constructor() {
      super("subscriptions");
    }
    list(params: unknown, options?: unknown) {
      return this._makeRequest("list", [params, options]);
    }
    search(params: unknown, options?: unknown) {
      return this._makeRequest("search", [params, options]);
    }
  }
  const customers = new Customers();
  const subscriptions = new Subscriptions();
  return { calls, stripe: { customers, subscriptions } };
}

function requestOptions(args: unknown[]): { maxNetworkRetries?: number; timeout?: number } {
  const options = [...args]
    .reverse()
    .find((value) => value && typeof value === "object" && "maxNetworkRetries" in value);
  if (!options || typeof options !== "object") throw new Error("Stripe call is missing request options");
  return options as { maxNetworkRetries?: number; timeout?: number };
}

function assertBudget(
  call: Recorded | undefined,
  msg: string,
  timeout?: number,
) {
  assert(Boolean(call), msg);
  const options = requestOptions(call!.args);
  assert(options.maxNetworkRetries === 0, `${msg} turns Stripe retries off`);
  if (timeout == null) {
    assert(typeof options.timeout === "number" && options.timeout > 0, `${msg} sets a timeout`);
  } else {
    assert(options.timeout === timeout, `${msg} timeout is ${timeout}`);
  }
}

const customer = {
  id: "cus_meta",
  email: "owner@example.com",
  metadata: { firm_id: FIRM, milon_user_id: USER },
};
const subscription = {
  id: "sub_live",
  status: "active",
  customer: "cus_meta",
  metadata: { milon_plan: "starter", milon_user_id: USER, firm_id: FIRM },
  items: { data: [{ price: { lookup_key: "milon_starter_monthly" } }] },
};

const lookup = { email: "owner@example.com", userId: USER, firmId: FIRM };

const retrieved = boundStripe({
  "customers.retrieve": async () => ({ ...customer, id: "cus_stored" }),
  "customers.list": async () => ({ data: [] }),
});
assert(
  (await findFirmCustomerId(retrieved.stripe, { ...lookup, storedCustomerId: "cus_stored" })) ===
    "cus_stored",
  "stored customer retrieve keeps Stripe this",
);
assertBudget(
  retrieved.calls.find((call) => call.name === "customers.retrieve"),
  "stored customer retrieve",
  STORED_CUSTOMER_READ_BUDGET_MS,
);

const bySubscription = boundStripe({
  "customers.list": async () => ({ data: [] }),
  "subscriptions.search": async () => ({ data: [subscription] }),
});
assert(
  (await findFirmCustomerId(bySubscription.stripe, lookup)) === "cus_meta",
  "subscription search keeps Stripe this",
);
assertBudget(
  bySubscription.calls.find((call) => call.name === "subscriptions.search"),
  "subscription search",
);

const byCustomer = boundStripe({
  "customers.list": async () => ({ data: [] }),
  "subscriptions.search": async () => ({ data: [] }),
  "customers.search": async () => ({ data: [customer] }),
});
assert(
  (await findFirmCustomerId(byCustomer.stripe, lookup)) === "cus_meta",
  "customer search keeps Stripe this",
);
assertBudget(
  byCustomer.calls.find((call) => call.name === "customers.search"),
  "customer search",
);

const countryStripe = boundStripe({
  "customers.retrieve": async () => ({ id: "cus_za", address: { country: "ZA" } }),
});
assert(
  (await readStripeCustomerCountry(countryStripe.stripe, "cus_za")) === "ZA",
  "customer country retrieve keeps Stripe this",
);

function firmDb() {
  const builder = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    limit() {
      return builder;
    },
    maybeSingle: async () => ({
      data: {
        id: FIRM,
        owner_user_id: USER,
        market: null,
        starter_trial_enforced: false,
        created_at: "2026-01-01T00:00:00.000Z",
        role: "owner",
      },
      error: null,
    }),
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (err: unknown) => unknown) {
      return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected);
    },
  };
  return {
    from() {
      return builder;
    },
  };
}

const addClient = readFileSync(resolve("src/lib/firm-clients.functions.ts"), "utf8");
assert(
  addClient.includes("loadFirmClientCreateAllowance"),
  "Add client calls the firm client cap",
);
const entitlementServer = readFileSync(resolve("src/lib/stripe-checkout.functions.ts"), "utf8");
assert(
  entitlementServer.includes("entitlementWhenBillingCheckFails"),
  "a timed-out Stripe read uses the stored plan",
);

const addClientStripe = boundStripe({
  "customers.list": async () => ({ data: [] }),
  "customers.retrieve": async () => customer,
  "subscriptions.search": async () => ({ data: [subscription] }),
  "subscriptions.list": async () => ({ data: [subscription] }),
});
setTestStripe(addClientStripe.stripe);
const allowance = await loadFirmClientCreateAllowance({
  supabase: firmDb(),
  userId: USER,
  email: "owner@example.com",
  firmId: FIRM,
});
assert(allowance.allowed === true, "Add client allowance finishes after the Stripe lookup");
assertBudget(
  addClientStripe.calls.find((call) => call.name === "subscriptions.search"),
  "Add client subscription search",
);
assert(
  addClientStripe.calls.some((call) => call.name === "subscriptions.list"),
  "Add client lists subscriptions on the Stripe resource",
);

const bothStatuses = boundStripe({
  "subscriptions.list": async (params) => {
    const status = (params as { status?: string }).status;
    if (status === "active") return { data: [] };
    return {
      data: [
        {
          id: "sub_trial",
          status: "trialing",
          items: { data: [{ price: { lookup_key: "milon_solo_monthly" } }] },
        },
      ],
    };
  },
});
assert(
  (await customerHasEntitlingSubscription(bothStatuses.stripe, "cus_meta")) === true,
  "trialing firm subscription entitles",
);
const listed = bothStatuses.calls.filter((call) => call.name === "subscriptions.list");
assert(listed.length === 2, "active and trialing are both listed");
for (const call of listed) {
  assertBudget(call, "subscriptions.list", LIST_BUDGET_MS);
}

const bareEmail = "owner@example.com";
const bareStripe = boundStripe({
  "customers.retrieve": async () => ({
    id: "cus_stored",
    email: bareEmail,
    metadata: { firm_id: FIRM, milon_user_id: USER },
  }),
  "subscriptions.list": async () => ({
    data: [
      {
        id: "sub_live",
        status: "active",
        created: 1_700_000_000,
        currency: "usd",
        metadata: { milon_plan: "solo" },
        discounts: ["di_za"],
        items: {
          data: [
            {
              id: "si_1",
              price: {
                id: "price_solo",
                lookup_key: "milon_solo_monthly",
                unit_amount: 9900,
                currency: "usd",
                recurring: { interval: "month" },
                product: "prod_solo",
              },
            },
          ],
        },
      },
    ],
  }),
});
setTestStripe(bareStripe.stripe);
const bareWarnings: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  bareWarnings.push(args.map((part) => String(part)).join(" "));
};
let bareHistory: Awaited<ReturnType<typeof readFirmSubscriptionHistory>> | undefined;
let bareThrew = false;
try {
  bareHistory = await readFirmSubscriptionHistory(bareEmail, {
    fresh: true,
    userId: USER,
    firmId: FIRM,
    storedCustomerId: "cus_stored",
  });
} catch {
  bareThrew = true;
} finally {
  console.warn = originalWarn;
}
assert(!bareThrew, "a bare discount id on the firm plan list does not throw");
assert(
  bareWarnings.length === 1 &&
    bareWarnings[0] === `[stripe] unexpanded discounts kept firm=${FIRM}` &&
    !bareWarnings.some((line) => /cus_|sub_|@/.test(line)),
  "the firm plan list warns with the firm id only",
);
assert(
  JSON.stringify(bareHistory?.entitling?.discounts) ===
    JSON.stringify([{ id: "di_za", couponId: null, promotionCodeId: null }]),
  "the firm plan list keeps the bare discount",
);
assert(
  bareHistory?.entitling?.band === "solo" &&
    bareHistory.entitling.lookupKey === "milon_solo_monthly" &&
    bareHistory.entitling.unitAmount === 9900,
  "a bare discount id does not change the plan price",
);

async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

mock.timers.enable({ apis: ["setTimeout"] });
try {
  let probe = false;
  setTimeout(() => {
    probe = true;
  }, LIST_BUDGET_MS);
  mock.timers.tick(LIST_BUDGET_MS);
  assert(probe, "fake timers advance setTimeout");

  const hanging = boundStripe({
    "subscriptions.list": () => new Promise(() => {}),
  });
  let settled = false;
  let failure: unknown;
  const pending = customerHasEntitlingSubscription(hanging.stripe, "cus_hang").then(
    () => {
      settled = true;
    },
    (err) => {
      settled = true;
      failure = err;
    },
  );
  mock.timers.tick(LIST_BUDGET_MS - 1);
  await flush();
  assert(!settled, "subscriptions.list is still open before the budget");
  mock.timers.tick(1);
  await flush();
  assert(settled, "a hanging subscriptions.list falls back within the budget");
  assert(
    failure instanceof FirmCustomerLookupUnknown && failure.kind === "timeout",
    "a hanging subscriptions.list is a timeout",
  );
  assertBudget(
    hanging.calls.find((call) => call.name === "subscriptions.list"),
    "hanging subscriptions.list",
    LIST_BUDGET_MS,
  );
  const stored = entitlementWhenBillingCheckFails({
    storedPlan: "entitled",
    prior: null,
    kind: classifyBillingCheckFailure(failure),
  });
  assert(stored.entitled === true, "the stored entitled plan stays entitled");
  assert(stored.reason === "active_subscription", "the stored plan is the active subscription");
  assert(stored.checkFailed === "timeout", "the list timeout is recorded on the stored plan");
  await pending;

  const historyStripe = boundStripe({
    "customers.retrieve": async () => ({ ...customer, id: "cus_hang" }),
    "customers.list": async () => ({ data: [] }),
    "subscriptions.list": () => new Promise(() => {}),
  });
  setTestStripe(historyStripe.stripe);
  settled = false;
  failure = undefined;
  const history = readFirmSubscriptionHistory("hang@example.com", {
    fresh: true,
    userId: USER,
    firmId: FIRM,
    storedCustomerId: "cus_hang",
  }).then(
    () => {
      settled = true;
    },
    (err) => {
      settled = true;
      failure = err;
    },
  );
  await flush();
  assert(!settled, "the entitlement list is still open before the budget");
  mock.timers.tick(LIST_BUDGET_MS);
  await flush();
  assert(settled, "the entitlement list falls back within the budget");
  assert(
    failure instanceof FirmCustomerLookupUnknown && failure.kind === "timeout",
    "the entitlement list timeout is unknown, not an unpaid firm",
  );
  const historyStored = entitlementWhenBillingCheckFails({
    storedPlan: "entitled",
    prior: null,
    kind: classifyBillingCheckFailure(failure),
  });
  assert(
    historyStored.entitled === true &&
      historyStored.reason === "active_subscription" &&
      historyStored.checkFailed === "timeout",
    "a hanging entitlement list returns the stored plan",
  );
  await history;
} finally {
  mock.timers.reset();
}

console.log("stripe-resource-this ok");
