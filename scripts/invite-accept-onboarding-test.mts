/**
 * Invite accept → founder board, then first-run profile + tour.
 * Run: pnpm test:invite-onboarding
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  hasOwnerFirstUploadHandled,
  isInvitedOwnerWithFigures,
  markOwnerFirstUploadHandled,
  ownerBoardReady,
  ownerFirstUploadHandledKey,
  ownerHasPreloadedFigures,
  ownerWalkthroughReady,
  shouldAutoProposeAfterFirstUpload,
  shouldClearFirstRunAfterFirstUpload,
  shouldShowOwnerProfileFunnel,
} from "../src/lib/first-run";
import {
  isClientUuid,
  isEmailAlreadyRegistered,
  pendingInviteTokenFromSearch,
  ownerInviteLandingPath,
  ownerInviteTokenFromNext,
  ownerInviteFromCallbackSearch,
  resolvePendingOwnerInvite,
  encodePendingOwnerInvite,
  decodePendingOwnerInvite,
  pendingOwnerInviteCookieString,
  readPendingOwnerInviteCookie,
  preferPendingInviteClient,
} from "../src/lib/invite-handoff";
import { shouldReopenFirstDataAfterEmptyTour } from "../src/lib/onboarding";

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
  pendingInviteTokenFromSearch("?invite=tok123456&mode=signup") === "tok123456",
  "invite+signup extracts token",
);
assert(pendingInviteTokenFromSearch("?invite=tok123456") === null, "invite without mode is not pending");
assert(pendingInviteTokenFromSearch("?mode=signup") === null, "mode without invite is not pending");
assert(
  ownerInviteLandingPath("abc+def") === "/?invite=abc%2Bdef&mode=signup",
  "landing path encodes the token",
);
assert(
  ownerInviteTokenFromNext("/?invite=tok123456&mode=signup") === "tok123456",
  "Google next preserves invite token",
);
assert(ownerInviteTokenFromNext("/app") === null, "non-invite next has no token");
assert(
  ownerInviteFromCallbackSearch("?invite=tok123&cc=MLN-AB12&code=pkce")?.token === "tok123" &&
    ownerInviteFromCallbackSearch("?invite=tok123&cc=MLN-AB12&code=pkce")?.clientCode === "MLN-AB12",
  "callback search keeps invite next to the PKCE code",
);
assert(
  ownerInviteFromCallbackSearch("?code=pkce") === null,
  "PKCE-only callback has no owner invite",
);
assert(
  resolvePendingOwnerInvite({
    callbackSearch: "?code=pkce",
    next: "/app",
    stored: { token: "tok123", clientCode: "MLN-1" },
  })?.token === "tok123",
  "storage invite survives when URL has only PKCE",
);
assert(
  resolvePendingOwnerInvite({
    callbackSearch: "?invite=tok123&code=pkce",
    stored: { token: "tok123", clientCode: "MLN-1" },
  })?.clientCode === "MLN-1",
  "URL token merges client code from storage",
);
assert(
  resolvePendingOwnerInvite({
    callbackSearch: "?code=pkce",
    next: "/?invite=fromnext&mode=signup",
    stored: null,
  })?.token === "fromnext",
  "Google next path is the last-resort invite source",
);
assert(encodePendingOwnerInvite({ token: "tok", clientCode: "MLN-AB12" }) === "tok|MLN-AB12", "encode with code");
assert(encodePendingOwnerInvite({ token: "tok", clientCode: null }) === "tok", "encode token only");
assert(decodePendingOwnerInvite("tok|MLN-AB12")?.clientCode === "MLN-AB12", "decode code");
assert(decodePendingOwnerInvite("tok")?.token === "tok", "decode token only");
{
  const cookie = pendingOwnerInviteCookieString(
    { token: "tok123", clientCode: "MLN-1" },
    "www.milonfinance.com",
    true,
  );
  assert(cookie.includes("milon_owner_invite="), "invite cookie name");
  assert(cookie.includes("Domain=milonfinance.com"), "invite cookie spans www/apex");
  assert(readPendingOwnerInviteCookie(cookie)?.token === "tok123", "reads invite cookie");
}
assert(
  preferPendingInviteClient({
    pendingClientId: "3d5a1c2e-7b44-4f1a-9c8d-1a2b3c4d5e6f",
    linkedClientId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  }) === "3d5a1c2e-7b44-4f1a-9c8d-1a2b3c4d5e6f",
  "existing account opens the invited client, not an older workspace",
);
assert(
  preferPendingInviteClient({ pendingClientId: "opaque-token", linkedClientId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }) ===
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  "opaque pending token does not override linked client",
);

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
  !shouldShowOwnerProfileFunnel({
    hasOperatingProfile: false,
    actingClientId: null,
    userRole: "client_owner",
    isInvitedOwnerWithFigures: true,
  }),
  "invited owner with preloaded figures skips the profile funnel",
);
assert(
  shouldShowOwnerProfileFunnel({
    hasOperatingProfile: false,
    actingClientId: null,
    userRole: "client_owner",
    isInvitedOwnerWithFigures: false,
  }),
  "invited owner without figures still sees the profile funnel",
);
assert(
  ownerHasPreloadedFigures({ hasRealFinancials: true, financialsUpdatedAt: null }),
  "hydrated financial blob counts as preloaded figures",
);
assert(
  ownerHasPreloadedFigures({ hasRealFinancials: false, financialsUpdatedAt: "2026-01-01T00:00:00Z" }),
  "financials_updated_at counts as preloaded figures before hydration",
);
assert(
  isInvitedOwnerWithFigures({
    isInvitedOwner: true,
    hasRealFinancials: true,
    financialsUpdatedAt: null,
  }),
  "invited owner + figures skips setup chrome",
);
assert(
  !isInvitedOwnerWithFigures({
    isInvitedOwner: true,
    hasRealFinancials: false,
    financialsUpdatedAt: null,
  }),
  "invited owner without figures keeps the upload path",
);
assert(
  !isInvitedOwnerWithFigures({
    isInvitedOwner: false,
    hasRealFinancials: true,
    financialsUpdatedAt: "2026-01-01T00:00:00Z",
  }),
  "self-signup owner with figures still gets first-run chrome",
);

// #175: first upload auto-drafts Profit / Cash / Budget. It clears the
// bring-in-your-numbers chrome but must NOT suppress the scored board tour —
// that tour is where the owner learns the deliverables await accountant sign-off.
assert(
  shouldClearFirstRunAfterFirstUpload({
    isInvitedOwner: false,
    isInvitedOwnerWithFigures: false,
    firstUploadHandled: true,
  }),
  "self-signup owner clears first-run chrome after first upload is handled",
);
assert(
  !shouldClearFirstRunAfterFirstUpload({
    isInvitedOwner: false,
    isInvitedOwnerWithFigures: false,
    firstUploadHandled: false,
  }),
  "self-signup owner keeps first-run chrome until first upload is handled",
);
assert(
  !shouldClearFirstRunAfterFirstUpload({
    isInvitedOwner: true,
    isInvitedOwnerWithFigures: false,
    firstUploadHandled: true,
  }),
  "invited owner without figures is out of scope for the upload gate",
);
assert(
  shouldAutoProposeAfterFirstUpload({
    isInvitedOwner: false,
    firstUploadHandled: false,
    clientId: "3d5a1c2e-7b44-4f1a-9c8d-1a2b3c4d5e6f",
    actingAsClient: false,
  }),
  "self-signup owner auto-proposes once on first upload",
);
assert(
  !shouldAutoProposeAfterFirstUpload({
    isInvitedOwner: false,
    firstUploadHandled: true,
    clientId: "3d5a1c2e-7b44-4f1a-9c8d-1a2b3c4d5e6f",
    actingAsClient: false,
  }),
  "auto-propose guard blocks repeat calls",
);
assert(
  !shouldAutoProposeAfterFirstUpload({
    isInvitedOwner: true,
    firstUploadHandled: false,
    clientId: "3d5a1c2e-7b44-4f1a-9c8d-1a2b3c4d5e6f",
    actingAsClient: false,
  }),
  "invited owner upload path does not auto-propose in this PR",
);
{
  const clientId = "3d5a1c2e-7b44-4f1a-9c8d-1a2b3c4d5e6f";
  const key = ownerFirstUploadHandledKey(clientId);
  assert(key.includes(clientId), "first-upload storage key is per client");
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  } as Storage;
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
  try {
    assert(!hasOwnerFirstUploadHandled(clientId), "fresh client has no first-upload flag");
    markOwnerFirstUploadHandled(clientId);
    assert(hasOwnerFirstUploadHandled(clientId), "markOwnerFirstUploadHandled persists");
    assert(store.get(key) === "1", "first-upload flag value");
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: prev, configurable: true });
  }
}

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

const memberSrc = readFileSync(resolve("src/lib/invite-member.server.ts"), "utf8");
assert(
  memberSrc.includes("export async function acceptOwnerInviteForUser"),
  "existing accounts redeem through acceptOwnerInviteForUser",
);
assert(
  memberSrc.includes("deleteUserOnFailure: false"),
  "existing-account redeem must not delete the auth user on failure",
);
assert(
  memberSrc.includes("replaceRoles: false"),
  "existing-account redeem must not wipe unrelated user_roles",
);
assert(
  memberSrc.includes("alreadyRedeemedByCaller"),
  "same Google user can retry an invite they already claimed (callback remount)",
);

const indexSrc = readFileSync(resolve("src/routes/index.tsx"), "utf8");
assert(indexSrc.includes("clearInviteQueryFromUrl"), "invite accept strips the invite URL");
assert(indexSrc.includes("stashInviteHandoff"), "invite accept stashes the client UUID");
assert(indexSrc.includes("to: \"/app\", replace: true") || indexSrc.includes("to: '/app', replace: true"), "invite accept replace-navigates to /app");
assert(indexSrc.includes("[landing] post-login path failed"), "sign-in still navigates if post-login path throws");
assert(indexSrc.includes("[landing] post-login redirect failed"), "already-signed-in redirect cannot crash the landing page");
assert(indexSrc.includes("Opening your workspace"), "signed-in landing does not flash hero copy while redirecting");
assert(indexSrc.includes("doAcceptOwnerInvite"), "existing accounts redeem via acceptOwnerInvite");
assert(indexSrc.includes("needsExistingAccept"), "already-registered emails attach after sign-in, not only createUser");
assert(indexSrc.includes("pendingInvite"), "landing Sign in keeps a pending owner invite");
assert(
  indexSrc.includes("ownerInvite=") && indexSrc.includes("Continue with Google"),
  "invite form and Sign in Google preserve the owner invite",
);
assert(
  !/clearInviteQueryFromUrl\(\);\s*setInviteClientId\(null\);\s*setSigninOpen\(false\)/.test(indexSrc),
  "Sign in must not strip the invite token before redeeming",
);
assert(
  indexSrc.includes("peekPendingOwnerInvite"),
  "landing keeps a Google-stashed owner invite (do not dump the accountant session to /dashboard)",
);

const handoffSrc = readFileSync(resolve("src/lib/invite-handoff.ts"), "utf8");
assert(handoffSrc.includes("let subscription"), "waitForAuthSession does not TDZ on the auth subscription");
assert(handoffSrc.includes("let timer"), "waitForAuthSession does not TDZ on the timeout handle");
assert(!handoffSrc.includes("sub.subscription.unsubscribe()"), "old sync-unsubscribe TDZ pattern is gone");

const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(appSrc.includes("hasInviteHandoffFlag"), "founder board does not bounce a just-accepted invite");
assert(appSrc.includes("ownerBoardRole"), "founder board uses the owner seat on the owner door, not firm_admin");
assert(appSrc.includes("openInvitedClient"), "founder board prefers the invited workspace for existing accounts");
assert(appSrc.includes("shouldShowOwnerProfileFunnel"), "founder board uses shared funnel gate");
assert(appSrc.includes("ownerWalkthroughReady({"), "tour ready helper is wired");
assert(appSrc.includes("skipInvitedSetupChrome"), "invited owner with figures skips the board tour");
assert(appSrc.includes("clearFirstRunAfterUpload"), "first upload clears the bring-in-your-numbers chrome");
assert(!appSrc.includes("skipPostUploadOwnerTour"), "first upload no longer suppresses the scored board tour (#175)");
{
  // Only the invited-with-figures path (#150) may pre-mark the owner tour done.
  const tourDoneCount = appSrc.split("markOnboardingDone(OWNER_TOUR_KEY)").length - 1;
  assert(tourDoneCount === 1, `owner tour is pre-marked done exactly once (invited+figures), got ${tourDoneCount}`);
  const uploadHandler = appSrc.slice(
    appSrc.indexOf("const handleOwnerFirstRealFinancialsUpload"),
    appSrc.indexOf("useEffect(() => {", appSrc.indexOf("const handleOwnerFirstRealFinancialsUpload")),
  );
  assert(
    !uploadHandler.includes("markOnboardingDone(OWNER_TOUR_KEY)"),
    "first upload handler leaves the scored tour to run",
  );
}
assert(appSrc.includes("handleOwnerFirstRealFinancialsUpload"), "first upload handler is wired");
assert(appSrc.includes("invokeBrainPropose"), "owner first upload reuses brain-propose");
assert(appSrc.includes("OwnerBrainFirstInsight"), "scored board surfaces proposed next steps");
assert(appSrc.includes("markOwnerFirstUploadHandled"), "first upload persists a per-client guard");
assert(appSrc.includes("isInvitedOwnerWithFigures"), "invited owner + figures gate is wired");
assert(appSrc.includes("markOnboardingDone(OWNER_TOUR_KEY)"), "invited owner with figures marks the tour done");
assert(appSrc.includes("setInvitedOwnerEntry(true)"), "client link stamps invited-owner entry");
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
  const metaEffectStart = appSrc.indexOf("if (!roleResolved) return;");
  const metaEffectEnd = appSrc.indexOf("// Returning invite accept:", metaEffectStart);
  const metaEffectBlock =
    metaEffectStart !== -1 && metaEffectEnd !== -1
      ? appSrc.slice(metaEffectStart, metaEffectEnd)
      : "";
  assert(firstRunDecl !== -1, "firstRunStep state is declared");
  assert(metaEffectBlock.includes("firstRunStep"), "client-meta effect still lists firstRunStep");
  assert(
    firstRunDecl < metaEffectStart,
    "firstRunStep must be initialized before the client-meta effect reads it",
  );
}
assert(appSrc.includes("ClientOnly"), "founder board waits for the browser before mounting");
assert(appSrc.includes('<TabErrorBoundary label="Cash Forecast">'), "cash tab cannot white-screen /app");
assert(appSrc.includes('<TabErrorBoundary label="Budget">'), "budget tab cannot white-screen /app");
assert(appSrc.includes('lazyPanel(') && appSrc.includes("Cash Forecast"), "cash tab uses lazyPanel");
// An owner always gets a tour on first login — on an empty board it is the
// two-step "owner-empty" nudge; the full board tour waits for a scored board
// (real figures, or the illustrative sample business) so it never points at
// an orb / Ask AI / seeded budget that is not there.
assert(
  /variant=\{showScoredBoard \? "owner" : "owner-empty"\}/.test(appSrc),
  "empty board gets the owner-empty tour; full tour waits for a scored board",
);
assert(
  /const showScoredBoard = hasRealFinancials \|\| sampleMode;/.test(appSrc),
  "scored board = real figures or sample mode",
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
assert(shouldReopenFirstDataAfterEmptyTour(false), "empty-studio tour still offers upload when no figures");
assert(!shouldReopenFirstDataAfterEmptyTour(true), "empty-studio tour does not re-prompt after figures");
assert(wizardSrc.includes('"accountant-dashboard-empty"'), "wizard knows the empty practice-board variant");
assert(wizardSrc.includes("ACCOUNTANT_DASH_EMPTY_TOUR_KEY"), "empty practice tour has its own storage key");
assert(wizardSrc.includes("Got it — add my first client"), "empty practice tour CTA adds a client");

// #175 narrative: one upload drafts Profit / Cash / Budget, then each waits for
// accountant sign-off — said on the owner board and in the accountant studio.
{
  const stepsBlock = (name: string) => {
    const start = wizardSrc.indexOf(`const ${name}: Step[] = [`);
    const end = wizardSrc.indexOf("];", start);
    assert(start !== -1 && end !== -1, `${name} is defined`);
    return wizardSrc.slice(start, end);
  };
  const ownerEmpty = stepsBlock("OWNER_EMPTY_STEPS");
  assert(/drafts your Profit/.test(ownerEmpty), "owner-empty says one upload drafts the deliverables");
  assert(/sign off/i.test(ownerEmpty), "owner-empty says drafts queue for accountant sign-off");

  const owner = stepsBlock("OWNER_STEPS");
  for (const section of ["Profit", "Cash Forecast", "Budget"]) {
    const i = owner.indexOf(`section: "${section}"`);
    const step = owner.slice(i, owner.indexOf("},", i));
    assert(i !== -1, `owner tour has a ${section} step`);
    assert(/accountant/.test(step) && /sign/.test(step), `owner ${section} step mentions accountant sign-off`);
  }

  const acctEmpty = stepsBlock("ACCOUNTANT_CLIENT_EMPTY_STEPS");
  assert(/drafts Profit, Cash Forecast and Budget/.test(acctEmpty), "accountant-empty says one upload drafts the deliverables");
  assert(/sign-off/.test(acctEmpty), "accountant-empty says tabs wait for sign-off");

  const acct = stepsBlock("ACCOUNTANT_CLIENT_STEPS");
  for (const section of ["Profit", "Cash Forecast", "Budget", "Reports"]) {
    const i = acct.indexOf(`section: "${section}"`);
    const step = acct.slice(i, acct.indexOf("},", i));
    assert(i !== -1, `accountant tour has a ${section} step`);
    assert(/sign/i.test(step), `accountant ${section} step asks for review / sign-off`);
  }
  assert(/Needs re-review/.test(acct), "accountant tour explains re-review after later uploads");
}

const onboardingSrc = readFileSync(resolve("src/lib/onboarding.ts"), "utf8");
assert(onboardingSrc.includes('"milon_walkthrough_v10"'), "owner tour key bumped for #175 copy");
assert(onboardingSrc.includes('"milon_walkthrough_empty_v2"'), "owner-empty tour key bumped");
assert(onboardingSrc.includes('"milon_accountant_client_tour_v9"'), "accountant client tour key bumped");
assert(onboardingSrc.includes('"milon_accountant_client_tour_empty_v2"'), "accountant client-empty tour key bumped");
assert(onboardingSrc.includes('"milon_accountant_dash_tour_v8"'), "accountant dashboard tour key bumped");
assert(onboardingSrc.includes('"milon_accountant_dash_empty_v1"'), "empty practice tour key exists");
assert(
  onboardingSrc.includes("shouldReopenFirstDataAfterEmptyTour"),
  "empty-studio tour does not reopen upload after figures land",
);

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
