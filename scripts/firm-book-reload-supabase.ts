/**
 * Controllable book reads for the firm-reload deadline harness.
 * A clients hang never resolves. Figures and action_items can be delayed on their own.
 */
import { FIRM_BOOK_FIRM_ID } from "./firm-book-reload-profile";
import { FIRM_BOOK_USER_ID } from "./firm-book-reload-auth";

export const FIRM_BOOK_CLIENT_ONE = "North Mill";
export const FIRM_BOOK_CLIENT_TWO = "South Kiln";
export const FIRM_BOOK_ACTION_DELAY_MS = 11_000;

type BookMode = "fast" | "clients-hang" | "figures-hang" | "slow-actions";

let mode: BookMode = "fast";
let actionDelayMs = FIRM_BOOK_ACTION_DELAY_MS;
let releaseFigures: () => void = () => {};
let figuresGate: Promise<void> = Promise.resolve();

export function setFirmBookClientsHang(hang: boolean): void {
  mode = hang ? "clients-hang" : "fast";
}

/** Figures resolve immediately. action_items resolves after `delayMs` (default 11s). */
export function setFirmBookSlowActions(delayMs = FIRM_BOOK_ACTION_DELAY_MS): void {
  mode = "slow-actions";
  actionDelayMs = delayMs;
}

/** Slim clients return at once. The financials/cashflow read waits for releaseFirmBookFigures. */
export function setFirmBookFiguresHang(): void {
  mode = "figures-hang";
  figuresGate = new Promise((resolve) => {
    releaseFigures = () => resolve();
  });
}

export function releaseFirmBookFigures(): void {
  releaseFigures();
}

const BOOK_CLIENTS = [
  {
    id: "book-client-1",
    name: FIRM_BOOK_CLIENT_ONE,
    business_type: null,
    operating_profile: null,
    client_code: null,
    contact_email: null,
    cash_runway_weeks: null,
    last_forecast_at: null,
    last_login_at: null,
    firm_id: FIRM_BOOK_FIRM_ID,
    owner_user_id: FIRM_BOOK_USER_ID,
    financials_updated_at: null,
    created_at: "2026-01-02T00:00:00.000Z",
    reports_issued_count: 0,
    market: { country: "ZA" },
  },
  {
    id: "book-client-2",
    name: FIRM_BOOK_CLIENT_TWO,
    business_type: null,
    operating_profile: null,
    client_code: null,
    contact_email: null,
    cash_runway_weeks: null,
    last_forecast_at: null,
    last_login_at: null,
    firm_id: FIRM_BOOK_FIRM_ID,
    owner_user_id: FIRM_BOOK_USER_ID,
    financials_updated_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    reports_issued_count: 0,
    market: { country: "ZA" },
  },
];

const BOOK_FIGURES = [
  { id: "book-client-1", financials: {}, cashflow: null },
  { id: "book-client-2", financials: {}, cashflow: null },
];

const BOOK_ACTIONS = [
  {
    client_id: "book-client-1",
    status: "open",
    due_date: null,
    created_at: "2026-10-20T00:00:00.000Z",
    title: "Send the pack",
  },
];

type Query = { table: string; columns: string };

function isFiguresSelect(columns: string): boolean {
  return columns.includes("financials") && columns.includes("cashflow");
}

function rowsFor(query: Query): { data: unknown; error: null } {
  if (query.table === "clients" && isFiguresSelect(query.columns)) return { data: BOOK_FIGURES, error: null };
  if (query.table === "clients") return { data: BOOK_CLIENTS, error: null };
  if (query.table === "action_items") return { data: BOOK_ACTIONS, error: null };
  return { data: [], error: null };
}

function answer(query: Query): Promise<{ data: unknown; error: null }> {
  if (query.table === "clients" && mode === "clients-hang") return new Promise(() => {});
  if (mode === "fast" || mode === "clients-hang") return Promise.resolve({ data: [], error: null });
  if (query.table === "clients" && isFiguresSelect(query.columns) && mode === "figures-hang") {
    return figuresGate.then(() => ({ data: BOOK_FIGURES, error: null }));
  }
  if (query.table === "action_items" && mode === "slow-actions") {
    return new Promise((resolve) => {
      window.setTimeout(() => resolve({ data: BOOK_ACTIONS, error: null }), actionDelayMs);
    });
  }
  return Promise.resolve(rowsFor(query));
}

function chain(table: string) {
  const query: Query = { table, columns: "" };
  let promise: Promise<{ data: unknown; error: null }> | null = null;
  const run = () => (promise ??= answer(query));
  const self: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (onFulfilled: unknown, onRejected: unknown) => run().then(onFulfilled as never, onRejected as never);
        }
        if (prop === "catch") return (onRejected: unknown) => run().catch(onRejected as never);
        if (prop === "finally") return (onFinally: unknown) => run().finally(onFinally as never);
        return (...args: unknown[]) => {
          if (prop === "select" && typeof args[0] === "string") query.columns = args[0];
          return self;
        };
      },
    },
  );
  return self;
}

export const supabase = {
  from(table: string) {
    return chain(table);
  },
  rpc() {
    return Promise.resolve({ data: false, error: null });
  },
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    },
  },
};
