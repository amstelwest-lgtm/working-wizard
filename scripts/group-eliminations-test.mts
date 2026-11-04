/**
 * Group intercompany eliminations stub (pure). Run: pnpm test:group-eliminations
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupConsolidation, sumGroupAdditiveScalars } from "../src/lib/group-consolidation.ts";
import {
  buildEliminationsStub,
  combinedFiguresUnchanged,
  describeIntercompanyCandidatePair,
  ownershipEdgesToCandidatePairs,
} from "../src/lib/group-eliminations.ts";

const members = [
  {
    clientId: "parent",
    name: "Parent Co",
    currency: "ZAR",
    periodDate: "2026-06-30",
    financials: { revenue: "100", totalAssets: "500" },
  },
  {
    clientId: "sub",
    name: "Sub Co",
    currency: "ZAR",
    periodDate: "2026-06-30",
    financials: { revenue: "40", totalAssets: "200" },
  },
];

const edges = [
  {
    id: "e1",
    holderClientId: "parent",
    heldClientId: "sub",
    ownershipPct: 100,
    classification: "subsidiary",
  },
];

test("buildEliminationsStub never applies journal lines", () => {
  const stub = buildEliminationsStub(edges);
  assert.equal(stub.appliedEliminations.length, 0);
  assert.match(stub.headline, /none applied/i);
  assert.ok(stub.notAppliedReasons.length >= 2);
});

test("ownership edges map to candidate IC pairs only", () => {
  const pairs = ownershipEdgesToCandidatePairs(edges);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.holderClientId, "parent");
  assert.equal(pairs[0]?.heldClientId, "sub");
});

test("stub does not mutate combined totals", () => {
  const result = buildGroupConsolidation(members);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  buildEliminationsStub(edges);
  const again = buildGroupConsolidation(members);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(
    combinedFiguresUnchanged(result.combined, again.combined),
    true,
  );
  assert.equal(result.combined.revenue, "140");
  assert.equal(
    combinedFiguresUnchanged(result.combined, sumGroupAdditiveScalars(members)),
    true,
  );
});

test("describeIntercompanyCandidatePair uses company names", () => {
  const stub = buildEliminationsStub(edges);
  const pair = stub.candidatePairs[0];
  assert.ok(pair);
  const label = describeIntercompanyCandidatePair(
    pair,
    new Map([
      ["parent", "Parent Co"],
      ["sub", "Sub Co"],
    ]),
  );
  assert.match(label, /Parent Co → Sub Co/);
  assert.match(label, /100%/);
});

test("empty edges still reports not applied", () => {
  const stub = buildEliminationsStub([]);
  assert.equal(stub.candidatePairs.length, 0);
  assert.match(stub.detail, /simple sum/i);
});
