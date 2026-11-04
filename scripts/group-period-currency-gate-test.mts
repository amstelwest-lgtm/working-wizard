/**
 * Group L1 year-end / currency gate stub (pure). Run: pnpm test:group-period-currency-gate
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupConsolidation, sumGroupAdditiveScalars } from "../src/lib/group-consolidation.ts";
import {
  buildPeriodCurrencyGateStub,
  combinedFiguresUnchanged,
  describeGateMemberCurrency,
  describeGateMemberYearEnd,
  memberYearEndsFromCompanies,
} from "../src/lib/group-period-currency-gate.ts";

const alignedCompanies = [
  { id: "a", yearEndMonth: 2 },
  { id: "b", yearEndMonth: 2 },
] as const;

const mixedYearEndCompanies = [
  { id: "a", yearEndMonth: 2 },
  { id: "b", yearEndMonth: 6 },
] as const;

const membersZar = [
  {
    clientId: "a",
    name: "Alpha",
    currency: "ZAR",
    periodDate: "2026-06-30",
    financials: { revenue: "100", totalAssets: "500" },
  },
  {
    clientId: "b",
    name: "Beta",
    currency: "ZAR",
    periodDate: "2026-06-30",
    financials: { revenue: "40", totalAssets: "200" },
  },
];

const mixedCurrencyMembers = [
  { ...membersZar[0]! },
  { ...membersZar[1]!, clientId: "c", name: "Gamma", currency: "USD" },
];

test("buildPeriodCurrencyGateStub never applies gates", () => {
  const stub = buildPeriodCurrencyGateStub({
    companies: mixedYearEndCompanies,
    members: membersZar,
  });
  assert.equal(stub.appliedGates.length, 0);
  assert.equal(stub.gateNeeded, true);
  assert.ok(stub.notAppliedReasons.length >= 3);
});

test("aligned year-end and currency omits gate card", () => {
  const stub = buildPeriodCurrencyGateStub({
    companies: alignedCompanies,
    members: membersZar,
  });
  assert.equal(stub.gateNeeded, false);
  assert.equal(stub.plannedBlockReasons.length, 0);
  assert.equal(stub.mixedYearEnd, false);
  assert.equal(stub.mixedCurrency, false);
});

test("mixed year-end months trigger planned gate", () => {
  const stub = buildPeriodCurrencyGateStub({
    companies: mixedYearEndCompanies,
    members: membersZar,
  });
  assert.equal(stub.mixedYearEnd, true);
  assert.equal(stub.mixedCurrency, false);
  assert.ok(stub.plannedBlockReasons.some((line) => /year-ends/i.test(line)));
  assert.match(stub.headline, /planned block/i);
});

test("mixed currencies trigger planned gate", () => {
  const stub = buildPeriodCurrencyGateStub({
    companies: alignedCompanies,
    members: mixedCurrencyMembers,
  });
  assert.equal(stub.mixedCurrency, true);
  assert.equal(stub.gateNeeded, true);
  assert.ok(stub.plannedBlockReasons.some((line) => /currencies/i.test(line)));
});

test("member year ends map from companies", () => {
  const rows = memberYearEndsFromCompanies(mixedYearEndCompanies);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.yearEndMonth).sort((x, y) => (x ?? 0) - (y ?? 0)),
    [2, 6],
  );
});

test("stub does not mutate combined totals", () => {
  const result = buildGroupConsolidation(membersZar);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  buildPeriodCurrencyGateStub({
    companies: mixedYearEndCompanies,
    members: membersZar,
  });
  const again = buildGroupConsolidation(membersZar);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(combinedFiguresUnchanged(result.combined, again.combined), true);
  assert.equal(result.combined.revenue, "140");
  assert.equal(
    combinedFiguresUnchanged(result.combined, sumGroupAdditiveScalars(membersZar)),
    true,
  );
});

test("describe helpers use company names", () => {
  const stub = buildPeriodCurrencyGateStub({
    companies: mixedYearEndCompanies,
    members: membersZar,
  });
  const yearRow = stub.memberYearEnds[0];
  assert.ok(yearRow);
  const yearLabel = describeGateMemberYearEnd(
    yearRow,
    new Map([
      ["a", "Alpha"],
      ["b", "Beta"],
    ]),
  );
  assert.match(yearLabel, /Alpha · FY end/);

  const currencyStub = buildPeriodCurrencyGateStub({
    companies: alignedCompanies,
    members: mixedCurrencyMembers,
  });
  const curRow = currencyStub.memberCurrencies[1];
  assert.ok(curRow);
  const curLabel = describeGateMemberCurrency(
    curRow,
    new Map([
      ["a", "Alpha"],
      ["c", "Gamma"],
    ]),
  );
  assert.match(curLabel, /Gamma · USD/);
});
