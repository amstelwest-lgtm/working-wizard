/**
 * Group of one backfill, company access, Individual privacy, and move revoke.
 * Run: pnpm test:client-groups
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  accessConfirmLines,
  backfillGroupOfOne,
  backfillSharesAGroup,
  billableCompanyCount,
  canAccessCompany,
  companyCountBanner,
  connectionHealth,
  countsTowardCompanySlot,
  groupChromeVisible,
  membershipsAfterMove,
} from "../src/lib/client-groups.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "44444444-4444-4444-8444-444444444444";
const firm = "22222222-2222-4222-8222-222222222222";

test("backfill gives every client its own group", () => {
  const groups = backfillGroupOfOne(["solo-books", "solo-cafe", "  ", "solo-books"]);
  assert.equal(groups.size, 2);
  assert.notEqual(groups.get("solo-books"), groups.get("solo-cafe"));
  assert.equal(backfillSharesAGroup(groups), false);
  assert.equal(groupChromeVisible(1), false);
  assert.equal(groupChromeVisible(2), true);
});

test("group owner sees companies and only the Individual person sees that entity", () => {
  const company = {
    entityType: "cc",
    personUserId: null,
    direct: false,
    groupOwner: true,
    hasMembership: false,
  };
  assert.equal(canAccessCompany({ userId: owner, ...company }), true);
  assert.equal(
    canAccessCompany({
      userId: other,
      entityType: "individual",
      personUserId: owner,
      direct: false,
      groupOwner: true,
      hasMembership: false,
    }),
    false,
  );
  assert.equal(
    canAccessCompany({
      userId: owner,
      entityType: "individual",
      personUserId: owner,
      direct: false,
      groupOwner: true,
      hasMembership: false,
    }),
    true,
  );
  assert.equal(
    canAccessCompany({
      userId: firm,
      entityType: "individual",
      personUserId: owner,
      direct: true,
      groupOwner: false,
      hasMembership: false,
    }),
    true,
  );
  assert.equal(
    canAccessCompany({
      userId: "stranger",
      entityType: "company",
      personUserId: null,
      direct: false,
      groupOwner: false,
      hasMembership: false,
    }),
    false,
  );
});

test("moving a company revokes the previous owner login and grants the next", () => {
  const plan = membershipsAfterMove({
    fromOwnerIds: [owner],
    toOwnerIds: [other],
    personUserId: null,
    entityType: "cc",
  });
  assert.deepEqual(plan.revoke, [owner]);
  assert.deepEqual(plan.grant, [other]);

  const individual = membershipsAfterMove({
    fromOwnerIds: [owner, other],
    toOwnerIds: [other],
    personUserId: owner,
    entityType: "individual",
  });
  assert.deepEqual(individual.revoke, []);
  assert.deepEqual(individual.grant, []);

  const lines = accessConfirmLines({
    companyName: "Harbour CC",
    gains: [{ userId: other, label: "Sam" }],
    losses: [{ userId: owner, label: "Ada" }],
    firmKeepsAccess: true,
  });
  assert.deepEqual(lines.gains, ["Sam gains access to Harbour CC."]);
  assert.deepEqual(lines.losses, ["Ada loses access to Harbour CC.", "The firm keeps this file."]);
});

test("Individual and unconnected placeholders stay outside the included 3", () => {
  const companies = [
    { entityType: "company", placeholder: false },
    { entityType: "cc", placeholder: false },
    { entityType: "trust", placeholder: false },
    { entityType: "individual", placeholder: false },
    { entityType: "company", placeholder: true },
  ];
  assert.equal(countsTowardCompanySlot(companies[3]!), false);
  assert.equal(countsTowardCompanySlot(companies[4]!), false);
  assert.equal(billableCompanyCount(companies), 3);
  assert.equal(companyCountBanner(3), null);
  assert.match(companyCountBanner(4) ?? "", /extra company/);
  assert.match(companyCountBanner(5) ?? "", /Billing is not changed yet/);
  assert.equal(
    countsTowardCompanySlot({
      entityType: "company",
      placeholder: true,
      dataUploadedAt: "2026-11-01",
    }),
    true,
  );
  assert.equal(
    countsTowardCompanySlot({ entityType: "company", placeholder: true, connected: true }),
    true,
  );
});

test("connection health is status only", () => {
  assert.deepEqual(connectionHealth([]), { label: "Not connected", lastSync: null });
  assert.equal(
    connectionHealth([{ syncStatus: "ok", syncError: null, lastSyncedAt: "2026-10-01" }]).label,
    "Connected",
  );
  assert.equal(
    connectionHealth([{ syncStatus: "error", syncError: "token", lastSyncedAt: null }]).label,
    "Needs attention",
  );
});

test("the group panel routes combined totals through preview helper only", () => {
  const source = readFileSync(
    new URL("../src/components/client-group-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(/totalRevenue|netIncome|cashBalance|\.sum\(/.test(source), false);
  assert.match(source, /GroupCombinedFiguresPreview/);
  assert.match(source, /read-only combined preview/);
});

test("client chrome exposes group status for a group of one", () => {
  const source = readFileSync(
    new URL("../src/components/client-group-chrome.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /loadClientGroupNav/);
  assert.match(source, /Group status/);
  assert.doesNotMatch(source, /!groupChromeVisible\(group\.companies\.length\)\) return null/);
});

test("access confirm can be dismissed without running the RPC", () => {
  const source = readFileSync(
    new URL("../src/components/client-group-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /dismissAccessConfirm/);
  assert.match(source, />\s*Cancel\s*</);
});

test("company groups use the shared rail kicker on the navy rail", () => {
  const chrome = readFileSync(
    new URL("../src/components/client-group-chrome.tsx", import.meta.url),
    "utf8",
  );
  const shine = readFileSync(new URL("../src/styles/premium-shine.css", import.meta.url), "utf8");
  assert.match(chrome, /className="rail-kicker">Groups/);
  assert.match(shine, /\.deliverable-rail \.rail-kicker[\s\S]*--pp-frame-dim/);
});

test("group status panel wires combined figures preview for multi-company groups", () => {
  const panel = readFileSync(
    new URL("../src/components/client-group-panel.tsx", import.meta.url),
    "utf8",
  );
  const preview = readFileSync(
    new URL("../src/components/group-combined-figures-preview.tsx", import.meta.url),
    "utf8",
  );
  assert.match(panel, /GroupCombinedFiguresPreview/);
  assert.match(panel, /groupChromeVisible\(companies\.length\)/);
  assert.match(preview, /Combined figures \(preview\)/);
  assert.match(preview, /buildGroupConsolidation/);
});
