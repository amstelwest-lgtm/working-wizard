/**
 * Load per-company figures for group consolidation preview (browser, existing RLS).
 */

import { supabase } from "@/integrations/supabase/client";
import { periodLabelFromDate, pickCurrentSnapshot } from "@/lib/financial-snapshots";
import type { GroupCompany } from "@/lib/client-group-client";
import type {
  CompanyConsolidationInput,
  GroupConsolidationBlocker,
} from "@/lib/group-consolidation";

type SnapshotRow = {
  client_id: string;
  period_date: string | null;
  created_at: string | null;
  financials: unknown;
};

export function normalizeFinancialScalars(raw: unknown): Record<string, string | undefined> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value == null || value === "") continue;
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = String(value);
  }
  return out;
}

function livePeriodDate(financials: Record<string, string | undefined>): string | null {
  const end = financials.periodEnd?.trim();
  if (end && /^\d{4}-\d{2}-\d{2}/.test(end)) return end.slice(0, 10);
  return null;
}

export function memberConsolidationInput(
  company: Pick<GroupCompany, "id" | "name" | "currency">,
  snapshot: Pick<SnapshotRow, "period_date" | "financials"> | null,
  liveFinancials: unknown,
): CompanyConsolidationInput {
  const live = normalizeFinancialScalars(liveFinancials);
  const fromSnapshot = snapshot
    ? normalizeFinancialScalars(snapshot.financials)
    : null;
  const financials = fromSnapshot && Object.keys(fromSnapshot).length > 0 ? fromSnapshot : live;
  const periodDate = snapshot?.period_date?.trim() || livePeriodDate(live) || null;
  const periodLabel = periodDate ? periodLabelFromDate(periodDate) : null;
  return {
    clientId: company.id,
    name: company.name,
    currency: company.currency,
    periodDate,
    periodLabel,
    financials,
  };
}

export function membersFromLoadedFigures(
  companies: readonly GroupCompany[],
  snapshotsByClient: ReadonlyMap<string, SnapshotRow[]>,
  liveByClient: ReadonlyMap<string, unknown>,
): CompanyConsolidationInput[] {
  return companies.map((company) => {
    const rows = snapshotsByClient.get(company.id) ?? [];
    const current = pickCurrentSnapshot(rows);
    return memberConsolidationInput(
      company,
      current,
      liveByClient.get(company.id) ?? null,
    );
  });
}

export function normalizeSnapshotPeriodDate(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null;
  return trimmed.slice(0, 10);
}

/** Distinct period_date values on file for one company (newest first). */
export function snapshotPeriodDates(rows: readonly SnapshotRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const day = normalizeSnapshotPeriodDate(row.period_date);
    if (day) set.add(day);
  }
  return [...set].sort((a, b) => b.localeCompare(a));
}

export function pickSnapshotForPeriod(
  rows: readonly SnapshotRow[],
  periodDate: string,
): SnapshotRow | null {
  const target = normalizeSnapshotPeriodDate(periodDate);
  if (!target) return null;
  const matches = rows.filter((row) => normalizeSnapshotPeriodDate(row.period_date) === target);
  if (!matches.length) return null;
  return pickCurrentSnapshot(matches);
}

export type CompanyPeriodCoverage = {
  clientId: string;
  name: string;
  /** Period end from the current on-file snapshot or live books. */
  currentPeriodDate: string | null;
  /** Snapshot period ends plus live periodEnd when set. */
  availablePeriodDates: string[];
};

export function companyPeriodCoverage(
  company: Pick<GroupCompany, "id" | "name">,
  snapshots: readonly SnapshotRow[],
  liveFinancials: unknown,
): CompanyPeriodCoverage {
  const live = normalizeFinancialScalars(liveFinancials);
  const fromSnapshots = snapshotPeriodDates(snapshots);
  const liveDate = livePeriodDate(live);
  const availablePeriodDates = [...fromSnapshots];
  if (liveDate && !availablePeriodDates.includes(liveDate)) {
    availablePeriodDates.push(liveDate);
    availablePeriodDates.sort((a, b) => b.localeCompare(a));
  }
  const current = pickCurrentSnapshot(snapshots);
  const currentPeriodDate =
    normalizeSnapshotPeriodDate(current?.period_date) || liveDate || null;
  return {
    clientId: company.id,
    name: company.name,
    currentPeriodDate,
    availablePeriodDates,
  };
}

/** Period ends that every company has on file (snapshot or live periodEnd). */
export function overlappingPeriodDates(coverages: readonly CompanyPeriodCoverage[]): string[] {
  if (coverages.length === 0) return [];
  let overlap = new Set(coverages[0]?.availablePeriodDates ?? []);
  for (let index = 1; index < coverages.length; index += 1) {
    const next = new Set(coverages[index]?.availablePeriodDates ?? []);
    overlap = new Set([...overlap].filter((day) => next.has(day)));
  }
  return [...overlap].sort((a, b) => b.localeCompare(a));
}

export function membersAtAlignedPeriod(
  companies: readonly GroupCompany[],
  snapshotsByClient: ReadonlyMap<string, SnapshotRow[]>,
  liveByClient: ReadonlyMap<string, unknown>,
  targetPeriodDate: string,
): CompanyConsolidationInput[] {
  const target = normalizeSnapshotPeriodDate(targetPeriodDate);
  if (!target) {
    return membersFromLoadedFigures(companies, snapshotsByClient, liveByClient);
  }
  return companies.map((company) => {
    const rows = snapshotsByClient.get(company.id) ?? [];
    const snapshot = pickSnapshotForPeriod(rows, target);
    const live = liveByClient.get(company.id) ?? null;
    if (snapshot) {
      return memberConsolidationInput(company, snapshot, live);
    }
    const liveScalars = normalizeFinancialScalars(live);
    if (livePeriodDate(liveScalars) === target) {
      return memberConsolidationInput(company, null, live);
    }
    return memberConsolidationInput(company, null, null);
  });
}

