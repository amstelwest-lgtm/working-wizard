/**
 * A new firm keeps the plan picked at signup. An existing dual-role sign-in
 * still drops a leftover stash before /practice.
 * Run: pnpm test:signup-checkout-keep
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  clearStoredCheckoutForPracticeLanding,
  decideAccountantAuthLanding,
} from "../src/lib/auth-landing";

const checks: string[] = [];
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
  checks.push(msg);
}

const picked = { plan: "growing" as const, interval: "year" as const, market: "us" as const };

const newFirm = decideAccountantAuthLanding({
  flow: "signup",
  hadFirmBefore: false,
  hasLiveEntitlement: false,
  pending: picked,
  next: undefined,
});
assert(newFirm.kind === "workspace", "new firm signup opens the workspace");
assert(
  !clearStoredCheckoutForPracticeLanding(newFirm),
  "new firm signup keeps the picked plan for checkout-after-insight",
);

const dualRole = decideAccountantAuthLanding({
  flow: "signin",
  hadFirmBefore: true,
  hasLiveEntitlement: false,
  pending: picked,
  next: undefined,
});
assert(dualRole.kind === "app", "existing dual-role sign-in is not a workspace landing");
assert(
  clearStoredCheckoutForPracticeLanding(dualRole),
  "existing dual-role sign-in clears a leftover plan before /practice",
);

const auth = readFileSync(resolve("src/routes/auth.tsx"), "utf8");
const landingAt = auth.indexOf("const practiceLanding");
const practice = auth.slice(landingAt, auth.indexOf("void ensurePractice()", landingAt));
assert(
  practice.includes("if (clearStoredCheckoutForPracticeLanding(practiceLanding)) clearPendingCheckout();"),
  "practice landing clears the stash only when the decision says so",
);
assert(
  !practice.includes("\n      clearPendingCheckout();"),
  "navigating to /practice does not always clear the stored checkout",
);

if (checks.length !== 6) throw new Error(`expected 6 checks, ran ${checks.length}`);
console.log(`signup-checkout-keep ${checks.length}/${checks.length}`);
