/**
 * Group consolidation figure loading (pure helpers). Run: pnpm test:group-consolidation-load
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  companyPeriodCoverage,
  memberConsolidationInput,
  membersAtAlignedPeriod,
  membersFromLoadedFigures,
  normalizeFinancialScalars,
  overlappingPeriodDates,
} from "../src/lib/group-consolidation-load.ts";
import { buildGroupConsolidation } from "../src/lib/group-consolidation.ts";
import type { GroupCompany } from "../src/lib/client-group-client.ts";

const company = (id: string, name: string): GroupCompany => ({
  id,
  name,
  groupId: "g1",
  entityType: "company",
  yearEndMonth: 2,
  currency: "ZAR",
  registrationNumber: null,
  taxNumber: null,
  vatNumber: null,
  personUserId: null,
  placeholder: false,
  booksConnectedAt: null,
  dataUploadedAt: null,
  openQueries: 0,
  firmId: null,
});

test("normalizeFinancialScalars keeps string and number fields", () => {
  assert.deepEqual(normalizeFinancialScalars({ revenue: "10", cash: 5 }), {
    revenue: "10",
    cash: "5",
  });
});

test("membersFromLoadedFigures uses pickCurrent snapshot then live periodEnd", () => {
  const members = membersFromLoadedFigures(
    [company("a", "Alpha"), company("b", "Beta")],
    new Map([
      [
        "a",
        [
          {
            client_id: "a",
            period_date: "2026-06-30",
            created_at: "2026-06-01T00:00:00Z",
            financials: { revenue: "100" },
          },
        ],
      ],
    ]),
    new Map([
      [
        "b",
        {
          revenue: "50",
          periodEnd: "2026-06-30",
        },
      ],
    ]),
  );
  const result = buildGroupConsolidation(members);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.combined.revenue, "150");
});

test("memberConsolidationInput prefers snapshot financials over live", () => {
  const input = memberConsolidationInput(
    company("a", "Alpha"),
    {
      period_date: "2026-06-30",
      financials: { revenue: "99" },
    },
    { revenue: "1" },
  );
  assert.equal(input.financials.revenue, "99");
});

test("overlappingPeriodDates is the intersection of on-file period ends", () => {
  const coverages = [
    companyPeriodCoverage(company("a", "Alpha"), [
      { client_id: "a", period_date: "2026-06-30", created_at: "2026-06-01", financials: {} },
      { client_id: "a", period_date: "2026-03-31", created_at: "2026-03-01", financials: {} },
    ], null),
    companyPeriodCoverage(company("b", "Beta"), [
      { client_id: "b", period_date: "2026-06-30", created_at: "2026-06-01", financials: {} },
      { client_id: "b", period_date: "2026-09-30", created_at: "2026-09-01", financials: {} },
    ], null),
  ];
  assert.deepEqual(overlappingPeriodDates(coverages), ["2026-06-30"]);
});

test("membersAtAlignedPeriod sums mismatched currents at a shared snapshot date", () => {
  const snapshotsByClient = new Map([
    [
      "a",
      [
        {
          client_id: "a",
          period_date: "2026-09-04",
          created_at: "2026-09-05",
          financials: { revenue: "100", totalAssets: "200", netIncome: "10" },
        },
        {
          client_id: "a",
          period_date: "2026-06-30",
          created_at: "2026-07-01",
          financials: { revenue: "80", totalAssets: "150", netIncome: "8" },
        },
      ],
    ],
    [
      "b",
      [
        {
          client_id: "b",
          period_date: "2026-11-02",
          created_at: "2026-11-03",
          financials: { revenue: "50", totalAssets: "90", netIncome: "5" },
        },
        {
          client_id: "b",
          period_date: "2026-06-30",
          created_at: "2026-07-01",
          financials: { revenue: "40", totalAssets: "70", netIncome: "4" },
        },
      ],
    ],
  ]);
  const liveByClient = new Map<string, unknown>();
  const defaultMembers = membersFromLoadedFigures(
    [company("a", "Alpha"), company("b", "Beta")],
    snapshotsByClient,
    liveByClient,
  );
  assert.equal(buildGroupConsolidation(defaultMembers).ok, false);

  const aligned = membersAtAlignedPeriod(
    [company("a", "Alpha"), company("b", "Beta")],
    snapshotsByClient,
    liveByClient,
    "2026-06-30",
  );
  const result = buildGroupConsolidation(aligned);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.combined.revenue, "120");
  assert.equal(result.periodDate, "2026-06-30");
});
