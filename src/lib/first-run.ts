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
 * Feature walkthrough starts once first-run dialogs are gone.
 * Do not wait for uploaded financials — first login would otherwise never
 * tour the board if the owner skipped (or had not yet done) bank upload.
 */
export function ownerWalkthroughReady(opts: {
  firstRunStep: FirstRunStep;
  showOnboarding: boolean;
  showBankDrafter: boolean;
  showCashFromBanks: boolean;
}): boolean {
  return (
    opts.firstRunStep === null &&
    !opts.showOnboarding &&
    !opts.showBankDrafter &&
    !opts.showCashFromBanks
  );
}
