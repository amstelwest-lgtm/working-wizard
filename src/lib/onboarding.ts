/**
 * Onboarding storage keys + helpers.
 * Keep keys versioned so we can re-show improved tours once.
 */

export const OWNER_TOUR_KEY = "milon_walkthrough_v3";
export const ACCOUNTANT_DASH_TOUR_KEY = "milon_accountant_dash_tour_v1";
export const ACCOUNTANT_CLIENT_TOUR_KEY = "milon_accountant_client_tour_v1";
export const ACCOUNTANT_FIRST_CLIENT_KEY = "milon_accountant_first_client_done_v1";

export function onboardingDone(key: string): boolean {
  if (typeof localStorage === "undefined") return true;
  return Boolean(localStorage.getItem(key));
}

export function markOnboardingDone(key: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, "1");
}

/** Suggested name for an accountant's first sandbox client. */
export const PRACTICE_TEST_CLIENT_NAME = "Practice Demo Client";
