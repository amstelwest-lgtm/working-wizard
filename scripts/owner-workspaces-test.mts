/**
 * Owner multi-business list + active pick.
 * Run: pnpm test:owner-workspaces
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  boardRoleForWorkspace,
  mergeOwnerWorkspaces,
  ownerActiveClientStorageKey,
  pickActiveOwnerWorkspace,
  workspaceDisplayName,
} from "../src/lib/owner-workspaces";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(workspaceDisplayName("  Karoo  ") === "Karoo", "trims name");
assert(workspaceDisplayName("") === "Untitled business", "empty name fallback");
assert(workspaceDisplayName(null) === "Untitled business", "null name fallback");

const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const staff = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const merged = mergeOwnerWorkspaces(
  [
    { id: first, name: "First Co" },
    { id: second, name: "Beta Shop" },
  ],
  [
    { client_id: first, role: "client_owner", name: "First Co" },
    { client_id: staff, role: "client_member", name: "Staff seat" },
    { client_id: second, role: "client_owner" },
  ],
);

assert(merged.length === 3, "owned + membership merge uniquely");
assert(merged.filter((w) => w.clientId === first).length === 1, "no duplicate for owned+member");
assert(merged.find((w) => w.clientId === first)?.role === "owner", "owned stays owner");
assert(merged.find((w) => w.clientId === staff)?.role === "member", "staff stays member");
assert(merged[0]!.role === "owner" && merged[1]!.role === "owner", "owners sort before members");
assert(merged[0]!.name === "Beta Shop", "owners sort alphabetically");
assert(merged[2]!.clientId === staff, "member after owners");

assert(
  pickActiveOwnerWorkspace({
    workspaces: merged,
    inviteClientId: staff,
    storedClientId: first,
  }) === staff,
  "just-accepted invite wins over stored last business",
);
assert(
  pickActiveOwnerWorkspace({
    workspaces: merged,
    storedClientId: first,
  }) === first,
  "stored last business wins when still on the list",
);
assert(
  pickActiveOwnerWorkspace({
    workspaces: merged,
    storedClientId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  }) === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "stale stored id falls back to first owned workspace",
);
assert(pickActiveOwnerWorkspace({ workspaces: [] }) === null, "empty list has no active");
assert(
  pickActiveOwnerWorkspace({
    workspaces: [{ clientId: staff, name: "Only member", role: "member" }],
  }) === staff,
  "membership-only login still opens that business",
);

assert(boardRoleForWorkspace("owner") === "client_owner", "owner workspace → owner board");
assert(boardRoleForWorkspace("member") === "client_member", "member workspace → member board");
assert(
  ownerActiveClientStorageKey("user-1") === "milon_owner_active_client:user-1",
  "per-user last-business key",
);

const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(appSrc.includes("mergeOwnerWorkspaces"), "founder board lists every owned + membership workspace");
assert(appSrc.includes("OwnerBusinessSwitcher"), "founder header has the business switcher");
assert(appSrc.includes("pickActiveOwnerWorkspace"), "founder board picks among all workspaces");
assert(
  !/from\("clients"\)[\s\S]{0,80}\.eq\("owner_user_id"[\s\S]{0,80}\.limit\(1\)/.test(
    appSrc.slice(appSrc.indexOf("const listWorkspaces"), appSrc.indexOf("const openInvitedClient")),
  ),
  "workspace list must not stop at the first owned client",
);

const serverSrc = readFileSync(resolve("src/lib/invite-member.server.ts"), "utf8");
assert(serverSrc.includes("replaceRoles: false"), "existing-account invite accept keeps prior roles");
assert(
  serverSrc.includes("acceptOwnerInviteForUser"),
  "existing owner redeem attaches the new business instead of creating a login",
);

console.log("owner-workspaces-test: ok");
