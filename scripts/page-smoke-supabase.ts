/**
 * In-memory Supabase client for the page-render smoke test.
 * `loading` never resolves a clients read, so the first paint stays on the
 * shell. `null` resolves an empty book. `loaded` resolves one workspace.
 * `revoked` keeps that workspace but answers a stored stale id with a
 * different name, so a premature by-id read would flash it. `error` fails
 * the owner workspace list (clients by owner, memberships by user).
 */

export type SmokeMode = "null" | "loading" | "loaded" | "revoked" | "error";

export const SMOKE_USER_ID = "11111111-1111-4111-8111-111111111111";
export const SMOKE_CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const STALE_CLIENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const STALE_CLIENT_NAME = "Revoked & Co";

let mode: SmokeMode = "null";
const rpcLog: string[] = [];

export function resetSmokeRpcLog() {
  rpcLog.length = 0;
}

export function smokeRpcLog(): readonly string[] {
  return rpcLog;
}

export function setSmokeMode(next: SmokeMode) {
  mode = next;
}

export function smokeMode(): SmokeMode {
  return mode;
}

const clientRow = {
  id: SMOKE_CLIENT_ID,
  name: "Harbour Books",
  business_type: "retail",
  client_code: "HB",
  operating_profile: {
    version: 1,
    payMotion: "time_delivery",
    volumeUnit: "billable_hours",
    templateId: "services_hours",
    secondaryVolumeUnits: [],
    debtorDaysDefault: 30,
    costShape: "payroll_heavy",
    seasonality: "flat",
    inventoryIntensity: "none",
    customerConcentration: "moderate",
    debtPosition: "light",
    ownerGoal: "survive_cash",
    primaryPressure: "cash",
    fyStartMonth: 3,
    businessTypeId: "professional_services",
    confirmedAt: "2026-09-01T00:00:00.000Z",
  },
  cash_runway_weeks: 12,
  last_forecast_at: null,
  financials: { revenue: "120000", periodMonths: "12" },
  financials_updated_at: "2026-09-30T00:00:00.000Z",
  reports_issued_count: 0,
  cashflow: null,
  market: { country: "ZA", regionCode: null },
  firm_id: null,
  is_demo: false,
  budget: null,
  owner_user_id: SMOKE_USER_ID,
  budget_updated_at: null,
  financial_year_start_month: 3,
};

const staleRow = {
  ...clientRow,
  id: STALE_CLIENT_ID,
  name: STALE_CLIENT_NAME,
  owner_user_id: "22222222-2222-4222-8222-222222222222",
};

type QueryFilter = { column: string; value: unknown };

function empty(kind: "list" | "single") {
  return Promise.resolve(kind === "list" ? { data: [], error: null } : { data: null, error: null });
}

function eqValue(filters: QueryFilter[], column: string): unknown {
  const hit = [...filters].reverse().find((row) => row.column === column);
  return hit?.value;
}

function includesId(filters: QueryFilter[], id: string): boolean {
  return filters.some(
    (row) => row.column === "id" && Array.isArray(row.value) && row.value.some((value) => value === id),
  );
}

function clientPayload(row: typeof clientRow, kind: "list" | "single") {
  if (kind === "single") return Promise.resolve({ data: row, error: null });
  return Promise.resolve({
    data: [{ id: row.id, name: row.name, owner_user_id: row.owner_user_id }],
    error: null,
  });
}

function settle(
  table: string,
  kind: "list" | "single",
  eqs: QueryFilter[],
  ins: QueryFilter[],
): Promise<{ data: unknown; error: { message: string } | null }> {
  if (mode === "loading" && table === "clients") return new Promise(() => {});
  if (mode === "error") {
    const workspaceList =
      (table === "clients" && eqValue(eqs, "owner_user_id") === SMOKE_USER_ID) ||
      (table === "client_memberships" && eqValue(eqs, "user_id") === SMOKE_USER_ID);
    if (workspaceList) return Promise.resolve({ data: null, error: { message: "boom" } });
  }
  if (mode === "revoked" && table === "clients") {
    const stale = eqValue(eqs, "id") === STALE_CLIENT_ID || includesId(ins, STALE_CLIENT_ID);
    return clientPayload(stale ? staleRow : clientRow, kind);
  }
  if (mode !== "loaded" || table !== "clients") return empty(kind);
  return clientPayload(clientRow, kind);
}

function builder(table: string) {
  const eqs: QueryFilter[] = [];
  const ins: QueryFilter[] = [];
  const self: Record<string, unknown> = {};
  const chain = () => self;
  for (const name of [
    "select",
    "neq",
    "is",
    "not",
    "or",
    "filter",
    "gte",
    "lte",
    "gt",
    "lt",
    "like",
    "ilike",
    "order",
    "limit",
    "range",
    "abortSignal",
    "insert",
    "update",
    "upsert",
    "delete",
    "match",
    "contains",
    "csv",
    "returns",
    "overrideTypes",
  ]) {
    self[name] = chain;
  }
  self.eq = (column: string, value: unknown) => {
    eqs.push({ column, value });
    return self;
  };
  self.in = (column: string, value: unknown) => {
    ins.push({ column, value });
    return self;
  };
  const run = (kind: "list" | "single") => settle(table, kind, eqs, ins);
  self.maybeSingle = () => run("single");
  self.single = () => run("single");
  self.then = (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    run("list").then(onFulfilled, onRejected);
  return self;
}

function session() {
  return {
    access_token: "smoke-access-token",
    refresh_token: "smoke-refresh-token",
    token_type: "bearer",
    user: {
      id: SMOKE_USER_ID,
      email: "ada@example.com",
      aud: "authenticated",
      created_at: "2026-01-01T00:00:00.000Z",
      app_metadata: { provider: "email" },
      user_metadata: { full_name: "Ada Owner", signup_type: "customer" },
      identities: [{ provider: "email" }],
    },
  };
}

function channel() {
  const api = {
    on() {
      return api;
    },
    subscribe(cb?: (status: string) => void) {
      cb?.("SUBSCRIBED");
      return api;
    },
    unsubscribe() {
      return Promise.resolve("ok");
    },
  };
  return api;
}

const auth = {
  async getSession() {
    return { data: { session: session() }, error: null };
  },
  async getUser() {
    return { data: { user: session().user }, error: null };
  },
  async signOut() {
    return { error: null };
  },
  async setSession() {
    return { data: { session: session() }, error: null };
  },
  onAuthStateChange(cb: (event: string, next: ReturnType<typeof session> | null) => void) {
    cb("INITIAL_SESSION", session());
    return { data: { subscription: { unsubscribe() {} } } };
  },
};

export const supabase = {
  from(table: string) {
    return builder(table);
  },
  rpc(name: string) {
    rpcLog.push(name);
    if (name === "is_milon_it_member") return Promise.resolve({ data: false, error: null });
    if (name === "ensure_own_client" && mode === "loaded") {
      return Promise.resolve({ data: SMOKE_CLIENT_ID, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  },
  channel,
  removeChannel() {
    return Promise.resolve("ok");
  },
  auth,
  functions: {
    invoke: async () => ({ data: null, error: null }),
  },
};
