/**
 * Owner board: list every business this login can open, and pick which one
 * is active. An existing owner invited to another workspace keeps the first
 * business and adds the new one — no second auth account.
 */
export const OWNER_ACTIVE_CLIENT_KEY_PREFIX = "milon_owner_active_client:";

export type OwnerWorkspaceRole = "owner" | "member";

export type OwnerWorkspace = {
  clientId: string;
  name: string;
  role: OwnerWorkspaceRole;
};

export type OwnedClientRow = {
  id: string;
  name?: string | null;
};

export type MembershipClientRow = {
  client_id: string;
  role?: string | null;
  name?: string | null;
};

export function ownerActiveClientStorageKey(userId: string): string {
  return `${OWNER_ACTIVE_CLIENT_KEY_PREFIX}${userId.trim()}`;
}

export function workspaceDisplayName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed || "Untitled business";
}

function membershipIsOwner(role: string | null | undefined): boolean {
  return role === "client_owner";
}

export function mergeOwnerWorkspaces(
  owned: OwnedClientRow[] | null | undefined,
  memberships: MembershipClientRow[] | null | undefined,
): OwnerWorkspace[] {
  const map = new Map<string, OwnerWorkspace>();

  for (const row of owned ?? []) {
    const id = row.id?.trim();
    if (!id) continue;
    map.set(id, {
      clientId: id,
      name: workspaceDisplayName(row.name),
      role: "owner",
    });
  }

  for (const row of memberships ?? []) {
    const id = row.client_id?.trim();
    if (!id) continue;
    const existing = map.get(id);
    const isOwner = existing?.role === "owner" || membershipIsOwner(row.role);
    map.set(id, {
      clientId: id,
      name: workspaceDisplayName(row.name || existing?.name),
      role: isOwner ? "owner" : "member",
    });
  }

  return [...map.values()].sort((a, b) => {
    if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/**
 * Just-accepted invite wins, then the last business they picked, then the
 * first owned workspace, then any membership.
 */
export function pickActiveOwnerWorkspace(opts: {
  workspaces: OwnerWorkspace[];
  inviteClientId?: string | null;
  storedClientId?: string | null;
}): string | null {
  const ids = new Set(opts.workspaces.map((w) => w.clientId));
  const invite = opts.inviteClientId?.trim() ?? "";
  if (invite && ids.has(invite)) return invite;
  const stored = opts.storedClientId?.trim() ?? "";
  if (stored && ids.has(stored)) return stored;
  const owned = opts.workspaces.find((w) => w.role === "owner");
  return owned?.clientId ?? opts.workspaces[0]?.clientId ?? null;
}

export function readStoredOwnerClientId(userId: string): string | null {
  if (typeof window === "undefined" || !userId.trim()) return null;
  try {
    const raw = localStorage.getItem(ownerActiveClientStorageKey(userId));
    return raw?.trim() || null;
  } catch {
    return null;
  }
}

export function writeStoredOwnerClientId(userId: string, clientId: string): void {
  if (typeof window === "undefined" || !userId.trim() || !clientId.trim()) return;
  try {
    localStorage.setItem(ownerActiveClientStorageKey(userId), clientId.trim());
  } catch {
    /* private browsing / quota */
  }
}

export function boardRoleForWorkspace(role: OwnerWorkspaceRole): "client_owner" | "client_member" {
  return role === "owner" ? "client_owner" : "client_member";
}

/** Only IDs already on this login’s workspace list can become the active board. */
export function canOpenOwnerWorkspace(
  workspaces: OwnerWorkspace[],
  clientId: string | null | undefined,
): boolean {
  const id = clientId?.trim() ?? "";
  return Boolean(id) && workspaces.some((w) => w.clientId === id);
}

/**
 * Settings tools (invite accountant, market) stay on a business this login
 * owns. Prefer the board’s last pick when it is still in that owned set.
 */
export function pickOwnedSettingsClient<T extends { id?: string | null; firm_id?: string | null }>(
  rows: T[],
  storedClientId?: string | null,
): T | null {
  const stored = storedClientId?.trim() ?? "";
  if (stored) {
    const match = rows.find((r) => (r.id ?? "").trim() === stored);
    if (match) return match;
  }
  return rows.find((r) => !r.firm_id) ?? rows[0] ?? null;
}