export type GroupConsolidationFigureBundle = {
  members: CompanyConsolidationInput[];
  snapshotsByClient: Map<string, SnapshotRow[]>;
  liveByClient: Map<string, unknown>;
  coverages: CompanyPeriodCoverage[];
  overlappingPeriodDates: string[];
};

export function groupConsolidationFigureBundle(
  companies: readonly GroupCompany[],
  snapshotsByClient: ReadonlyMap<string, SnapshotRow[]>,
  liveByClient: ReadonlyMap<string, unknown>,
): GroupConsolidationFigureBundle {
  const members = membersFromLoadedFigures(companies, snapshotsByClient, liveByClient);
  const coverages = companies.map((company) =>
    companyPeriodCoverage(
      company,
      snapshotsByClient.get(company.id) ?? [],
      liveByClient.get(company.id) ?? null,
    ),
  );
  return {
    members,
    snapshotsByClient: new Map(snapshotsByClient),
    liveByClient: new Map(liveByClient),
    coverages,
    overlappingPeriodDates: overlappingPeriodDates(coverages),
  };
}

function indexSnapshotsByClient(rows: readonly SnapshotRow[]): Map<string, SnapshotRow[]> {
  const snapshotsByClient = new Map<string, SnapshotRow[]>();
  for (const row of rows) {
    const clientId = String(row.client_id ?? "");
    if (!clientId) continue;
    const list = snapshotsByClient.get(clientId) ?? [];
    list.push(row);
    snapshotsByClient.set(clientId, list);
  }
  return snapshotsByClient;
}

async function loadGroupConsolidationRaw(
  companies: readonly GroupCompany[],
): Promise<{
  snapshotsByClient: Map<string, SnapshotRow[]>;
  liveByClient: Map<string, unknown>;
}> {
  if (companies.length === 0) {
    return { snapshotsByClient: new Map(), liveByClient: new Map() };
  }
  const ids = companies.map((company) => company.id);
  const [clientRes, snapRes] = await Promise.all([
    supabase.from("clients").select("id, financials").in("id", ids),
    supabase
      .from("client_financial_snapshots")
      .select("client_id, period_date, created_at, financials")
      .in("client_id", ids)
      .order("period_date", { ascending: false })
      .limit(Math.max(ids.length * 32, 64)),
  ]);

  const liveByClient = new Map<string, unknown>();
  if (!clientRes.error) {
    for (const row of clientRes.data ?? []) {
      if (row && typeof row === "object" && "id" in row) {
        liveByClient.set(String((row as { id: string }).id), (row as { financials: unknown }).financials);
      }
    }
  }

  const snapshotsByClient = new Map<string, SnapshotRow[]>();
  if (!snapRes.error) {
    const indexed = indexSnapshotsByClient(
      (snapRes.data ?? []).filter((row): row is SnapshotRow => row != null && typeof row === "object"),
    );
    for (const [clientId, list] of indexed) {
      snapshotsByClient.set(clientId, list);
    }
  }

  return { snapshotsByClient, liveByClient };
}

export async function loadGroupConsolidationBundle(
  companies: readonly GroupCompany[],
): Promise<GroupConsolidationFigureBundle> {
  const { snapshotsByClient, liveByClient } = await loadGroupConsolidationRaw(companies);
  return groupConsolidationFigureBundle(companies, snapshotsByClient, liveByClient);
}

export async function loadGroupConsolidationMembers(
  companies: readonly GroupCompany[],
): Promise<CompanyConsolidationInput[]> {
  const bundle = await loadGroupConsolidationBundle(companies);
  return bundle.members;
}

export function describeGroupConsolidationBlocker(
  blocker: GroupConsolidationBlocker,
  nameById: ReadonlyMap<string, string>,
): string {
  const names = (clientIds: string[]) =>
    clientIds.map((id) => nameById.get(id) ?? id).join(", ");
  switch (blocker.kind) {
    case "currency_mismatch":
      return `Different currencies (${blocker.currencies.join(", ")}). Preview needs one currency — no FX conversion.`;
    case "period_mismatch":
      return `Different period ends (${blocker.periodDates.join(", ")}). Pick a shared period end on file for every company, or upload statements to the same date.`;
    case "missing_period":
      return `Missing period end for: ${names(blocker.clientIds)}.`;
    case "no_figures":
      return blocker.clientIds.length
        ? `No figures on file for: ${names(blocker.clientIds)}.`
        : "Need at least two companies with figures.";
  }
}

export const GROUP_COMBINED_FIGURE_LABELS: Record<string, string> = {
  revenue: "Revenue",
  cogs: "COGS",
  fixedCosts: "Fixed costs",
  variableCosts: "Variable costs",
  laborCost: "Labor cost",
  ebitda: "EBITDA",
  ebit: "EBIT",
  ebt: "EBT",
  netIncome: "Net income",
  operatingCashflow: "Operating cash flow",
  totalAssets: "Total assets",
  equity: "Equity",
  totalLiabilities: "Total liabilities",
  currentAssets: "Current assets",
  currentLiabilities: "Current liabilities",
  nonCurrentLiabilities: "Non-current liabilities",
  cash: "Cash",
  receivables: "Receivables",
  inventory: "Inventory",
  payables: "Payables",
};
