/**
 * QuickBooks callback handler: duplicate realm is refused before upsert.
 * Run: pnpm test:qbo-callback
 */
import { handleQboCallbackGet, type QboCallbackAdmin } from "../src/routes/api/qbo/callback";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const yankees = "11111111-1111-4111-8111-111111111111";
const qaUs = "22222222-2222-4222-8222-222222222222";
const firm = "33333333-3333-4333-8333-333333333333";
const realm = "9341457958564018";

type Row = Record<string, unknown>;

function mockAdmin(tables: Record<string, Row[]>) {
  const upserts: Row[] = [];
  const admin = {
    upserts,
    from(table: string) {
      const rows = tables[table] ?? [];
      return {
        select() {
          const filters: Array<(row: Row) => boolean> = [];
          const run = () => rows.filter((row) => filters.every((fn) => fn(row)));
          const builder = {
            eq(column: string, value: string) {
              filters.push((row) => row[column] === value);
              return builder;
            },
            in(column: string, values: string[]) {
              filters.push((row) => values.includes(String(row[column] ?? "")));
              return Promise.resolve({ data: run(), error: null });
            },
            maybeSingle() {
              return Promise.resolve({ data: run()[0] ?? null, error: null });
            },
            then(
              onFulfilled?: ((value: { data: Row[]; error: null }) => unknown) | null,
              onRejected?: ((reason: unknown) => unknown) | null,
            ) {
              return Promise.resolve({ data: run(), error: null }).then(onFulfilled, onRejected);
            },
          };
          return builder;
        },
        delete() {
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
        upsert(row: Row) {
          upserts.push(row);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return admin;
}

function callbackRequest() {
  const url = new URL("https://app.example/api/qbo/callback");
  url.searchParams.set("code", "auth-code");
  url.searchParams.set("state", "csrf-state");
  url.searchParams.set("realmId", realm);
  return new Request(url);
}

function stateRow(clientId: string): Row {
  return {
    state: "csrf-state",
    client_id: clientId,
    return_path: `/clients/${clientId}`,
    created_at: new Date().toISOString(),
  };
}

async function run(tables: Record<string, Row[]>) {
  const admin = mockAdmin(tables);
  let exchanges = 0;
  const response = await handleQboCallbackGet(callbackRequest(), {
    admin: admin as unknown as QboCallbackAdmin,
    exchangeCodeForTokens: async () => {
      exchanges += 1;
      return { access_token: "access", refresh_token: "refresh", expires_in: 3600 };
    },
    fetchQboCompanyName: async () => "Yankees Books",
  });
  const location = response.headers.get("location") ?? "";
  const redirected = new URL(location);
  return { admin, exchanges, redirected, status: response.status };
}

const duplicate = await run({
  qbo_oauth_states: [stateRow(qaUs)],
  clients: [
    { id: qaUs, name: "QA US", firm_id: firm },
    { id: yankees, name: "New York Yankees", firm_id: firm },
  ],
  qbo_connections: [{ client_id: yankees, realm_id: realm }],
});
assert(duplicate.status === 302, `duplicate realm redirects, got ${duplicate.status}`);
assert(duplicate.redirected.searchParams.get("qbo") === "error", "duplicate realm is an error");
assert(
  duplicate.redirected.searchParams.get("reason") ===
    "This QuickBooks company is already connected to New York Yankees",
  `duplicate reason names the other client, got ${duplicate.redirected.searchParams.get("reason")}`,
);
assert(duplicate.admin.upserts.length === 0, "duplicate realm does not upsert");
assert(duplicate.exchanges === 0, "duplicate realm does not exchange the code");

const reconnect = await run({
  qbo_oauth_states: [stateRow(yankees)],
  clients: [{ id: yankees, name: "New York Yankees", firm_id: firm }],
  qbo_connections: [{ client_id: yankees, realm_id: realm }],
});
assert(reconnect.redirected.searchParams.get("qbo") === "connected", "same client may reconnect");
assert(reconnect.exchanges === 1, "reconnect exchanges the code");
assert(reconnect.admin.upserts.length === 1, "reconnect upserts the connection");
assert(reconnect.admin.upserts[0]?.client_id === yankees, "reconnect upsert stays on this client");
assert(reconnect.admin.upserts[0]?.realm_id === realm, "reconnect keeps the realm");

console.log("qbo-callback ok");
