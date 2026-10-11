/**
 * Retired milon.co.za hosts. The canonical site is https://www.milonfinance.com.
 * vercel.json repeats this as edge redirects (has host eq / suffix). This helper
 * is the same rule for requests that reach the TanStack server.
 */

import { CANONICAL_APP_ORIGIN } from "./app-origin";

export const RETIRED_MILON_CO_ZA_APEX = "milon.co.za";

export function normalizeRequestHost(raw: string | null | undefined): string {
  let host = (raw ?? "").trim().toLowerCase();
  if (!host) return "";
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end >= 0 ? host.slice(1, end) : host;
  }
  const colon = host.lastIndexOf(":");
  if (colon > -1 && /^\d+$/.test(host.slice(colon + 1))) {
    host = host.slice(0, colon);
  }
  return host.replace(/\.$/, "");
}

/** Apex milon.co.za and any subdomain, including www. */
export function isRetiredMilonCoZaHost(raw: string | null | undefined): boolean {
  const host = normalizeRequestHost(raw);
  return host === RETIRED_MILON_CO_ZA_APEX || host.endsWith(`.${RETIRED_MILON_CO_ZA_APEX}`);
}

type HostRequest = {
  url: string;
  headers: { get(name: string): string | null };
};

function candidateHosts(request: HostRequest): string[] {
  const hosts: string[] = [];
  const forwarded = request.headers.get("x-forwarded-host");
  if (forwarded) {
    for (const part of forwarded.split(",")) {
      const trimmed = part.trim();
      if (trimmed) hosts.push(trimmed);
    }
  }
  const host = request.headers.get("host");
  if (host) hosts.push(host);
  try {
    hosts.push(new URL(request.url).hostname);
  } catch {
    // Ignore a URL the host header can still classify.
  }
  return hosts;
}

/** Absolute canonical URL with the request path and query preserved. */
export function retiredCoZaLocation(requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  return new URL(`${url.pathname}${url.search}`, CANONICAL_APP_ORIGIN).toString();
}

/** 308 to www.milonfinance.com when any presented host is a retired co.za host. */
export function retiredCoZaRedirect(request: HostRequest): Response | null {
  if (!candidateHosts(request).some((host) => isRetiredMilonCoZaHost(host))) return null;
  const location = retiredCoZaLocation(request.url);
  if (!location) return null;
  return new Response(null, {
    status: 308,
    headers: { Location: location },
  });
}
