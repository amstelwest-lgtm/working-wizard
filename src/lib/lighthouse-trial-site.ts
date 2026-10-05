/**
 * Base URL for Lighthouse trial and signup links in outreach.
 * The product site is milonfinance.com. Other hosts (including milon.co.za)
 * are not used, even when SITE_URL / VITE_APP_URL point at them.
 */

export const LIGHTHOUSE_TRIAL_SITE_URL = "https://www.milonfinance.com";

export type LighthouseSiteEnv = {
  SITE_URL?: string | null;
  VITE_APP_URL?: string | null;
};

/** Origin when `raw` is an http(s) URL on milonfinance.com or a subdomain of it. */
export function milonfinanceOrigin(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host !== "milonfinance.com" && !host.endsWith(".milonfinance.com")) return null;
  return url.origin;
}

/**
 * Lighthouse trial-link base. Defaults to https://www.milonfinance.com.
 * An explicit env value is kept only when its host is milonfinance.com.
 */
export function lighthouseTrialSiteUrl(env: LighthouseSiteEnv = {}): string {
  for (const raw of [env.SITE_URL, env.VITE_APP_URL]) {
    const origin = milonfinanceOrigin(raw);
    if (origin) return origin;
  }
  return LIGHTHOUSE_TRIAL_SITE_URL;
}
