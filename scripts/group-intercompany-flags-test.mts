/**
 * Group L1 intercompany flags stub (pure). Run: pnpm test:group-intercompany-flags
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupConsolidation, sumGroupAdditiveScalars } from "../src/lib/group-consolidation.ts";
import {
  buildIntercompanyFlagsStub,
  combinedFiguresUnchanged,
  describeIntercompanyFlagCandidate,
  ownershipEdgesToIntercompanyFlagCandidates,
} from "../src/lib/group-intercompany-flags.ts";

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

const inGroupEdge = [
  {
    id: "e1",
    holderClientId: "parent",
    heldClientId: "sub",
    ownershipPct: 100,
    classification: "subsidiary",
  },
];

const outOfGroupEdge = [
  {
    id: "e2",
    holderClientId: "external",
    heldClientId: "sub",
    ownershipPct: 20,
    classification: "associate",
  },
];

test("buildIntercompanyFlagsStub never applies IC flags", () => {
  const stub = buildIntercompanyFlagsStub({
    edges: inGroupEdge,
    memberClientIds: ["parent", "sub"],
  });
  assert.equal(stub.appliedFlags.length, 0);
  assert.match(stub.headline, /none applied/i);
  assert.ok(stub.notAppliedReasons.length >= 4);
  assert.ok(
    stub.notAppliedReasons.some((line) => /No intercompany account map/i.test(line)),
  );
});

test("no in-group edges means flags not planned", () => {
  const stub = buildIntercompanyFlagsStub({
    edges: [],
    memberClientIds: ["parent", "sub"],
  });
  assert.equal(stub.flagsPlanned, false);
  assert.equal(stub.candidateFlags.length, 0);
});

test("edges outside member list do not create flag candidates", () => {
  const candidates = ownershipEdgesToIntercompanyFlagCandidates(outOfGroupEdge, [
    "parent",
    "sub",
  ]);
  assert.equal(candidates.length, 0);
  const stub = buildIntercompanyFlagsStub({
    edges: outOfGroupEdge,
    memberClientIds: ["parent", "sub"],
  });
  assert.equal(stub.flagsPlanned, false);
});

test("in-group ownership edge is a planned IC flag", () => {
  const stub = buildIntercompanyFlagsStub({
    edges: inGroupEdge,
    memberClientIds: ["parent", "sub"],
  });
  assert.equal(stub.flagsPlanned, true);
  assert.equal(stub.candidateFlags.length, 1);
  assert.match(stub.detail, /simple sum/i);
  assert.match(stub.candidateFlags[0]?.plannedFlagLabel ?? "", /Review intercompany/i);
});

test("stub does not mutate combined totals", () => {
  const result = buildGroupConsolidation(members);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  buildIntercompanyFlagsStub({
    edges: inGroupEdge,
    memberClientIds: ["parent", "sub"],
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

test("describeIntercompanyFlagCandidate uses company names", () => {
  const stub = buildIntercompanyFlagsStub({
    edges: inGroupEdge,
    memberClientIds: ["parent", "sub"],
  });
  const candidate = stub.candidateFlags[0];
  assert.ok(candidate);
  const label = describeIntercompanyFlagCandidate(
    candidate,
    new Map([
      ["parent", "Parent Co"],
      ["sub", "Sub Co"],
    ]),
  );
  assert.match(label, /Parent Co ↔ Sub Co/);
  assert.match(label, /100%/);
  assert.match(label, /planned/i);
});
