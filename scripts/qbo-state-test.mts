/**
 * QuickBooks OAuth callback checks — no I/O, no live Intuit calls.
 * Run: pnpm test:qbo-state
 */
import { qboOauthCallbackIssue, readQboRealmId, sanitizeQboOauthReason } from "../src/lib/qbo-state";

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

console.log("qbo-state ok");
