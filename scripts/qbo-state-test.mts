/**
 * QuickBooks OAuth callback checks — no I/O, no live Intuit calls.
 * Run: pnpm test:qbo-state
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  qboDuplicateRealmClientName,
  qboDuplicateRealmReason,
  qboOauthCallbackIssue,
  readQboRealmId,
  sanitizeQboOauthReason,
} from "../src/lib/qbo-state";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ok = {
  code: "auth-code",
  state: "csrf",
  realmId: "123",
  stateFound: true,
};

assert(qboOauthCallbackIssue(ok) === null, "complete callback proceeds");
assert(qboOauthCallbackIssue({ ...ok, code: null }) === "missing_code", "code is its own reason");
assert(qboOauthCallbackIssue({ ...ok, code: "" }) === "missing_code", "blank code");
assert(qboOauthCallbackIssue({ ...ok, state: null }) === "missing_state", "state query is its own reason");
assert(qboOauthCallbackIssue({ ...ok, realmId: null }) === "missing_realm", "realm is not missing_params");
assert(
  qboOauthCallbackIssue({ ...ok, stateFound: false }) === "invalid_or_expired_state",
  "unknown stored state is not missing_params",
);
assert(
  qboOauthCallbackIssue({ ...ok, code: null, stateFound: false }) === "missing_code",
  "query gaps win over a missing row",
);

assert(readQboRealmId(new URLSearchParams("realmId=9341457958564018")) === "9341457958564018", "documented realmId");
assert(readQboRealmId(new URLSearchParams("realmID=42")) === "42", "realmID casing");
assert(readQboRealmId(new URLSearchParams("realmid=7")) === "7", "lowercased realmid");
assert(readQboRealmId(new URLSearchParams("code=abc&state=s")) === null, "absent realm");
assert(readQboRealmId(new URLSearchParams("realmId=official&realmid=other")) === "official", "documented key wins");

assert(sanitizeQboOauthReason("access_denied") === "access_denied", "intuit error passes through");
assert(sanitizeQboOauthReason("Missing parameter: redirect_uri") === "denied", "prose is not a reason token");

const yankees = "11111111-1111-4111-8111-111111111111";
const qaUs = "22222222-2222-4222-8222-222222222222";
const firm = "33333333-3333-4333-8333-333333333333";
const otherFirm = "44444444-4444-4444-8444-444444444444";
const owners = [
  { clientId: yankees, clientName: "New York Yankees", firmId: firm },
  { clientId: qaUs, clientName: "QA US", firmId: firm },
];
assert(
  qboDuplicateRealmClientName({ clientId: qaUs, firmId: firm, owners }) === "New York Yankees",
  "same firm, other client blocks the realm",
);
assert(
  qboDuplicateRealmClientName({
    clientId: yankees,
    firmId: firm,
    owners: [{ clientId: yankees, clientName: "New York Yankees", firmId: firm }],
  }) === null,
  "the same client may reconnect its own realm",
);
assert(
  qboDuplicateRealmClientName({
    clientId: qaUs,
    firmId: otherFirm,
    owners: [{ clientId: yankees, clientName: "New York Yankees", firmId: firm }],
  }) === null,
  "a realm on another firm is not a duplicate",
);
assert(
  qboDuplicateRealmReason("New York Yankees") ===
    "This QuickBooks company is already connected to New York Yankees",
  "duplicate realm error names the other client",
);

const callbackSrc = readFileSync(resolve("src/routes/api/qbo/callback.ts"), "utf8");
assert(callbackSrc.includes("qboDuplicateRealmClientName"), "callback refuses a duplicate realm");
assert(callbackSrc.includes("qboDuplicateRealmReason"), "callback redirects with the client name");
assert(!callbackSrc.includes("onConflict: \"realm_id\""), "upsert stays per client");

console.log("qbo-state ok");
