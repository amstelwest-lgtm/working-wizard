/**
 * Sage Business Cloud Accounting (South Africa) host config.
 *
 * SAGE_SA_BASE_URL picks the API host. Unset means the live host. Preview
 * points it at the reseller sandbox while we build against the sandbox key:
 *   https://resellers.accounting.sageone.co.za/api/2.0.0
 *
 * Only https URLs on *.sageone.co.za are accepted. Anything else falls back to
 * the live host so a typo can never send credentials to another domain.
 */

export const SAGE_SA_LIVE_API_BASE = "https://accounting.sageone.co.za/api/2.0.0";
export const SAGE_SA_SANDBOX_API_BASE = "https://resellers.accounting.sageone.co.za/api/2.0.0";

export function normalizeSageApiBase(raw: string | undefined | null): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  if (!value) return SAGE_SA_LIVE_API_BASE;
  try {
    const url = new URL(value);
    const hostOk = url.hostname === "sageone.co.za" || url.hostname.endsWith(".sageone.co.za");
    if (url.protocol !== "https:" || !hostOk || url.search || url.hash)
      return SAGE_SA_LIVE_API_BASE;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return SAGE_SA_LIVE_API_BASE;
  }
}

/** Resolved per call so tests and runtime env changes are honoured. */
export function sageApiBase(): string {
  return normalizeSageApiBase(process.env.SAGE_SA_BASE_URL);
}

export function sageApiKey(): string {
  return process.env.SAGE_SA_API_KEY?.trim() ?? "";
}

export function sagePasswordKey(): string {
  return process.env.SAGE_SA_PASSWORD_KEY?.trim() ?? "";
}

/**
 * Connect and sync need both the API key and the dedicated password key.
 * Without SAGE_SA_PASSWORD_KEY a new password would have no stable cipher key.
 */
export function sageCredentialsConfigured(): boolean {
  return sageApiKey().length > 0 && sagePasswordKey().length > 0;
}
