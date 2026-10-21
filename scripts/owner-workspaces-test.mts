/**
 * Owner multi-business list + active pick.
 * Run: pnpm test:owner-workspaces
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  boardRoleForWorkspace,
  canOpenOwnerWorkspace,
  clearStoredOwnerClientId,
  confirmedOwnerClientId,
  decideStoredClientAccess,
  inviteWorkspaceAlreadyKnown,
  mergeOwnerWorkspaces,
  nextWorkspaceListStep,
  ownerActiveClientStorageKey,
  ownerBootShellName,
  pickActiveOwnerWorkspace,
  pickOwnedSettingsClient,
  readStoredOwnerClientId,
  workspaceDisplayName,
  writeStoredOwnerClientId,
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
assert(switcherSrc.includes("never someone else’s"), "menu states the isolation rule");

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

const stale = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const revoked = decideStoredClientAccess({ storedClientId: stale, workspaces: merged });
assert(revoked.phase === "revoked", "a stored id missing from a successful list is revoked");
assert(confirmedOwnerClientId(revoked) === null, "revoked access loads no client data");
assert(
  ownerBootShellName({ phase: "revoked", rememberedName: "Old Co", confirmedName: "Beta Shop" }) ===
    "Your business",
  "revoked access does not paint the old client name",
);

const inflight = decideStoredClientAccess({ storedClientId: first, workspaces: null });
assert(inflight.phase === "provisional" && inflight.clientId === first, "a stored id paints while the list is in flight");
assert(confirmedOwnerClientId(inflight) === null, "the provisional shell does not load figures");
assert(
  ownerBootShellName({ phase: "provisional", rememberedName: "First Co", confirmedName: "Beta Shop" }) ===
    "Your business",
  "the provisional shell does not paint a client name before access is confirmed",
);

const confirmed = decideStoredClientAccess({ storedClientId: first, workspaces: merged });
assert(confirmed.phase === "confirmed", "a stored id still on the list is confirmed");
assert(confirmedOwnerClientId(confirmed) === first, "a confirmed id may load the board");
assert(
  decideStoredClientAccess({ storedClientId: first, workspaces: [], failed: true }).phase === "error",
  "a failed workspace read is an error, not an empty list",
);

assert(nextWorkspaceListStep({ inviting: true, outcome: "empty", attempt: 0, maxAttempts: 5 }) === "retry", "an invite retries a successful empty read");
assert(nextWorkspaceListStep({ inviting: true, outcome: "empty", attempt: 4, maxAttempts: 5 }) === "fall-through", "the last empty invite read stops retrying");
assert(nextWorkspaceListStep({ inviting: false, outcome: "empty", attempt: 0, maxAttempts: 5 }) === "fall-through", "a successful empty read without an invite does not retry");
assert(nextWorkspaceListStep({ inviting: true, outcome: "error", attempt: 0, maxAttempts: 5 }) === "error", "an invite does not retry a failed read");
assert(nextWorkspaceListStep({ inviting: false, outcome: "error", attempt: 0, maxAttempts: 1 }) === "error", "a failed read is not treated as no workspace");
assert(nextWorkspaceListStep({ inviting: false, outcome: "rows", attempt: 0, maxAttempts: 1 }) === "apply", "rows apply on the first read");

assert(
  inviteWorkspaceAlreadyKnown([{ clientId: first, role: "owner" }], first),
  "an owned or client_owner workspace is already known",
);
assert(
  !inviteWorkspaceAlreadyKnown([{ clientId: first, role: "member" }], first),
  "a member-only invite still opens",
);
assert(!inviteWorkspaceAlreadyKnown([], first), "no workspace yet still opens the invite");

const listSlice = appSrc.slice(appSrc.indexOf("const listWorkspaces"), appSrc.indexOf("const openInvitedClient"));
assert(listSlice.includes("Promise.all"), "owned clients and memberships are read together");
const parallel = listSlice.slice(listSlice.indexOf("Promise.all"), listSlice.indexOf('.in("id"'));
assert(parallel.includes('from("clients")') && parallel.includes("client_memberships"), "both list reads sit in the same Promise.all");
assert(listSlice.indexOf('.in("id"') > listSlice.indexOf("Promise.all"), "clients.in stays behind the membership result");
assert(
  listSlice.includes("ownedRes.value.error || memRes.value.error"),
  "a PostgREST error is not read as an empty list",
);
assert(!appSrc.includes("setEffectiveClientId(storedClientId)"), "the stored id is not the board client before the list confirms it");
assert(!appSrc.includes("setEffectiveClientId(readStoredOwnerClientId"), "financials do not start from the stored id");
assert(appSrc.includes('access.phase === "revoked"'), "revoked access is handled on the board");
assert(appSrc.includes("clearStoredOwnerClientId"), "revoked access clears the stored client id");
assert(appSrc.includes('data-owner-boot={provisional ? "provisional" : "pending"}'), "the in-flight shell is marked provisional");
assert(appSrc.includes("provisionalWhileAuth"), "a stored client paints the shell while auth is still restoring");

const loadErrorAt = appSrc.indexOf('data-owner-boot="load-error"');
const loadError = appSrc.slice(loadErrorAt, loadErrorAt + 800);
assert(loadErrorAt > 0, "a failed workspace list has its own state");
assert(loadError.includes("Couldn't load your workspace"), "a failed read says the workspace did not load");
assert(loadError.includes("Retry"), "a failed read offers Retry");
assert(!loadError.toLowerCase().includes("no workspace"), "a failed read is not the no-workspace path");
assert(!loadError.includes("ensure_own_client"), "a failed read does not provision a client");

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size;
  },
} as Storage;
const host = globalThis as { localStorage?: Storage };
const priorStorage = host.localStorage;
host.localStorage = storage;
try {
  writeStoredOwnerClientId("user-1", stale);
  assert(readStoredOwnerClientId("user-1") === stale, "the stored id round-trips");
  clearStoredOwnerClientId("user-1");
  assert(readStoredOwnerClientId("user-1") === null, "clearing a revoked id drops the stored client");
} finally {
  if (priorStorage === undefined) delete host.localStorage;
  else host.localStorage = priorStorage;
}

const profileSrc = readFileSync(resolve("src/contexts/accountant-profile.tsx"), "utf8");
assert(profileSrc.includes("if (deferSideReads) return"), "profiles wait until the owner board is ready");
assert(appSrc.includes("reportOwnerBoardReady"), "the owner board publishes when it is ready");
assert(appSrc.includes("if (!user || !ownerGateSettled) return"), "the practice bounce waits for the owner gate");

console.log("owner-workspaces-test: ok");
