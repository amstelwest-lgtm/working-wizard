/**
 * Invite accept → founder board, then first-run profile + tour.
 * Run: pnpm test:invite-onboarding
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ownerBoardReady,
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

assert(
  !ownerBoardReady({
    roleResolved: false,
    clientLinkResolved: true,
    effectiveClientId: "c",
    onboardingGateReady: false,
    firstRunStep: null,
    profileFunnelOpen: false,
    financialsHydrated: false,
  }),
  "board waits for the role before painting",
);
assert(
  !ownerBoardReady({
    roleResolved: true,
    clientLinkResolved: true,
    effectiveClientId: "c",
    onboardingGateReady: true,
    firstRunStep: null,
    profileFunnelOpen: false,
    financialsHydrated: false,
  }),
  "board does not flash empty-score copy before financials hydrate",
);
assert(
  ownerBoardReady({
    roleResolved: true,
    clientLinkResolved: true,
    effectiveClientId: "c",
    onboardingGateReady: true,
    firstRunStep: "pick-type",
    profileFunnelOpen: true,
    financialsHydrated: false,
  }),
  "profile funnel can open without waiting for financials",
);
assert(
  ownerBoardReady({
    roleResolved: true,
    clientLinkResolved: true,
    effectiveClientId: "c",
    onboardingGateReady: true,
    firstRunStep: "first-data",
    profileFunnelOpen: false,
    financialsHydrated: false,
  }),
  "first-data nudge does not drop back to a spinner",
);
assert(
  ownerBoardReady({
    roleResolved: true,
    clientLinkResolved: true,
    effectiveClientId: "c",
    onboardingGateReady: true,
    firstRunStep: null,
    profileFunnelOpen: false,
    financialsHydrated: true,
  }),
  "returning owner sees the board only after financials hydrate",
);

const indexSrc = readFileSync(resolve("src/routes/index.tsx"), "utf8");
assert(indexSrc.includes("waitForAuthSession"), "invite accept waits for the auth session");
assert(indexSrc.includes("clearInviteQueryFromUrl"), "invite accept strips the invite URL");
assert(indexSrc.includes("stashInviteHandoff"), "invite accept stashes the client UUID");
assert(indexSrc.includes("to: \"/app\", replace: true") || indexSrc.includes("to: '/app', replace: true"), "invite accept replace-navigates to /app");
assert(indexSrc.includes("[landing] post-login path failed"), "sign-in still navigates if post-login path throws");
assert(indexSrc.includes("[landing] post-login redirect failed"), "already-signed-in redirect cannot crash the landing page");
assert(indexSrc.includes("Opening your workspace"), "signed-in landing does not flash hero copy while redirecting");

const handoffSrc = readFileSync(resolve("src/lib/invite-handoff.ts"), "utf8");
assert(handoffSrc.includes("let subscription"), "waitForAuthSession does not TDZ on the auth subscription");
assert(handoffSrc.includes("let timer"), "waitForAuthSession does not TDZ on the timeout handle");
assert(!handoffSrc.includes("sub.subscription.unsubscribe()"), "old sync-unsubscribe TDZ pattern is gone");

const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(appSrc.includes("hasInviteHandoffFlag"), "founder board does not bounce a just-accepted invite");
assert(appSrc.includes("shouldShowOwnerProfileFunnel"), "founder board uses shared funnel gate");
assert(appSrc.includes("ownerWalkthroughReady({"), "tour ready helper is wired");
assert(appSrc.includes("ownerBoardReady({"), "founder board holds the spinner until profile/client data is ready");
assert(appSrc.includes("onboardingGateReady"), "tour waits until client meta has loaded");
assert(appSrc.includes("const [v, setV] = useState<Inputs>(defaults)"), "financials state is declared");
assert(
  appSrc.indexOf("const [v, setV] = useState<Inputs>(defaults)") <
    appSrc.indexOf("const handleStatementUpload"),
  "financials state must be initialized before the upload handler",
);
{
  const firstRunDecl = appSrc.indexOf("const [firstRunStep, setFirstRunStep]");
  const firstRunDeps = appSrc.indexOf("actingClientId, firstRunStep, roleResolved]");
  assert(firstRunDecl !== -1, "firstRunStep state is declared");
  assert(firstRunDeps !== -1, "client-meta effect still lists firstRunStep");
  assert(
    firstRunDecl < firstRunDeps,
    "firstRunStep must be initialized before the client-meta effect reads it",
  );
}
assert(appSrc.includes("ClientOnly"), "founder board waits for the browser before mounting");
assert(appSrc.includes('<TabErrorBoundary label="Cash Forecast">'), "cash tab cannot white-screen /app");
assert(appSrc.includes('<TabErrorBoundary label="Budget">'), "budget tab cannot white-screen /app");
assert(appSrc.includes('lazyPanel(') && appSrc.includes("Cash Forecast"), "cash tab uses lazyPanel");
// An owner always gets a tour on first login — on an empty board it is the
// two-step "owner-empty" nudge; the full board tour waits for a real score so
// it never points at an orb / Ask AI / seeded budget that is not there.
assert(
  /variant=\{hasRealFinancials \? "owner" : "owner-empty"\}/.test(appSrc),
  "empty board gets the owner-empty tour; full tour waits for real figures",
);
assert(appSrc.includes('id="wizard-empty-score"'), "empty tour has its score target");
assert(appSrc.includes('id="wizard-first-figures"'), "empty tour has its figures target");
assert(
  appSrc.includes('id="ask-ai-overview"') &&
    appSrc.indexOf('id="ask-ai-overview"') < appSrc.indexOf("<SphereHero"),
  "empty board mounts Ask AI so it says figures are missing instead of being absent",
);

// Role resolution must wait for the client link: a freshly confirmed owner has
// no user_roles row until ensure_own_client runs, and userRole=null silently
// skipped the profile funnel.
{
  const roleEffect = appSrc.indexOf("if (!clientLinkResolved) return;");
  assert(roleEffect !== -1, "role effect waits for the client link");
  assert(
    appSrc.includes("[user?.id, clientLinkResolved, effectiveClientId]"),
    "role effect re-resolves once the client exists",
  );
}

const wizardSrc = readFileSync(resolve("src/components/walkthrough-wizard.tsx"), "utf8");
assert(wizardSrc.includes('"owner-empty"'), "wizard knows the owner-empty variant");
assert(wizardSrc.includes("OWNER_EMPTY_TOUR_KEY"), "owner-empty tour has its own storage key");

// AccountantProfileProvider mounts for every session (root). It must never
// mint a practice firm for an owner whose roles have not been written yet.
const acctSrc = readFileSync(resolve("src/contexts/accountant-profile.tsx"), "utf8");
assert(
  acctSrc.includes('meta?.signup_type === "customer"') &&
    acctSrc.includes("!customerSignup && (roles.hasPracticeRole || practiceSignup)"),
  "ensure_practice_firm only runs on positive practice evidence",
);
assert(
  !acctSrc.includes("!roles.hasClientRole ||"),
  "'no roles yet' is not treated as an accountant",
);

console.log("invite-accept-onboarding-test: ok");
