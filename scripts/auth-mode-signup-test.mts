/**
 * /auth?mode=signup opens Create firm and keeps the market hint.
 * Run: pnpm test:auth-mode-signup
 */
import { parseAuthSearch } from "../src/lib/auth-search.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const signup = parseAuthSearch({ mode: "signup" });
assert(signup.signup === true, `/auth?mode=signup must open Create firm, saw ${JSON.stringify(signup)}`);

const hinted = parseAuthSearch({ mode: "signup", market: "ZA" });
assert(hinted.signup === true, "mode=signup still opens Create firm when a market hint is present");
assert(hinted.market === "ZA", `mode=signup keeps the ZA market hint, saw ${hinted.market}`);

const lower = parseAuthSearch({ mode: "signup", market: "za", next: "/clients", plan: "starter", interval: "month" });
assert(lower.signup === true, "mode=signup with a plan still opens Create firm");
assert(lower.market === "ZA", "a lowercase market hint is still ZA");
assert(lower.next === "/clients", "mode=signup keeps next");
assert(lower.plan === "starter" && lower.interval === "month", "mode=signup keeps plan and interval");

const us = parseAuthSearch({ mode: "signup", market: "US" });
assert(us.signup === true && us.market === "US", "mode=signup keeps a US market hint");

const plain = parseAuthSearch({});
assert(plain.signup !== true, "a bare /auth stays on Practice sign-in");

const signin = parseAuthSearch({ mode: "signin", market: "ZA" });
assert(signin.signup !== true, "mode=signin does not open Create firm");
assert(signin.market === "ZA", "mode=signin still keeps the market hint");

const legacy = parseAuthSearch({ signup: "true", market: "US", plan: "solo", interval: "year" });
assert(legacy.signup === true, "signup=true still opens Create firm");
assert(legacy.market === "US" && legacy.plan === "solo" && legacy.interval === "year", "signup=true keeps market, plan, and interval");

assert(!("country" in parseAuthSearch({ mode: "signup", country: "ZA", market: "ZA" })), "country is not a search key");

console.log("auth-mode-signup: ok");
