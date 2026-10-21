/**
 * Stored plan, firmId null. The Supabase double is the fixture firm rows.
 * The stored branch logs the firm id and the answer is entitled.
 *
 * Run: pnpm test:strike7-entitlement
 */
import { STRIKE7_MY_PRACTICE_ID, STRIKE7_OWNER_ID, strike7FirmRows, type Strike7FirmRow } from "./strike7-firms";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

process.env.STRIPE_SECRET_KEY ??= "sk_test_strike7_stored_plan";
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.SUPABASE_SECRET_KEY;

const rows = strike7FirmRows();

function firmDouble(firmRows: Strike7FirmRow[]) {
  return {
    auth: {
      getUser: async () => ({ data: { user: { email: null } } }),
    },
    from(table: string) {
      return {
        select() {
          return {
            eq(column: string, value: string) {
              const matched =
                table === "firms"
                  ? firmRows.filter((row) => String((row as Record<string, unknown>)[column] ?? "") === value)
                  : [];
              return {
                eq() {
                  return this;
                },
                limit: async () => ({ data: matched }),
                maybeSingle: async () => ({ data: matched[0] ?? null, error: null }),
              };
            },
          };
        },
      };
    },
  };
}

const lines: string[] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  lines.push(args.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
  originalWarn(...args);
};

const realFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new Error("stripe down"));

const { resolveFirmBillingEntitlement } = await import("../src/lib/stripe-checkout.functions.ts");

try {
  const result = await resolveFirmBillingEntitlement(
    {
      userId: STRIKE7_OWNER_ID,
      claims: {},
      supabase: firmDouble(rows),
    },
    true,
    null,
  );
  const stored = lines.find((line) => line.includes("[stripe-entitlement] stored plan entitled"));
  assert(Boolean(stored), `stored branch did not log, saw ${lines.join(" | ") || "(no warnings)"}`);
  assert(
    stored?.includes(`firm=${STRIKE7_MY_PRACTICE_ID}`) === true,
    `stored log should name the owned firm, saw ${stored}`,
  );
  assert(!/@/.test(lines.join(" ")), "stored-plan logs must not include an email");
  assert(result.entitled === true, `firmId null with a stored entitled row should return entitled, saw ${JSON.stringify(result)}`);
  assert(result.reason !== "stripe_unconfigured", "the fixture row answered, not the unconfigured short-circuit");
} finally {
  globalThis.fetch = realFetch;
  console.warn = originalWarn;
}

console.log("strike7 entitlement ok");
