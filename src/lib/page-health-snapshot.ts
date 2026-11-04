/**
 * Health-page score for regenerate and the Analyst card.
 * Kept out of health-snapshot.ts so edge functions do not import it.
 */
import { hasFinancialEvidence } from "./client-metrics.ts";
import { parseOperatingProfile } from "./client-profile.ts";
import { healthWithoutEvidence, liveHealthFromBooks } from "./health-score.ts";
import { healthSnapshotFromBooks, type HealthScoreSnapshot } from "./health-snapshot.ts";
import { marketForClient } from "./market/scope.ts";
import { resolvePriorSnapshot } from "./prior-period.ts";
import { clientIndustryDisplay } from "./profile-signals.ts";
import { figuresPeriodLabelFrom, readStatementMeta } from "./statement-period.ts";

type PageSnapshotRow = {
  period_label?: string | null;
  period_date?: string | null;
  financials?: Record<string, unknown> | null;
  created_at?: string | null;
  pinned?: boolean | null;
};

/** Newest created_at, matching pickCurrentSnapshot. No pin column on the table. */
function currentPageSnapshot(rows: readonly PageSnapshotRow[]): PageSnapshotRow | null {
  const list = rows.filter((row) => row != null);
  if (!list.length) return null;
  const pinned = list.find((row) => row.pinned === true);
  if (pinned) return pinned;
  return (
    [...list].sort((a, b) => {
      const created = Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "");
      if (Number.isFinite(created) && created !== 0) return created;
      return (b.period_date ?? "").localeCompare(a.period_date ?? "");
    })[0] ?? null
  );
}

function asFinancials(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The Health page score: liveHealthFromBooks with the client's year start,
 * industry, prior snapshot, and the current snapshot's period label.
 */
export function pageHealthScoreSnapshot(input: {
  financials?: Record<string, unknown> | null;
  cashflow?: unknown;
  financialsUpdatedAt?: string | null;
  market?: unknown;
  operatingProfile?: unknown;
  clientName?: string | null;
  snapshots?: readonly PageSnapshotRow[];
  now?: Date;
}): HealthScoreSnapshot | null {
  const market = marketForClient({ market: input.market });
  const financials = asFinancials(input.financials);
  const profile = parseOperatingProfile(input.operatingProfile);
  const fyStartMonth = profile?.fyStartMonth ?? market.fyStartMonthDefault;
  const industry = clientIndustryDisplay(input.clientName, profile);
  const statementMeta = readStatementMeta(financials, market);
  const prior = resolvePriorSnapshot(
    (input.snapshots ?? []).map((row) => ({
      period_label: "",
      period_date: row.period_date ?? "",
      financials: asFinancials(row.financials),
      created_at: row.created_at ?? null,
    })),
    input.now ?? new Date(),
    { periodEnd: statementMeta.periodEnd, financials },
  );
  const current = currentPageSnapshot(input.snapshots ?? []);
  const scored = liveHealthFromBooks({
    financials,
    cashflow: input.cashflow,
    financialsUpdatedAt: input.financialsUpdatedAt ?? null,
    priorFinancials: prior?.financials ?? null,
    fyStartMonth,
    market,
    industry,
    timeZone: market.timezone,
    now: input.now,
  });
  const health = hasFinancialEvidence({ financials, cashflow: input.cashflow })
    ? scored
    : healthWithoutEvidence(scored);
  const periodLabel = figuresPeriodLabelFrom(financials, current?.period_label ?? null, market);
  return healthSnapshotFromBooks({ health, periodLabel });
}

type PageHealthDb = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
        order: (column: string, options: { ascending: boolean }) => {
          limit: (count: number) => PromiseLike<{
            data: Record<string, unknown>[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
};

/**
 * Health-page snapshot for regenerate. Agent runs keep loadHealthScoreSnapshot.
 */
export async function loadPageHealthScoreSnapshot(
  db: unknown,
  clientId: string,
  now?: Date,
): Promise<HealthScoreSnapshot | null> {
  const query = db as PageHealthDb;
  try {
    const { data, error } = await query
      .from("clients")
      .select("financials, cashflow, financials_updated_at, market, operating_profile, name")
      .eq("id", clientId)
      .maybeSingle();
    if (error || !data) return null;
    const snaps = await query
      .from("client_financial_snapshots")
      .select("period_label, period_date, financials, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(24);
    const rows = snaps.error || !snaps.data ? [] : snaps.data;
    return pageHealthScoreSnapshot({
      financials: asFinancials(data.financials),
      cashflow: data.cashflow,
      financialsUpdatedAt: typeof data.financials_updated_at === "string" ? data.financials_updated_at : null,
      market: data.market,
      operatingProfile: data.operating_profile,
      clientName: typeof data.name === "string" ? data.name : null,
      snapshots: rows as PageSnapshotRow[],
      now,
    });
  } catch {
    return null;
  }
}
