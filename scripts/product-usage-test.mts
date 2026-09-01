/**
 * Product-usage catalog and rollup tests.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/product-usage-test.mts
 */
import {
  FEATURE_CATALOG,
  resolveFeatureKey,
  resolveUsagePersona,
  rollupUsage,
  shouldSkipPath,
  surfaceFromPath,
  type UsageEventRow,
} from "../src/lib/product-usage";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(shouldSkipPath("/"), "landing is not product usage");
assert(shouldSkipPath("/ops"), "ops console is skipped");
assert(shouldSkipPath("/auth"), "auth is skipped");
assert(shouldSkipPath("/lh/unsubscribe"), "lighthouse public routes skipped");
assert(!shouldSkipPath("/app"), "/app is tracked");
assert(!shouldSkipPath("/dashboard"), "/dashboard is tracked");
assert(!shouldSkipPath("/clients/abc"), "client workspace is tracked");
assert(!shouldSkipPath("/reports"), "reports studio is tracked");

assert(surfaceFromPath("/app") === "owner_app", "owner surface");
assert(surfaceFromPath("/dashboard") === "accountant_portal", "firm dashboard surface");
assert(surfaceFromPath("/clients/x") === "accountant_portal", "client workspace surface");
assert(surfaceFromPath("/reports") === "reports", "reports surface");

assert(
  resolveFeatureKey({ event: "tab_viewed", tab: "today", surface: "owner_app" }) === "owner.health",
  "owner health tab",
);
assert(
  resolveFeatureKey({ event: "tab_viewed", tab: "cash", surface: "accountant_portal" }) ===
    "firm.client_cash",
  "firm cash tab",
);
assert(resolveFeatureKey({ event: "page_viewed", path: "/dashboard" }) === "firm.dashboard", "dashboard page");
assert(resolveFeatureKey({ event: "report_downloaded" }) === "firm.report_download", "report download");
assert(
  resolveFeatureKey({ event: "note_created", tab: "ratios" }) === "firm.notes",
  "accountant note from tab",
);
assert(
  resolveFeatureKey({ event: "note_created", tab: "today" }) === "owner.notes",
  "owner note from tab",
);

assert(
  resolveUsagePersona({ roles: ["firm_admin"], surface: "accountant_portal" }) === "firm",
  "practice on firm surface",
);
assert(
  resolveUsagePersona({ roles: ["client_owner"], surface: "owner_app" }) === "founder",
  "owner on owner app",
);
assert(
  resolveUsagePersona({ roles: ["client_member"], surface: "owner_app" }) === "customer",
  "member is customer",
);
assert(
  resolveUsagePersona({
    roles: ["firm_admin", "client_owner"],
    surface: "owner_app",
    actingAsClient: true,
  }) === "firm",
  "impersonating accountant stays firm",
);
assert(
  resolveUsagePersona({
    roles: ["firm_admin", "client_owner"],
    surface: "owner_app",
  }) === "founder",
  "dual-role on owner app is founder",
);

const now = "2026-08-22T12:00:00.000Z";
const rows: UsageEventRow[] = [
  {
    occurredAt: now,
    userId: "u1",
    persona: "founder",
    surface: "owner_app",
    eventName: "tab_viewed",
    featureKey: "owner.health",
    firmId: null,
    clientId: "c1",
  },
  {
    occurredAt: now,
    userId: "u1",
    persona: "founder",
    surface: "owner_app",
    eventName: "tab_viewed",
    featureKey: "owner.health",
    firmId: null,
    clientId: "c1",
  },
  {
    occurredAt: now,
    userId: "u2",
    persona: "firm",
    surface: "accountant_portal",
    eventName: "page_viewed",
    featureKey: "firm.dashboard",
    firmId: "f1",
    clientId: null,
  },
];

const rollup = rollupUsage(rows, {
  fromIso: "2026-08-22T00:00:00.000Z",
  toIso: "2026-08-22T23:59:59.000Z",
  entityLabels: { "client:c1": "Acme", "firm:f1": "West Practice" },
});

assert(rollup.totals.events === 3, "event total");
assert(rollup.totals.uniqueUsers === 2, "unique users");
assert(rollup.totals.byPersona.founder.events === 2, "founder events");
assert(rollup.totals.byPersona.firm.uniqueUsers === 1, "one firm user");
assert(rollup.mostUsed[0]?.key === "owner.health", "most used is health");
assert(rollup.mostUsed[0]?.events === 2, "health event count");
assert(
  rollup.unused.some((f) => f.key === "owner.budget"),
  "unused catalog feature is listed",
);
assert(
  rollup.leastUsed[0]?.events === 0,
  "least used starts at zero-count catalog items",
);
assert(rollup.features.length >= FEATURE_CATALOG.length, "catalog included in ranking");
assert(rollup.entities[0]?.label === "Acme" || rollup.entities[1]?.label === "Acme", "client label");
assert(rollup.entities.some((e) => e.label === "West Practice"), "firm label");
assert(rollup.daily.length === 1, "single-day window");
assert(rollup.daily[0]?.events === 3, "daily events");

console.log("product-usage tests passed");
