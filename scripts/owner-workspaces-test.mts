/**
 * Owner multi-business list + active pick.
 * Run: pnpm test:owner-workspaces
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  boardRoleForWorkspace,
  canOpenOwnerWorkspace,
  mergeOwnerWorkspaces,
  ownerActiveClientStorageKey,
  pickActiveOwnerWorkspace,
  pickOwnedSettingsClient,
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

assert(canOpenOwnerWorkspace(merged, first), "owned workspace is openable");
assert(canOpenOwnerWorkspace(merged, staff), "membership workspace is openable");
assert(
  !canOpenOwnerWorkspace(merged, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
  "a foreign client id is not on this login’s list",
);
assert(!canOpenOwnerWorkspace(merged, "  "), "blank id is not openable");
assert(!canOpenOwnerWorkspace([], first), "empty list opens nothing");

assert(
  pickOwnedSettingsClient(
    [
      { id: first, firm_id: "firm-1" },
      { id: second, firm_id: null },
    ],
    first,
  )?.id === first,
  "settings follows the board’s last owned business",
);
assert(
  pickOwnedSettingsClient(
    [
      { id: first, firm_id: "firm-1" },
      { id: second, firm_id: null },
    ],
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  )?.id === second,
  "stale / foreign stored id cannot select someone else’s business in settings",
);

const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(appSrc.includes("mergeOwnerWorkspaces"), "founder board lists every owned + membership workspace");
assert(appSrc.includes("OwnerBusinessSwitcher"), "founder header has the business switcher");
assert(appSrc.includes("pickActiveOwnerWorkspace"), "founder board picks among all workspaces");
assert(appSrc.includes("canOpenOwnerWorkspace"), "switch refuses ids that are not on this login’s list");
assert(appSrc.includes("setExtractionForReview(null)"), "switch clears the previous business’s upload review");

const switcherSrc = readFileSync(resolve("src/components/owner-business-switcher.tsx"), "utf8");
assert(!switcherSrc.includes("<select"), "switcher is a premium menu, not a native select");
assert(switcherSrc.includes("canOpenOwnerWorkspace"), "menu only emits listed workspace ids");
assert(switcherSrc.includes("Your businesses"), "menu names the list");

const settingsSrc = readFileSync(resolve("src/routes/_authenticated/settings.index.tsx"), "utf8");
assert(settingsSrc.includes("pickOwnedSettingsClient"), "settings stays on the active owned business");
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
