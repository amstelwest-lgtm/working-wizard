/**
 * Action Plan tab: chunk/render failures must not white-screen /app.
 * Run: pnpm test:action-plan-tab
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ActionPlan, { driverHealthLabel, healthMeta } from "../src/components/action-plan";
import { lazyPanel, TabErrorBoundary } from "../src/components/lazy-panel";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(typeof ActionPlan === "function", "action-plan default export loads");
assert(typeof lazyPanel === "function", "lazyPanel export");
assert(typeof TabErrorBoundary.getDerivedStateFromError === "function", "error boundary hook");

const derived = TabErrorBoundary.getDerivedStateFromError(new Error("boom"));
assert(derived.error instanceof Error && derived.error.message === "boom", "boundary captures error");

assert(driverHealthLabel(67.4) === 67, "finite health rounds");
assert(driverHealthLabel(Number.NaN) === null, "NaN health is blank, not a crash");
assert(driverHealthLabel(Number.POSITIVE_INFINITY) === null, "Infinity health is blank");
assert(healthMeta("at_risk").label === "At risk", "known health");
assert(healthMeta("nope").label === "On track", "unknown health falls back");
assert(healthMeta(undefined).label === "On track", "missing health falls back");

const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(appSrc.includes('lazyPanel(() => import("@/components/action-plan")'), "founder board uses lazyPanel");
assert(appSrc.includes('void import("@/components/action-plan")'), "founder board preloads Action Plan chunk");
assert(appSrc.includes('<TabErrorBoundary label="Action Plan">'), "founder board wraps Action Plan");
assert(appSrc.includes('<TabErrorBoundary label="Cash Forecast">'), "founder board wraps Cash Forecast");
assert(appSrc.includes('<TabErrorBoundary label="Budget">'), "founder board wraps Budget");

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(clientSrc.includes('lazyPanel(() => import("@/components/action-plan")'), "client board uses lazyPanel");
assert(clientSrc.includes('<TabErrorBoundary label="Action Plan">'), "client board wraps Action Plan");

const wizardSrc = readFileSync(resolve("src/components/walkthrough-wizard.tsx"), "utf8");
assert(wizardSrc.includes("if (!s) return"), "walkthrough guards missing steps");

console.log("action-plan-tab-test: ok");
