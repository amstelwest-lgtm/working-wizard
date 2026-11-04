/**
 * Group FX translation stub (pure). Run: pnpm test:group-fx
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildGroupConsolidation, sumGroupAdditiveScalars } from "../src/lib/group-consolidation.ts";
import {
  buildFxStub,
  combinedFiguresUnchanged,
  describeMemberCurrency,
  memberCurrenciesFromConsolidationInputs,
} from "../src/lib/group-fx.ts";

const zarMembers = [
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

const mixedMembers = [
  { ...zarMembers[0]!, currency: "ZAR" },
  { ...zarMembers[1]!, clientId: "c", name: "Gamma", currency: "USD" },
];

test("buildFxStub never applies translation lines", () => {
  const stub = buildFxStub(zarMembers);
  assert.equal(stub.appliedTranslations.length, 0);
  assert.match(stub.headline, /none applied/i);
  assert.ok(stub.notAppliedReasons.length >= 2);
});

test("same-currency group reports FX not needed", () => {
  const stub = buildFxStub(zarMembers);
  assert.equal(stub.sameCurrencyGroup, true);
  assert.equal(stub.mixedCurrency, false);
  assert.ok(stub.notAppliedReasons.some((line) => /not needed/i.test(line)));
  assert.match(stub.detail, /ZAR/i);
});

test("mixed currencies note planned FX without inventing rates", () => {
  const stub = buildFxStub(mixedMembers);
  assert.equal(stub.mixedCurrency, true);
  assert.equal(stub.sameCurrencyGroup, false);
  assert.match(stub.detail, /blocked/i);
  assert.match(stub.detail, /no rates/i);
  assert.ok(
    stub.notAppliedReasons.some((line) => /Mixed currencies block/i.test(line)),
  );
});

test("member currencies map from consolidation inputs", () => {
  const rows = memberCurrenciesFromConsolidationInputs(mixedMembers);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.currency).sort(), ["USD", "ZAR"]);
});

test("stub does not mutate combined totals", () => {
  const result = buildGroupConsolidation(zarMembers);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  buildFxStub(zarMembers);
  const again = buildGroupConsolidation(zarMembers);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(combinedFiguresUnchanged(result.combined, again.combined), true);
  assert.equal(result.combined.revenue, "140");
  assert.equal(
    combinedFiguresUnchanged(result.combined, sumGroupAdditiveScalars(zarMembers)),
    true,
  );
});

test("describeMemberCurrency uses company names", () => {
  const stub = buildFxStub(zarMembers);
  const row = stub.memberCurrencies[0];
  assert.ok(row);
  const label = describeMemberCurrency(
    row,
    new Map([
      ["a", "Alpha"],
      ["b", "Beta"],
    ]),
  );
  assert.match(label, /Alpha · ZAR/);
});
