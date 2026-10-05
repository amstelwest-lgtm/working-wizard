/**
 * /ops must not render a blank page on the default Lighthouse view.
 * Run: pnpm test:ops-route-state
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  opsNeedsDashboard,
  opsRouteRenderDecision,
  opsSkipsDashboard,
  type OpsRouteState,
} from "../src/lib/ops-route-state";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const owner = { allowed: true, isOwner: true, isItMember: false };

function decide(patch: Partial<OpsRouteState> & Pick<OpsRouteState, "tab">): string {
  return opsRouteRenderDecision({
    authLoading: false,
    signedIn: true,
    unlocked: true,
    accessChecked: true,
    access: owner,
    hasDash: false,
    dashBusy: false,
    dashErr: false,
    ...patch,
  });
}

assert(
  opsNeedsDashboard(false, "lighthouse", "it") === false,
  "default lighthouse view does not need the owner dashboard",
);
assert(opsSkipsDashboard(false, "lighthouse", "it") === true, "lighthouse skips the dashboard");
assert(
  opsSkipsDashboard(false, "lighthouse", "it") === !opsNeedsDashboard(false, "lighthouse", "it"),
  "skipDash is the inverse of needsOpsDash on lighthouse",
);
assert(
  opsNeedsDashboard(false, "platform", "it") === true,
  "platform metrics need the owner dashboard",
);
assert(
  opsSkipsDashboard(false, "platform", "it") === false,
  "platform metrics do not skip the dashboard",
);
assert(opsNeedsDashboard(false, "it", "pilot") === true, "pilot knobs need the owner dashboard");
assert(
  opsNeedsDashboard(false, "it", "it") === false,
  "Milōn IT queries do not need the owner dashboard",
);
assert(
  opsNeedsDashboard(true, "it", "pilot") === false,
  "IT-only members never load the owner dashboard",
);

const lighthouseTabs = [undefined, "agent", "firms", "system"] as const;
for (const tab of lighthouseTabs) {
  const decision = decide({ tab });
  const label = tab ?? "(no tab)";
  assert(decision === "render shell", `${label} renders the shell, got ${decision}`);
  assert(decision !== "loading", `${label} does not wait on a dashboard it never loads`);
  assert(decision !== null, `${label} decision is not null`);
}

assert(
  decide({ tab: undefined, dashBusy: true }) === "render shell",
  "lighthouse renders the shell even while a dashboard request is marked busy",
);

assert(decide({ tab: "usage" }) === "loading", "?tab=usage with no dashboard is loading");
assert(
  decide({ tab: "usage", dashBusy: true }) === "loading",
  "?tab=usage stays on the spinner while the dashboard is in flight",
);
assert(
  decide({ tab: "usage", dashErr: true }) === "error",
  "?tab=usage with a failed dashboard load is the error card",
);
assert(
  decide({ tab: "usage", hasDash: true }) === "render shell",
  "?tab=usage renders the shell once the dashboard has loaded",
);
assert(
  decide({ tab: "pilot" }) === "loading",
  "pilot knobs wait on the dashboard instead of rendering null",
);
assert(
  decide({ tab: "it" }) === "render shell",
  "Milōn IT queries render without the owner dashboard",
);

assert(
  decide({
    tab: undefined,
    access: null,
    dashBusy: true,
  }) === "error",
  "a thrown access check does not render an empty lighthouse shell",
);
assert(
  decide({
    tab: "agent",
    access: null,
    unlocked: false,
  }) === "error",
  "a thrown access check is the error card, not the passphrase form",
);
assert(
  decide({
    tab: undefined,
    access: { allowed: false, isOwner: false, isItMember: false },
    unlocked: false,
  }) === "restricted",
  "a denied access check is the Restricted card",
);
assert(
  decide({
    tab: undefined,
    accessChecked: false,
    access: null,
  }) === "loading",
  "a signed-in user sees the spinner while access is still loading",
);

const routeSrc = readFileSync(resolve(process.cwd(), "src/routes/_authenticated/ops.tsx"), "utf8");
assert(routeSrc.includes("opsRouteRenderDecision"), "ops route uses the shared render decision");
assert(!routeSrc.includes("return null"), "ops route has no return null path");

console.log("ops route state ok");
