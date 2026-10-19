/**
 * Client view of an edge auth result.
 * 401 refreshes the session once. 503 auth_unavailable retries once with the
 * same token. Anything else is shown with Retry.
 */

export const AUTH_UNAVAILABLE_CODE = "auth_unavailable";

export type AuthRetryPlan = "refresh" | "again";

export function authRetryPlan(status: number, body: unknown): AuthRetryPlan | null {
  if (status === 401) return "refresh";
  if (status !== 503 || !body || typeof body !== "object") return null;
  return (body as { code?: unknown }).code === AUTH_UNAVAILABLE_CODE ? "again" : null;
}

/** Read the plan without consuming the response the caller still has to parse. */
export async function authRetryPlanFromResponse(res: {
  status?: number;
  clone?: () => { json: () => Promise<unknown> };
  json?: () => Promise<unknown>;
}): Promise<AuthRetryPlan | null> {
  const status = typeof res.status === "number" ? res.status : 0;
  if (status === 401) return "refresh";
  if (status !== 503) return null;
  try {
    const source = typeof res.clone === "function" ? res.clone() : null;
    if (!source) return null;
    return authRetryPlan(status, await source.json());
  } catch {
    return null;
  }
}
