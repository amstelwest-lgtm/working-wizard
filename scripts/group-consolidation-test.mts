/**
 * Parent group additive consolidation (P2 prep). Run: pnpm test:group-consolidation
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGroupConsolidation,
  groupConsolidationBlockers,
  groupConsolidationHardStop,
  GROUP_ADDITIVE_SCALAR_KEYS,
  sumGroupAdditiveScalars,
} from "../src/lib/group-consolidation.ts";

const baseFigures = {
  revenue: "100",
  cogs: "40",
  netIncome: "10",
  totalAssets: "200",
  equity: "80",
  cash: "15",
};

test("additive keys cover primary P&L and BS scalars", () => {
  assert.ok(GROUP_ADDITIVE_SCALAR_KEYS.includes("revenue"));
  assert.ok(GROUP_ADDITIVE_SCALAR_KEYS.includes("totalAssets"));
});

test("sums two aligned ZAR companies", () => {
  const members = [
    {
      clientId: "a",
      name: "Alpha",
      currency: "ZAR",
      periodDate: "2026-06-30",
      financials: baseFigures,
    },
    {
      clientId: "b",
      name: "Beta",
      currency: "ZAR",
      periodDate: "2026-06-30",
      financials: {
        revenue: "50",
        cogs: "20",
        netIncome: "5",
        totalAssets: "90",
        equity: "40",
        cash: "5",
      },
    },
  ];
  const result = buildGroupConsolidation(members);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.combined.revenue, "150");
  assert.equal(result.combined.totalAssets, "290");
  assert.equal(result.combined.netIncome, "15");
  assert.equal(result.currency, "ZAR");
});

test("currency mismatch is a hard stop", () => {
  const blockers = groupConsolidationBlockers([
    {
      clientId: "a",
      name: "A",
      currency: "ZAR",
      periodDate: "2026-06-30",
      financials: baseFigures,
    },
    {
      clientId: "b",
      name: "B",
      currency: "USD",
      periodDate: "2026-06-30",
      financials: baseFigures,
    },
  ]);
  assert.equal(groupConsolidationHardStop(blockers), true);
  const result = buildGroupConsolidation([
    {
      clientId: "a",
      name: "A",
      currency: "ZAR",
      periodDate: "2026-06-30",
      financials: baseFigures,
    },
    {
      clientId: "b",
      name: "B",
      currency: "USD",
      periodDate: "2026-06-30",
      financials: baseFigures,
    },
  ]);
  assert.equal(result.ok, false);
});

test("period mismatch is a hard stop", () => {
  const result = buildGroupConsolidation([
    {
      clientId: "a",
      name: "A",
      currency: "ZAR",
      periodDate: "2026-06-30",
      financials: baseFigures,
    },
    {
      clientId: "b",
      name: "B",
      currency: "ZAR",
      periodDate: "2026-03-31",
      financials: baseFigures,
    },
  ]);
  assert.equal(result.ok, false);
});

test("sum skips blank lines on one member", () => {
  const combined = sumGroupAdditiveScalars([
    {
      clientId: "a",
      name: "A",
      currency: "ZAR",
      periodDate: "2026-06-30",
      financials: { revenue: "10" },
    },
    {
      clientId: "b",
      name: "B",
      currency: "ZAR",
      periodDate: "2026-06-30",
      financials: { revenue: "5", cash: "2" },
    },
  ]);
  assert.equal(combined.revenue, "15");
  assert.equal(combined.cash, "2");
});
