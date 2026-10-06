/**
 * Accountant "Enter as client" stores the owner-board client in sessionStorage.
 * The auth attacher forwards it as x-acting-as-client-id, and server functions
 * then 403 any other client id. Firm pages (/clients/:id and the rest of the
 * practice) must use the firm principal, so they neither send the header nor
 * keep the session once the accountant opens a firm client page.
 */

export const ACTING_AS_CLIENT_ID_KEY = "acting_as_client_id";
export const ACTING_AS_CLIENT_NAME_KEY = "acting_as_client_name";

type ActingStorage = Pick<Storage, "getItem" | "removeItem">;

/** Owner board only. Firm routes stay on the firm principal. */
export function actingAsHeaderForPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === "/app" || pathname.startsWith("/app/");
}

/** Clears impersonation keys. Returns the client id that was active, if any. */
export function exitFirmClientMode(storage: ActingStorage | null | undefined): string | null {
  if (!storage) return null;
  const id = storage.getItem(ACTING_AS_CLIENT_ID_KEY);
  storage.removeItem(ACTING_AS_CLIENT_ID_KEY);
  storage.removeItem(ACTING_AS_CLIENT_NAME_KEY);
  return id && id.trim() ? id : null;
}

/** True when a server function rejected because impersonation scope did not match. */
export function isImpersonationForbidden(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") {
    return /forbidden|impersonation scope|status(?: code)?:?\s*403|\b403\b/i.test(error);
  }
  if (typeof error !== "object") return false;
  const record = error as { status?: unknown; statusCode?: unknown; message?: unknown };
  if (record.status === 403 || record.statusCode === 403) return true;
  if (typeof record.message === "string") return isImpersonationForbidden(record.message);
  return false;
}
