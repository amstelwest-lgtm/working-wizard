/**
 * Public app origin for redirects and links the user follows.
 * Request Origin wins when it is on the allowlist. Anything else, including
 * milon.co.za and a stale SITE_URL, becomes https://www.milonfinance.com.
 */

export const CANONICAL_APP_ORIGIN = "https://www.milonfinance.com";

export function isAllowedAppHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "milonfinance.com" || host === "www.milonfinance.com") return true;
  // Vercel preview and project hosts (branch deploys).
  if (host.endsWith(".vercel.app") && host.length > ".vercel.app".length) return true;
  return false;
}

/** https origin when `raw` is an allowlisted app host. Otherwise null. */
export function allowedAppOrigin(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!isAllowedAppHost(url.hostname)) return null;
  return url.origin;
}

/**
 * Origin for auth and invite links. The public apex and www both become
 * https://www.milonfinance.com. Localhost and Vercel preview hosts stay, so a
 * local callback still returns there. Anything else becomes www.
 */
export function canonicalAuthOrigin(raw?: string | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return CANONICAL_APP_ORIGIN;
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return CANONICAL_APP_ORIGIN;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return url.origin;
  if (
    host.endsWith(".vercel.app") &&
    host.length > ".vercel.app".length &&
    url.protocol === "https:"
  ) {
    return url.origin;
  }
  if (host === "milonfinance.com" || host === "www.milonfinance.com") return CANONICAL_APP_ORIGIN;
  return CANONICAL_APP_ORIGIN;
}

/** Path on the canonical auth origin. Ignores the page host. */
export function canonicalAuthUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${CANONICAL_APP_ORIGIN}${suffix}`;
}

/** First allowlisted candidate, otherwise the canonical www host. */
export function appRedirectOrigin(candidates: Array<string | null | undefined> = []): string {
  for (const raw of candidates) {
    const origin = allowedAppOrigin(raw);
    if (origin) return origin;
  }
  return CANONICAL_APP_ORIGIN;
}

export function appUrl(path: string, candidates: Array<string | null | undefined> = []): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${appRedirectOrigin(candidates)}${suffix}`;
}

/** Browser origin when the page itself is an allowlisted host. */
export function browserAppOrigin(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : null;
  return appRedirectOrigin([origin]);
}

export function browserAppUrl(path: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : null;
  return appUrl(path, [origin]);
}

type OriginRequest = {
  url: string;
  headers: { get(name: string): string | null };
};

/** Prefer the request Origin header, then the request URL, then canonical. */
export function requestAppOrigin(request: OriginRequest | null | undefined): string {
  if (!request) return CANONICAL_APP_ORIGIN;
  let fromUrl: string | null = null;
  try {
    fromUrl = new URL(request.url).origin;
  } catch {
    fromUrl = null;
  }
  return appRedirectOrigin([request.headers.get("origin"), fromUrl]);
}
