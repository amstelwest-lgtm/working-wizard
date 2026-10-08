/**
 * Pre-card welcome landing and the settings allow-list.
 * Run: pnpm test:smart-landing
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideFirmBillingPathGate, isFirmProductPath } from "../src/lib/stripe-entitlement";
import {
  decideSmartLanding,
  firmWallBackLabel,
  isSafeSmartLandingHref,
  isSmartLandingNext,
  PRECARD_ONBOARDING_HREF,
  SMART_LANDING_PATH,
} from "../src/lib/smart-landing";
import { welcomeAppPath } from "../src/lib/welcome-email";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const blocked = {
  isAccountantFirmUser: true,
  isMilonItMember: false,
  entitled: false,
  insightSeen: true,
  firmClientCount: 1,
  firstClientId: "abc",
} as const;

assert(!isFirmProductPath("/settings/brand"), "brand is not behind the firm gate");
assert(!isFirmProductPath("/settings"), "account settings are not behind the firm gate");
assert(!isFirmProductPath(SMART_LANDING_PATH), "the landing route is not behind the firm gate");
assert(isFirmProductPath("/settings/team"), "team settings stay gated");
assert(isFirmProductPath("/dashboard"), "dashboard stays gated");
assert(isFirmProductPath("/reports"), "reports stay gated");

assert(
  decideFirmBillingPathGate({ ...blocked, pathname: "/settings/brand" }) === "allow",
  "pre-card firm can open brand",
);
assert(
  decideFirmBillingPathGate({ ...blocked, pathname: "/settings" }) === "allow",
  "pre-card firm can open account settings",
);
assert(
  decideFirmBillingPathGate({ ...blocked, pathname: "/dashboard" }) === "require_billing",
  "dashboard still requires a card after an insight",
);
assert(
  decideFirmBillingPathGate({ ...blocked, pathname: "/reports" }) === "require_billing",
  "reports still require a card after an insight",
);
assert(
  decideFirmBillingPathGate({ ...blocked, pathname: "/settings/team" }) === "require_billing",
  "team settings still require a card",
);
assert(
  decideFirmBillingPathGate({ ...blocked, pathname: "/clients/abc" }) === "allow",
  "the first client file stays open",
);

const client = decideSmartLanding({ signedIn: true, entitled: false, firstClientId: "abc" });
assert(client.kind === "client" && client.href === "/clients/abc" && client.clientId === "abc", "no card + client → that client");
assert(
  decideSmartLanding({ signedIn: true, entitled: false, firstClientId: "  abc  " }).href ===
    "/clients/abc",
  "client id is trimmed",
);

const onboard = decideSmartLanding({ signedIn: true, entitled: false, firstClientId: null });
assert(onboard.kind === "onboarding" && onboard.href === PRECARD_ONBOARDING_HREF, "no card + no client → add-client step");
assert(
  decideFirmBillingPathGate({
    pathname: "/dashboard",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 0,
  }) === "allow",
  "0-client /open destination stays open pre-card",
);
assert(
  decideFirmBillingPathGate({
    pathname: PRECARD_ONBOARDING_HREF,
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 0,
  }) === "allow",
  "/dashboard?addClient=1 stays open for a 0-client firm",
);
assert(
  decideFirmBillingPathGate({
    pathname: SMART_LANDING_PATH,
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 0,
  }) === "allow",
  "/open itself is not the billing wall for a 0-client firm",
);
assert(
  decideSmartLanding({ signedIn: true, entitled: false, firstClientId: " " }).kind === "onboarding",
  "blank client id is the add-client step",
);
assert(
  decideSmartLanding({ signedIn: true, entitled: false, firstClientId: "../dashboard" }).kind ===
    "onboarding",
  "a path-like client id is not a redirect",
);

const board = decideSmartLanding({ signedIn: true, entitled: true, firstClientId: "abc" });
assert(board.kind === "dashboard" && board.href === "/dashboard", "a card opens the practice dashboard");
assert(
  decideSmartLanding({ signedIn: true, entitled: true, firstClientId: null }).href === "/dashboard",
  "a card with no client still opens the dashboard",
);

const signedOut = decideSmartLanding({ signedIn: false, entitled: false, firstClientId: "abc" });
assert(
  signedOut.kind === "auth" && signedOut.href === `/auth?next=${SMART_LANDING_PATH}`,
  "signed-out opens sign-in and comes back",
);

for (const landing of [client, onboard, board, signedOut]) {
  assert(isSafeSmartLandingHref(landing.href), `href is an internal landing: ${landing.href}`);
  assert(!landing.href.startsWith("/billing"), "landing never opens the paywall");
}
assert(!isSafeSmartLandingHref("https://evil.example/open"), "external href is rejected");
assert(!isSafeSmartLandingHref("//evil.example"), "protocol-relative href is rejected");
assert(!isSafeSmartLandingHref("/clients/../dashboard"), "client traversal is rejected");

assert(isSmartLandingNext("/open"), "welcome next is the landing");
assert(isSmartLandingNext("/open?x=1"), "query on the landing still counts");
assert(!isSmartLandingNext("/dashboard"), "dashboard next is not the landing");
assert(!isSmartLandingNext("/billing/start"), "checkout next is not the landing");
assert(!isSmartLandingNext("//open"), "protocol-relative next is rejected");
assert(!isSmartLandingNext("https://evil.example/open"), "absolute next is rejected");

assert(firmWallBackLabel("Acme") === "Back to Acme", "wall names the open client");
assert(firmWallBackLabel("  Northwind  ") === "Back to Northwind", "wall trims the name");
assert(firmWallBackLabel("  ") === null, "blank name has no back label");
assert(firmWallBackLabel(null) === null, "missing name has no back label");

assert(welcomeAppPath("firm_owner") === SMART_LANDING_PATH, "firm welcome uses the landing");
assert(welcomeAppPath("business_owner") === "/app", "Spark welcome is unchanged");

const welcome = readFileSync(resolve("src/lib/welcome-email.ts"), "utf8");
assert(!welcome.includes('"/dashboard"'), "welcome helper does not hard-code the dashboard");
assert(welcome.includes("The MILŌN Team"), "welcome still signs The MILŌN Team");

const server = readFileSync(resolve("src/lib/welcome-email.server.ts"), "utf8");
assert(server.includes("welcomeAppPath"), "sender uses the welcome path helper");
assert(!server.includes("/dashboard"), "sender does not hard-code the dashboard");
assert(!/from:\s*[`'"]/.test(server), "sender does not hard-code a from address");

const openRoute = readFileSync(resolve("src/routes/open.tsx"), "utf8");
assert(openRoute.includes("resolveSmartLanding"), "landing asks the server where to go");
assert(openRoute.includes("isSafeSmartLandingHref"), "landing refuses an unexpected href");

const wall = readFileSync(resolve("src/routes/billing.required.tsx"), "utf8");
assert(wall.includes("firmWallBackLabel"), "wall offers a way back to the client");
assert(wall.includes("loadFirstFirmClient"), "wall looks up the open client");
assert(wall.includes("The firm dashboard and reports need a card."), "wall explains the firm dashboard");
assert(wall.includes("The figures stay."), "wall still says the figures stay");
assert(wall.includes("Resume Checkout"), "wall still resumes checkout");
assert(!/50%|discount/i.test(wall), "wall does not advertise a discount");

const auth = readFileSync(resolve("src/routes/auth.tsx"), "utf8");
assert(auth.includes("isSmartLandingNext(next)"), "sign-in returns to the landing");
const callback = readFileSync(resolve("src/routes/auth_.callback.tsx"), "utf8");
assert(callback.includes("isSmartLandingNext(next)"), "Google return honors the landing");

console.log("smart-landing-test: ok");
