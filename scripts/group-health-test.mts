/**
 * Group Health / ratios stub (pure). Run: pnpm test:group-health
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupConsolidation, sumGroupAdditiveScalars } from "../src/lib/group-consolidation.ts";
import {
  buildGroupHealthStub,
  combinedFiguresUnchanged,
} from "../src/lib/group-health.ts";
import { HEALTH_RATIO_COUNT } from "../src/lib/health-catalogue.ts";

const members = [
  {
    clientId: "parent",
    name: "Parent Co",
    currency: "ZAR",
    periodDate: "2026-06-30",
    financials: { revenue: "100", totalAssets: "500", equity: "200" },
  },
  {
    clientId: "sub",
    name: "Sub Co",
    currency: "ZAR",
    periodDate: "2026-06-30",
    financials: { revenue: "40", totalAssets: "200", equity: "80" },
  },
];

test("buildGroupHealthStub never applies Health lines", () => {
  const result = buildGroupConsolidation(members);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const stub = buildGroupHealthStub({
    memberCount: members.length,
    consolidationOk: true,
    combined: result.combined,
  });
  assert.equal(stub.appliedHealth.length, 0);
  assert.match(stub.headline, /none applied/i);
  assert.ok(stub.notAppliedReasons.length >= 4);
  assert.ok(stub.notAppliedReasons.some((line) => /group-level ratio compute/i.test(line)));
  assert.ok(stub.notAppliedReasons.some((line) => /Analyst stays per company/i.test(line)));
  assert.equal(stub.plannedRatioLabels.length, HEALTH_RATIO_COUNT);
  assert.ok(stub.combinedInputLabels.includes("Revenue"));
  assert.equal(stub.blocked, false);
  assert.equal(stub.healthPlanned, true);
});

test("single company reports Group Health not needed", () => {
  const stub = buildGroupHealthStub({
    memberCount: 1,
    consolidationOk: true,
    combined: { revenue: "100" },
  });
  assert.equal(stub.healthPlanned, false);
  assert.match(stub.headline, /not needed/i);
  assert.equal(stub.plannedRatioLabels.length, 0);
});

test("multi-company blocked consolidation surfaces blocked headline", () => {
  const stub = buildGroupHealthStub({
    memberCount: 2,
    consolidationOk: false,
  });
  assert.equal(stub.blocked, true);
  assert.equal(stub.healthPlanned, true);
  assert.match(stub.headline, /blocked until combined figures/i);
  assert.equal(stub.plannedRatioLabels.length, HEALTH_RATIO_COUNT);
  assert.equal(stub.combinedInputLabels.length, 0);
});

test("stub does not mutate combined totals", () => {
  const result = buildGroupConsolidation(members);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  buildGroupHealthStub({
    memberCount: members.length,
    consolidationOk: true,
    combined: result.combined,
  });
  const again = buildGroupConsolidation(members);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(combinedFiguresUnchanged(result.combined, again.combined), true);
  assert.equal(result.combined.revenue, "140");
  assert.equal(
    combinedFiguresUnchanged(result.combined, sumGroupAdditiveScalars(members)),
    true,
  );
});
