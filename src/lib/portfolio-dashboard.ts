/**
 * Portfolio triage helpers for the accountant firm dashboard.
 * Pure functions — derive greeting copy, 30d trend, priority, attention
 * cards, and insight chips from already-loaded client rows.
 */

import type { OverallHealth } from "@/lib/health-score";
import type { HealthTier } from "@/lib/ratios";

export type ScoreHistoryPoint = {
  score: number;
  is_estimated: boolean;
  period_date?: string | null;
};

export type PriorityLevel = "critical" | "high" | "medium" | "none";

export type AttentionSeverity = "critical" | "high" | "medium";

export type AttentionItem = {
  clientId: string;
  name: string;
  severity: AttentionSeverity;
  severityLabel: string;
  reason: string;
  detail: string;
  /** When true, open the client's Action Plan tab (outstanding work). */
  openPlan?: boolean;
};

export type PortfolioInsight = {
  id: string;
  kind: "trend" | "risk" | "star";
  text: string;
};

export type PortfolioClientSignals = {
  score: number | null;
  health: OverallHealth;
  trendDelta: number | null;
  runwayWeeks: number | null;
  openQueries: number;
  openActions: number;
  overdueActions: number;
  revenue: number | null;
};

/** Greeting for the time of day. */
export function timeGreeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** First name from a display name, falling back to the full string. */
export function firstNameOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

/** Format "Data as of 16 Aug 2026". */
export function dataAsOfLabel(now = new Date()): string {
  return now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Score change over ~30 days from dated history.
 * Falls back to first→last of the padded trend when dates are missing.
 */
export function trendDelta30d(
  history: ScoreHistoryPoint[],
  currentScore: number | null,
): number | null {
  if (currentScore == null || !Number.isFinite(currentScore)) return null;
  if (!history.length) return null;

  const withDates = history
    .filter((h) => h.period_date && Number.isFinite(h.score))
    .map((h) => ({
      score: h.score,
      t: Date.parse(h.period_date as string),
    }))
    .filter((h) => Number.isFinite(h.t))
    .sort((a, b) => a.t - b.t);

  if (withDates.length >= 2) {
    const latest = withDates[withDates.length - 1];
    const target = latest.t - 30 * 24 * 60 * 60 * 1000;
    let prior = withDates[0];
    for (const pt of withDates) {
      if (pt.t <= target) prior = pt;
      else break;
    }
    // If everything is newer than 30d, use the earliest point.
    return Math.round(latest.score - prior.score);
  }

  const scores = history.map((h) => h.score).filter((s) => Number.isFinite(s));
  if (scores.length < 2) return 0;
  return Math.round(scores[scores.length - 1] - scores[0]);
}

/** Bubble / chart colour from display status. */
export function statusColor(status: HealthTier | null | undefined): string {
  if (status === "healthy") return "var(--ok)";
  if (status === "at_risk") return "var(--warn)";
  if (status === "critical") return "var(--risk)";
  return "var(--ink-faint)";
}

/** Table priority from health + operational pressure. */
export function derivePriority(signals: PortfolioClientSignals): {
  level: PriorityLevel;
  label: string;
} {
  const { health, runwayWeeks, openQueries, overdueActions, score } = signals;
  if (health.overall == null) return { level: "none", label: "—" };

  const critical =
    health.displayStatus === "critical" ||
    (runwayWeeks != null && runwayWeeks < 4) ||
    overdueActions > 0;

  if (critical) return { level: "critical", label: "Review now" };

  const high =
    health.displayStatus === "at_risk" ||
    (score != null && score < 55) ||
    openQueries >= 2 ||
    (runwayWeeks != null && runwayWeeks < 8);

  if (high) return { level: "high", label: "Watch" };

  if (health.displayStatus !== "healthy") {
    return { level: "medium", label: "Monitor" };
  }

  return { level: "none", label: "—" };
}

function pillarLabel(id: string | undefined): string {
  switch (id) {
    case "profit":
      return "Profitability";
    case "assets":
      return "Asset Efficiency";
    case "financing":
      return "Financing";
    case "cash":
      return "Cash Stability";
    default:
      return "Health";
  }
}

/** Build the Needs Attention list (worst first, max `limit`). */
export function buildAttentionItems(
  rows: Array<
    PortfolioClientSignals & {
      id: string;
      name: string;
    }
  >,
  limit = 3,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const row of rows) {
    if (row.health.overall == null) continue;
    if (row.health.displayStatus === "healthy" && row.overdueActions === 0) continue;

    const priority = derivePriority(row);
    if (priority.level === "none") continue;

    const severity: AttentionSeverity =
      priority.level === "critical" ? "critical" : priority.level === "high" ? "high" : "medium";

    const weak = row.health.weakestPillar;
    const pillar = pillarLabel(weak?.id);
    const delta = row.trendDelta;
    let reason = pillar;
    if (weak?.score != null && Number.isFinite(weak.score)) {
      reason =
        delta != null && delta !== 0
          ? `${pillar} ${delta > 0 ? "↑" : "↓"} ${Math.abs(delta)} pts`
          : `${pillar} under pressure`;
    } else if (row.runwayWeeks != null && row.runwayWeeks < 8) {
      reason = `Runway ${row.runwayWeeks} wk`;
    } else {
      reason = row.health.displayLabel;
    }

    let detail: string;
    if (row.overdueActions > 0) {
      detail = `${row.overdueActions} action${row.overdueActions === 1 ? "" : "s"} overdue`;
    } else if (row.openActions > 0) {
      detail = `${row.openActions} recommended action${row.openActions === 1 ? "" : "s"}`;
    } else if (row.openQueries > 0) {
      detail = `${row.openQueries} open quer${row.openQueries === 1 ? "y" : "ies"}`;
    } else if (priority.level === "high" || severity === "high") {
      detail = "Review financing structure";
    } else {
      detail = "Needs a check-in";
    }

    items.push({
      clientId: row.id,
      name: row.name,
      severity,
      severityLabel: severity === "critical" ? "Critical" : severity === "high" ? "High" : "Medium",
      reason,
      detail,
      openPlan: row.overdueActions > 0 || row.openActions > 0,
    });
  }

  const rank = { critical: 0, high: 1, medium: 2 };
  items.sort((a, b) => rank[a.severity] - rank[b.severity] || a.name.localeCompare(b.name));
  return items.slice(0, limit);
}

