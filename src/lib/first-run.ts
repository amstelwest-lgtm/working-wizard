/**
 * First-run gates for the SME founder board (/app).
 * Pure functions so invite/onboarding tests can lock the behaviour.
 */

export type FirstRunStep = "pick-type" | "first-data" | null;

/**
 * Open the 10-question profile when the owner has no operating profile yet.
 * A firm-picked `business_type` alone must not skip this — that left invited
 * SMEs on a blank board with no questions and no tour.
 */
export function shouldShowOwnerProfileFunnel(opts: {
  hasOperatingProfile: boolean;
  actingClientId: string | null;
  userRole: string | null;
}): boolean {
  if (opts.hasOperatingProfile) return false;
  if (opts.actingClientId) return false;
  if (opts.userRole === null) return false;
  if (opts.userRole === "client_member") return false;
  return true;
}

/**
 * Hold the boot spinner until the founder board can paint the right surface.
 * Otherwise sign-in flashes "Add your financials" / empty-score copy, then
 * swaps to the profile funnel (or the real orb) a beat later.
 */
export function ownerBoardReady(opts: {
  roleResolved: boolean;
  clientLinkResolved: boolean;
  effectiveClientId: string | null;
  onboardingGateReady: boolean;
  firstRunStep: FirstRunStep;
  profileFunnelOpen: boolean;
  financialsHydrated: boolean;
}): boolean {
  if (!opts.roleResolved || !opts.clientLinkResolved) return false;
  if (!opts.effectiveClientId) return true;
  if (!opts.onboardingGateReady) return false;
  // First-run dialogs cover the board — don't wait for financials (and don't
  // drop back to a spinner between the profile funnel and the data nudge).
  if (opts.profileFunnelOpen || opts.firstRunStep !== null) return true;
  return opts.financialsHydrated;
}

/**
 * Feature walkthrough starts once first-run dialogs are gone.
 * Do not wait for uploaded financials — first login would otherwise never
 * tour the board if the owner skipped (or had not yet done) bank upload.
 *
 * `onboardingGateReady` must stay false until the first clientMeta fetch
 * settles. Otherwise the tour mounts on the first signed-in paint (when
 * firstRunStep and showOnboarding are still their initial values) and can
 * crash /app before the funnel has a chance to open.
 */
export function ownerWalkthroughReady(opts: {
  firstRunStep: FirstRunStep;
  showOnboarding: boolean;
  showBankDrafter: boolean;
  showCashFromBanks: boolean;
  onboardingGateReady: boolean;
}): boolean {
  if (!opts.onboardingGateReady) return false;
  return (
    opts.firstRunStep === null &&
    !opts.showOnboarding &&
    !opts.showBankDrafter &&
    !opts.showCashFromBanks
  );
}
