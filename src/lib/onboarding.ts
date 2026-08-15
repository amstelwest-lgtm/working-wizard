/**
 * Onboarding storage keys + helpers.
 * Keep keys versioned so we can re-show improved tours once.
 *
 * v9 — full tour copy + tighter spotlights for the real product flow.
 */

export const OWNER_TOUR_KEY = "milon_walkthrough_v9";
export const ACCOUNTANT_DASH_TOUR_KEY = "milon_accountant_dash_tour_v7";
export const ACCOUNTANT_CLIENT_TOUR_KEY = "milon_accountant_client_tour_v7";
export const ACCOUNTANT_FIRST_CLIENT_KEY = "milon_accountant_first_client_done_v2";

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
  }
  if (role === "accountant" || role === "all") {
    localStorage.removeItem(ACCOUNTANT_DASH_TOUR_KEY);
    localStorage.removeItem(ACCOUNTANT_CLIENT_TOUR_KEY);
    localStorage.removeItem(ACCOUNTANT_FIRST_CLIENT_KEY);
  }
}

/** Suggested name for an accountant's first sandbox client. */
export const PRACTICE_TEST_CLIENT_NAME = "Practice Demo Client";
