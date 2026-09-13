/**
 * Onboarding storage keys + helpers.
 * Keep keys versioned so we can re-show improved tours once.
 *
 * v12 — owner tour is an incentive-led walk (notes, sign-off, product lines,
 * cash, Claude next moves, action plan) with a larger premium card.
 */

export const OWNER_TOUR_KEY = "milon_walkthrough_v12";
/** Two-step orientation shown on an owner board that has no figures yet. */
export const OWNER_EMPTY_TOUR_KEY = "milon_walkthrough_empty_v3";
export const ACCOUNTANT_DASH_TOUR_KEY = "milon_accountant_dash_tour_v9";
/** Two-step orientation on an empty practice book — runs before Add client. */
export const ACCOUNTANT_DASH_EMPTY_TOUR_KEY = "milon_accountant_dash_empty_v1";
export const ACCOUNTANT_CLIENT_TOUR_KEY = "milon_accountant_client_tour_v10";
/** Two-step orientation shown in a client studio that has no figures yet. */
export const ACCOUNTANT_CLIENT_EMPTY_TOUR_KEY = "milon_accountant_client_tour_empty_v2";
export const ACCOUNTANT_FIRST_CLIENT_KEY = "milon_accountant_first_client_done_v2";

/** Empty-studio tour may reopen the upload dialog only when figures are still missing. */
export function shouldReopenFirstDataAfterEmptyTour(hasFigures: boolean): boolean {
  return !hasFigures;
}

export function onboardingDone(key: string): boolean {
  if (typeof localStorage === "undefined") return true;
  return Boolean(localStorage.getItem(key));
}

export function markOnboardingDone(key: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, "1");
}

/** Clear tour flags so guided onboarding can run again on this browser. */
export function resetOnboardingTours(role: "owner" | "accountant" | "all" = "all"): void {
  if (typeof localStorage === "undefined") return;
  if (role === "owner" || role === "all") {
    localStorage.removeItem(OWNER_TOUR_KEY);
    localStorage.removeItem(OWNER_EMPTY_TOUR_KEY);
  }
  if (role === "accountant" || role === "all") {
    localStorage.removeItem(ACCOUNTANT_DASH_TOUR_KEY);
    localStorage.removeItem(ACCOUNTANT_DASH_EMPTY_TOUR_KEY);
    localStorage.removeItem(ACCOUNTANT_CLIENT_TOUR_KEY);
    localStorage.removeItem(ACCOUNTANT_CLIENT_EMPTY_TOUR_KEY);
    localStorage.removeItem(ACCOUNTANT_FIRST_CLIENT_KEY);
  }
}

/** Suggested name for an accountant's first sandbox client. */
export const PRACTICE_TEST_CLIENT_NAME = "Practice Demo Client";
