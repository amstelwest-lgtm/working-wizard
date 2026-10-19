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

type Membership = { clientId: string; role: string };
type RoleRow = { role: string };
type Books = { clients: OwnedClientSeat[]; memberships: Membership[]; roles: RoleRow[] };

/** Return paths copy the books. Insert adds a client row and leaves memberships and roles alone. */
function applyEnsureOwnClient(books: Books): Books {
  const decision = decideEnsureOwnClient(books.clients);
  const memberships = books.memberships.map((row) => ({ ...row }));
  const roles = books.roles.map((row) => ({ ...row }));
  if (decision.action === "return") {
    const found = books.clients.some((row) => row.id === decision.id);
    assert(found, "a return decision names a client the user already owns");
    return { clients: books.clients.map((row) => ({ ...row })), memberships, roles };
  }
  return {
    clients: [
      ...books.clients,
      { id: `blank-${books.clients.length + 1}`, firmId: null, createdAt: "2026-10-19T21:00:00.000Z", clientOwner: false },
    ],
    memberships,
    roles,
  };
}

function signIn(owned: OwnedClientSeat[]): OwnedClientSeat[] {
  return applyEnsureOwnClient({ clients: owned, memberships: [], roles: [] }).clients;
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

const accountantFirmClients: Books = {
  clients: [
    { id: "acme-books", firmId: "firm-9", createdAt: "2026-02-01T00:00:00.000Z", clientOwner: false },
    { id: "beta-books", firmId: "firm-9", createdAt: "2026-05-01T00:00:00.000Z", clientOwner: false },
  ],
  memberships: [],
  roles: [{ role: "accountant" }],
};
const accountantDecision = decideEnsureOwnClient(accountantFirmClients.clients);
assert(accountantDecision.action === "insert", "an accountant's firm clients are not returned as the seat");
const accountantAfter = applyEnsureOwnClient(accountantFirmClients);
assert(
  JSON.stringify(accountantAfter.memberships) === JSON.stringify(accountantFirmClients.memberships),
  "an accountant owning firm clients gets no membership change",
);
assert(
  JSON.stringify(accountantAfter.roles) === JSON.stringify(accountantFirmClients.roles),
  "an accountant owning firm clients gets no role change",
);
assert(
  accountantAfter.clients.filter((row) => row.firmId != null).every((row) => row.clientOwner === false),
  "firm clients stay without a client_owner membership",
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
const clientInsertAt = migration.indexOf("INSERT INTO public.clients");
assert(clientInsertAt > 0, "the migration still inserts a client when both lookups miss");
assert(
  migration.indexOf("m.role = 'client_owner'") < clientInsertAt,
  "membership lookup happens before any insert",
);
const beforeInsert = migration.slice(0, clientInsertAt);
assert(
  (beforeInsert.match(/RETURN v_client_id;/g) ?? []).length === 2,
  "both lookups return the existing id before the insert",
);
assert(migration.includes("p_name,"), "the insert uses the live p_name argument");
assert(!migration.includes("v_name"), "the live insert has no name fallback");
assert(!/insert\s+into\s+public\.client_memberships/i.test(migration), "the live body does not write client_memberships");
assert(!/insert\s+into\s+public\.user_roles/i.test(migration), "the live body does not write user_roles");
assert(!/update\s+public\.client_memberships/i.test(migration), "memberships are not updated");
assert(!/update\s+public\.user_roles/i.test(migration), "roles are not updated");
const lookups = beforeInsert.match(/SELECT[\s\S]*?LIMIT 1;/g) ?? [];
assert(lookups.length === 2, "there are two lookups and no oldest-owned fallback");
assert(lookups[0].includes("firm_id IS NULL") && !lookups[0].includes("client_memberships"), "the first lookup is the live firm-unlinked select");
assert(lookups[1].includes("client_memberships") && lookups[1].includes("m.role = 'client_owner'"), "the second lookup requires client_owner");
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
