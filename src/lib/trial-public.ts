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
 * Accountant signup (Create Firm, Solo monthly preselected). Must stay equal
 * to firmSignupHref() in firm-signup-copy.ts — asserted by test:trial-demo.
 * Duplicated here so the /try client chunk does not pull the Stripe catalog.
 */
export const TRIAL_SIGNUP_HREF = "/auth?signup=true&plan=solo&interval=month";

/** Must stay equal to FIRM_TRIAL_SENTENCE in stripe-plans.ts — asserted by test:trial-demo. */
export const TRIAL_SIGNUP_SENTENCE = "14-day free trial · up to 3 clients";

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
