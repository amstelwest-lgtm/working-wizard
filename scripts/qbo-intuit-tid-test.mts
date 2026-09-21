/**
 * intuit_tid capture on the shared QBO HTTP client. No live Intuit calls.
 * Run: pnpm test:qbo-intuit-tid
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  exchangeCodeForTokens,
  intuitTidFromError,
  QboHttpError,
  qboGet,
  qboRequestPath,
  readIntuitTid,
  refreshQboToken,
  revokeQboToken,
} from "../src/lib/qbo";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  qboRequestPath(
    "https://sandbox-quickbooks.api.intuit.com/v3/company/1/query?query=SELECT%20secret&minorversion=70",
  ) === "/v3/company/1/query",
  "log path drops the query string",
);
assert(
  readIntuitTid(new Headers({ intuit_tid: "tid_from_underscore" })) === "tid_from_underscore",
  "intuit_tid",
);
assert(
  readIntuitTid(new Headers({ "Intuit-Tid": "tid-from-hyphen" })) === "tid-from-hyphen",
  "intuit-tid fallback",
);
assert(
  readIntuitTid(new Headers({ intuit_tid: "primary", "intuit-tid": "secondary" })) === "primary",
  "prefer intuit_tid when both are present",
);
assert(readIntuitTid({ get: () => "bad\ntid" }) === null, "reject log injection");
assert(readIntuitTid({ get: () => `x${"a".repeat(200)}` }) === null, "reject oversized tid");
assert(intuitTidFromError(new Error("plain")) === null, "plain errors have no tid");
{
  const inner = new QboHttpError("inner", {
    intuitTid: "cause-tid",
    status: 401,
    path: "/oauth2/v1/tokens/bearer",
  });
  const wrapped = new Error("Sync failed: inner");
  wrapped.cause = inner;
  assert(intuitTidFromError(wrapped) === "cause-tid", "tid is read from error.cause");
}

const src = readFileSync(resolve("src/lib/qbo.ts"), "utf8");
const fetchCalls = src.match(/\bfetch\s*\(/g) ?? [];
assert(
  fetchCalls.length === 1,
  `qbo.ts must fetch only inside qboFetch, found ${fetchCalls.length}`,
);
assert(src.includes("async function qboFetch"), "shared qboFetch wrapper");

const logs: Array<{ level: string; args: unknown[] }> = [];
const originalFetch = globalThis.fetch;
const originalInfo = console.info;
const originalError = console.error;
const envKeys = [
  "QBO_CLIENT_ID",
  "QBO_CLIENT_SECRET",
  "QBO_REDIRECT_URI",
  "QBO_ENVIRONMENT",
] as const;
const savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));

console.info = (...args: unknown[]) => {
  logs.push({ level: "info", args });
};
console.error = (...args: unknown[]) => {
  logs.push({ level: "error", args });
};

function loggedText(): string {
  return JSON.stringify(logs);
}

function qboLines(): Array<{ level: string; fields: Record<string, unknown> }> {
  return logs
    .filter(
      (line) => line.args[0] === "qbo.response" && line.args[1] && typeof line.args[1] === "object",
    )
    .map((line) => ({ level: line.level, fields: line.args[1] as Record<string, unknown> }));
}

try {
  process.env.QBO_CLIENT_ID = "client-id";
  process.env.QBO_CLIENT_SECRET = "client-secret-value";
  process.env.QBO_REDIRECT_URI = "https://milonfinance.com/api/qbo/callback";
  process.env.QBO_ENVIRONMENT = "sandbox";

  globalThis.fetch = async (input) => {
    const url = String(input);
    assert(url.startsWith("https://sandbox-quickbooks.api.intuit.com/v3/company/999/query?"), url);
    assert(!url.includes("secret-access-token"), "token must not be in the URL");
    return new Response(JSON.stringify({ QueryResponse: {} }), {
      status: 200,
      headers: { intuit_tid: "sync-tid-1" },
    });
  };

  await qboGet("999", "secret-access-token", "/query?query=SELECT%20*%20FROM%20Account");
  const okLine = qboLines().at(-1);
  assert(okLine?.level === "info", "success is info");
  assert(okLine?.fields.intuit_tid === "sync-tid-1", "success logs intuit_tid");
  assert(okLine?.fields.status === 200, "success status");
  assert(okLine?.fields.path === "/v3/company/999/query", "success path has no query");
  assert(okLine?.fields.realm_id === "999", "realm id when in scope");
  assert(!loggedText().includes("secret-access-token"), "access token is not logged");
  assert(!loggedText().includes("SELECT"), "query string is not logged");

  globalThis.fetch = async () =>
    new Response("nope", {
      status: 401,
      headers: { "intuit-tid": "err-tid-hyphen" },
    });
  let thrown: unknown;
  try {
    await qboGet("realm1", "secret-access-token", "/reports/ProfitAndLoss?start_date=2026-01-01");
  } catch (err) {
    thrown = err;
  }
  assert(thrown instanceof QboHttpError, "API errors are QboHttpError");
  if (!(thrown instanceof QboHttpError)) throw new Error("unreachable");
  assert(thrown.intuitTid === "err-tid-hyphen", "hyphen header on the error");
  assert(thrown.status === 401, "status on the error");
  assert(thrown.path === "/v3/company/realm1/reports/ProfitAndLoss", "error path strips the query");
  assert(thrown.realmId === "realm1", "realm on the error");
  assert(!thrown.message.includes("start_date"), "error message has no query");
  assert(!thrown.message.includes("secret-access-token"), "error message has no token");
  const errLine = qboLines().at(-1);
  assert(errLine?.level === "error", "HTTP errors log at error");
  assert(errLine?.fields.intuit_tid === "err-tid-hyphen", "error log includes tid");
  assert(errLine?.fields.realm_id === "realm1", "error log includes realm");

  globalThis.fetch = async (_input, init) => {
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : "";
    assert(body.includes("code=auth-code-secret"), "request still sends the code");
    return new Response(
      JSON.stringify({ error: "invalid_grant", access_token: "SHOULD_NOT_LEAK" }),
      {
        status: 400,
        headers: { intuit_tid: "token-tid" },
      },
    );
  };
  let tokenErr: unknown;
  try {
    await exchangeCodeForTokens("auth-code-secret");
  } catch (err) {
    tokenErr = err;
  }
  assert(tokenErr instanceof QboHttpError, "token exchange errors carry tid");
  if (!(tokenErr instanceof QboHttpError)) throw new Error("unreachable");
  assert(tokenErr.intuitTid === "token-tid", "token endpoint tid");
  assert(tokenErr.path === "/oauth2/v1/tokens/bearer", "token path");
  assert(tokenErr.realmId === undefined, "token call has no realm");
  assert(!tokenErr.message.includes("auth-code-secret"), "auth code stays out of the error");
  assert(!tokenErr.message.includes("client-secret-value"), "client secret stays out of the error");
  assert(!tokenErr.message.includes("SHOULD_NOT_LEAK"), "response token is redacted");
  assert(tokenErr.message.includes("[redacted]"), "redaction marker");
  assert(!loggedText().includes("auth-code-secret"), "auth code is not logged");
  assert(!loggedText().includes("client-secret-value"), "client secret is not logged");
  assert(!loggedText().includes("SHOULD_NOT_LEAK"), "leaked token field is not logged");
  assert(qboLines().at(-1)?.fields.intuit_tid === "token-tid", "token error log has tid");

  globalThis.fetch = async (_input, init) => {
    const body = init?.body instanceof URLSearchParams ? init.body.toString() : "";
    assert(body.includes("refresh_token=refresh-secret-value"), "refresh body is sent");
    return new Response("{}", { status: 200, headers: { intuit_tid: "refresh-tid" } });
  };
  await refreshQboToken("refresh-secret-value");
  assert(qboLines().at(-1)?.fields.intuit_tid === "refresh-tid", "refresh logs tid");
  assert(!loggedText().includes("refresh-secret-value"), "refresh token is not logged");

  globalThis.fetch = async (_input, init) => {
    const body = typeof init?.body === "string" ? init.body : "";
    assert(body.includes("revoke-token-value"), "revoke body is sent");
    return new Response("", { status: 400, headers: { intuit_tid: "revoke-tid" } });
  };
  await revokeQboToken("revoke-token-value");
  const revokeLine = qboLines().at(-1);
  assert(revokeLine?.fields.intuit_tid === "revoke-tid", "revoke still captures tid");
  assert(revokeLine?.fields.status === 400, "revoke status");
  assert(!loggedText().includes("revoke-token-value"), "revoked token is not logged");
} finally {
  globalThis.fetch = originalFetch;
  console.info = originalInfo;
  console.error = originalError;
  for (const key of envKeys) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}

console.log("qbo intuit_tid ok");
