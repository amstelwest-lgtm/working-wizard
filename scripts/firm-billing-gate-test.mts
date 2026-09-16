/**
 * Firm product is gated on an entitling Stripe subscription.
 * Run: pnpm test:firm-billing-gate
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkoutSessionUnlocksFirm,
  customerHasEntitlingSubscription,
  decideFirmBillingEntitlement,
  decideFirmBillingPathGate,
  decidePostLoginBillingResume,
  emailHasEntitlingSubscription,
  isBillingExemptPath,
  isFirmProductPath,
  isOpsPath,
  isOwnerSparkPath,
  subscriptionStatusEntitles,
  type StripeCustomerSubscriptionReader,
} from "../src/lib/stripe-entitlement";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(subscriptionStatusEntitles("active"), "active entitles");
assert(subscriptionStatusEntitles("trialing"), "trialing entitles (Starter / trials)");
assert(!subscriptionStatusEntitles("incomplete"), "incomplete does not entitle");
assert(!subscriptionStatusEntitles("past_due"), "past_due does not entitle");
assert(!subscriptionStatusEntitles("canceled"), "canceled does not entitle");
assert(!subscriptionStatusEntitles("unpaid"), "unpaid does not entitle");

assert(checkoutSessionUnlocksFirm({ status: "complete" }), "complete Checkout unlocks");
assert(checkoutSessionUnlocksFirm({ paymentStatus: "paid" }), "paid Checkout unlocks");
assert(
  checkoutSessionUnlocksFirm({ status: "complete", paymentStatus: "no_payment_required" }),
  "Starter $0 no_payment_required unlocks",
);
assert(
  !checkoutSessionUnlocksFirm({ status: "open", paymentStatus: "unpaid" }),
  "open unpaid does not unlock",
);

assert(isFirmProductPath("/dashboard"), "dashboard is firm product");
assert(isFirmProductPath("/clients/abc"), "client workspace is firm product");
assert(isFirmProductPath("/reports"), "reports is firm product");
assert(isFirmProductPath("/settings/team"), "team settings is firm product");
assert(isFirmProductPath("/settings/brand"), "brand settings is firm product");
assert(!isFirmProductPath("/settings"), "shared settings is not gated");
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
  "firm without sub → redirected",
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
}): StripeCustomerSubscriptionReader {
  return {
    customers: {
      list: async () => ({
        data: opts.customerId ? [{ id: opts.customerId }] : [],
      }),
    },
    subscriptions: {
      list: async ({ status }) => ({
        data: (opts.statuses ?? []).includes(status) ? [{ id: "sub_1", status }] : [],
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
const goToFirm = landing.slice(
  landing.indexOf("const goToFirmSignup"),
  landing.indexOf("const goToOwnerSpark"),
);
assert(goToFirm.includes("if (user)"), "signed-in Create firm CTA checks the session");
assert(
  goToFirm.includes('to: "/billing/start"'),
  "signed-in Create firm CTA short-circuits to billing start",
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
assert(
  authPage.includes('setMode("signin")'),
  "accountant /auth switches to sign-in instead of check-your-email",
);

const layout = readFileSync(resolve("src/routes/_authenticated.tsx"), "utf8");
assert(layout.includes("getFirmBillingEntitlement"), "authenticated shell calls the Stripe gate");
assert(layout.includes("isFirmProductPath"), "authenticated shell gates firm product paths");
assert(layout.includes("/billing/required"), "unpaid firms redirect to billing required");
assert(
  !layout.includes('to: "/app"') || layout.includes("shouldStayOnAccountantPortal"),
  "SME bounce to /app remains",
);

const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(!appSrc.includes("getFirmBillingEntitlement"), "owner /app is not Stripe-gated");
assert(appSrc.includes("shouldBounceFromOwnerApp"), "owner bounce helper still used");

const required = readFileSync(resolve("src/routes/billing.required.tsx"), "utf8");
assert(required.includes("Finish firm billing to open your practice"), "required page copy");
assert(required.includes("Resume Checkout"), "required page resumes Checkout");
assert(required.includes('createFileRoute("/billing/required")'), "required route");

const start = readFileSync(resolve("src/routes/billing.start.tsx"), "utf8");
assert(start.includes("createStripeCheckout"), "billing start still creates Checkout");

const success = readFileSync(resolve("src/routes/billing.success.tsx"), "utf8");
assert(success.includes("checkoutSessionUnlocksFirm"), "success treats Starter complete as unlock");
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

console.log("firm-billing-gate ok");
