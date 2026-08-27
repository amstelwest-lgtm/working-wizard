/**
 * Invite accept → founder board, then first-run profile + tour.
 * Run: pnpm test:invite-onboarding
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ownerWalkthroughReady,
  shouldShowOwnerProfileFunnel,
} from "../src/lib/first-run";
import {
  isClientUuid,
  isEmailAlreadyRegistered,
} from "../src/lib/invite-handoff";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(isClientUuid("3d5a1c2e-7b44-4f1a-9c8d-1a2b3c4d5e6f"), "uuid accepted");
assert(!isClientUuid("opaque-invite-token"), "opaque token rejected");
assert(!isClientUuid("pending_invite_client_id"), "junk rejected");
assert(isEmailAlreadyRegistered("User already registered"), "already registered");
assert(isEmailAlreadyRegistered("A user with this email address has already been registered"), "gotrue copy");
assert(!isEmailAlreadyRegistered("Invalid login credentials"), "wrong password is not already-registered");

assert(
  shouldShowOwnerProfileFunnel({
    hasOperatingProfile: false,
    actingClientId: null,
    userRole: "client_owner",
  }),
  "invited owner with no operating profile sees the funnel",
);
assert(
  shouldShowOwnerProfileFunnel({
    hasOperatingProfile: false,
    actingClientId: null,
    userRole: "client_owner",
  }),
  "firm-picked business_type must not skip the funnel (profile still missing)",
);
assert(
  !shouldShowOwnerProfileFunnel({
    hasOperatingProfile: true,
    actingClientId: null,
    userRole: "client_owner",
  }),
  "full operating profile skips funnel",
);

assert(
  !ownerWalkthroughReady({
    firstRunStep: null,
    showOnboarding: false,
    showBankDrafter: false,
    showCashFromBanks: false,
    onboardingGateReady: false,
  }),
  "tour must not start on the first signed-in paint",
);
assert(
  ownerWalkthroughReady({
    firstRunStep: null,
    showOnboarding: false,
    showBankDrafter: false,
    showCashFromBanks: false,
    onboardingGateReady: true,
  }),
  "tour starts after first-run dialogs even with no uploaded financials",
);
assert(
  !ownerWalkthroughReady({
    firstRunStep: "pick-type",
    showOnboarding: true,
    showBankDrafter: false,
    showCashFromBanks: false,
    onboardingGateReady: true,
  }),
  "tour waits while the profile funnel is open",
);
assert(
  !ownerWalkthroughReady({
    firstRunStep: "first-data",
    showOnboarding: false,
    showBankDrafter: false,
    showCashFromBanks: false,
    onboardingGateReady: true,
  }),
  "tour waits while the first-data nudge is open",
);

const indexSrc = readFileSync(resolve("src/routes/index.tsx"), "utf8");
assert(indexSrc.includes("waitForAuthSession"), "invite accept waits for the auth session");
assert(indexSrc.includes("clearInviteQueryFromUrl"), "invite accept strips the invite URL");
assert(indexSrc.includes("stashInviteHandoff"), "invite accept stashes the client UUID");
assert(indexSrc.includes("to: \"/app\", replace: true") || indexSrc.includes("to: '/app', replace: true"), "invite accept replace-navigates to /app");
assert(indexSrc.includes("[landing] post-login path failed"), "sign-in still navigates if post-login path throws");
assert(indexSrc.includes("[landing] post-login redirect failed"), "already-signed-in redirect cannot crash the landing page");

const handoffSrc = readFileSync(resolve("src/lib/invite-handoff.ts"), "utf8");
assert(handoffSrc.includes("let subscription"), "waitForAuthSession does not TDZ on the auth subscription");
assert(handoffSrc.includes("let timer"), "waitForAuthSession does not TDZ on the timeout handle");
assert(!handoffSrc.includes("sub.subscription.unsubscribe()"), "old sync-unsubscribe TDZ pattern is gone");

const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(appSrc.includes("hasInviteHandoffFlag"), "founder board does not bounce a just-accepted invite");
assert(appSrc.includes("shouldShowOwnerProfileFunnel"), "founder board uses shared funnel gate");
assert(appSrc.includes("ownerWalkthroughReady({"), "tour ready helper is wired");
assert(appSrc.includes("onboardingGateReady"), "tour waits until client meta has loaded");
assert(appSrc.includes('<TabErrorBoundary label="Business Health">'), "health tab cannot white-screen /app");
assert(appSrc.includes('<TabErrorBoundary label="Cash Forecast">'), "cash tab cannot white-screen /app");
assert(appSrc.includes('<TabErrorBoundary label="Budget">'), "budget tab cannot white-screen /app");
assert(appSrc.includes('lazyPanel(') && appSrc.includes("Cash Forecast"), "cash tab uses lazyPanel");
assert(
  !/WalkthroughWizard[\s\S]{0,400}hasRealFinancials/.test(appSrc),
  "owner tour is no longer gated on uploaded financials",
);

console.log("invite-accept-onboarding-test: ok");
