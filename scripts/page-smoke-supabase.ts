/**
 * In-memory Supabase client for the page-render smoke test.
 * `loading` never resolves a clients read, so the first paint stays on the
 * shell. `null` resolves an empty book. `loaded` resolves one workspace.
 * `revoked` keeps that workspace but answers a stored stale id with a
 * different name, so a premature by-id read would flash it. `error` fails
 * the owner workspace list (clients by owner, memberships by user).
 */

export type SmokeMode =
  | "null"
  | "loading"
  | "loaded"
  | "revoked"
  | "error"
  | "hang-once"
  | "hang-twice"
  | "critical-down"
  | "section-down"
  | "client-hang-twice"
  | "invite-roles-hang"
  | "invite-slow-chain"
  | "invite-fresh"
  | "hedge-slow-read"
  | "progress-ceiling";

export const SMOKE_USER_ID = "11111111-1111-4111-8111-111111111111";
export const SMOKE_CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const STALE_CLIENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const STALE_CLIENT_NAME = "Revoked & Co";

const INVITE_META_MODES = new Set<SmokeMode>([
  "invite-roles-hang",
  "invite-slow-chain",
  "invite-fresh",
  "hedge-slow-read",
  "progress-ceiling",
]);

let mode: SmokeMode = "null";
const rpcLog: string[] = [];
const hangAttempts = new Map<string, number>();
const roleReads: { at: number; signal: boolean; stack?: string }[] = [];
let bootStartedAt = Date.now();
let workspaceListWaves = 0;
let inviteOpens = 0;
let hedgeFirstAt = 0;
let hedgeRetryResolvedAt = 0;

export function resetSmokeRoleReads() {
  roleReads.length = 0;
  bootStartedAt = Date.now();
}

export function smokeRoleReads(): readonly { at: number; signal: boolean; stack?: string }[] {
  return roleReads.map((row) => ({
    at: row.at - bootStartedAt,
    signal: row.signal,
    stack: row.stack,
  }));
}

export function resetSmokeRpcLog() {
  rpcLog.length = 0;
}

export function smokeRpcLog(): readonly string[] {
  return rpcLog;
}

export function smokeWorkspaceListWaves(): number {
  return workspaceListWaves;
}

export function smokeInviteOpens(): number {
  return inviteOpens;
}

export function smokeHedgeTiming(): { firstAt: number; retryResolvedAt: number } {
  return { firstAt: hedgeFirstAt, retryResolvedAt: hedgeRetryResolvedAt };
}

export function setSmokeMode(next: SmokeMode) {
  mode = next;
  hangAttempts.clear();
  workspaceListWaves = 0;
  inviteOpens = 0;
  hedgeFirstAt = 0;
  hedgeRetryResolvedAt = 0;
  resetSmokeRoleReads();
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
    (row) =>
      row.column === "id" && Array.isArray(row.value) && row.value.some((value) => value === id),
  );
}

function clientPayload(row: typeof clientRow, kind: "list" | "single") {
  if (kind === "single") return Promise.resolve({ data: row, error: null });
  return Promise.resolve({
    data: [{ id: row.id, name: row.name, owner_user_id: row.owner_user_id }],
    error: null,
  });
}

function isWorkspaceList(table: string, eqs: QueryFilter[]): boolean {
  return (
    (table === "clients" &&
      eqValue(eqs, "owner_user_id") === SMOKE_USER_ID &&
      eqValue(eqs, "id") == null) ||
    (table === "client_memberships" &&
      eqValue(eqs, "user_id") === SMOKE_USER_ID &&
      eqValue(eqs, "client_id") == null)
  );
}

function isInviteOpen(table: string, eqs: QueryFilter[]): boolean {
  return (
    table === "clients" &&
    eqValue(eqs, "id") === SMOKE_CLIENT_ID &&
    eqValue(eqs, "owner_user_id") === SMOKE_USER_ID
  );
}

function hangUntilAbort(
  signal: AbortSignal | undefined,
): Promise<{ data: null; error: { message: string } }> {
  if (!signal) return new Promise(() => {});
  return new Promise((resolve) => {
    const done = () =>
      resolve({ data: null, error: { message: "AbortError: The operation was aborted." } });
    if (signal.aborted) done();
    else signal.addEventListener("abort", done, { once: true });
  });
}

