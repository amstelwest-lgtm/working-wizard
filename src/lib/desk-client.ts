const DESK_KEY = "milon.deskClientId";

/** Last client whose desk the accountant opened. Practice "Desk" uses this. */
export function rememberDeskClient(clientId: string) {
  if (!clientId) return;
  try {
    sessionStorage.setItem(DESK_KEY, clientId);
  } catch {
    /* private mode */
  }
}

export function readDeskClient(): string | null {
  try {
    const id = sessionStorage.getItem(DESK_KEY);
    return id && id.trim() ? id : null;
  } catch {
    return null;
  }
}
