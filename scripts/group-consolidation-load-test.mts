/**
 * Group consolidation figure loading (pure helpers). Run: pnpm test:group-consolidation-load
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  memberConsolidationInput,
  membersFromLoadedFigures,
  normalizeFinancialScalars,
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
            period_label: "Jun 2026",
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
          periodLabel: "Jun 2026",
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
      period_label: "Jun 2026",
      financials: { revenue: "99" },
    },
    { revenue: "1" },
  );
  assert.equal(input.financials.revenue, "99");
});
