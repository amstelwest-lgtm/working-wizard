/**
 * In-memory Supabase client for the page-render smoke test.
 * `loading` never resolves a clients read, so the first paint stays on the
 * shell. `null` resolves an empty book. `loaded` resolves one workspace.
 */

export type SmokeMode = "null" | "loading" | "loaded";

export const SMOKE_USER_ID = "11111111-1111-4111-8111-111111111111";
export const SMOKE_CLIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let mode: SmokeMode = "null";

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

function empty(kind: "list" | "single") {
  return Promise.resolve(kind === "list" ? { data: [], error: null } : { data: null, error: null });
}

function settle(table: string, kind: "list" | "single"): Promise<{ data: unknown; error: null }> {
  if (mode === "loading" && table === "clients") return new Promise(() => {});
  if (mode !== "loaded" || table !== "clients") return empty(kind);
  if (kind === "single") return Promise.resolve({ data: clientRow, error: null });
  return Promise.resolve({
    data: [{ id: clientRow.id, name: clientRow.name, owner_user_id: SMOKE_USER_ID }],
    error: null,
  });
}

function builder(table: string) {
  const self: Record<string, unknown> = {};
  const chain = () => self;
  for (const name of [
    "select",
    "eq",
    "neq",
    "in",
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
  self.maybeSingle = () => settle(table, "single");
  self.single = () => settle(table, "single");
  self.then = (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    settle(table, "list").then(onFulfilled, onRejected);
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
