/**
 * In-memory Supabase stand-in for the rail harness.
 * No URL, no key, no fetch. Reads return fixture rows. Writes resolve locally.
 */
const HARNESS_USER = {
  id: "harness-local-user",
  email: "harness@example.test",
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
};

const SESSION = {
  user: HARNESS_USER,
  access_token: "harness-local",
  refresh_token: "harness-local",
  expires_at: 4_102_444_800,
};

const CLIENT_ROW = {
  id: "harness-client",
  name: "Harbour Glass",
  cashflow: {
    startDate: "2026-10-06",
    openingBalance: "186000",
    revenue: [
      { id: "r1", name: "Collections", amount: "42000", frequency: "weekly", startWeek: 1, splitCount: 1 },
    ],
    expenses: [
      { id: "e1", name: "Payroll", amount: "28000", frequency: "weekly", startWeek: 1, splitCount: 1 },
    ],
    other: [],
  },
  last_forecast_at: "2026-10-01T00:00:00.000Z",
  cashflow_bank_draft: null,
  operating_profile: null,
  financials: { cash: "186000", revenue: "420000" },
  financials_updated_at: "2026-10-01T00:00:00.000Z",
  budget: null,
};

const ACTION_PLAN = {
  id: "harness-plan",
  client_id: "harness-client",
  period_label: "Oct 2026",
  outcome_goal: "Collect this month's cash before payroll",
  why_statement: "Runway is the number the owner asked about.",
  target_date: "2026-12-31",
  is_active: true,
};

const ACTION_ITEM = {
  id: "harness-item",
  plan_id: "harness-plan",
  title: "Call the two largest overdue accounts",
  status: "not_started",
  seq: 1,
  due_date: "2026-10-15",
  outcome_why: "Those two invoices are most of the gap.",
  owner_name: "Ada Mbeki",
  owner_email: null,
};

const TABLES: Record<string, unknown> = {
  clients: CLIENT_ROW,
  action_plans: [ACTION_PLAN],
  action_items_v: [ACTION_ITEM],
  action_items: [ACTION_ITEM],
  client_employees: [],
  action_milestones: [],
  action_emails: [],
  user_roles: [],
  firms: [],
  firm_members: [],
};

type Mode = "list" | "single" | "maybe";

function materialize(table: string, mode: Mode): { data: unknown; error: null } {
  const row = TABLES[table];
  if (mode === "list") {
    if (Array.isArray(row)) return { data: row, error: null };
    if (row == null) return { data: [], error: null };
    return { data: [row], error: null };
  }
  const one = Array.isArray(row) ? (row[0] ?? null) : (row ?? null);
  return { data: one, error: null };
}

function builder(table: string) {
  let mode: Mode = "list";
  const api = {
    select() {
      return api;
    },
    insert() {
      return api;
    },
    update() {
      return api;
    },
    upsert() {
      return api;
    },
    delete() {
      return api;
    },
    eq() {
      return api;
    },
    neq() {
      return api;
    },
    in() {
      return api;
    },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    gte() {
      return api;
    },
    lte() {
      return api;
    },
    is() {
      return api;
    },
    or() {
      return api;
    },
    filter() {
      return api;
    },
    match() {
      return api;
    },
    maybeSingle() {
      mode = "maybe";
      return api;
    },
    single() {
      mode = "single";
      return api;
    },
    then(resolve: (value: { data: unknown; error: null }) => void, reject?: (reason: unknown) => void) {
      try {
        resolve(materialize(table, mode));
      } catch (error) {
        reject?.(error);
      }
    },
  };
  return api;
}

export const supabase = {
  from(table: string) {
    return builder(table);
  },
  rpc() {
    return Promise.resolve({ data: [], error: { message: "harness-local" } });
  },
  channel() {
    const channel = {
      on() {
        return channel;
      },
      subscribe() {
        return channel;
      },
      unsubscribe() {
        return channel;
      },
    };
    return channel;
  },
  auth: {
    async getSession() {
      return { data: { session: SESSION }, error: null };
    },
    onAuthStateChange(callback: (event: string, session: typeof SESSION | null) => void) {
      queueMicrotask(() => callback("INITIAL_SESSION", SESSION));
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async signOut() {
      return { error: null };
    },
  },
};
