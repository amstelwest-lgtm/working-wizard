/**
 * Loads the same Overview inputs the accountant client page scores from:
 * clients.financials, cash_runway_weeks, and brain_summary. Snapshot ratios
 * are only a fallback when live financials do not yield ratios.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveRatioRecord } from "../ask-ai/derive-ratios.ts";
import {
  buildOverviewBrief,
  copyPackFromMarket,
  overviewFyStartMonth,
  type OverviewBrief,
} from "../ask-ai/overview-brief.ts";
import {
  groundBrainSummaryRecord,
  ratiosForBrainProse,
} from "../../../src/lib/advisory-narrative.ts";
import { assessClientMetrics, runwayDisplayLabel } from "../../../src/lib/client-metrics.ts";

export async function loadOverviewBrief(
  client: SupabaseClient,
  clientId: string,
): Promise<OverviewBrief | null> {
  const [clientRes, snapRes] = await Promise.all([
    client
      .from("clients")
      .select(
        "name, market, financials, cashflow, cash_runway_weeks, financials_updated_at, brain_summary, operating_profile",
      )
      .eq("id", clientId)
      .maybeSingle(),
    client
      .from("client_financial_snapshots")
      .select("period_label, period_date, ratios")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const row = clientRes.data;
  if (!row && !snapRes.data) return null;
  const financials =
    row?.financials && typeof row.financials === "object" && !Array.isArray(row.financials)
      ? (row.financials as Record<string, unknown>)
      : null;
  const snapRatios =
    snapRes.data?.ratios &&
    typeof snapRes.data.ratios === "object" &&
    !Array.isArray(snapRes.data.ratios)
      ? (snapRes.data.ratios as Record<string, unknown>)
      : null;
  const fallback = resolveRatioRecord(snapRatios, financials);
  const copyPack = copyPackFromMarket(row?.market);
  const fyStartMonth = overviewFyStartMonth(copyPack, row?.operating_profile);
  const metrics = assessClientMetrics({
    financials,
    cashflow: (row as { cashflow?: unknown } | null)?.cashflow,
    financialsUpdatedAt:
      (row as { financials_updated_at?: string | null } | null)?.financials_updated_at ?? null,
    fyStartMonth,
  });
  return buildOverviewBrief({
    financials,
    ratios: fallback,
    cash: metrics.cash.amount,
    runwayWeeks: metrics.runway.weeks,
    runwayLabel: runwayDisplayLabel(metrics.runway),
    copyPack,
    fyStartMonth,
    shortfallWeek: metrics.outlook.shortfallWeek,
    clientName: typeof row?.name === "string" ? row.name : null,
    periodLabel: (snapRes.data?.period_label as string | null) ?? null,
    figuresAsOf: (snapRes.data?.period_date as string | null) ?? null,
    brainSummary: groundBrainSummaryRecord(
      row?.brain_summary ?? null,
      ratiosForBrainProse(financials, fyStartMonth),
    ),
  });
}
