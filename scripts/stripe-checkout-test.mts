/**
 * Public Stripe Checkout for Orbit / Constellation.
 * Run: pnpm test:stripe-checkout
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  billingStartPath,
  checkoutCallbackPath,
  checkoutEmailRedirectTo,
  isBillingStartPath,
  paidPlanFromRegisterLabel,
  parsePendingCheckout,
  parsePendingCheckoutFromSearch,
  pendingCheckoutFromNext,
  registerLabelForPlan,
} from "../src/lib/pending-checkout";
import { STRIPE_PLAN_CATALOG, STRIPE_SAAS_BUSINESS_TAX_CODE } from "../src/lib/stripe-plans";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(STRIPE_PLAN_CATALOG.orbit.us.unitAmount === 3_900, "US Orbit is $39");
assert(STRIPE_PLAN_CATALOG.orbit.za.unitAmount === 69_900, "ZA Orbit is R699");
assert(STRIPE_PLAN_CATALOG.constellation.us.unitAmount === 7_500, "US Constellation is $75");
assert(STRIPE_PLAN_CATALOG.constellation.za.unitAmount === 129_900, "ZA Constellation is R1299");

assert(
  parsePendingCheckout({ plan: "orbit", market: "us" })?.plan === "orbit",
  "parse orbit us",
);
assert(parsePendingCheckout({ plan: "spark", market: "us" }) === null, "spark is not a paid plan");
assert(
  parsePendingCheckoutFromSearch("?checkout=constellation&market=za")?.plan === "constellation",
  "checkout query alias",
);
assert(
  parsePendingCheckoutFromSearch("?plan=orbit")?.market === "us",
  "market defaults to US when omitted",
);
assert(billingStartPath({ plan: "orbit", market: "us" }) === "/billing/start?plan=orbit&market=us", "start path");
assert(
  checkoutCallbackPath({ plan: "orbit", market: "us" }) === "/auth/callback?checkout=orbit&market=us",
  "email confirm uses allowlisted callback",
);
assert(
  checkoutEmailRedirectTo("https://milonfinance.com/", { plan: "orbit", market: "za" }) ===
    "https://milonfinance.com/auth/callback?checkout=orbit&market=za",
  "email redirect strips trailing slash",
);
assert(
  checkoutEmailRedirectTo("https://milonfinance.com", { plan: "orbit", market: "us" }) ===
    "https://milonfinance.com/auth/callback?checkout=orbit&market=us",
  "email redirect matches the Google OAuth checkout hop",
);
assert(isBillingStartPath("/billing/start?plan=orbit&market=us"), "is billing start");
assert(!isBillingStartPath("/app"), "app is not billing start");
assert(
  pendingCheckoutFromNext("/billing/start?plan=orbit&market=za")?.market === "za",
  "next carries market",
);
assert(registerLabelForPlan("orbit") === "Orbit", "orbit label");
assert(paidPlanFromRegisterLabel("Orbit") === "orbit", "label back to plan");
assert(paidPlanFromRegisterLabel("Spark — Free early access") === null, "spark label is not paid");

const checkoutFn = readFileSync(resolve("src/lib/stripe-checkout.functions.ts"), "utf8");
assert(checkoutFn.includes("createStripeCheckout"), "public checkout export");
assert(checkoutFn.includes("createOwnerStripeCheckout = createStripeCheckout"), "ops alias kept");
assert(checkoutFn.includes("requireSupabaseAuth"), "checkout requires a signed-in user");
assert(!checkoutFn.includes("assertPlatformOwner"), "checkout is not owner-only");
assert(!checkoutFn.includes("payment_method_types"), "dynamic payment methods");
assert(checkoutFn.includes("subscription_data"), "plan metadata lands on the subscription");
assert(checkoutFn.includes("STRIPE_WEBHOOK_SECRET"), "webhook secret is documented as optional");
assert(
  /managed_payments:\s*\{\s*enabled:\s*false\s*\}/.test(checkoutFn),
  "session disables Managed Payments so Milon, Inc. stays merchant of record",
);
assert(
  checkoutFn.includes("tax_code: STRIPE_SAAS_BUSINESS_TAX_CODE"),
  "inline product_data sets a Stripe product tax code",
);
assert(
  STRIPE_SAAS_BUSINESS_TAX_CODE === "txcd_10103001",
  "tax_code is SaaS — business use from Stripe's canonical list",
);
assert(!checkoutFn.includes("automatic_tax"), "do not enable automatic_tax without a tax registration");
assert(checkoutFn.includes("integration_identifier"), "keep integration_identifier on session create");

const checkoutDocs = readFileSync(resolve("docs/STRIPE_CHECKOUT.md"), "utf8");
assert(checkoutDocs.includes("managed_payments"), "docs explain Managed Payments");
assert(checkoutDocs.includes("txcd_10103001"), "docs name the SaaS business tax code");
assert(checkoutDocs.includes("Milon, Inc."), "docs say Milon, Inc. is merchant of record");

const landing = readFileSync(resolve("src/routes/index.tsx"), "utf8");
assert(landing.includes("Start Orbit"), "landing Orbit CTA is a pay button");
assert(landing.includes("Start Constellation"), "landing Constellation CTA is a pay button");
assert(!landing.includes("Join waitlist"), "landing no longer waitlists paid plans");
assert(!landing.includes("billing is not live yet"), "landing no longer says billing is waitlist");
assert(landing.includes("startPaidPlan"), "landing paid CTAs share one checkout starter");
assert(landing.includes('option value="Orbit"'), "register can keep Orbit through signup");
assert(landing.includes("checkoutEmailRedirectTo"), "signup confirmation uses the allowlisted callback");
assert(landing.includes("register-error"), "register errors render in the form, not only as a toast");
assert(!landing.includes("${window.location.origin}${billingStartPath"), "signup does not emailRedirectTo /billing/start");

const landingCss = readFileSync(resolve("src/styles/landing.css"), "utf8");
assert(
  landingCss.includes("[data-milon-landing] section"),
  "landing section padding is scoped so it cannot restyle Sonner",
);
assert(
  !landingCss.includes('html[data-landing="1"] section{'),
  "unscoped landing section rule would tuck toasts under the nav",
);
assert(landingCss.includes("[data-sonner-toaster]"), "landing pins toaster above the page and below the header");
assert(landingCss.includes("scroll-margin-top:88px"), "register hash scroll clears the sticky nav");
assert(landingCss.includes(".reg-error"), "register form has an in-flow error banner");

const root = readFileSync(resolve("src/routes/__root.tsx"), "utf8");
assert(root.includes("zIndex: 70"), "root toaster sits above sticky marketing chrome");

const start = readFileSync(resolve("src/routes/billing.start.tsx"), "utf8");
assert(start.includes("createStripeCheckout"), "billing start creates a Checkout session");
assert(start.includes('to: "/"'), "unsigned visitors are sent to signup, not dropped on Spark");
assert(start.includes('role="alert"'), "checkout-start failure is an accessible alert");

const success = readFileSync(resolve("src/routes/billing.success.tsx"), "utf8");
assert(!success.includes("waitlist"), "success page is not waitlist copy");
assert(success.includes("subscription is active") || success.includes("Payment received"), "success tells the truth");
assert(success.includes('to="/app"'), "success returns to the workspace");

const cancel = readFileSync(resolve("src/routes/billing.cancel.tsx"), "utf8");
assert(!cancel.includes("Lighthouse"), "cancel is not a Lighthouse-only test page");
assert(cancel.includes("Nothing was charged"), "cancel says nothing was charged");

const callback = readFileSync(resolve("src/routes/auth_.callback.tsx"), "utf8");
assert(callback.includes("pendingCheckout"), "Google return resumes paid Checkout");
assert(
  callback.indexOf("pendingCheckout") < callback.indexOf("goOps"),
  "paid Checkout resume runs before generic /app landing",
);

assert(existsSync(resolve("src/routes/billing.start.tsx")), "billing start route exists");

console.log("stripe-checkout ok");
