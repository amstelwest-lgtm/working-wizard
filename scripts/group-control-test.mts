/**
 * Group ownership / control stub (pure). Run: pnpm test:group-control
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupConsolidation, sumGroupAdditiveScalars } from "../src/lib/group-consolidation.ts";
import {
  buildControlStub,
  combinedFiguresUnchanged,
  describeControlOwnershipCandidate,
  ownershipEdgesToControlCandidates,
} from "../src/lib/group-control.ts";

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

const subsidiaryEdge = [
  {
    id: "e1",
    holderClientId: "parent",
    heldClientId: "sub",
    ownershipPct: 100,
    classification: "subsidiary",
  },
];

const associateEdge = [
  {
    id: "e2",
    holderClientId: "parent",
    heldClientId: "sub",
    ownershipPct: 30,
    classification: "associate",
  },
];

const jvEdge = [
  {
    id: "e3",
    holderClientId: "parent",
    heldClientId: "sub",
    ownershipPct: 50,
    classification: "joint_venture",
  },
];

test("buildControlStub never applies control rules", () => {
  const stub = buildControlStub(subsidiaryEdge);
  assert.equal(stub.appliedControl.length, 0);
  assert.match(stub.headline, /none applied/i);
  assert.ok(stub.notAppliedReasons.length >= 4);
  assert.ok(
    stub.notAppliedReasons.some((line) =>
      /ownership_pct not used for consolidation method/i.test(line),
    ),
  );
  assert.ok(
    stub.notAppliedReasons.some((line) =>
      /classification not applied to company inclusion/i.test(line),
    ),
  );
});

test("no edges reports control not on file", () => {
  const stub = buildControlStub([]);
  assert.equal(stub.controlPlanned, false);
  assert.match(stub.headline, /not on file/i);
  assert.match(stub.detail, /No ownership edges/i);
});

test("wholly owned subsidiary gets full consolidation planned label", () => {
  const candidates = ownershipEdgesToControlCandidates(subsidiaryEdge);
  assert.equal(candidates.length, 1);
  assert.match(candidates[0]?.plannedControlLabel ?? "", /Wholly owned/i);
  const stub = buildControlStub(subsidiaryEdge);
  assert.equal(stub.controlPlanned, true);
  assert.match(stub.detail, /simple sum/i);
});

test("associate and JV use classification-based planned labels", () => {
  const associate = buildControlStub(associateEdge);
  assert.match(
    associate.candidateEdges[0]?.plannedControlLabel ?? "",
    /equity method/i,
  );
  const jv = buildControlStub(jvEdge);
  assert.match(jv.candidateEdges[0]?.plannedControlLabel ?? "", /Joint venture/i);
});

test("stub does not mutate combined totals", () => {
  const result = buildGroupConsolidation(members);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  buildControlStub(subsidiaryEdge);
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

test("describeControlOwnershipCandidate uses company names", () => {
  const stub = buildControlStub(subsidiaryEdge);
  const candidate = stub.candidateEdges[0];
  assert.ok(candidate);
  const label = describeControlOwnershipCandidate(
    candidate,
    new Map([
      ["parent", "Parent Co"],
      ["sub", "Sub Co"],
    ]),
  );
  assert.match(label, /Parent Co → Sub Co/);
  assert.match(label, /100%/);
  assert.match(label, /consolidation/i);
});
