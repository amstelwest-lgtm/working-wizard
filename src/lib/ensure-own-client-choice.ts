/**
 * When ensure_own_client may insert, and which owned client it must return.
 * The SQL function in 20261019190000_ensure_own_client_idempotent.sql is the
 * one that runs. This module is the same decision, so the Google callback and
 * the unit test can share it without a database.
 */

export type OwnedClientSeat = {
  id: string;
  firmId: string | null;
  createdAt: string;
  /** This user has a client_owner membership on the client. */
  clientOwner: boolean;
};

export type EnsureOwnClientDecision = { action: "return"; id: string } | { action: "insert" };

function byAge(a: OwnedClientSeat, b: OwnedClientSeat): number {
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Owned seats only. Firm-unlinked wins, then the oldest client_owner
 * membership. An owned firm client with no client_owner membership is not a
 * seat (create_firm_client makes the accountant the owner). Insert then.
 */
export function decideEnsureOwnClient(owned: readonly OwnedClientSeat[]): EnsureOwnClientDecision {
  const ordered = [...owned].sort(byAge);
  const unlinked = ordered.find((row) => row.firmId == null);
  if (unlinked) return { action: "return", id: unlinked.id };
  const member = ordered.find((row) => row.clientOwner);
  if (member) return { action: "return", id: member.id };
  return { action: "insert" };
}

/**
 * Google callback gate. Skip the RPC when the user already owns a client or
 * belongs to one. A failed read is null and does not count as a seat, matching
 * adminSignUp's "create only when none exists" check while also covering a
 * membership the user does not own.
 */
export function shouldCallEnsureOwnClient(input: {
  ownedIds: readonly unknown[] | null;
  membershipClientIds: readonly unknown[] | null;
}): boolean {
  if ((input.ownedIds?.length ?? 0) > 0) return false;
  if ((input.membershipClientIds?.length ?? 0) > 0) return false;
  return true;
}
