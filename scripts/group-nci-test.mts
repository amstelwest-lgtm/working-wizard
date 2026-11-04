/**
 * Group NCI / ownership stub (pure). Run: pnpm test:group-nci
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupConsolidation, sumGroupAdditiveScalars } from "../src/lib/group-consolidation.ts";
import {
  buildNciStub,
  combinedFiguresUnchanged,
  describeNciOwnershipCandidate,
  ownershipEdgesToNciCandidates,
} from "../src/lib/group-nci.ts";

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

const whollyOwnedEdge = [
  {
    id: "e1",
    holderClientId: "parent",
    heldClientId: "sub",
    ownershipPct: 100,
    classification: "subsidiary",
  },
];

const partialEdge = [
  {
    id: "e2",
    holderClientId: "parent",
    heldClientId: "sub",
    ownershipPct: 80,
    classification: "subsidiary",
  },
];

const unsetPctEdge = [
  {
    id: "e3",
    holderClientId: "parent",
    heldClientId: "sub",
    ownershipPct: null,
    classification: "associate",
  },
];

test("buildNciStub never applies NCI lines", () => {
  const stub = buildNciStub(partialEdge);
  assert.equal(stub.appliedNci.length, 0);
  assert.match(stub.headline, /none applied/i);
  assert.ok(stub.notAppliedReasons.length >= 3);
  assert.ok(stub.notAppliedReasons.some((line) => /ownership_pct not applied/i.test(line)));
});

test("wholly owned edges report NCI not needed", () => {
  const stub = buildNciStub(whollyOwnedEdge);
  assert.equal(stub.nciPlanned, false);
  assert.equal(stub.candidateHoldings.length, 0);
  assert.match(stub.headline, /not needed/i);
  assert.match(stub.detail, /100%/i);
});

test("partial ownership surfaces planned NCI candidates", () => {
  const candidates = ownershipEdgesToNciCandidates(partialEdge);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.ownershipPct, 80);
  const stub = buildNciStub(partialEdge);
  assert.equal(stub.nciPlanned, true);
  assert.equal(stub.candidateHoldings.length, 1);
  assert.match(stub.detail, /simple sum/i);
});

test("unset ownership pct treated as planned NCI candidate", () => {
  const stub = buildNciStub(unsetPctEdge);
  assert.equal(stub.nciPlanned, true);
  assert.equal(stub.candidateHoldings.length, 1);
});

test("no edges reports NCI not needed / none on file", () => {
  const stub = buildNciStub([]);
  assert.equal(stub.nciPlanned, false);
  assert.match(stub.headline, /not needed/i);
  assert.match(stub.detail, /No ownership edges/i);
});

test("stub does not mutate combined totals", () => {
  const result = buildGroupConsolidation(members);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  buildNciStub(partialEdge);
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

test("describeNciOwnershipCandidate uses company names", () => {
  const stub = buildNciStub(partialEdge);
  const candidate = stub.candidateHoldings[0];
  assert.ok(candidate);
  const label = describeNciOwnershipCandidate(
    candidate,
    new Map([
      ["parent", "Parent Co"],
      ["sub", "Sub Co"],
    ]),
  );
  assert.match(label, /Parent Co → Sub Co/);
  assert.match(label, /80%/);
});
