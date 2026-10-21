/**
 * Firm product is gated on an entitling Stripe subscription.
 * Run: pnpm test:firm-billing-gate
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideAccountantAuthLanding, safeAccountantRedirect } from "../src/lib/auth-landing";
import {
  entitlementForFailedCheck,
  FIRM_BILLING_PLAN_FALLBACK_MS,
} from "../src/lib/billing-check-failure";
import { firmFileOnBillingResult } from "../src/lib/firm-gate-access";
import { SHELL_GATE_TIMEOUT_MS } from "../src/lib/shell-gate";
import {
  firmStripeCustomerColumnProbes,
  noteMissingFirmStripeCustomerColumn,
  readFirmStripeCustomerId,
  resetFirmStripeCustomerColumnProbe,
} from "../src/lib/firm-stripe-customer.server";
import {
  firmCheckoutSessionParams,
  firmIntegrationIdentifier,
  firmStartTrialCheckout,
} from "../src/lib/stripe-checkout.core";
import {
  checkoutSessionUnlocksFirm,
  customerHasEntitlingSubscription,
  decideFirmBillingEntitlement,
  decideFirmBillingPathGate,
  decidePostLoginBillingResume,
  isFirstClientFiguresPath,
  customerIdFromMetadataCustomers,
  customerIdFromMetadataSubscriptions,
  emailHasEntitlingSubscription,
  FIRM_CUSTOMER_SEARCH_BUDGET_MS,
  STORED_CUSTOMER_READ_BUDGET_MS,
  findFirmCustomerId,
  FirmCustomerLookupUnknown,
  metadataFirmCustomerStore,
  setMetadataFirmCustomerWriteListener,
  firmCustomerSearchQuery,
  isBillingExemptPath,
  isFirmProductPath,
  isPracticeShellPath,
  isOpsPath,
  isOwnerSparkPath,
  subscriptionStatusEntitles,
  type StripeCustomerSubscriptionReader,
} from "../src/lib/stripe-entitlement";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(subscriptionStatusEntitles("active"), "active entitles");
assert(subscriptionStatusEntitles("trialing"), "trialing entitles the 14-day trial");
assert(!subscriptionStatusEntitles("incomplete"), "incomplete does not entitle");
assert(!subscriptionStatusEntitles("past_due"), "past_due does not entitle");
assert(!subscriptionStatusEntitles("canceled"), "canceled does not entitle");
assert(!subscriptionStatusEntitles("unpaid"), "unpaid does not entitle");

assert(checkoutSessionUnlocksFirm({ status: "complete" }), "complete Checkout unlocks");
assert(checkoutSessionUnlocksFirm({ paymentStatus: "paid" }), "paid Checkout unlocks");
assert(
  checkoutSessionUnlocksFirm({ status: "complete", paymentStatus: "no_payment_required" }),
  "trial Checkout no_payment_required unlocks",
);
assert(
  !checkoutSessionUnlocksFirm({ status: "open", paymentStatus: "unpaid" }),
  "open unpaid does not unlock",
);

assert(isFirmProductPath("/dashboard"), "dashboard is firm product");
assert(isFirmProductPath("/practice"), "practice overview is firm product");
assert(isPracticeShellPath("/dashboard"), "Home is a practice shell path");
assert(isPracticeShellPath("/practice"), "Practice is a practice shell path");
assert(isPracticeShellPath("/clients"), "the client list is a practice shell path");
assert(isPracticeShellPath("/clients/"), "a trailing slash does not leave the client list");
assert(!isPracticeShellPath("/clients/second"), "a client file is not the practice shell");
assert(isFirmProductPath("/clients/abc"), "client workspace is firm product");
assert(isFirmProductPath("/reports"), "reports is firm product");
assert(!isFirmProductPath("/settings/team"), "team settings stay open with the rest of settings");
assert(!isFirmProductPath("/settings/team/"), "team settings with a slash stay open");
assert(!isFirmProductPath("/settings/brand"), "brand settings stay open before a card");
assert(!isFirmProductPath("/settings/brand/"), "brand settings with a slash stay open");
assert(!isFirmProductPath("/settings"), "shared settings is not gated");
assert(!isFirmProductPath("/open"), "smart landing is not a firm-product path");
assert(!isFirmProductPath("/app"), "/app is owner Spark");
assert(!isFirmProductPath("/ops"), "/ops is Lighthouse");
assert(!isFirmProductPath("/billing/start"), "billing start is exempt");
assert(isBillingExemptPath("/billing/required"), "billing required is exempt");
assert(isBillingExemptPath("/billing/success"), "billing success is exempt");
assert(isOwnerSparkPath("/app"), "owner path helper");
assert(isOpsPath("/ops"), "ops path helper");

assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
  }) === "require_billing",
  "firm without sub and no insight flag → redirected",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: false,
  }) === "allow",
  "before an insight the dashboard stays open",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 0,
  }) === "allow",
  "a firm with 0 clients stays on the dashboard before a card",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard?addClient=1",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 0,
  }) === "allow",
  "0-client add-client step stays open pre-card",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/open",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 0,
  }) === "allow",
  "0-client /open is not the billing wall",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: null,
  }) === "require_billing",
  "unknown client count is not treated as zero",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/clients/abc",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: false,
  }) === "allow",
  "before an insight the client workspace stays open",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/reports",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: false,
  }) === "require_billing",
  "reports still bill before an insight",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
  }) === "require_billing",
  "after an insight an unpaid firm is sent to Checkout",
);
assert(
  isFirstClientFiguresPath({ pathname: "/clients/abc", firmClientCount: 1, firstClientId: "abc" }),
  "the only client file is the figures view",
);
assert(
  !isFirstClientFiguresPath({ pathname: "/reports", firmClientCount: 1 }),
  "reports is not the figures view",
);
assert(
  !isFirstClientFiguresPath({
    pathname: "/clients/second",
    firmClientCount: 2,
    firstClientId: "first",
  }),
  "a later client is not the first figures view",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/clients/abc",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 1,
    firstClientId: "abc",
  }) === "allow",
  "first-client figures stay viewable without a card",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/clients/first",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 2,
    firstClientId: "first",
  }) === "allow",
  "the earliest file stays open after a second client exists",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/clients/abc",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: null,
  }) === "allow",
  "a failed client count does not wall the file",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/clients/second",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 2,
    firstClientId: "first",
  }) === "require_billing",
  "a second client still redirects after an insight",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 1,
    firstClientId: "abc",
  }) === "allow",
  "practice Home stays open without a card",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 2,
    firstClientId: "first",
  }) === "allow",
  "practice Home stays open when a second client exists",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/practice",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 1,
    firstClientId: "abc",
  }) === "allow",
  "practice overview stays open without a card",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/clients",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 2,
    firstClientId: "first",
  }) === "allow",
  "the client list stays open without a card",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/practice",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: null,
  }) === "require_billing",
  "unknown client count does not open the practice overview",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/reports",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 1,
    firstClientId: "abc",
  }) === "require_billing",
  "reports and export still redirect",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/settings/team",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: false,
    firmClientCount: 1,
  }) === "allow",
  "team settings stay open before an insight",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/settings/brand",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 1,
    firstClientId: "abc",
  }) === "allow",
  "brand settings stay open after an insight and before a card",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/settings",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 1,
    firstClientId: "abc",
  }) === "allow",
  "account settings stay open so brand can be reached",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/clients/abc",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
  }) === "require_billing",
  "without a first-client count the client path still redirects",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: true,
  }) === "allow",
  "firm with active sub → allowed",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/app",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
  }) === "allow",
  "owner Spark path unaffected even if the same email is a firm user",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/app",
    isAccountantFirmUser: false,
    isMilonItMember: false,
    entitled: false,
  }) === "allow",
  "pure owner path unaffected",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/ops",
    isAccountantFirmUser: true,
    isMilonItMember: true,
    entitled: false,
  }) === "allow",
  "ops / IT path is not gated",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/billing/start",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
  }) === "allow",
  "billing start is not gated",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/auth/callback",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
  }) === "allow",
  "auth callback is not gated",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/join/token",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
  }) === "allow",
  "accountant join is not gated",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard",
    isAccountantFirmUser: false,
    isMilonItMember: false,
    entitled: false,
  }) === "allow",
  "SME-only on dashboard is not a billing redirect (role bounce handles it)",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard",
    isAccountantFirmUser: true,
    isMilonItMember: true,
    entitled: false,
  }) === "allow",
  "IT member may sit on dashboard without a firm sub",
);

assert(
  decideFirmBillingEntitlement({
    stripeConfigured: true,
    hasEntitlingSubscription: false,
    ownsFirm: true,
    isFirmMember: true,
  }).entitled === false,
  "unpaid firm owner is not entitled",
);
assert(
  decideFirmBillingEntitlement({
    stripeConfigured: true,
    hasEntitlingSubscription: true,
    ownsFirm: true,
    isFirmMember: true,
  }).entitled === true,
  "owner with active/trialing sub is entitled",
);
assert(
  decideFirmBillingEntitlement({
    stripeConfigured: true,
    hasEntitlingSubscription: false,
    ownsFirm: false,
    isFirmMember: true,
  }).reason === "firm_member",
  "invited staff inherit firm billing (not billed on their own email)",
);
assert(
  decideFirmBillingEntitlement({
    stripeConfigured: false,
    hasEntitlingSubscription: false,
    ownsFirm: true,
    isFirmMember: true,
  }).reason === "stripe_unconfigured",
  "local/dev without Stripe keys does not lock the shell",
);

assert(
  decidePostLoginBillingResume({
    hasPendingFirmCheckout: true,
    ownsFirm: false,
    resumeFirmBilling: false,
  }) === "billing_start",
  "pending firm checkout resumes /billing/start even on the owner door",
);
assert(
  decidePostLoginBillingResume({
    hasPendingFirmCheckout: false,
    ownsFirm: true,
    resumeFirmBilling: true,
  }) === "billing_required",
  "firm-register already-registered + firm owner without pending → billing required",
);
assert(
  decidePostLoginBillingResume({
    hasPendingFirmCheckout: false,
    ownsFirm: true,
    resumeFirmBilling: false,
  }) === null,
  "owner-door sign-in of a dual-role email does not steal Spark",
);
assert(
  decidePostLoginBillingResume({
    hasPendingFirmCheckout: false,
    ownsFirm: false,
    resumeFirmBilling: true,
  }) === null,
  "Spark-only already-registered does not open firm Checkout",
);

function mockStripe(opts: {
  customerId?: string;
  statuses?: string[];
  subscriptions?: Array<{
    id: string;
    status: string;
    metadata?: { milon_plan?: string | null; milon_lookup_key?: string | null } | null;
    items?: {
      data: Array<{
        price: {
          lookup_key?: string;
          product?: { metadata?: { plan?: string; band?: string } };
        };
      }>;
    };
  }>;
}): StripeCustomerSubscriptionReader {
  return {
    customers: {
      list: async () => ({
        data: opts.customerId ? [{ id: opts.customerId }] : [],
      }),
    },
    subscriptions: {
      list: async ({ status }) => ({
        data: opts.subscriptions
          ? opts.subscriptions.filter((sub) => sub.status === status)
          : (opts.statuses ?? []).includes(status)
            ? [{ id: "sub_1", status }]
            : [],
      }),
    },
  };
}

assert(
  (await emailHasEntitlingSubscription(mockStripe({}), "firm@example.com")) === false,
  "no Stripe customer → not entitled",
);
assert(
  (await emailHasEntitlingSubscription(
    mockStripe({ customerId: "cus_1", statuses: [] }),
    "firm@example.com",
  )) === false,
  "customer without active/trialing sub → not entitled",
);
assert(
  (await emailHasEntitlingSubscription(
    mockStripe({ customerId: "cus_1", statuses: ["active"] }),
    "firm@example.com",
  )) === true,
  "active subscription by email → entitled",
);

const BEN_OWNER = "d55084b0-43fe-417b-970b-37f22cee84f3";
const BEN_FIRM = "e8f7a440-a541-422c-8e4f-82ba33dd0604";
const benQuery = firmCustomerSearchQuery({ userId: BEN_OWNER, firmId: BEN_FIRM });
assert(
  benQuery ===
    `metadata['firm_id']:'${BEN_FIRM}' OR metadata['milon_user_id']:'${BEN_OWNER}'`,
  "firm lookup searches firm id and owner id, not email",
);
assert(firmCustomerSearchQuery({ userId: "team@trymilon.com" }) === null, "an email is not a search key");
assert(
  firmCustomerSearchQuery({ userId: "d55084b0-43fe-417b-970b-37f22cee84f3' OR " }) === null,
  "a non-uuid cannot be interpolated into the Stripe query",
);

const starterSub = {
  id: "sub_starter",
  status: "active",
  customer: "cus_old",
  metadata: {
    milon_plan: "starter",
    milon_user_id: BEN_OWNER,
    firm_id: BEN_FIRM,
  },
  items: { data: [{ price: { lookup_key: "milon_starter_monthly" } }] },
};
assert(
  customerIdFromMetadataSubscriptions([starterSub], { userId: BEN_OWNER, firmId: BEN_FIRM }) ===
    "cus_old",
  "metadata on the subscription yields its customer id",
);

let searchedQuery = "";
let listedEmail = "";
const movedEmailStripe: StripeCustomerSubscriptionReader = {
  customers: {
    list: async ({ email }) => {
      listedEmail = email;
      return { data: [] };
    },
  },
  subscriptions: {
    list: async ({ customer, status }) => ({
      data:
        customer === "cus_old" && status === "active"
          ? [starterSub]
          : [],
    }),
    search: async ({ query }) => {
      searchedQuery = query;
      return { data: [starterSub] };
    },
  },
};
assert(
  (await findFirmCustomerId(movedEmailStripe, {
    email: "team@trymilon.com",
    userId: BEN_OWNER,
    firmId: BEN_FIRM,
  })) === "cus_old",
  "an email change still finds the subscription by firm id and owner id",
);
assert(
  listedEmail === "team@trymilon.com",
  "the new email is compared after the stable customer is found",
);
assert(searchedQuery === benQuery, "the search query is the firm and owner ids");
assert(
  (await customerHasEntitlingSubscription(movedEmailStripe, "cus_old")) === true,
  "that customer still has an entitling Starter subscription",
);

let splitLists = 0;
const emptyNewCustomer: StripeCustomerSubscriptionReader = {
  customers: {
    list: async () => {
      splitLists += 1;
      // The lookup misses. The later comparison sees a different customer.
      if (splitLists === 1) return { data: [] };
      return { data: [{ id: "cus_new_empty" }] };
    },
  },
  subscriptions: {
    list: async () => ({ data: [] }),
    search: async () => ({ data: [starterSub] }),
  },
};
const splitWarnings: string[] = [];
const warnSplit = console.warn;
console.warn = (...args: unknown[]) => {
  splitWarnings.push(args.map((part) => String(part)).join(" "));
};
let splitHit = "";
try {
  splitHit =
    (await findFirmCustomerId(emptyNewCustomer, {
      email: "team@trymilon.com",
      userId: BEN_OWNER,
      firmId: BEN_FIRM,
    })) ?? "";
  await new Promise((resolve) => setTimeout(resolve, 0));
} finally {
  console.warn = warnSplit;
}
assert(splitHit === "cus_old", "a newer customer on the new email does not hide the firm's subscription");
assert(
  splitWarnings.some((line) => line.includes("keeping the stable customer")),
  "different stable and email customers are logged",
);
const splitTrial = firmStartTrialCheckout({
  customerId: splitHit,
  priorSubscriptionCount: 1,
  hasEntitlingSubscription: false,
  needsPaymentOnExisting: false,
});
const splitParams = firmCheckoutSessionParams({
  priceId: "price_test_starter_month",
  lookupKey: "milon_starter_monthly",
  band: "starter",
  interval: "month",
  origin: "https://milonfinance.com",
  userId: BEN_OWNER,
  firmId: BEN_FIRM,
  email: "team@trymilon.com",
  customerId: splitTrial.kind === "checkout" ? splitTrial.customerId : undefined,
  market: "us",
  integrationIdentifier: firmIntegrationIdentifier("starter", "month", "abcdefgh"),
  includeTrial: splitTrial.kind === "checkout" ? splitTrial.includeTrial : false,
});
assert(splitParams.customer === "cus_old", "Start trial keeps the stable customer");
assert(splitParams.customer_email == null, "Start trial does not create a customer for the new email");
assert(splitTrial.kind === "checkout" && splitTrial.includeTrial === false, "a prior subscription is not a second trial");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const FIRM_B = "44444444-4444-4444-8444-444444444444";
const firmBSub = {
  id: "sub_b",
  status: "active",
  customer: "cus_b",
  metadata: { milon_plan: "starter", milon_user_id: USER_B, firm_id: FIRM_B },
  items: { data: [{ price: { lookup_key: "milon_starter_monthly" } }] },
};
assert(
  customerIdFromMetadataSubscriptions([firmBSub], { userId: USER_A, firmId: FIRM_B }) === undefined,
  "firm A's user does not take a subscription tagged for firm B's owner",
);
const crossFirmStripe: StripeCustomerSubscriptionReader = {
  customers: {
    list: async () => ({ data: [{ id: "cus_a" }] }),
    retrieve: async () => ({
      id: "cus_b",
      email: "b@example.com",
      metadata: { milon_user_id: USER_B, firm_id: FIRM_B },
    }),
  },
  subscriptions: {
    list: async () => ({ data: [] }),
    search: async () => ({ data: [firmBSub] }),
  },
};
assert(
  (await findFirmCustomerId(crossFirmStripe, {
    email: "a@example.com",
    userId: USER_A,
    firmId: FIRM_B,
    storedCustomerId: "cus_b",
  })) === "cus_a",
  "firm A's user cannot resolve firm B's customer",
);

let storedListCalls = 0;
let storedSearchCalls = 0;
let storedUpdateCalls = 0;
const storedIdStripe: StripeCustomerSubscriptionReader = {
  customers: {
    list: async () => {
      storedListCalls += 1;
      return { data: [] };
    },
    retrieve: async () => ({
      id: "cus_stored",
      email: "team@trymilon.co.za",
      metadata: { milon_user_id: BEN_OWNER, firm_id: BEN_FIRM },
    }),
    update: async () => {
      storedUpdateCalls += 1;
      return {};
    },
  } as StripeCustomerSubscriptionReader["customers"],
  subscriptions: {
    list: async () => ({ data: [] }),
    search: async () => {
      storedSearchCalls += 1;
      return { data: [] };
    },
  },
};
const emailDiffWarnings: string[] = [];
const warnBefore = console.warn;
console.warn = (...args: unknown[]) => {
  emailDiffWarnings.push(
    args
      .map((part) => (part && typeof part === "object" ? JSON.stringify(part) : String(part)))
      .join(" "),
  );
};
let storedHit = "";
try {
  storedHit =
    (await findFirmCustomerId(storedIdStripe, {
      email: "team@trymilon.com",
      userId: BEN_OWNER,
      firmId: BEN_FIRM,
      storedCustomerId: "cus_stored",
    })) ?? "";
  await findFirmCustomerId(storedIdStripe, {
    email: "team@trymilon.com",
    userId: BEN_OWNER,
    firmId: BEN_FIRM,
    storedCustomerId: "cus_stored",
  });
} finally {
  console.warn = warnBefore;
}
assert(storedHit === "cus_stored", "a stored customer id beats an email miss");
assert(storedListCalls === 2, "an id hit still compares the email customer");
assert(storedSearchCalls === 0, "an id hit does not search when the stored customer is present");
assert(storedUpdateCalls === 0, "an email mismatch does not update Stripe");
const emailDiffLine = emailDiffWarnings.find((line) => line.includes("leaving Stripe unchanged"));
assert(Boolean(emailDiffLine), "an email mismatch is logged and Stripe is left unchanged");
assert(emailDiffLine!.includes(BEN_FIRM), "the email-diff log names the firm");
assert(
  emailDiffLine!.includes("signed_in_email_differs"),
  "the email-diff log uses a fixed reason",
);
assert(!emailDiffLine!.includes("@"), "the email-diff log contains no email address");
assert(!emailDiffLine!.includes("cus_stored"), "the email-diff log drops the Stripe customer id");
assert(
  emailDiffWarnings.filter((line) => line.includes("leaving Stripe unchanged")).length === 1,
  "the email-diff log fires once per firm",
);

const customerOnly: StripeCustomerSubscriptionReader = {
  customers: {
    list: async () => ({ data: [] }),
    search: async () => ({
      data: [
        {
          id: "cus_meta",
          email: "team@trymilon.co.za",
          metadata: { milon_user_id: BEN_OWNER, firm_id: BEN_FIRM },
        },
      ],
    }),
  },
  subscriptions: {
    list: async () => ({ data: [] }),
    search: async () => ({ data: [] }),
  },
};
assert(
  (await findFirmCustomerId(customerOnly, {
    email: "team@trymilon.com",
    userId: BEN_OWNER,
    firmId: BEN_FIRM,
  })) === "cus_meta",
  "customer metadata finds the firm when the subscription search is empty",
);

const metadataWrite = metadataFirmCustomerStore({
  firmId: BEN_FIRM,
  customerId: "cus_meta",
  storedCustomerId: null,
  metadataFirmId: BEN_FIRM,
  metadataUserId: BEN_OWNER,
  lookupUserId: BEN_OWNER,
  status: "active",
  ownerPlan: false,
});
assert(
  metadataWrite.customerId === "cus_meta" && metadataWrite.plan === "entitled",
  "a metadata hit writes the customer id and entitled",
);
const metadataKept = metadataFirmCustomerStore({
  firmId: BEN_FIRM,
  customerId: "cus_meta",
  storedCustomerId: "cus_kept",
  metadataFirmId: BEN_FIRM,
  metadataUserId: BEN_OWNER,
  lookupUserId: BEN_OWNER,
  status: "trialing",
  ownerPlan: false,
});
assert(metadataKept.customerId === null, "a different stored customer id is not overwritten");
assert(metadataKept.plan === "entitled", "a metadata hit still stores the entitled plan");
assert(
  metadataFirmCustomerStore({
    firmId: BEN_FIRM,
    customerId: "cus_other",
    storedCustomerId: null,
    metadataFirmId: "44444444-4444-4444-8444-444444444444",
    metadataUserId: "22222222-2222-4222-8222-222222222222",
    lookupUserId: BEN_OWNER,
    status: "active",
    ownerPlan: false,
  }).plan === null,
  "a cross-firm metadata hit does not write",
);
assert(
  metadataFirmCustomerStore({
    firmId: BEN_FIRM,
    customerId: "cus_meta",
    storedCustomerId: null,
    metadataFirmId: BEN_FIRM,
    metadataUserId: BEN_OWNER,
    lookupUserId: BEN_OWNER,
    status: "canceled",
    ownerPlan: false,
  }).plan === null,
  "a canceled subscription does not store entitled",
);

const metadataWrites: Array<{ customerId: string | null; plan: "entitled" | null }> = [];
setMetadataFirmCustomerWriteListener((decision) => {
  metadataWrites.push(decision);
});
const subscriptionHit: StripeCustomerSubscriptionReader = {
  customers: {
    list: async () => ({ data: [] }),
    search: async () => ({ data: [] }),
  },
  subscriptions: {
    list: async () => ({ data: [] }),
    search: async () => ({
      data: [
        {
          id: "sub_ben",
          status: "active",
          customer: "cus_meta",
          metadata: {
            milon_plan: "starter",
            milon_user_id: BEN_OWNER,
            firm_id: BEN_FIRM,
          },
        },
      ],
    }),
  },
};
try {
  assert(
    (await findFirmCustomerId(subscriptionHit, {
      email: "team@trymilon.com",
      userId: BEN_OWNER,
      firmId: BEN_FIRM,
    })) === "cus_meta",
    "subscription metadata resolves the firm customer",
  );
  assert(
    metadataWrites.length === 1 &&
      metadataWrites[0]?.customerId === "cus_meta" &&
      metadataWrites[0]?.plan === "entitled",
    "a metadata hit writes the customer id and the entitled plan",
  );
  metadataWrites.length = 0;
  const emailOnly: StripeCustomerSubscriptionReader = {
    customers: {
      list: async () => ({ data: [{ id: "cus_email" }] }),
      search: () => new Promise(() => {}),
    },
    subscriptions: {
      list: async () => ({ data: [] }),
      search: () => new Promise(() => {}),
    },
  };
  assert(
    (await findFirmCustomerId(emailOnly, {
      email: "team@trymilon.com",
      userId: BEN_OWNER,
      firmId: BEN_FIRM,
    })) === "cus_email",
    "an email hit still resolves",
  );
  assert(metadataWrites.length === 0, "an email-only match does not write the firm customer");
  metadataWrites.length = 0;
  const keptStripe: StripeCustomerSubscriptionReader = {
    customers: {
      list: async () => ({ data: [] }),
      retrieve: async () => ({
        id: "cus_kept",
        email: "team@trymilon.co.za",
        metadata: { milon_user_id: BEN_OWNER, firm_id: BEN_FIRM },
      }),
      search: async () => ({
        data: [{ id: "cus_meta", metadata: { firm_id: BEN_FIRM, milon_user_id: BEN_OWNER } }],
      }),
    },
    subscriptions: {
      list: async () => ({ data: [] }),
      search: async () => ({
        data: [
          {
            id: "sub_ben",
            status: "active",
            customer: "cus_meta",
            metadata: { milon_plan: "starter", milon_user_id: BEN_OWNER, firm_id: BEN_FIRM },
          },
        ],
      }),
    },
  };
  assert(
    (await findFirmCustomerId(keptStripe, {
      email: "team@trymilon.com",
      userId: BEN_OWNER,
      firmId: BEN_FIRM,
      storedCustomerId: "cus_kept",
    })) === "cus_kept",
    "a stored customer id still wins",
  );
  assert(metadataWrites.length === 0, "a different stored customer id is not overwritten");
} finally {
  setMetadataFirmCustomerWriteListener(null);
}

assert(FIRM_CUSTOMER_SEARCH_BUDGET_MS === 4_000, "metadata search shares a 4s budget");
assert(FIRM_CUSTOMER_SEARCH_BUDGET_MS < 5_000, "the search budget is inside a 5s entitlement check");

let emailHitSearches = 0;
let emailListOptions: { maxNetworkRetries?: number; timeout?: number } | undefined;
const emailHitHang: StripeCustomerSubscriptionReader = {
  customers: {
    list: async (_params, options) => {
      emailListOptions = options;
      return { data: [{ id: "cus_email" }] };
    },
    search: () => {
      emailHitSearches += 1;
      return new Promise(() => {});
    },
  },
  subscriptions: {
    list: async () => ({ data: [] }),
    search: () => {
      emailHitSearches += 1;
      return new Promise(() => {});
    },
  },
};
const emailHitStarted = Date.now();
const emailHit = await Promise.race([
  findFirmCustomerId(emailHitHang, {
    email: "team@trymilon.com",
    userId: BEN_OWNER,
    firmId: BEN_FIRM,
  }),
  new Promise<string>((_resolve, reject) => {
    setTimeout(() => reject(new Error("email hit waited on search")), 5_000);
  }),
]);
assert(emailHit === "cus_email", "an email hit resolves without metadata search");
assert(emailHitSearches === 0, "the email-hit path makes no search calls");
assert(Date.now() - emailHitStarted < 5_000, "an email hit finishes within 5s");
assert(emailListOptions?.maxNetworkRetries === 0, "the email list does not ask Stripe to retry");
assert(
  typeof emailListOptions?.timeout === "number" &&
    emailListOptions.timeout <= FIRM_CUSTOMER_SEARCH_BUDGET_MS,
  "the email list timeout stays inside the shared budget",
);

let missSearchOptions: { maxNetworkRetries?: number; timeout?: number } | undefined;
let missSearches = 0;
const missHang: StripeCustomerSubscriptionReader = {
  customers: {
    list: async () => ({ data: [] }),
    search: (_params, options) => {
      missSearches += 1;
      missSearchOptions = options;
      return new Promise(() => {});
    },
  },
  subscriptions: {
    list: async () => ({ data: [] }),
    search: (_params, options) => {
      missSearches += 1;
      missSearchOptions = options;
      return new Promise(() => {});
    },
  },
};
const missStarted = Date.now();
let missUnknown: unknown;
try {
  await Promise.race([
    findFirmCustomerId(missHang, {
      email: "team@trymilon.com",
      userId: BEN_OWNER,
      firmId: BEN_FIRM,
    }),
    new Promise<string>((_resolve, reject) => {
      setTimeout(() => reject(new Error("hung metadata search exceeded 5s")), 5_000);
    }),
  ]);
} catch (err) {
  missUnknown = err;
}
const missElapsed = Date.now() - missStarted;
assert(
  missUnknown instanceof FirmCustomerLookupUnknown && missUnknown.kind === "timeout",
  "a hung metadata search is unknown, not no customer",
);
assert(missElapsed < 5_000, "hung metadata searches give up within 5s");
assert(missSearches >= 1, "an email miss still searches");
const storedPlanOpen = entitlementForFailedCheck("entitled", "timeout");
assert(
  storedPlanOpen.entitled === true && storedPlanOpen.checkFailed === "timeout",
  "a stored entitled plan stays entitled when the check times out",
);
assert(
  firmFileOnBillingResult(storedPlanOpen) === "open",
  "a metadata search timeout with a stored plan keeps the client file open",
);
assert(
  missUnknown instanceof FirmCustomerLookupUnknown &&
    firmFileOnBillingResult(storedPlanOpen) === "open",
  "Ben's email miss and slow metadata search keep the file open when a stored plan exists",
);
assert(
  entitlementForFailedCheck(null, "timeout").reason !== "no_active_subscription",
  "a lookup timeout is not an unpaid firm",
);
const completedEmpty: StripeCustomerSubscriptionReader = {
  customers: {
    list: async () => ({ data: [] }),
    search: async () => ({ data: [] }),
  },
  subscriptions: {
    list: async () => ({ data: [] }),
    search: async () => ({ data: [] }),
  },
};
assert(
  (await findFirmCustomerId(completedEmpty, {
    email: "team@trymilon.com",
    userId: BEN_OWNER,
    firmId: BEN_FIRM,
  })) === undefined,
  "a completed email list and metadata search with zero results is no customer",
);
let listHangSearches = 0;
let listHangOptions: { maxNetworkRetries?: number; timeout?: number } | undefined;
const listHang: StripeCustomerSubscriptionReader = {
  customers: {
    list: (_params, options) => {
      listHangOptions = options;
      return new Promise(() => {});
    },
    search: () => {
      listHangSearches += 1;
      return new Promise(() => {});
    },
  },
  subscriptions: {
    list: async () => ({ data: [] }),
    search: () => {
      listHangSearches += 1;
      return new Promise(() => {});
    },
  },
};
const listHangStarted = Date.now();
let listHangUnknown: unknown;
try {
  await Promise.race([
    findFirmCustomerId(listHang, {
      email: "team@trymilon.com",
      userId: BEN_OWNER,
      firmId: BEN_FIRM,
    }),
    new Promise<string>((_resolve, reject) => {
      setTimeout(() => reject(new Error("hung email list exceeded 5s")), 5_000);
    }),
  ]);
} catch (err) {
  listHangUnknown = err;
}
assert(
  listHangUnknown instanceof FirmCustomerLookupUnknown && listHangUnknown.kind === "timeout",
  "a hung email list is unknown, not no customer",
);
assert(Date.now() - listHangStarted < 5_000, "a hung email list stays inside the shared deadline");
assert(listHangSearches === 0, "an email list timeout does not start a metadata search");
assert(listHangOptions?.maxNetworkRetries === 0, "the email list turns Stripe retries off");
assert(
  typeof listHangOptions?.timeout === "number" &&
    listHangOptions.timeout <= FIRM_CUSTOMER_SEARCH_BUDGET_MS,
  "the email list timeout is capped by the shared budget",
);
let sharedListTimeout = 0;
let sharedSearchTimeout = 0;
const sharedBudget: StripeCustomerSubscriptionReader = {
  customers: {
    list: (_params, options) =>
      new Promise((resolve) => {
        sharedListTimeout = options?.timeout ?? 0;
        setTimeout(() => resolve({ data: [] }), 300);
      }),
    search: async () => ({ data: [] }),
  },
  subscriptions: {
    list: async () => ({ data: [] }),
    search: (_params, options) => {
      sharedSearchTimeout = options?.timeout ?? 0;
      return Promise.resolve({ data: [] });
    },
  },
};
assert(
  (await findFirmCustomerId(sharedBudget, {
    email: "team@trymilon.com",
    userId: BEN_OWNER,
    firmId: BEN_FIRM,
  })) === undefined,
  "a slow completed email miss still counts as no customer when metadata is empty",
);
assert(sharedListTimeout <= FIRM_CUSTOMER_SEARCH_BUDGET_MS, "the email list starts inside the shared budget");
assert(
  sharedSearchTimeout > 0 && sharedSearchTimeout < sharedListTimeout,
  "metadata search is capped by the budget remaining after the email list",
);
assert(
  firmFileOnBillingResult({ entitled: false, reason: "no_active_subscription" }) === "closed",
  "a confirmed no active plan closes the client file",
);
assert(
  firmFileOnBillingResult({
    entitled: false,
    reason: "no_active_subscription",
    checkFailed: "timeout",
  }) === "retry",
  "a failed check does not close the file on an unpaid echo",
);
assert(
  firmFileOnBillingResult(entitlementForFailedCheck("none", "timeout")) === "retry",
  "a timeout does not treat a stored none as a confirmed close",
);
assert(
  firmFileOnBillingResult(entitlementForFailedCheck(null, "network")) === "retry",
  "a failed check with no stored plan stays on retry",
);
assert(
  FIRM_BILLING_PLAN_FALLBACK_MS < SHELL_GATE_TIMEOUT_MS,
  "a stored plan answers before the shell gate closes the file",
);
assert(FIRM_CUSTOMER_SEARCH_BUDGET_MS === 4_000, "the metadata search budget stays 4s");
assert(missSearchOptions?.maxNetworkRetries === 0, "metadata search does not ask Stripe to retry");
assert(
  typeof missSearchOptions?.timeout === "number" &&
    missSearchOptions.timeout <= FIRM_CUSTOMER_SEARCH_BUDGET_MS,
  "metadata search timeout stays inside the shared budget",
);

assert(STORED_CUSTOMER_READ_BUDGET_MS <= 1_000, "a stored customer id is not held on retrieve");
let storedHangSearches = 0;
const storedHang: StripeCustomerSubscriptionReader = {
  customers: {
    list: async () => ({ data: [{ id: "cus_email" }] }),
    retrieve: () => new Promise(() => {}),
    search: () => {
      storedHangSearches += 1;
      return new Promise(() => {});
    },
  },
  subscriptions: {
    list: async () => ({ data: [] }),
    search: () => {
      storedHangSearches += 1;
      return new Promise(() => {});
    },
  },
};
const storedHangStarted = Date.now();
const storedHangHit = await Promise.race([
  findFirmCustomerId(storedHang, {
    email: "team@trymilon.com",
    userId: BEN_OWNER,
    firmId: BEN_FIRM,
    storedCustomerId: "cus_stored",
  }),
  new Promise<string>((_resolve, reject) => {
    setTimeout(() => reject(new Error("stored id waited on retrieve")), 5_000);
  }),
]);
const storedHangElapsed = Date.now() - storedHangStarted;
assert(storedHangHit === "cus_stored", "a hanging retrieve still returns the stored customer id");
assert(storedHangSearches === 0, "a stored id does not search when retrieve hangs");
assert(storedHangElapsed < 5_000, "a stored id resolves within 5s when retrieve hangs");
let storedErrorSearches = 0;
const storedError: StripeCustomerSubscriptionReader = {
  customers: {
    list: async () => ({ data: [] }),
    retrieve: async () => {
      throw new Error("stripe down");
    },
    search: () => {
      storedErrorSearches += 1;
      return new Promise(() => {});
    },
  },
  subscriptions: {
    list: async () => ({ data: [] }),
    search: () => {
      storedErrorSearches += 1;
      return new Promise(() => {});
    },
  },
};
assert(
  (await findFirmCustomerId(storedError, {
    email: "team@trymilon.com",
    userId: BEN_OWNER,
    firmId: BEN_FIRM,
    storedCustomerId: "cus_stored",
  })) === "cus_stored",
  "a Stripe error on retrieve keeps the stored customer id",
);
assert(storedErrorSearches === 0, "a retrieve error does not start a metadata search");
assert(
  customerIdFromMetadataCustomers(
    [{ id: "cus_meta", metadata: { firm_id: BEN_FIRM, milon_user_id: BEN_OWNER } }],
    { userId: BEN_OWNER, firmId: BEN_FIRM },
  ) === "cus_meta",
  "customer metadata yields its customer id",
);
const ownerSub = {
  id: "sub_owner",
  status: "active",
  customer: "cus_owner",
  metadata: { milon_plan: "owner", milon_user_id: BEN_OWNER },
};
assert(
  customerIdFromMetadataSubscriptions([starterSub, ownerSub], {
    userId: BEN_OWNER,
    preferOwnerPlan: true,
  }) === "cus_owner",
  "owner Checkout prefers the Spark subscription on the same user id",
);
assert(
  (await customerHasEntitlingSubscription(
    mockStripe({ customerId: "cus_1", statuses: ["trialing"] }),
    "cus_1",
  )) === true,
  "trialing subscription → entitled",
);
assert(
  (await customerHasEntitlingSubscription(
    mockStripe({ customerId: "cus_1", statuses: ["incomplete"] }),
    "cus_1",
  )) === false,
  "incomplete subscription → not entitled",
);

function ownerPriceSub(lookup: string) {
  return {
    id: "sub_owner",
    status: "active",
    items: {
      data: [
        {
          price: {
            lookup_key: lookup,
            product: { metadata: { plan: "owner" } },
          },
        },
      ],
    },
  };
}

assert(
  (await customerHasEntitlingSubscription(
    mockStripe({
      subscriptions: [ownerPriceSub("milon_za_owner_monthly")],
    }),
    "cus_owner",
  )) === false,
  "the ZA owner price does not entitle the firm product",
);
assert(
  (await customerHasEntitlingSubscription(
    mockStripe({
      subscriptions: [ownerPriceSub("milon_owner_monthly")],
    }),
    "cus_owner",
  )) === false,
  "the USD owner price does not entitle the firm product",
);
assert(
  (await customerHasEntitlingSubscription(
    mockStripe({
      subscriptions: [
        {
          id: "sub_plan",
          status: "active",
          items: {
            data: [{ price: { product: { metadata: { plan: "owner" } } } }],
          },
        },
      ],
    }),
    "cus_owner",
  )) === false,
  "product metadata plan=owner does not entitle the firm product",
);
assert(
  (await customerHasEntitlingSubscription(
    mockStripe({
      subscriptions: [
        ownerPriceSub("milon_owner_monthly"),
        {
          id: "sub_solo",
          status: "active",
          items: { data: [{ price: { lookup_key: "milon_solo_monthly" } }] },
        },
      ],
    }),
    "cus_both",
  )) === true,
  "a firm band still entitles when the customer also has the owner price",
);

const landing = readFileSync(resolve("src/routes/index.tsx"), "utf8");
assert(
  landing.includes("getFirmBillingEntitlement") === false,
  "landing does not Stripe-gate itself",
);
assert(
  landing.includes("promptSignInToFinishFirmBilling"),
  "firm already-registered opens billing sign-in",
);
assert(landing.includes("FIRM_BILLING_SIGNIN_MESSAGE"), "firm already-registered copy is shared");
assert(
  landing.includes("signupLooksAlreadyRegistered"),
  "handles thrown User already registered and empty identities",
);
assert(
  landing.includes("stashResumeFirmBilling"),
  "already-registered firm signup stamps billing resume",
);
assert(
  landing.includes("consumeResumeFirmBilling"),
  "landing sign-in consumes the billing-resume flag",
);
assert(
  landing.includes("decidePostLoginBillingResume"),
  "post-login can send unpaid firm owners to billing",
);
const signedInLanding = landing.slice(
  landing.indexOf("redirect if already signed in"),
  landing.indexOf("Landing theme"),
);
assert(
  !signedInLanding.includes('to: "/billing/start"'),
  "a signed-in visit to / does not auto-start Checkout",
);
assert(signedInLanding.includes('hash === "pricing"'), "pricing hash stays on the landing");
const goToFirm = landing.slice(
  landing.indexOf("const goToFirmSignup"),
  landing.indexOf("const goToOwnerSpark"),
);
assert(goToFirm.includes("if (user)"), "signed-in Create firm CTA checks the session");
assert(goToFirm.includes("readInsightSeen"), "signed-in Create firm waits for an insight");
assert(goToFirm.includes('to: "/dashboard"'), "before an insight the CTA opens the practice");
assert(
  goToFirm.includes('to: "/billing/start"'),
  "after an insight the CTA can still open Checkout",
);

const firmRegister = landing.slice(
  landing.indexOf("Firm signup (accountant / advisory)"),
  landing.indexOf("Standard owner signup"),
);
assert(
  firmRegister.includes("promptSignInToFinishFirmBilling"),
  "firm register already-registered is not a dead-end toast",
);
assert(
  firmRegister.includes("stashPendingCheckout"),
  "firm register stashes pending checkout before signUp",
);
assert(
  !firmRegister.includes("That email already has a Milōn account — sign in instead."),
  "firm already-registered uses billing-resume copy",
);

const ownerRegister = landing.slice(
  landing.indexOf("Standard owner signup"),
  landing.indexOf("startFirmPlan"),
);
assert(
  ownerRegister.includes("promptSignInExistingAccount"),
  "owner already-registered still opens sign-in",
);
assert(
  ownerRegister.includes("OWNER_ALREADY_REGISTERED_MESSAGE") ||
    ownerRegister.includes("promptSignInExistingAccount"),
  "owner keeps the softer sign-in nudge",
);

const authPage = readFileSync(resolve("src/routes/auth.tsx"), "utf8");
assert(
  authPage.includes("signupLooksAlreadyRegistered"),
  "accountant /auth Create firm handles already-registered",
);
assert(
  authPage.includes("FIRM_BILLING_SIGNIN_MESSAGE"),
  "accountant /auth already-registered mentions finishing billing",
);
// Tab is URL-owned: already-registered must call openSignIn (clears ?signup=true).
// A leftover setMode("signin") would snap back to Create Firm while signup=true.
const authAlready = authPage.slice(
  authPage.indexOf(
    "if (signupLooksAlreadyRegistered({ errorMessage: error?.message, user: data?.user }))",
  ),
  authPage.indexOf("if (!data.session)"),
);
assert(
  authAlready.includes("openSignIn("),
  "accountant /auth switches to sign-in instead of check-your-email",
);
assert(
  !authAlready.includes("check your email"),
  "already-registered firm signup does not stop on check-your-email",
);
const authConfirm = authPage.slice(
  authPage.indexOf("if (!data.session)"),
  authPage.indexOf("if (data.user)"),
);
assert(
  authConfirm.includes("Account created — check your email to confirm before signing in."),
  "new firm signup without a session still asks to check email",
);
assert(
  !authConfirm.includes("openSignIn("),
  "new firm signup does not switch to sign-in before email confirmation",
);
const authCatch = authPage.slice(
  authPage.indexOf('if (mode === "signup" && signupLooksAlreadyRegistered({ errorMessage: msg }))'),
  authPage.indexOf("toast.error(msg)"),
);
assert(
  authCatch.includes("openSignIn("),
  "thrown already-registered on /auth also switches to sign-in",
);

const layout = readFileSync(resolve("src/routes/_authenticated.tsx"), "utf8");
const gate = readFileSync(resolve("src/routes/_authenticated.gate.tsx"), "utf8");
const shell = `${layout}\n${gate}`;
assert(layout.includes("codeSplitGroupings: []"), "auth shell is not a split chunk");
assert(
  layout.includes('import("./_authenticated.gate")'),
  "auth gate loads after the shell hydrates",
);
assert(gate.includes("getFirmBillingEntitlement"), "authenticated shell calls the Stripe gate");
assert(gate.includes("isFirmProductPath"), "authenticated shell gates firm product paths");
assert(gate.includes("/billing/required"), "unpaid firms redirect to billing required");
assert(gate.includes("firmBillingResumeIntent"), "shell builds the wall from the firm market");
assert(
  !shell.includes("firmSignupCheckoutIntent"),
  "shell does not default an existing firm to a US signup intent",
);
assert(
  layout.includes("pendingComponent: FirmShellLoading"),
  "auth shell pending paint matches SSR",
);
assert(gate.includes("loadFirmClientGateContext"), "shell loads the first-client count");
assert(gate.includes("firmClientCount"), "shell passes the first-client count into the gate");
assert(
  gate.includes("clients.firmClientCount === 0 ? false : readInsightSeen(firmId)"),
  "shell treats a 0-client firm as not yet seen",
);
assert(
  !gate.includes('to: "/app"') || gate.includes("shouldStayOnAccountantPortal"),
  "SME bounce to /app remains",
);

const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(!appSrc.includes("getFirmBillingEntitlement"), "owner /app is not Stripe-gated");
assert(appSrc.includes("shouldBounceFromOwnerApp"), "owner bounce helper still used");

const required = readFileSync(resolve("src/routes/billing.required.tsx"), "utf8");
assert(required.includes("Continue on"), "required page is Checkout after the figures");
assert(
  required.includes("firmWallWhyLine"),
  "required page explains why the first client stays open",
);
assert(
  required.includes("FIRM_WALL_START_LABEL"),
  "required page offers the trial once the billing read settles",
);
assert(!required.includes('href="/#pricing"'), "the accountant wall does not link back to pricing");
assert(required.includes("FIRM_WALL_BACK_HREF"), "back leaves for the client list");
assert(!required.includes('to="/"'), "back to pricing does not link at /");
assert(required.includes("BillingSignOutButton"), "billing wall can sign out");
assert(required.includes('createFileRoute("/billing/required")'), "required route");
assert(required.includes("readFirmBillingQuote"), "wall price comes from the firm quote");
assert(required.includes("billingIntentForResolvedMarket"), "wall checkout ignores the URL market");
assert(required.includes('quote?.market === "us"'), "USD copy is only shown for a US firm quote");

const start = readFileSync(resolve("src/routes/billing.start.tsx"), "utf8");
assert(start.includes("createStripeCheckout"), "billing start still creates Checkout");
assert(start.includes("BillingSignOutButton"), "billing start can sign out");
const signOut = readFileSync(resolve("src/components/billing-sign-out.tsx"), "utf8");
assert(signOut.includes("Sign out"), "sign out label is visible");
assert(
  start.includes("readFirmBillingQuote"),
  "billing start loads the firm quote, not the URL market",
);
assert(
  start.includes("readSaPricingCopy"),
  "billing start loads the pre-auth owner line from the server chunk",
);
assert(
  !start.includes("R299") && !start.includes("R799"),
  "billing start source has no rand literals",
);
assert(
  start.includes("user ? quote : null"),
  "a signed-in firm price comes from the firm quote, not visitor geo",
);
assert(!start.includes("adaptivePricingNote"), "billing start does not mention adaptive pricing");
assert(
  !start.includes("South African firms may be charged in ZAR via Adaptive Pricing."),
  "US interstitial does not hard-code the SA line",
);
assert(start.includes('href="/#pricing"'), "billing start error returns to pricing");

const success = readFileSync(resolve("src/routes/billing.success.tsx"), "utf8");
assert(
  success.includes("checkoutSessionUnlocksFirm"),
  "success treats completed trial Checkout as unlock",
);
assert(success.includes('to="/dashboard"'), "success opens the practice portal");
assert(success.includes("refresh: true"), "success warms entitlement cache");

const cancel = readFileSync(resolve("src/routes/billing.cancel.tsx"), "utf8");
assert(cancel.includes("Resume Checkout"), "cancel does not strand the firm");
assert(cancel.includes("/billing/required"), "cancel points at the billing-required page");

const fns = readFileSync(resolve("src/lib/stripe-checkout.functions.ts"), "utf8");
assert(fns.includes("getFirmBillingEntitlement"), "entitlement server fn");
assert(fns.includes("createStripeCheckout"), "checkout create stays ungated");
assert(fns.includes("createBillingPortalSession"), "portal start stays ungated");
assert(fns.includes("customerHasEntitlingSubscription"), "checkout reuses entitling statuses");

const docs = readFileSync(resolve("docs/STRIPE_FIRM_BANDS.md"), "utf8");
assert(docs.includes("Accountant product gate"), "docs name the gate");
assert(docs.includes("active") && docs.includes("trialing"), "docs list entitling statuses");
assert(docs.includes("/billing/required"), "docs name the resume page");
assert(docs.includes("Owner Spark"), "docs keep Spark ungated");

assert(existsSync(resolve("src/routes/billing.required.tsx")), "billing required route file");

const solo = { plan: "solo" as const, interval: "month" as const, market: "us" as const };
const stashed = decideAccountantAuthLanding({
  flow: "signin",
  hadFirmBefore: true,
  hasLiveEntitlement: true,
  pending: solo,
  next: undefined,
});
assert(stashed.kind === "app", "plain sign-in with a firm ignores a stashed Create firm plan");
const billingNext = decideAccountantAuthLanding({
  flow: "signin",
  hadFirmBefore: true,
  hasLiveEntitlement: false,
  pending: solo,
  next: "/billing/start?plan=solo&interval=month&market=us",
});
assert(
  billingNext.kind === "app",
  "an existing firm is not sent to Stripe even if next is billing start",
);
const subscribed = decideAccountantAuthLanding({
  flow: "signin",
  hadFirmBefore: false,
  hasLiveEntitlement: true,
  pending: solo,
  next: "/billing/start?plan=solo&interval=month&market=us",
});
assert(subscribed.kind === "app", "a live subscription is not sent to Checkout or the portal");
const freshSignup = decideAccountantAuthLanding({
  flow: "signup",
  hadFirmBefore: false,
  hasLiveEntitlement: false,
  pending: solo,
  next: undefined,
});
assert(
  freshSignup.kind === "workspace",
  "Create firm signup opens the workspace; Checkout waits for an insight",
);
const staleSignup = decideAccountantAuthLanding({
  flow: "signup",
  hadFirmBefore: false,
  hasLiveEntitlement: false,
  pending: solo,
  next: "/billing/start?plan=solo&interval=month&market=us",
  insightSeen: true,
});
assert(staleSignup.kind === "workspace", "a new firm signup ignores a stored insight flag");
const earlyResume = decideAccountantAuthLanding({
  flow: "signin",
  hadFirmBefore: false,
  hasLiveEntitlement: false,
  pending: null,
  next: "/billing/start?plan=solo&interval=month&market=us",
});
assert(earlyResume.kind === "workspace", "before an insight, a billing next opens the practice");
const resume = decideAccountantAuthLanding({
  flow: "signin",
  hadFirmBefore: false,
  hasLiveEntitlement: false,
  pending: null,
  next: "/billing/start?plan=solo&interval=month&market=us",
  insightSeen: true,
});
assert(
  resume.kind === "billing" && resume.pending.plan === "solo",
  "after an insight, sign-in to finish billing still opens Solo Checkout",
);
assert(safeAccountantRedirect("/dashboard") === "/dashboard", "dashboard next is safe");
assert(
  safeAccountantRedirect("/billing/start?plan=solo") === null,
  "billing next is not a safe sign-in redirect",
);
assert(
  safeAccountantRedirect("https://billing.stripe.com/p/session") === null,
  "Stripe portal URL is rejected",
);
assert(
  safeAccountantRedirect("//billing.stripe.com") === null,
  "protocol-relative redirect is rejected",
);

assert(authPage.includes("clearPendingCheckout"), "plain sign-in clears a stashed plan");
assert(
  authPage.includes("decideAccountantAuthLanding"),
  "auth landing uses the plan-intent decision",
);
assert(
  authPage.includes('landAfterAccountantAuth(signInData.user.id, "signin")'),
  "password sign-in does not reuse the Create firm landing",
);

const ownerFns = readFileSync(resolve("src/lib/stripe-checkout.functions.ts"), "utf8");
assert(
  ownerFns.includes("export const startOwnerCheckout"),
  "owner Checkout is a signed-in server function",
);
assert(
  ownerFns.includes("export const getOwnerEntitlement"),
  "owner entitlement helper is exported for the plan UI",
);
assert(ownerFns.includes("requireSupabaseAuth"), "owner Checkout requires a signed-in user");
const ownerWebhook = readFileSync(resolve("src/routes/api/stripe/webhook.ts"), "utf8");
assert(
  ownerWebhook.includes("ownerBillingEventSignal"),
  "webhook separates owner events from firm bands",
);
assert(
  ownerWebhook.includes("customer.subscription.deleted"),
  "owner cancellation is a webhook event",
);
const ownerMigration = readFileSync(
  resolve("supabase/migrations/20261013140000_owner_subscriptions.sql"),
  "utf8",
);
assert(ownerMigration.includes("enable row level security"), "owner entitlement table enables RLS");
assert(ownerMigration.includes("owner_subscriptions read own"), "the owner can read their own row");
assert(ownerMigration.includes("user_id = auth.uid()"), "the read policy is the signed-in owner");
assert(
  ownerMigration.includes("grant select on table public.owner_subscriptions to authenticated"),
  "authenticated can select",
);
assert(
  !/for insert/i.test(ownerMigration) &&
    !/for update/i.test(ownerMigration) &&
    !/for delete/i.test(ownerMigration),
  "writes are not granted by an owner policy",
);
assert(ownerMigration.includes("service_role"), "service role can write the entitlement");
assert(
  ownerMigration.includes("source in ('stripe', 'firm')"),
  "entitlement source is stripe or firm",
);

const linkGuard = readFileSync(
  resolve("supabase/migrations/20261013150000_owner_firm_link_guard.sql"),
  "utf8",
);
assert(
  linkGuard.includes("clients.firm_id cannot be set by the owner"),
  "an owner who sets firm_id is rejected",
);
assert(
  linkGuard.includes("AND firm_id IS NULL"),
  "owner insert cannot include a firm_id",
);
assert(
  linkGuard.includes("NEW.firm_id IS NULL AND OLD.firm_id IS NOT NULL"),
  "an owner may clear firm_id to leave the firm",
);
assert(linkGuard.includes("firm_link_accepted_at"), "acceptance is stored on the client");
assert(
  linkGuard.includes("CREATE OR REPLACE FUNCTION public.link_client_firm"),
  "invite and marketplace accept go through link_client_firm",
);
assert(
  linkGuard.includes("REVOKE ALL ON FUNCTION public.link_client_firm(uuid, uuid, uuid) FROM authenticated"),
  "signed-in users cannot execute link_client_firm",
);
assert(
  !/GRANT EXECUTE ON FUNCTION public\.link_client_firm\(uuid, uuid, uuid\) TO authenticated/.test(linkGuard),
  "link_client_firm is not granted to authenticated",
);
assert(
  linkGuard.includes("GRANT EXECUTE ON FUNCTION public.link_client_firm(uuid, uuid, uuid) TO service_role"),
  "service role can execute link_client_firm",
);
assert(
  linkGuard.includes("status IN ('open', 'accepted')"),
  "a signed-in caller needs an open or accepted firm request",
);
assert(
  linkGuard.includes("CREATE OR REPLACE FUNCTION public.link_own_client_to_firm"),
  "owners who are firm members use link_own_client_to_firm",
);
assert(
  linkGuard.includes("create_firm_client must not claim an existing client"),
  "create_firm_client cannot adopt an existing client",
);
assert(
  linkGuard.includes("firm_link_accepted_at,\n    firm_link_accepted_by"),
  "a firm-created client stamps acceptance",
);
assert(
  linkGuard.includes("PERFORM public.link_client_firm"),
  "marketplace accept links through the same function",
);
assert(
  linkGuard.includes("lower(email) = lower(trim(p_email))"),
  "webhook email match is exact and case-insensitive",
);
assert(!linkGuard.includes("ilike"), "the email lookup is not a LIKE pattern");

const inviteServer = readFileSync(resolve("src/lib/accountant-invite.server.ts"), "utf8");
assert(inviteServer.includes('rpc("link_client_firm"'), "accountant invite links through the RPC");
assert(
  !inviteServer.includes("firm_connected_at: new Date()"),
  "accountant invite does not write firm_id with the user client",
);
const dashboard = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");
assert(
  dashboard.includes('rpc(\n          "link_own_client_to_firm"'),
  "orphan clients attach through link_own_client_to_firm",
);
assert(!dashboard.includes('"link_client_firm"'), "the dashboard does not call link_client_firm");
assert(
  !dashboard.includes("firm_id: activeFirmId, firm_connected_at"),
  "the dashboard does not update clients.firm_id directly",
);
const linkLock = readFileSync(
  resolve("supabase/migrations/20261013160000_link_client_firm_execute_lock.sql"),
  "utf8",
);
assert(
  linkLock.includes("REVOKE ALL ON FUNCTION public.link_client_firm(uuid, uuid, uuid) FROM authenticated"),
  "already-applied databases revoke authenticated execute",
);
const linkSql = readFileSync(resolve("scripts/link-client-firm-guard-sql-tests.sql"), "utf8");
for (const name of [
  "cross_tenant_member_refused",
  "owner_self_link_refused",
  "invite_redeem_links",
  "marketplace_accept_links",
  "link_own_client_to_firm_owner_member",
  "create_firm_client_does_not_claim_existing",
]) {
  assert(linkSql.includes(name), `sql tests include ${name}`);
}
const disconnect = readFileSync(resolve("src/lib/practice-access.functions.ts"), "utf8");
assert(
  disconnect.includes("firm_link_accepted_at: null"),
  "leaving a firm clears the acceptance marker",
);
const ownerServer = readFileSync(resolve("src/lib/owner-billing.server.ts"), "utf8");
assert(ownerServer.includes("firmLinkCoversOwner"), "coverage requires an accepted firm link");
assert(ownerServer.includes('rpc("user_id_by_email"'), "webhook email fallback uses the exact match");
assert(!ownerServer.includes('.ilike("email"'), "webhook email fallback does not use ilike");
assert(
  !ownerServer.includes("findCustomerIdByEmail"),
  "owner billing does not look the customer up by email only",
);
assert(ownerServer.includes("findFirmCustomerId"), "owner billing uses the stable customer lookup");
assert(
  ownerServer.includes("installMetadataFirmCustomerWrite"),
  "owner billing installs the metadata customer write",
);
const entitlement = readFileSync(resolve("src/lib/stripe-entitlement.ts"), "utf8");
assert(!entitlement.includes("customers.update"), "entitlement lookup does not write Stripe");
assert(
  !entitlement.includes("firm-stripe-customer.server"),
  "the entitlement module does not import the service-role writer",
);
assert(
  entitlement.includes("metadataFirmCustomerStore"),
  "a subscription metadata hit decides the firm customer write",
);
assert(
  entitlement.includes("noteSubscriptionMetadataCustomer"),
  "only a subscription metadata hit stores the firm customer",
);
assert(
  !entitlement.includes("writeFirmStripeCustomerId"),
  "the entitlement module does not overwrite firms.stripe_customer_id itself",
);
const migration = readFileSync(
  resolve("supabase/migrations/20261020223000_firm_stripe_customer_id.sql"),
  "utf8",
);
assert(
  migration.includes("ADD COLUMN IF NOT EXISTS stripe_customer_id"),
  "migration adds firms.stripe_customer_id",
);
assert(!/UPDATE\s+public\.firms/i.test(migration), "migration does not backfill firm rows");
assert(migration.includes("authenticated"), "signed-in owners cannot set the customer id");
resetFirmStripeCustomerColumnProbe();
await readFirmStripeCustomerId(BEN_FIRM);
const probesAfterSelect = firmStripeCustomerColumnProbes();
assert(probesAfterSelect === 1, "the first check selects firms.stripe_customer_id");
assert(
  noteMissingFirmStripeCustomerColumn("column firms.stripe_customer_id does not exist"),
  "a missing stripe_customer_id column is recognized",
);
await readFirmStripeCustomerId(BEN_FIRM);
assert(
  firmStripeCustomerColumnProbes() === probesAfterSelect,
  "a missing firms.stripe_customer_id column is not selected again",
);
resetFirmStripeCustomerColumnProbe();
const billingSync = readFileSync(resolve("src/lib/stripe-billing-sync.server.ts"), "utf8");
assert(
  billingSync.includes("writeFirmStripeCustomerId"),
  "webhook success stores the firm customer id",
);
assert(
  fns.includes("writeFirmStripeCustomerId"),
  "checkout stores the firm customer id",
);
assert(fns.includes("firmStartTrialCheckout"), "Start trial reuses the resolved customer");
assert(fns.includes("firmBillingIdsForActor"), "a client firm id is checked against the signed-in user");
assert(!fns.includes("customerId: z."), "checkout does not take a customer id from the client");
const capServer = readFileSync(resolve("src/lib/firm-client-cap.server.ts"), "utf8");
assert(capServer.includes("installMetadataFirmCustomerWrite"), "subscription history installs the metadata customer write");
assert(capServer.includes("actorCanUseFirm"), "a named firm is used only when the user belongs to it");
assert(
  !capServer.includes("writeFirmStripeCustomerId"),
  "reading subscription history does not write firms.stripe_customer_id",
);
const planMigration = readFileSync(
  resolve("supabase/migrations/20261021040000_firm_billing_plan_known.sql"),
  "utf8",
);
assert(
  planMigration.includes("ADD COLUMN IF NOT EXISTS billing_plan_known"),
  "migration adds firms.billing_plan_known",
);
assert(!/UPDATE\s+public\.firms/i.test(planMigration), "the plan migration does not backfill firm rows");
const customerServer = readFileSync(resolve("src/lib/firm-stripe-customer.server.ts"), "utf8");
assert(
  customerServer.includes('.is("stripe_customer_id", null)'),
  "a metadata hit fills a null customer id and does not overwrite one",
);
assert(
  customerServer.includes("subscription metadata stored the firm plan"),
  "a metadata hit logs the firm plan write",
);
assert(
  planMigration.includes("IS DISTINCT FROM 'authenticated'"),
  "signed-in users cannot set the stored plan",
);
assert(fns.includes("installMetadataFirmCustomerWrite"), "checkout installs the metadata customer write");
assert(fns.includes("readFirmBillingPlanKnown"), "a slow check reads the stored firm plan");
assert(
  fns.includes("[stripe-entitlement] stored-plan refresh failed"),
  "a stored entitled plan returns before the Stripe list and catches the refresh",
);
assert(fns.includes("rememberConfirmedFirmPlan"), "a finished check stores the firm plan");
assert(fns.includes('writeFirmBillingPlanKnown(firmId, "none")'), "only a confirmed no-plan stores none");
const portalStart = fns.indexOf("export const createBillingPortalSession");
const portalEnd = fns.indexOf("export const getCheckoutSessionStatus");
assert(
  portalStart !== -1 &&
    portalEnd > portalStart &&
    fns.slice(portalStart, portalEnd).includes("writeFirmStripeCustomerId"),
  "opening the billing portal stores firms.stripe_customer_id",
);
const setupStart = billingSync.indexOf("export async function completeFirmSetupUpgrade");
const setupEnd = billingSync.indexOf("export async function", setupStart + 40);
assert(
  setupStart !== -1 &&
    setupEnd > setupStart &&
    billingSync.slice(setupStart, setupEnd).includes("writeFirmStripeCustomerId"),
  "setup Checkout stores firms.stripe_customer_id",
);
const rememberStart = billingSync.indexOf("async function rememberFirmStripeCustomer");
const rememberEnd = billingSync.indexOf("export async function syncFirmSubscriptionBand");
const rememberFn = billingSync.slice(rememberStart, rememberEnd);
assert(rememberFn.includes("writeFirmStripeCustomerId"), "subscription sync stores the firm customer id");
assert(rememberFn.includes("writeFirmBillingPlanKnown"), "an entitling subscription stores the firm plan");
assert(!rememberFn.includes('"none"'), "a subscription webhook does not store a confirmed no-plan");
assert(gate.includes("firmFileOnBillingResult"), "the gate opens a stored plan after a failed check");
assert(gate.includes('file === "open"'), "a failed check with a stored plan does not stay on Retry");

console.log("firm-billing-gate ok");