function settle(
  table: string,
  kind: "list" | "single",
  eqs: QueryFilter[],
  ins: QueryFilter[],
  signal: AbortSignal | undefined,
  callerStack: string,
): Promise<{ data: unknown; error: { message: string } | null }> {
  if (isWorkspaceList(table, eqs) && table === "clients") workspaceListWaves += 1;
  if (isInviteOpen(table, eqs)) inviteOpens += 1;
  const workspaceList = isWorkspaceList(table, eqs);
  if (mode === "loading" && table === "clients") return new Promise(() => {});
  if (mode === "error" && workspaceList) {
    return Promise.resolve({ data: null, error: { message: "boom" } });
  }
  if (mode === "critical-down" && workspaceList) {
    return Promise.resolve({ data: null, error: { message: "TypeError: Failed to fetch" } });
  }
  if (mode === "hang-once" && workspaceList) {
    const key = `${table}:${String(eqValue(eqs, table === "clients" ? "owner_user_id" : "user_id"))}`;
    const attempt = (hangAttempts.get(key) ?? 0) + 1;
    hangAttempts.set(key, attempt);
    if (attempt === 1) return hangUntilAbort(signal);
  }
  if (mode === "hang-twice" && signal && workspaceList) {
    const key = `${table}:${String(eqValue(eqs, table === "clients" ? "owner_user_id" : "user_id"))}`;
    const attempt = (hangAttempts.get(key) ?? 0) + 1;
    hangAttempts.set(key, attempt);
    if (attempt <= 2) return hangUntilAbort(signal);
  }
  if (
    mode === "client-hang-twice" &&
    signal &&
    table === "clients" &&
    eqValue(eqs, "id") === SMOKE_CLIENT_ID
  ) {
    const key = `client-row:${SMOKE_CLIENT_ID}`;
    const attempt = (hangAttempts.get(key) ?? 0) + 1;
    hangAttempts.set(key, attempt);
    if (attempt <= 2) return hangUntilAbort(signal);
  }
  if (table === "user_roles" && INVITE_META_MODES.has(mode)) {
    roleReads.push({ at: Date.now(), signal: Boolean(signal), stack: callerStack });
    // listAppRoles passes an AbortSignal. A rejection after that signal aborts
    // must not be logged. The role effect's bootSelect passes one too.
    if (mode === "invite-roles-hang" && callerStack.includes("listAppRoles")) {
      if (!signal) return new Promise(() => {});
      return new Promise((resolve) => {
        const fail = () =>
          resolve({
            data: null,
            error: { message: "TypeError: Failed to fetch (example.supabase.co)" },
          });
        if (signal.aborted) fail();
        else signal.addEventListener("abort", fail, { once: true });
      });
    }
    if (mode === "invite-slow-chain" && !signal) {
      return Promise.resolve({
        data: null,
        error: { message: "TypeError: Failed to fetch (example.supabase.co)" },
      });
    }
    return Promise.resolve({ data: [], error: null });
  }
  if (mode === "invite-roles-hang" && table === "client_memberships") {
    const row = { client_id: SMOKE_CLIENT_ID, role: "client_owner" };
    return kind === "single"
      ? Promise.resolve({ data: row, error: null })
      : Promise.resolve({ data: [row], error: null });
  }
  if (mode === "invite-slow-chain" && (table === "clients" || table === "client_memberships")) {
    const inviteRead =
      isWorkspaceList(table, eqs) ||
      (table === "clients" && eqValue(eqs, "id") === SMOKE_CLIENT_ID) ||
      (table === "client_memberships" && eqValue(eqs, "client_id") === SMOKE_CLIENT_ID);
    // Under the 4s boot abort. Three of these in series still cross the 8s backstop.
    const STEP_MS = 3_200;
    if (inviteRead) {
      return new Promise((resolve) => {
        setTimeout(() => {
          if (table === "client_memberships") {
            const row = { client_id: SMOKE_CLIENT_ID, role: "client_owner" };
            resolve(kind === "single" ? { data: row, error: null } : { data: [row], error: null });
            return;
          }
          resolve(
            kind === "single"
              ? { data: clientRow, error: null }
              : {
                  data: [
                    { id: SMOKE_CLIENT_ID, name: clientRow.name, owner_user_id: SMOKE_USER_ID },
                  ],
                  error: null,
                },
          );
        }, STEP_MS);
      });
    }
  }
  if (mode === "invite-fresh") {
    if (isInviteOpen(table, eqs)) {
      return Promise.resolve({ data: { id: SMOKE_CLIENT_ID }, error: null });
    }
    if (workspaceList) {
      if (workspaceListWaves <= 1) return empty(kind);
      if (table === "client_memberships") {
        const row = { client_id: SMOKE_CLIENT_ID, role: "client_owner" };
        return kind === "single"
          ? Promise.resolve({ data: row, error: null })
          : Promise.resolve({ data: [row], error: null });
      }
      return Promise.resolve({
        data: [{ id: SMOKE_CLIENT_ID, name: clientRow.name, owner_user_id: SMOKE_USER_ID }],
        error: null,
      });
    }
    if (table === "clients" && eqValue(eqs, "id") === SMOKE_CLIENT_ID) {
      return clientPayload(clientRow, kind);
    }
  }
  if (mode === "hedge-slow-read") {
    if (
      table === "clients" &&
      eqValue(eqs, "owner_user_id") === SMOKE_USER_ID &&
      eqValue(eqs, "id") == null
    ) {
      const attempt = (hangAttempts.get("hedge-owned") ?? 0) + 1;
      hangAttempts.set("hedge-owned", attempt);
      if (attempt === 1) {
        hedgeFirstAt = Date.now();
        return hangUntilAbort(signal);
      }
      return new Promise((resolve) => {
        setTimeout(() => {
          hedgeRetryResolvedAt = Date.now();
          resolve({
            data: [{ id: SMOKE_CLIENT_ID, name: clientRow.name, owner_user_id: SMOKE_USER_ID }],
            error: null,
          });
        }, 2_500);
      });
    }
    if (table === "client_memberships" && workspaceList) {
      const row = { client_id: SMOKE_CLIENT_ID, role: "client_owner" };
      return kind === "single"
        ? Promise.resolve({ data: row, error: null })
        : Promise.resolve({ data: [row], error: null });
    }
    if (table === "clients") return clientPayload(clientRow, kind);
  }
  if (mode === "progress-ceiling" && (table === "clients" || table === "client_memberships")) {
    const ms = workspaceList ? 200 : 800;
    return new Promise((resolve) => {
      setTimeout(() => {
        if (table === "client_memberships") {
          const row = { client_id: SMOKE_CLIENT_ID, role: "client_owner" };
          resolve(kind === "single" ? { data: row, error: null } : { data: [row], error: null });
          return;
        }
        resolve(
          kind === "single"
            ? { data: clientRow, error: null }
            : {
                data: [{ id: SMOKE_CLIENT_ID, name: clientRow.name, owner_user_id: SMOKE_USER_ID }],
                error: null,
              },
        );
      }, ms);
    });
  }
  if (mode === "section-down" && table === "deliverable_drafts") {
    return Promise.reject(new TypeError("Failed to fetch"));
  }
  if (mode === "revoked" && table === "clients") {
    const stale = eqValue(eqs, "id") === STALE_CLIENT_ID || includesId(ins, STALE_CLIENT_ID);
    return clientPayload(stale ? staleRow : clientRow, kind);
  }
  const likeLoaded =
    mode === "loaded" ||
    mode === "hang-once" ||
    mode === "hang-twice" ||
    mode === "section-down" ||
    mode === "critical-down" ||
    mode === "client-hang-twice" ||
    mode === "invite-roles-hang";
  if (!likeLoaded || table !== "clients") return empty(kind);
  return clientPayload(clientRow, kind);
}

function builder(table: string, callerStack: string) {
  const eqs: QueryFilter[] = [];
  const ins: QueryFilter[] = [];
  let signal: AbortSignal | undefined;
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
  self.abortSignal = (next: AbortSignal) => {
    signal = next;
    return self;
  };
  self.eq = (column: string, value: unknown) => {
    eqs.push({ column, value });
    return self;
  };
  self.in = (column: string, value: unknown) => {
    ins.push({ column, value });
    return self;
  };
  const run = (kind: "list" | "single") => settle(table, kind, eqs, ins, signal, callerStack);
  self.maybeSingle = () => run("single");
  self.single = () => run("single");
  self.then = (
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => run("list").then(onFulfilled, onRejected);
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
      user_metadata: INVITE_META_MODES.has(mode)
        ? {
            full_name: "Zanele",
            signup_type: "customer",
            invite_client_id: SMOKE_CLIENT_ID,
          }
        : { full_name: "Ada Owner", signup_type: "customer" },
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
    const callerStack = (new Error().stack ?? "")
      .split("\n")
      .filter((line) => /\/src\/|\/scripts\//.test(line) && !/page-smoke-supabase/.test(line))
      .slice(0, 4)
      .join(" | ");
    return builder(table, callerStack);
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
