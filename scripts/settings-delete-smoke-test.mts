/**
 * Smoke-check onboarding key bump + account delete RPC shape.
 * Does not delete Theo's live account.
 */
import { createClient } from "@supabase/supabase-js";
import {
  ACCOUNTANT_CLIENT_TOUR_KEY,
  ACCOUNTANT_DASH_TOUR_KEY,
  ACCOUNTANT_FIRST_CLIENT_KEY,
  OWNER_TOUR_KEY,
  resetOnboardingTours,
} from "../src/lib/onboarding.ts";

const expected = {
  OWNER_TOUR_KEY: "milon_walkthrough_v4",
  ACCOUNTANT_DASH_TOUR_KEY: "milon_accountant_dash_tour_v2",
  ACCOUNTANT_CLIENT_TOUR_KEY: "milon_accountant_client_tour_v2",
  ACCOUNTANT_FIRST_CLIENT_KEY: "milon_accountant_first_client_done_v2",
};

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("ok:", msg);
  }
}

assert(OWNER_TOUR_KEY === expected.OWNER_TOUR_KEY, `owner key is ${OWNER_TOUR_KEY}`);
assert(
  ACCOUNTANT_DASH_TOUR_KEY === expected.ACCOUNTANT_DASH_TOUR_KEY,
  `dash key is ${ACCOUNTANT_DASH_TOUR_KEY}`,
);
assert(
  ACCOUNTANT_CLIENT_TOUR_KEY === expected.ACCOUNTANT_CLIENT_TOUR_KEY,
  `client key is ${ACCOUNTANT_CLIENT_TOUR_KEY}`,
);
assert(
  ACCOUNTANT_FIRST_CLIENT_KEY === expected.ACCOUNTANT_FIRST_CLIENT_KEY,
  `first-client key is ${ACCOUNTANT_FIRST_CLIENT_KEY}`,
);

// localStorage polyfill for node
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => {
    store.set(k, String(v));
  },
  removeItem: (k) => {
    store.delete(k);
  },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

store.set(OWNER_TOUR_KEY, "1");
store.set(ACCOUNTANT_DASH_TOUR_KEY, "1");
resetOnboardingTours("all");
assert(!store.has(OWNER_TOUR_KEY), "reset clears owner tour");
assert(!store.has(ACCOUNTANT_DASH_TOUR_KEY), "reset clears accountant tour");

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (url && key && key.length > 80) {
  const sb = createClient(url, key);
  const { error } = await sb.rpc("delete_own_account");
  // Unauthenticated call should fail — proves RPC exists or reports missing.
  console.log(
    "rpc probe (expect auth error or missing fn):",
    error?.message ?? "unexpected success",
  );
} else {
  console.log("skip live rpc probe — publishable key not configured in this env");
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nall smoke checks passed");
