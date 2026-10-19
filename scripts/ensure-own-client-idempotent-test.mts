/**
 * A linked owner signing in again must not gain a blank client.
 * Run: pnpm test:ensure-own-client-idempotent
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  decideEnsureOwnClient,
  shouldCallEnsureOwnClient,
  type OwnedClientSeat,
} from "../src/lib/ensure-own-client-choice.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const migration = readFileSync(
  resolve("supabase/migrations/20261019190000_ensure_own_client_idempotent.sql"),
  "utf8",
);
const callback = readFileSync(resolve("src/routes/auth_.callback.tsx"), "utf8");

function signIn(owned: OwnedClientSeat[]): OwnedClientSeat[] {
  const decision = decideEnsureOwnClient(owned);
  if (decision.action === "return") {
    const found = owned.some((row) => row.id === decision.id);
    assert(found, "a return decision names a client the user already owns");
    return owned;
  }
  return [
    ...owned,
    { id: `blank-${owned.length + 1}`, firmId: null, createdAt: "2026-10-19T21:00:00.000Z", clientOwner: true },
  ];
}

const linked: OwnedClientSeat[] = [
  { id: "linked-biz", firmId: "firm-1", createdAt: "2026-03-01T00:00:00.000Z", clientOwner: true },
];
const afterFirst = signIn(linked);
const afterSecond = signIn(afterFirst);
assert(afterFirst.length === 1 && afterFirst[0].id === "linked-biz", "a linked owner sign-in inserts no row");
assert(afterSecond.length === 1 && afterSecond[0].id === "linked-biz", "signing in again still inserts no row");
assert(decideEnsureOwnClient(linked).action === "return", "the linked seat is returned");
if (decideEnsureOwnClient(linked).action === "return") {
  assert(decideEnsureOwnClient(linked).id === "linked-biz", "the returned id is the linked business");
}

const linkedWithoutMembership: OwnedClientSeat[] = [
  { id: "linked-no-role", firmId: "firm-1", createdAt: "2026-04-01T00:00:00.000Z", clientOwner: false },
];
assert(
  signIn(linkedWithoutMembership).length === 1,
  "owning a linked client is enough to skip the insert",
);

const twoLinked: OwnedClientSeat[] = [
  { id: "older-plain", firmId: "firm-1", createdAt: "2026-01-01T00:00:00.000Z", clientOwner: false },
  { id: "newer-owner", firmId: "firm-1", createdAt: "2026-06-01T00:00:00.000Z", clientOwner: true },
];
const picked = decideEnsureOwnClient(twoLinked);
assert(picked.action === "return" && picked.id === "newer-owner", "client_owner membership wins over an older owned seat");

const unlinkedAndLinked: OwnedClientSeat[] = [
  { id: "old-linked", firmId: "firm-1", createdAt: "2026-01-01T00:00:00.000Z", clientOwner: true },
  { id: "blank", firmId: null, createdAt: "2026-08-01T00:00:00.000Z", clientOwner: true },
];
const kept = decideEnsureOwnClient(unlinkedAndLinked);
assert(kept.action === "return" && kept.id === "blank", "an existing firm-unlinked client is reused");
assert(signIn(unlinkedAndLinked).length === 2, "an existing blank is not joined by another blank");

const created = signIn([]);
assert(created.length === 1 && created[0].firmId == null, "a user who owns nothing gets one client");
assert(signIn(created).length === 1, "the second sign-in reuses that client");

assert(shouldCallEnsureOwnClient({ ownedIds: [], membershipClientIds: [] }) === true, "a new Google user still calls the RPC");
assert(
  shouldCallEnsureOwnClient({ ownedIds: [{ id: "linked-biz" }], membershipClientIds: [] }) === false,
  "an owner who already owns a client skips the Google RPC",
);
assert(
  shouldCallEnsureOwnClient({ ownedIds: [], membershipClientIds: [{ client_id: "invited" }] }) === false,
  "a user who already belongs to a client skips the Google RPC",
);
assert(
  shouldCallEnsureOwnClient({ ownedIds: null, membershipClientIds: null }) === true,
  "a failed seat read still calls the RPC",
);

assert(migration.includes("pg_advisory_xact_lock"), "the migration keeps the advisory lock");
assert(migration.includes("firm_id IS NULL"), "the migration still prefers a firm-unlinked owned client");
assert(migration.includes("m.role = 'client_owner'"), "the migration falls back to a client_owner membership");
assert(
  migration.indexOf("firm_id IS NULL") < migration.indexOf("m.role = 'client_owner'"),
  "firm-unlinked is checked before the membership fallback",
);
assert(
  migration.indexOf("m.role = 'client_owner'") < migration.indexOf("INSERT INTO public.clients"),
  "membership lookup happens before any insert",
);
assert(!/create\s+unique\s+index/i.test(migration), "owners may own several clients in one firm");
assert(!/update\s+public\.clients/i.test(migration), "existing client rows are not updated");
assert(!/delete\s+from\s+public\.clients/i.test(migration), "existing client rows are not deleted");

assert(callback.includes("shouldCallEnsureOwnClient"), "the Google callback skips the RPC when a seat exists");
assert(
  callback.indexOf("shouldCallEnsureOwnClient") < callback.indexOf("ensure_own_client"),
  "the seat check runs before ensure_own_client",
);
assert(callback.includes('from("client_memberships")'), "the callback treats a membership as an existing seat");
assert(callback.includes('eq("owner_user_id", user.id)'), "the callback treats an owned client as an existing seat");

console.log("ensure-own-client-idempotent: ok");
