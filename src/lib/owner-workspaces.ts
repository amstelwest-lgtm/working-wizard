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
  /**
   * Set on a practice file. `clients.owner_user_id` there is the accountant
   * who added the client, not the business owner.
   */
  firmId?: string | null;
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

/**
 * Business-owner seat. A `client_owner` membership is the business owner.
 * On a practice file, `owner_user_id` is the accountant who added the client,
 * so that match is not the owner. A self-serve file (no firm) still treats
 * `owner_user_id` as the owner.
 */
export function isBusinessOwnerSeat(input: {
  userId: string;
  ownerUserId: string | null;
  firmId: string | null;
  membershipRole: string | null;
}): boolean {
  if ((input.membershipRole ?? "").trim() === "client_owner") return true;
  if (input.firmId) return false;
  const userId = input.userId.trim();
  return Boolean(userId) && userId === (input.ownerUserId ?? "");
}

/** Role inferred when `user_roles` has no row. A firm file's owner_user_id is not the business owner. */
export function fallbackOwnerAppRole(input: {
  hasSelfServeOwned: boolean;
  membershipRoles: readonly (string | null | undefined)[];
}): "client_owner" | "client_member" | null {
  if (input.membershipRoles.some((role) => (role ?? "").trim() === "client_owner"))
    return "client_owner";
  if (input.hasSelfServeOwned) return "client_owner";
  if (input.membershipRoles.some((role) => Boolean((role ?? "").trim()))) return "client_member";
  return null;
}

export function mergeOwnerWorkspaces(
  owned: OwnedClientRow[] | null | undefined,
  memberships: MembershipClientRow[] | null | undefined,
): OwnerWorkspace[] {
  const map = new Map<string, OwnerWorkspace>();

  for (const row of owned ?? []) {
    const id = row.id?.trim();
    if (!id) continue;
    if (row.firmId) continue;
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

function browserLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStoredOwnerClientId(userId: string): string | null {
  const storage = browserLocalStorage();
  if (!storage || !userId.trim()) return null;
  try {
    const raw = storage.getItem(ownerActiveClientStorageKey(userId));
    return raw?.trim() || null;
  } catch {
    return null;
  }
}

export function writeStoredOwnerClientId(userId: string, clientId: string): void {
  const storage = browserLocalStorage();
  if (!storage || !userId.trim() || !clientId.trim()) return;
  try {
    storage.setItem(ownerActiveClientStorageKey(userId), clientId.trim());
  } catch {
    /* private browsing / quota */
  }
}

/** Drop a stored client the latest workspace list no longer includes. */
export function clearStoredOwnerClientId(userId: string): void {
  const storage = browserLocalStorage();
  if (!storage || !userId.trim()) return;
  try {
    storage.removeItem(ownerActiveClientStorageKey(userId));
  } catch {
    /* private browsing / quota */
  }
}

export type StoredClientAccess =
  | { phase: "idle" }
  | { phase: "provisional"; clientId: string }
  | { phase: "confirmed"; clientId: string }
  | { phase: "revoked" }
  | { phase: "error" };

/**
 * Stored id while the workspace list is in flight is a shell only.
 * A successful list that omits that id is revoked: clear it, do not paint it.
 * A failed list is an error, not an empty book.
 */
export function decideStoredClientAccess(input: {
  storedClientId?: string | null;
  /** Null until listWorkspaces returns a successful list. */
  workspaces: readonly { clientId: string }[] | null;
  failed?: boolean;
}): StoredClientAccess {
  if (input.failed) return { phase: "error" };
  const stored = input.storedClientId?.trim() ?? "";
  if (input.workspaces == null) {
    return stored ? { phase: "provisional", clientId: stored } : { phase: "idle" };
  }
  if (!stored) return { phase: "idle" };
  if (input.workspaces.some((row) => row.clientId === stored)) {
    return { phase: "confirmed", clientId: stored };
  }
  return { phase: "revoked" };
}

/** Id that may load figures, financials, or scores. Provisional and revoked stay closed. */
export function confirmedOwnerClientId(access: StoredClientAccess): string | null {
  return access.phase === "confirmed" ? access.clientId : null;
}

/**
 * Header on the boot shell. The stored id has no name, and a revoked id must
 * not paint one. The real name waits until the list confirms access.
 */
export function ownerBootShellName(input: {
  phase: StoredClientAccess["phase"];
  rememberedName?: string | null;
  confirmedName?: string | null;
}): string {
  if (input.phase === "provisional" || input.phase === "revoked" || input.phase === "error") {
    return "Your business";
  }
  const confirmed = input.confirmedName?.trim();
  return confirmed || "Your business";
}

export type WorkspaceListOutcome = "rows" | "empty" | "error";

/**
 * Retry only a successful empty read, and only while an invite is still landing.
 * An error stops. A successful empty with no invite falls through once.
 */
export function nextWorkspaceListStep(input: {
  inviting: boolean;
  outcome: WorkspaceListOutcome;
  attempt: number;
  maxAttempts: number;
}): "apply" | "retry" | "error" | "fall-through" {
  if (input.outcome === "error") return "error";
  if (input.outcome === "rows") return "apply";
  if (input.inviting && input.attempt < input.maxAttempts - 1) return "retry";
  return "fall-through";
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
