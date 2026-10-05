/**
 * Same allowlist as src/lib/app-origin.ts. Edge functions cannot import the app
 * bundle, so this copy stays in the function deploy. Keep the two in step.
 */

export const CANONICAL_APP_ORIGIN = "https://www.milonfinance.com";

export function isAllowedAppHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "milonfinance.com" || host === "www.milonfinance.com") return true;
  if (host.endsWith(".vercel.app") && host.length > ".vercel.app".length) return true;
  return false;
}

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

export function appRedirectOrigin(candidates: Array<string | null | undefined> = []): string {
  for (const raw of candidates) {
    const origin = allowedAppOrigin(raw);
    if (origin) return origin;
  }
  return CANONICAL_APP_ORIGIN;
}
