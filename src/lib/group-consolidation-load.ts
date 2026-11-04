/**
 * Load per-company figures for group consolidation preview (browser, existing RLS).
 */

import { supabase } from "@/integrations/supabase/client";
import { pickCurrentSnapshot } from "@/lib/financial-snapshots";
import type { GroupCompany } from "@/lib/client-group-client";
import type {
  CompanyConsolidationInput,
  GroupConsolidationBlocker,
} from "@/lib/group-consolidation";

type SnapshotRow = {
  client_id: string;
  period_label: string | null;
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

function livePeriodLabel(financials: Record<string, string | undefined>): string | null {
  const label = financials.periodLabel?.trim();
  return label || null;
}

export function memberConsolidationInput(
  company: Pick<GroupCompany, "id" | "name" | "currency">,
  snapshot: Pick<SnapshotRow, "period_date" | "period_label" | "financials"> | null,
  liveFinancials: unknown,
): CompanyConsolidationInput {
  const live = normalizeFinancialScalars(liveFinancials);
  const fromSnapshot = snapshot
    ? normalizeFinancialScalars(snapshot.financials)
    : null;
  const financials = fromSnapshot && Object.keys(fromSnapshot).length > 0 ? fromSnapshot : live;
  const periodDate = snapshot?.period_date?.trim() || livePeriodDate(live) || null;
  const periodLabel = snapshot?.period_label?.trim() || livePeriodLabel(live) || null;
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

export async function loadGroupConsolidationMembers(
  companies: readonly GroupCompany[],
): Promise<CompanyConsolidationInput[]> {
  if (companies.length === 0) return [];
  const ids = companies.map((company) => company.id);
  const [clientRes, snapRes] = await Promise.all([
    supabase.from("clients").select("id, financials").in("id", ids),
    supabase
      .from("client_financial_snapshots")
      .select("client_id, period_label, period_date, created_at, financials")
      .in("client_id", ids)
      .order("period_date", { ascending: false })
      .limit(Math.max(ids.length * 8, 16)),
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
    for (const row of snapRes.data ?? []) {
      if (!row || typeof row !== "object") continue;
      const clientId = String((row as SnapshotRow).client_id ?? "");
      if (!clientId) continue;
      const list = snapshotsByClient.get(clientId) ?? [];
      list.push(row as SnapshotRow);
      snapshotsByClient.set(clientId, list);
    }
  }

  return membersFromLoadedFigures(companies, snapshotsByClient, liveByClient);
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
      return `Different period ends (${blocker.periodDates.join(", ")}). Align statements before adding up.`;
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
