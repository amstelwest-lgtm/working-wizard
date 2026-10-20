/**
 * Dual-role sign-in: a firm row wins over signup_type customer, and a hung
 * post-auth read cannot leave the button spinning.
 * Run: pnpm test:post-auth-landing
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  POST_AUTH_DEADLINE_MS,
  accountantDoorWhenFirmsLoaded,
  finishAccountantSignIn,
  finishOwnerSignIn,
  firmsAfterAccountChange,
  firmsAfterLoadTimeout,
  ownerDoorForDualRoleFirm,
} from "../src/lib/post-auth-landing";
import { destinationAfterSignIn } from "../src/lib/landing-sign-in-destination";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const src = (path: string) => readFileSync(resolve(path), "utf8");

assert(POST_AUTH_DEADLINE_MS === 8_000, "post-auth deadline is 8s");

// theo: signup_type customer, no firm_name, owns a firm, client_owner seats.
// Stored market null or US/NY must both open the practice.
const theoRoles = {
  hasPracticeRole: true,
  hasClientRole: true,
  hasFirm: true,
  practiceSignup: false,
  profileLoaded: true as const,
};
assert(
  destinationAfterSignIn(theoRoles, "accountant") === "/practice",
  "accountant door + firm + customer metadata → /practice",
);
assert(
  destinationAfterSignIn(theoRoles, "landing") === "/practice",
  "landing door + firm + customer metadata → /practice",
);

for (const marketCountry of [null, "US"] as const) {
  const loaded = accountantDoorWhenFirmsLoaded({
    firmCount: 1,
    marketCountry,
    practiceSignup: false,
    hasPracticeRole: false,
    hasClientRole: true,
  });
  assert(loaded === "/practice", `firm row + client seats + market ${marketCountry ?? "null"} → /practice`);
}

assert(
  accountantDoorWhenFirmsLoaded({
    firmCount: 0,
    marketCountry: null,
    practiceSignup: false,
    hasPracticeRole: false,
    hasClientRole: true,
  }) === "/app",
  "a finished empty firm read plus a client seat stays on the owner board",
);

assert(ownerDoorForDualRoleFirm() === "/app", "owner door still opens the owner view");

let whenNoFirmCalls = 0;
const withFirm = await finishAccountantSignIn({
  flow: "signin",
  practiceSignup: false,
  hasPracticeRole: true,
  hasClientRole: true,
  readFirms: async () => ({ ok: true, count: 1, marketCountry: null }),
  whenNoFirm: async () => {
    whenNoFirmCalls += 1;
    return "/app";
  },
});
assert(withFirm.status === "go" && withFirm.path === "/practice", "known firm skips getUser path");
assert(whenNoFirmCalls === 0, "known firm does not call the no-firm resolver");

const hung = await finishAccountantSignIn({
  flow: "signin",
  practiceSignup: false,
  hasPracticeRole: true,
  hasClientRole: true,
  timeoutMs: 30,
  readFirms: () => new Promise(() => {}),
  whenNoFirm: async () => "/practice",
});
assert(hung.status === "retry", "a hung firm read retries inside the deadline");

const hungAfter = await finishAccountantSignIn({
  flow: "signin",
  practiceSignup: false,
  hasPracticeRole: false,
  hasClientRole: true,
  timeoutMs: 30,
  readFirms: async () => ({ ok: true, count: 0, marketCountry: "US" }),
  whenNoFirm: () => new Promise(() => {}),
});
assert(hungAfter.status === "retry", "a hung destination read retries inside the deadline");

const failedRead = await finishAccountantSignIn({
  flow: "signin",
  practiceSignup: false,
  hasPracticeRole: false,
  hasClientRole: true,
  readFirms: async () => ({ ok: false }),
  whenNoFirm: async () => "/app",
});
assert(
  failedRead.status === "retry",
  "a swallowed firm error is not treated as no firm for a client seat",
);

const ownerHung = await finishOwnerSignIn({
  timeoutMs: 30,
  readDestination: () => new Promise(() => {}),
});
assert(ownerHung.status === "retry", "owner sign-in retries when destination never settles");

const ownerFirm = await finishOwnerSignIn({
  readDestination: async () => "/practice",
});
assert(ownerFirm.status === "go" && ownerFirm.path === "/practice", "owner sign-in can still open the practice");

const dropped = firmsAfterAccountChange({
  previousUserId: "ben",
  nextUserId: "3343e0ef-669d-4b1e-a7df-27457bc1e16f",
  firms: [{ id: "bens-firm", ownerUserId: "ben" }],
});
assert(dropped.length === 0, "sign-out → sign-in drops the previous user's firms");
assert(
  firmsAfterAccountChange({
    previousUserId: "same",
    nextUserId: "same",
    firms: [{ id: "f", ownerUserId: "same" }],
  }).length === 1,
  "the same user keeps a committed firm list",
);
assert(
  firmsAfterLoadTimeout({
    committed: false,
    firms: [{ id: "bens-firm", ownerUserId: "ben" }],
  }).length === 0,
  "an 8s firm timeout does not keep an uncommitted firm",
);
assert(
  firmsAfterLoadTimeout({
    committed: true,
    firms: [{ id: "fca0f102", ownerUserId: "theo" }],
  })[0]?.id === "fca0f102",
  "a committed firm survives the timeout",
);

const auth = src("src/routes/auth.tsx");
assert(auth.includes("finishAccountantSignIn"), "accountant sign-in uses the deadline helper");
assert(auth.includes("knownMeta"), "accountant sign-in passes metadata and skips getUser");
assert(!auth.includes("useAccountantProfile"), "sign-in does not wait on the profile provider");
assert(auth.includes("postAuthRetry"), "a timed-out sign-in can retry");

const callback = src("src/routes/auth_.callback.tsx");
assert(callback.includes("settleWithin"), "Google callback has the same deadline");
assert(callback.includes("POST_AUTH_TIMEOUT_MESSAGE"), "Google callback shows the timeout");
assert(callback.includes("setCanRetry"), "Google callback offers retry");

const dest = src("src/lib/landing-sign-in-destination.ts");
assert(
  dest.includes("if (knownMeta === undefined)"),
  "getUser runs only when metadata was not already provided",
);

const profile = src("src/contexts/accountant-profile.tsx");
assert(profile.includes("firmsAfterAccountChange"), "profile drops the previous account on user change");
assert(profile.includes("firmsAfterLoadTimeout"), "profile timeout does not keep an uncommitted firm");

const owner = src("src/routes/index.tsx");
assert(owner.includes("finishOwnerSignIn"), "owner sign-in uses the deadline helper");
assert(!owner.includes("auth.getUser()"), "owner sign-in does not call getUser after the password grant");

const ownerSession = src("src/components/landing/landing-sign-in-session.tsx");
assert(ownerSession.includes("finishOwnerSignIn"), "landing sign-in session uses the deadline helper");

console.log("post-auth landing ok");
