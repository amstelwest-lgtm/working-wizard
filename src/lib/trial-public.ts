/**
 * Public Turnstile site key. The secret stays on the server.
 * Cloudflare's always-pass test site key is used when the env var is unset
 * outside production.
 */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

/** Token Cloudflare documents for the always-pass test secret. */
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

export const TRIAL_DISCLAIMER = "AI-generated from sample figures, not reviewed by an accountant.";

/**
 * Accountant signup (Create Firm, Starter monthly preselected). Must stay
 * equal to firmSignupHref("starter") — asserted by test:trial-demo.
 * Duplicated here so the /try client chunk does not pull the Stripe catalog.
 */
export const TRIAL_SIGNUP_HREF = "/auth?signup=true&plan=starter&interval=month";

/**
 * Starter's catalog client limit (5), not the older 3-client trial sentence.
 * The test checks this against FIRM_BAND_CATALOG.starter.clientLimit.
 */
export const TRIAL_SIGNUP_SENTENCE = "14-day free trial · up to 5 clients";

const TRIAL_UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

/** Starter signup, plus any utm params already on the page. Other query keys are dropped. */
export function trialSignupHref(search = ""): string {
  const incoming = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const q = new URLSearchParams(TRIAL_SIGNUP_HREF.slice(TRIAL_SIGNUP_HREF.indexOf("?") + 1));
  for (const key of TRIAL_UTM_KEYS) {
    const value = incoming.get(key);
    if (value) q.set(key, value);
  }
  return `/auth?${q.toString()}`;
}

export const TRIAL_CTA_LABEL = "Start free trial";

/** One line saying what Milōn is and who it is for. */
export const TRIAL_VALUE_PROP =
  "Milōn is an AI finance team for accountants and the business owners they advise — three agents prepare the work, the accountant signs off.";

/** Short form for the persistent CTA bar. */
export const TRIAL_VALUE_PROP_SHORT =
  "An AI finance team for accountants and their business-owner clients.";

export function turnstileSiteKey(envValue: string | undefined, dev: boolean): string | null {
  const set = (envValue ?? "").trim();
  if (set) return set;
  return dev ? TURNSTILE_TEST_SITE_KEY : null;
}

export function turnstileSecret(envValue: string | undefined, dev: boolean): string | null {
  const set = (envValue ?? "").trim();
  if (set) return set;
  return dev ? TURNSTILE_TEST_SECRET_KEY : null;
}

/**
 * Both keys turn the check on. Dev with either key empty still uses the
 * Cloudflare test keys. Production with either key empty leaves it off.
 */
export function turnstileEnabled(input: {
  siteKey: string | undefined | null;
  secret: string | undefined | null;
  dev: boolean;
}): boolean {
  const site = (input.siteKey ?? "").trim();
  const secret = (input.secret ?? "").trim();
  if (site && secret) return true;
  return input.dev;
}

let turnstileUnsetWarned = false;

/** One server log when production is running without Turnstile. */
export function warnTurnstileUnsetOnce(production: boolean, enabled: boolean): void {
  if (!production || enabled || turnstileUnsetWarned) return;
  turnstileUnsetWarned = true;
  console.warn(
    "Turnstile keys are unset. The sample gate is using the IP limit, the email limit, and a honeypot.",
  );
}

export function resetTurnstileUnsetWarning(): void {
  turnstileUnsetWarned = false;
}
