/**
 * Public Turnstile site key. The secret stays on the server.
 * Cloudflare's always-pass test site key is used when the env var is unset
 * outside production.
 */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

/** Token Cloudflare documents for the always-pass test secret. */
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

export const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

export const TRIAL_DISCLAIMER =
  "AI-generated from sample figures, not reviewed by an accountant.";

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
