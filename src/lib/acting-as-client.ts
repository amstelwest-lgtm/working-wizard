/**
 * Firm client workspace vs "Enter as client".
 * Opening /clients/:id from the practice list is not impersonation.
 * "Acting as client" is only true when this client is the active impersonation.
 */

export const ACTING_AS_CLIENT_KEY_PREFIX = "acting_as_client_id:";
/** Unscoped key from before the user id was part of the name. Sign-out removes it. Never read it. */
export const ACTING_AS_CLIENT_KEY = "acting_as_client_id";
export const ACTING_AS_CLIENT_NAME_PREFIX = "acting_as_client_name:";
export const ACTING_AS_CLIENT_NAME_KEY = "acting_as_client_name";

export function actingAsClientKey(userId: string): string {
  return `${ACTING_AS_CLIENT_KEY_PREFIX}${userId.trim()}`;
}

export function actingAsClientNameKey(userId: string): string {
  return `${ACTING_AS_CLIENT_NAME_PREFIX}${userId.trim()}`;
}

export function readActingAsClientId(userId: string | null | undefined): string | null {
  const id = userId?.trim() ?? "";
  if (!id || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(actingAsClientKey(id))?.trim() ?? "";
    return raw || null;
  } catch {
    return null;
  }
}

export function readActingAsClientName(userId: string | null | undefined): string | null {
  const id = userId?.trim() ?? "";
  if (!id || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(actingAsClientNameKey(id))?.trim() ?? "";
    return raw || null;
  } catch {
    return null;
  }
}

export function clearActingAsClientId(userId: string | null | undefined): void {
  const id = userId?.trim() ?? "";
  if (!id || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(actingAsClientKey(id));
    sessionStorage.removeItem(actingAsClientNameKey(id));
  } catch {
    /* private browsing */
  }
}

/** Drop every acting-as id in this tab, including the old unscoped key. */
export function clearActingAsClientIds(): void {
  if (typeof sessionStorage === "undefined") return;
  const drop: string[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key) continue;
      if (
        key === ACTING_AS_CLIENT_KEY ||
        key === ACTING_AS_CLIENT_NAME_KEY ||
        key.startsWith(ACTING_AS_CLIENT_KEY_PREFIX) ||
        key.startsWith(ACTING_AS_CLIENT_NAME_PREFIX)
      ) {
        drop.push(key);
      }
    }
    for (const key of drop) sessionStorage.removeItem(key);
  } catch {
    /* private browsing */
  }
}

export function isActingAsThisClient(
  actingAsClientId: string | null | undefined,
  clientId: string | null | undefined,
): boolean {
  const acting = (actingAsClientId ?? "").trim();
  const id = (clientId ?? "").trim();
  return acting.length > 0 && id.length > 0 && acting === id;
}

/** Breadcrumb on the firm client workspace. Name only, unless actually acting. */
export function firmClientCrumbLabel(clientName: string, acting: boolean): string {
  const name = clientName.trim() || "Client";
  return acting ? `Acting as client: ${name}` : name;
}
