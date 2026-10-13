/**
 * Firm product is gated on an entitling Stripe subscription.
 * Run: pnpm test:firm-billing-gate
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideAccountantAuthLanding, safeAccountantRedirect } from "../src/lib/auth-landing";
import {
  checkoutSessionUnlocksFirm,
  customerHasEntitlingSubscription,
  decideFirmBillingEntitlement,
  decideFirmBillingPathGate,
  decidePostLoginBillingResume,
  isFirstClientFiguresPath,
  emailHasEntitlingSubscription,
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
  required.includes("The figures stay."),
  "required page does not pretend the workspace never opened",
);
assert(required.includes("Resume Checkout"), "required page resumes Checkout");
assert(required.includes('href="/#pricing"'), "back to pricing shows pricing, not Checkout");
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
  !start.includes("readSaPricingCopy"),
  "billing start does not paint geo rand copy for a signed-in firm",
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

console.log("firm-billing-gate ok");