/** Rule-based portfolio insight chips. */
export function buildPortfolioInsights(
  rows: Array<
    PortfolioClientSignals & {
      id: string;
      name: string;
    }
  >,
): PortfolioInsight[] {
  const scored = rows.filter((r) => r.score != null);
  const insights: PortfolioInsight[] = [];

  if (scored.length > 0) {
    const improved = scored.filter((r) => (r.trendDelta ?? 0) > 0).length;
    insights.push({
      id: "improved",
      kind: "trend",
      text: `${improved} of ${scored.length} client${scored.length === 1 ? "" : "s"} improved their health this month.`,
    });
  }

  const pillarCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.health.displayStatus === "healthy") continue;
    const id = r.health.weakestPillar?.id;
    if (!id) continue;
    pillarCounts.set(id, (pillarCounts.get(id) ?? 0) + 1);
  }
  let topPillar: string | null = null;
  let topCount = 0;
  for (const [id, n] of pillarCounts) {
    if (n > topCount) {
      topPillar = id;
      topCount = n;
    }
  }
  if (topPillar && topCount > 0) {
    insights.push({
      id: "weakness",
      kind: "risk",
      text: `${pillarLabel(topPillar)} is the most common weakness across your portfolio.`,
    });
  }

  const improving = scored
    .filter((r) => (r.trendDelta ?? 0) > 0 && r.score != null)
    .sort((a, b) => (b.trendDelta ?? 0) - (a.trendDelta ?? 0) || (b.score ?? 0) - (a.score ?? 0));
  if (improving[0]) {
    insights.push({
      id: "star",
      kind: "star",
      text: `${improving[0].name} is your healthiest improving client this month.`,
    });
  }

  return insights.slice(0, 3);
}

/** Portfolio summary sentence under the greeting. */
export function portfolioSummaryLine(input: {
  clientCount: number;
  needAttention: number;
  avgHealth: number | null;
}): string {
  const { clientCount, needAttention, avgHealth } = input;
  if (clientCount === 0) {
    return "Add your first client to start tracking portfolio health.";
  }
  if (needAttention === 0) {
    return avgHealth != null && avgHealth >= 70
      ? "Your portfolio is healthy overall — no clients need urgent attention."
      : "No clients are flagged for attention right now.";
  }
  const healthyEnough = avgHealth != null && avgHealth >= 65;
  if (healthyEnough) {
    return `Your portfolio is healthy overall, but ${needAttention} client${needAttention === 1 ? "" : "s"} need attention.`;
  }
  return `${needAttention} client${needAttention === 1 ? "" : "s"} need attention across your book.`;
}

/** Revenue figure for bubble sizing (null-safe). */
export function revenueOf(
  financials: Record<string, string | number | null> | null | undefined,
): number | null {
  if (!financials) return null;
  const raw = financials.revenue;
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Clients added in the current calendar month. */
export function clientsAddedThisMonth(
  rows: Array<{ created_at?: string | null }>,
  now = new Date(),
): number {
  const y = now.getFullYear();
  const m = now.getMonth();
  return rows.filter((r) => {
    if (!r.created_at) return false;
    const d = new Date(r.created_at);
    return d.getFullYear() === y && d.getMonth() === m;
  }).length;
}

/** Average health delta vs prior point in each client's trend (portfolio avg). */
export function avgHealthDelta(
  rows: Array<{ trendDelta: number | null; score: number | null }>,
): number | null {
  const deltas = rows
    .filter((r) => r.score != null && r.trendDelta != null)
    .map((r) => r.trendDelta as number);
  if (!deltas.length) return null;
  return Math.round(deltas.reduce((s, d) => s + d, 0) / deltas.length);
}

/** Mini sparkline points (0–100) for a metric card from client trends. */
export function portfolioSparkPoints(rows: Array<{ trend: Array<{ score: number }> }>): number[] {
  if (!rows.length) return [];
  const len = Math.max(...rows.map((r) => r.trend.length), 0);
  if (len === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    const vals: number[] = [];
    for (const r of rows) {
      const pt = r.trend[i] ?? r.trend[r.trend.length - 1];
      if (pt && Number.isFinite(pt.score)) vals.push(pt.score);
    }
    if (vals.length) out.push(Math.round(vals.reduce((s, v) => s + v, 0) / vals.length));
  }
  return out;
}

export type FollowUpItem = {
  clientId: string;
  name: string;
  overdueActions: number;
  openActions: number;
};

/**
 * Clients the practice should chase this week: overdue first, then other
 * open Action Plan work. Deep-link these to /clients/:id?tab=plan.
 */
export function buildFollowUpQueue(
  rows: Array<{
    id: string;
    name: string;
    overdueActions: number;
    openActions: number;
  }>,
  limit = 8,
): FollowUpItem[] {
  return rows
    .filter((r) => r.overdueActions > 0 || r.openActions > 0)
    .sort(
      (a, b) =>
        b.overdueActions - a.overdueActions ||
        b.openActions - a.openActions ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit)
    .map((r) => ({
      clientId: r.id,
      name: r.name,
      overdueActions: r.overdueActions,
      openActions: r.openActions,
    }));
}
