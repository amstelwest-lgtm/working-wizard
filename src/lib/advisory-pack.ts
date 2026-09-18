/**
 * Advisory pack — pure module (P1.1 / P1.2 of the advisory OS spine).
 *
 * The pack is the versioned deliverable a cycle produces. `buildAdvisoryPack`
 * is deterministic and rules-first: it turns the analysis that already exists
 * (health, ratios, forecast, recommendations, data gaps) into named sections
 * of plain-language copy. No LLM call is required; a later "polish" step may
 * rewrite section bodies, but the numbers and structure come from here.
 *
 * Statement-depth honesty: nothing in this module names invoices, customers
 * or transactions. Every section that could be misread as advice carries the
 * disclosure, and the reviewer (accountant seat, or the owner when no firm is
 * attached) is named on the pack.
 *
 * Vocabulary mirrors supabase/migrations/20260918160000_advisory_packs.sql
 * (test-guarded).
 */
import type { Json } from "@/integrations/supabase/types";
import {
  type HealthPillarId,
  type OverallHealth,
  pillarForRatioName,
  scoreRatio,
} from "@/lib/health-score";
import { CASH_RUNWAY_THRESHOLD_RAND } from "@/lib/cash-runway";
import {
  STATEMENT_DEPTH_DISCLOSURE,
  expectedImpactLabel,
  priorityLabel,
  type Recommendation,
} from "@/lib/recommendations";
import type { DataRequest } from "@/lib/data-requests";

export const PACK_STATUSES = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "rejected",
  "superseded",
] as const;
export type PackStatus = (typeof PACK_STATUSES)[number];

export const PACK_REVIEW_ACTIONS = [
  "generated",
  "edit",
  "comment",
  "approve",
  "request_changes",
  "reject",
  "deliver",
  "supersede",
  "read",
] as const;
export type PackReviewAction = (typeof PACK_REVIEW_ACTIONS)[number];

/** Actions the app may call through `advisory_pack_review`. */
export const PACK_APP_ACTIONS = [
  "edit",
  "comment",
  "approve",
  "request_changes",
  "reject",
  "deliver",
  "read",
] as const satisfies readonly PackReviewAction[];

export const PACK_GENERATORS = ["rules", "rules+claude"] as const;
export type PackGenerator = (typeof PACK_GENERATORS)[number];

export const PACK_SECTION_KEYS = [
  "headline",
  "state_of_business",
  "what_changed",
  "what_matters",
  "forecast",
  "recommendations",
  "data_gaps",
  "next_step",
  "disclosure",
] as const;
export type PackSectionKey = (typeof PACK_SECTION_KEYS)[number];

export type PackSection = {
  key: PackSectionKey;
  title: string;
  body: string;
  bullets?: string[];
  /** Sections the reviewer should not rewrite (facts / legal). */
  locked?: boolean;
};

export type PackHealthBlock = {
  overall: number | null;
  status: string;
  label: string;
  pillars: Array<{ id: HealthPillarId; label: string; score: number | null; status: string }>;
  weakest: string | null;
};

export type PackRatioBlock = {
  name: string;
  pillar: HealthPillarId;
  value: number;
  prior: number | null;
  score: number | null;
  formatted: string;
};

export type PackForecastBlock = {
  openingBalance: number | null;
  lowestClosing: number | null;
  lowestWeek: number | null;
  breachesZero: boolean;
  breachesThreshold: boolean;
  runwayWeeks: number | null;
  horizonWeeks: number;
};

export type PackRecommendationRef = {
  id: string;
  title: string;
  problem: string | null;
  priority: string;
  status: string;
  expectedImpact: string | null;
  dataDepth: string;
};

export type PackDataGapRef = {
  id: string;
  kind: string;
  title: string;
  severity: string;
};

export type AdvisoryPackContent = {
  schema: 1;
  generatedAt: string;
  clientName: string;
  periodLabel: string | null;
  priorPeriodLabel: string | null;
  figuresAsOf: string | null;
  reviewer: "accountant" | "owner";
  health: PackHealthBlock | null;
  ratios: PackRatioBlock[];
  forecast: PackForecastBlock | null;
  recommendations: PackRecommendationRef[];
  dataGaps: PackDataGapRef[];
  sections: PackSection[];
};

export type AdvisoryPack = {
  id: string;
  client_id: string;
  cycle_id: string | null;
  version: number;
  status: PackStatus;
  requires_review: boolean;
  period_label: string | null;
  figures_as_of: string | null;
  snapshot_id: string | null;
  generator: PackGenerator;
  ai_draft: AdvisoryPackContent;
  content: AdvisoryPackContent;
  edit_stats: PackEditStats | null;
  generated_by: string | null;
  generated_at: string;
  reviewed_by: string | null;
  reviewed_by_kind: "accountant" | "owner" | null;
  reviewed_at: string | null;
  review_note: string | null;
  delivered_at: string | null;
  delivered_to: string | null;
  meta: Json;
  created_at: string;
  updated_at: string;
};

export type PackReview = {
  id: number;
  pack_id: string;
  client_id: string;
  action: PackReviewAction;
  actor_id: string | null;
  actor_kind: string;
  section: string | null;
  before: Json | null;
  after: Json | null;
  note: string | null;
  created_at: string;
};

// ── Parsing ──────────────────────────────────────────────────────────────────

export function parsePackContent(raw: unknown): AdvisoryPackContent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sections = Array.isArray(o.sections)
    ? (o.sections as Record<string, unknown>[])
        .filter((s) => s && typeof s.key === "string")
        .map((s) => ({
          key: s.key as PackSectionKey,
          title: typeof s.title === "string" ? s.title : String(s.key),
          body: typeof s.body === "string" ? s.body : "",
          bullets: Array.isArray(s.bullets) ? s.bullets.map(String) : undefined,
          locked: s.locked === true ? true : undefined,
        }))
    : [];
  return {
    schema: 1,
    generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : "",
    clientName: typeof o.clientName === "string" ? o.clientName : "",
    periodLabel: typeof o.periodLabel === "string" ? o.periodLabel : null,
    priorPeriodLabel: typeof o.priorPeriodLabel === "string" ? o.priorPeriodLabel : null,
    figuresAsOf: typeof o.figuresAsOf === "string" ? o.figuresAsOf : null,
    reviewer: o.reviewer === "accountant" ? "accountant" : "owner",
    health: (o.health as PackHealthBlock | null) ?? null,
    ratios: Array.isArray(o.ratios) ? (o.ratios as PackRatioBlock[]) : [],
    forecast: (o.forecast as PackForecastBlock | null) ?? null,
    recommendations: Array.isArray(o.recommendations)
      ? (o.recommendations as PackRecommendationRef[])
      : [],
    dataGaps: Array.isArray(o.dataGaps) ? (o.dataGaps as PackDataGapRef[]) : [],
    sections,
  };
}

export function parsePackRow(row: Record<string, unknown>): AdvisoryPack {
  const str = (k: string): string | null =>
    typeof row[k] === "string" ? (row[k] as string) : null;
  const status = str("status");
  const gen = str("generator");
  const rk = str("reviewed_by_kind");
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    cycle_id: str("cycle_id"),
    version: Number(row.version ?? 0),
    status: (PACK_STATUSES as readonly string[]).includes(status ?? "")
      ? (status as PackStatus)
      : "draft",
    requires_review: row.requires_review === true,
    period_label: str("period_label"),
    figures_as_of: str("figures_as_of"),
    snapshot_id: str("snapshot_id"),
    generator: (PACK_GENERATORS as readonly string[]).includes(gen ?? "")
      ? (gen as PackGenerator)
      : "rules",
    ai_draft: parsePackContent(row.ai_draft),
    content: parsePackContent(row.content),
    edit_stats:
      row.edit_stats && typeof row.edit_stats === "object"
        ? (row.edit_stats as PackEditStats)
        : null,
    generated_by: str("generated_by"),
    generated_at: str("generated_at") ?? "",
    reviewed_by: str("reviewed_by"),
    reviewed_by_kind: rk === "accountant" || rk === "owner" ? rk : null,
    reviewed_at: str("reviewed_at"),
    review_note: str("review_note"),
    delivered_at: str("delivered_at"),
    delivered_to: str("delivered_to"),
    meta: (row.meta as Json) ?? {},
    created_at: str("created_at") ?? "",
    updated_at: str("updated_at") ?? "",
  };
}

export function parsePackReviewRow(row: Record<string, unknown>): PackReview {
  const action = typeof row.action === "string" ? row.action : "comment";
  return {
    id: Number(row.id),
    pack_id: String(row.pack_id),
    client_id: String(row.client_id),
    action: (PACK_REVIEW_ACTIONS as readonly string[]).includes(action)
      ? (action as PackReviewAction)
      : "comment",
    actor_id: typeof row.actor_id === "string" ? row.actor_id : null,
    actor_kind: typeof row.actor_kind === "string" ? row.actor_kind : "system",
    section: typeof row.section === "string" ? row.section : null,
    before: (row.before as Json) ?? null,
    after: (row.after as Json) ?? null,
    note: typeof row.note === "string" ? row.note : null,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

export function isMissingPackRelation(err: unknown): boolean {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : "";
  return /advisory_pack/.test(msg) && /does not exist|schema cache|could not find/i.test(msg);
}

export const OPEN_PACK_STATUSES: readonly PackStatus[] = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
];

export function packStatusLabel(s: PackStatus, requiresReview: boolean): string {
  switch (s) {
    case "draft":
      return requiresReview ? "Draft" : "Ready for you";
    case "in_review":
      return "With your accountant";
    case "changes_requested":
      return "Changes requested";
    case "approved":
      return requiresReview ? "Signed off" : "Accepted";
    case "rejected":
      return "Rejected";
    case "superseded":
      return "Superseded";
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

function groupThousands(n: number): string {
  const [int, frac] = Math.abs(n).toFixed(0).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${n < 0 ? "−" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

export function fmtMoney(n: number, currency = "R"): string {
  const rounded = Math.round(n);
  return `${rounded < 0 ? "−" : ""}${currency}${groupThousands(Math.abs(rounded))}`;
}

const DAYS_RATIOS = new Set([
  "Debtor Days",
  "Inventory Days",
  "Creditor Days",
  "Working Capital Days",
]);
const MULTIPLE_RATIOS = new Set([
  "Asset Turnover",
  "Equity Multiplier",
  "Degree of Operating Leverage",
  "Gross Profit / Labor",
  "OCF / EBITDA",
  "Debt-to-Equity",
  "Current Ratio",
]);

export function fmtRatio(name: string, v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (DAYS_RATIOS.has(name)) return `${Math.round(v)} days`;
  if (name === "Sales-per-Employee Ratio") return fmtMoney(v);
  if (MULTIPLE_RATIOS.has(name)) return `${v.toFixed(2)}×`;
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDelta(name: string, delta: number): string {
  if (DAYS_RATIOS.has(name)) return `${Math.abs(Math.round(delta))} days`;
  if (name === "Sales-per-Employee Ratio") return fmtMoney(Math.abs(delta));
  if (MULTIPLE_RATIOS.has(name)) return `${Math.abs(delta).toFixed(2)}×`;
  return `${Math.abs(delta * 100).toFixed(1)}pp`;
}

/** Ratios where a rise is good; the rest improve when they fall. */
const HIGHER_IS_BETTER = new Set([
  "Net Margin",
  "Operating Margin",
  "Gross Margin",
  "Return on Equity",
  "Return on Assets",
  "Asset Turnover",
  "Interest Burden",
  "Tax Burden",
  "Creditor Days",
  "Gross Profit / Labor",
  "Sales-per-Employee Ratio",
  "OCF / EBITDA",
  "Current Ratio",
]);

function isImprovement(name: string, delta: number): boolean {
  return HIGHER_IS_BETTER.has(name) ? delta > 0 : delta < 0;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "an unknown date";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ── Builder ──────────────────────────────────────────────────────────────────

export type PackInputs = {
  clientName: string;
  firmName: string | null;
  hasFirm: boolean;
  periodLabel: string | null;
  priorPeriodLabel: string | null;
  figuresAsOf: string | null;
  health: OverallHealth | null;
  ratios: Record<string, number> | null;
  priorRatios: Record<string, number> | null;
  openingBalance: number | null;
  /** Weekly closing balances from the saved 13-week forecast; null = no forecast. */
  closings: number[] | null;
  cashRunwayWeeks: number | null;
  recommendations: Recommendation[];
  dataRequests: DataRequest[];
  openActions: number;
  overdueActions: number;
  now: string;
  currency?: string;
};

const MOVE_THRESHOLD = 0.05;
const WEAK_SCORE = 40;

export function buildAdvisoryPack(input: PackInputs): AdvisoryPackContent {
  const cur = input.currency ?? "R";
  const name = input.clientName.trim() || "This business";

  // ── data blocks ──
  const health: PackHealthBlock | null = input.health
    ? {
        overall: input.health.overall,
        status: input.health.displayStatus,
        label: input.health.displayLabel,
        pillars: input.health.pillars.map((p) => ({
          id: p.id,
          label: p.label,
          score: p.score,
          status: p.status,
        })),
        weakest: input.health.weakestPillar?.label ?? null,
      }
    : null;

  const ratios: PackRatioBlock[] = Object.entries(input.ratios ?? {})
    .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
    .map(([n, v]) => {
      const prior = input.priorRatios?.[n];
      const score = scoreRatio(n, v);
      return {
        name: n,
        pillar: pillarForRatioName(n),
        value: v,
        prior: typeof prior === "number" && Number.isFinite(prior) ? prior : null,
        score: Number.isFinite(score) ? Math.round(score) : null,
        formatted: fmtRatio(n, v),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  let forecast: PackForecastBlock | null = null;
  if (input.closings && input.closings.length > 0) {
    let lowest = Number.POSITIVE_INFINITY;
    let lowestWeek = 0;
    input.closings.forEach((c, i) => {
      if (c < lowest) {
        lowest = c;
        lowestWeek = i + 1;
      }
    });
    forecast = {
      openingBalance: input.openingBalance,
      lowestClosing: lowest,
      lowestWeek,
      breachesZero: lowest < 0,
      breachesThreshold: lowest < CASH_RUNWAY_THRESHOLD_RAND,
      runwayWeeks: input.cashRunwayWeeks,
      horizonWeeks: input.closings.length,
    };
  }

  const recs: PackRecommendationRef[] = [...input.recommendations]
    .filter((r) => r.status !== "rejected" && r.status !== "superseded")
    .sort((a, b) => rank(a.priority) - rank(b.priority) || a.title.localeCompare(b.title))
    .map((r) => ({
      id: r.id,
      title: r.title,
      problem: r.problem ?? r.rationale ?? null,
      priority: r.priority,
      status: r.status,
      expectedImpact: expectedImpactLabel(r, cur),
      dataDepth: r.data_depth,
    }));

  const gaps: PackDataGapRef[] = input.dataRequests
    .filter((d) => d.status === "open" || d.status === "sent")
    .map((d) => ({ id: d.id, kind: d.kind, title: d.title, severity: d.severity }));

  // ── copy ──
  const weakRatios = ratios
    .filter((r) => r.score !== null && r.score < WEAK_SCORE)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  const moves = ratios
    .filter((r) => r.prior !== null)
    .map((r) => {
      const delta = r.value - (r.prior as number);
      const rel = r.prior !== 0 ? Math.abs(delta / (r.prior as number)) : Math.abs(delta);
      return { r, delta, rel, flipped: r.value < 0 !== (r.prior as number) < 0 };
    })
    .filter((m) => m.rel >= MOVE_THRESHOLD || m.flipped)
    .sort((a, b) => b.rel - a.rel);

  const headline = buildHeadline(name, health, weakRatios, forecast);

  const stateLines: string[] = [];
  if (health && health.overall !== null) {
    stateLines.push(
      `${name} scores ${health.overall} out of 100 (${health.label.toLowerCase()})${
        input.periodLabel ? ` on the ${input.periodLabel} figures` : ""
      }.`,
    );
    const scored = health.pillars.filter((p) => p.score !== null);
    if (scored.length) {
      const strongest = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
      stateLines.push(
        `Strongest pillar: ${strongest.label} (${strongest.score}). Weakest: ${health.weakest ?? "—"}${
          health.weakest ? ` (${scored.find((p) => p.label === health.weakest)?.score ?? "—"})` : ""
        }.`,
      );
    }
  } else {
    stateLines.push(`${name} has no scorable figures yet, so the health score is not available.`);
  }
  if (forecast) {
    stateLines.push(
      forecast.breachesZero
        ? `The 13-week cash forecast goes below zero in week ${forecast.lowestWeek} (lowest point ${fmtMoney(
            forecast.lowestClosing ?? 0,
            cur,
          )}).`
        : forecast.breachesThreshold
          ? `The 13-week cash forecast stays positive but dips to ${fmtMoney(
              forecast.lowestClosing ?? 0,
              cur,
            )} in week ${forecast.lowestWeek}, under the ${fmtMoney(CASH_RUNWAY_THRESHOLD_RAND, cur)} comfort line.`
          : `The 13-week cash forecast stays above the ${fmtMoney(
              CASH_RUNWAY_THRESHOLD_RAND,
              cur,
            )} comfort line throughout (lowest ${fmtMoney(forecast.lowestClosing ?? 0, cur)} in week ${
              forecast.lowestWeek
            }).`,
    );
  }
  if (input.openActions > 0) {
    stateLines.push(
      `${input.openActions} action${input.openActions === 1 ? " is" : "s are"} open from the last cycle${
        input.overdueActions > 0 ? `, ${input.overdueActions} overdue` : ""
      }.`,
    );
  }

  const changedBullets = moves.slice(0, 6).map((m) => {
    const dir = m.delta > 0 ? "up" : "down";
    const good = isImprovement(m.r.name, m.delta);
    return `${m.r.name}: ${fmtRatio(m.r.name, m.r.prior as number)} → ${m.r.formatted} (${dir} ${fmtDelta(
      m.r.name,
      m.delta,
    )}${good ? ", better" : ", worse"})`;
  });
  const whatChangedBody = !input.priorRatios
    ? "First period on record, so there is nothing to compare against yet. The next pack will show movement."
    : changedBullets.length === 0
      ? `Nothing moved more than 5% against ${input.priorPeriodLabel ?? "the prior period"}. Stable is not the same as healthy, so the sections below still apply.`
      : `Against ${input.priorPeriodLabel ?? "the prior period"}, the biggest moves were:`;

  const mattersBullets: string[] = [];
  if (health?.weakest) {
    mattersBullets.push(
      `${health.weakest} is the weakest pillar and sets the tone for this cycle.`,
    );
  }
  for (const r of weakRatios.slice(0, 3)) {
    mattersBullets.push(
      `${r.name} is ${r.formatted} (scores ${r.score}/100) — ${weakRatioWhy(r.name)}`,
    );
  }
  if (forecast?.breachesZero) {
    mattersBullets.push(
      `Cash runs out in week ${forecast.lowestWeek} on current assumptions. Every recommendation below is judged first on whether it moves that week.`,
    );
  } else if (forecast?.breachesThreshold) {
    mattersBullets.push(
      `Cash is thin in week ${forecast.lowestWeek}; a late debtor or an early supplier bill turns thin into negative.`,
    );
  }
  if (gaps.some((g) => g.severity === "critical")) {
    mattersBullets.push(
      "At least one blocking data gap is open; the figures above are weaker than they look until it is closed.",
    );
  }

  const forecastBody = !forecast
    ? "No 13-week cash forecast has been published yet, so this pack cannot say when cash gets tight. Publishing one is the fastest way to sharpen every recommendation."
    : forecast.openingBalance === null || forecast.openingBalance === 0
      ? `The forecast has no opening bank balance, so its runway starts from zero and the week-${forecast.lowestWeek} low of ${fmtMoney(
          forecast.lowestClosing ?? 0,
          cur,
        )} is understated by whatever is actually in the bank.`
      : `Opening balance ${fmtMoney(forecast.openingBalance, cur)}; lowest point ${fmtMoney(
          forecast.lowestClosing ?? 0,
          cur,
        )} in week ${forecast.lowestWeek} of ${forecast.horizonWeeks}${
          forecast.runwayWeeks !== null && forecast.runwayWeeks < forecast.horizonWeeks
            ? `; runway ${forecast.runwayWeeks} week${forecast.runwayWeeks === 1 ? "" : "s"} before the comfort line`
            : ""
        }. The forecast uses the saved assumptions; change them in the cash tab and regenerate.`;

  const recBullets = recs.map(
    (r) =>
      `${priorityLabel(r.priority as Recommendation["priority"])} · ${r.title}${
        r.problem ? ` — ${r.problem}` : ""
      }${r.expectedImpact ? ` (expected: ${r.expectedImpact})` : ""}${
        r.status === "approved" || r.status === "edited" ? " · approved" : ""
      }`,
  );
  const recBody =
    recs.length === 0
      ? "No recommendations have been proposed for this cycle yet. Ask MILŌN to suggest moves once the figures are current."
      : `${recs.length} recommendation${recs.length === 1 ? "" : "s"}, strongest first. Each is built from statement totals and ratios, so it points at the problem and the lever rather than at individual accounts.`;

  const gapBullets = gaps.map(
    (g) =>
      `${g.severity === "critical" ? "Blocking" : g.severity === "important" ? "Needed" : "Helpful"} · ${g.title}`,
  );
  const gapBody =
    gaps.length === 0
      ? "Nothing outstanding. The figures in this pack are as complete as MILŌN can make them from what has been provided."
      : `${gaps.length} open request${gaps.length === 1 ? "" : "s"}. Until these land, treat the affected sections as provisional.`;

  const nextStepBody = input.hasFirm
    ? `${input.firmName ?? "Your accountant"} reviews this pack first — they can edit, comment, or send it back. Once it is signed off you decide which recommendations become actions, and MILŌN turns each one into a dated, owned task and chases it.`
    : "Read the recommendations and accept the ones you will act on. MILŌN turns each into a dated, owned action and chases it; the next pack will show whether the numbers moved. You can invite an accountant to review future packs at any time.";

  const disclosureBody = `Prepared by MILŌN from statement-level figures as at ${fmtDate(
    input.figuresAsOf,
  )}. ${STATEMENT_DEPTH_DISCLOSURE} This is analysis and a set of suggestions for you and your adviser to weigh, not regulated financial, tax or legal advice.${
    input.hasFirm
      ? ` Accountant review status is shown on the pack; a signed-off pack names the reviewer and the time of sign-off.`
      : " No accountant has reviewed this pack."
  }`;

  const sections: PackSection[] = [
    { key: "headline", title: "In one line", body: headline },
    { key: "state_of_business", title: "Where the business stands", body: stateLines.join(" ") },
    {
      key: "what_changed",
      title: "What changed",
      body: whatChangedBody,
      bullets: changedBullets.length ? changedBullets : undefined,
    },
    {
      key: "what_matters",
      title: "What matters most",
      body: mattersBullets.length
        ? "Ordered by how much they decide the next 13 weeks."
        : "Nothing scores as weak on the current figures. Use this cycle to build a cash buffer and keep the data current.",
      bullets: mattersBullets.length ? mattersBullets : undefined,
    },
    { key: "forecast", title: "Cash forecast", body: forecastBody },
    {
      key: "recommendations",
      title: "Recommendations",
      body: recBody,
      bullets: recBullets.length ? recBullets : undefined,
    },
    {
      key: "data_gaps",
      title: "What MILŌN still needs",
      body: gapBody,
      bullets: gapBullets.length ? gapBullets : undefined,
    },
    { key: "next_step", title: "What happens now", body: nextStepBody },
    { key: "disclosure", title: "About this pack", body: disclosureBody, locked: true },
  ];

  return {
    schema: 1,
    generatedAt: input.now,
    clientName: name,
    periodLabel: input.periodLabel,
    priorPeriodLabel: input.priorPeriodLabel,
    figuresAsOf: input.figuresAsOf,
    reviewer: input.hasFirm ? "accountant" : "owner",
    health,
    ratios,
    forecast,
    recommendations: recs,
    dataGaps: gaps,
    sections,
  };
}

function rank(priority: string): number {
  switch (priority) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    default:
      return 3;
  }
}

function buildHeadline(
  name: string,
  health: PackHealthBlock | null,
  weak: PackRatioBlock[],
  forecast: PackForecastBlock | null,
): string {
  const parts: string[] = [];
  if (health && health.overall !== null) {
    parts.push(`${name} is ${health.label.toLowerCase()} at ${health.overall}/100`);
    if (health.weakest) parts.push(`${health.weakest} is the drag`);
  } else {
    parts.push(`${name} has no health score yet`);
  }
  if (forecast?.breachesZero) {
    parts.push(`cash goes negative in week ${forecast.lowestWeek}`);
  } else if (weak[0]) {
    parts.push(`${weak[0].name} at ${weak[0].formatted} is the number to move`);
  }
  const s = parts.join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

function weakRatioWhy(name: string): string {
  switch (name) {
    case "Debtor Days":
      return "customers are holding your cash longer than the business can afford. The lever is terms and follow-up rhythm, not any one customer.";
    case "Creditor Days":
      return "suppliers are being paid faster than they need to be; the terms you already have are unused runway.";
    case "Inventory Days":
      return "stock is sitting too long before it becomes cash.";
    case "Working Capital Days":
      return "the gap between paying out and getting paid is funding itself from the bank.";
    case "Gross Margin":
      return "pricing or direct cost is leaving too little to cover overheads.";
    case "Net Margin":
    case "Operating Margin":
      return "overheads are eating what the margin leaves.";
    case "Fixed Cost Ratio":
      return "too much of the cost base is fixed, so a soft month hits profit hard.";
    case "Top-5 Customer Share":
      return "revenue leans on a few relationships; one loss would be material.";
    case "Equity Multiplier":
      return "the balance sheet leans on debt.";
    case "OCF / EBITDA":
      return "accounting profit is not turning into cash.";
    default:
      return "below the healthy band for this ratio.";
  }
}

// ── Diff + edit rate (P1.2) ───────────────────────────────────────────────────

export type PackEditStats = {
  sections_total: number;
  sections_changed: number;
  chars_total: number;
  chars_changed: number;
  /** 0–1: share of AI-draft characters the reviewer changed. */
  edit_rate: number;
};

export type SectionDiff = {
  key: PackSectionKey;
  title: string;
  changed: boolean;
  before: string;
  after: string;
};

function sectionText(s: PackSection | undefined): string {
  if (!s) return "";
  return [s.title, s.body, ...(s.bullets ?? [])].join("\n");
}

/** Character-level edit distance, capped to keep it O(n·m) on short copy. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function diffPackSections(
  draft: AdvisoryPackContent,
  final: AdvisoryPackContent,
): SectionDiff[] {
  const byKey = new Map(final.sections.map((s) => [s.key, s]));
  return draft.sections.map((d) => {
    const f = byKey.get(d.key);
    const before = sectionText(d);
    const after = sectionText(f);
    return { key: d.key, title: f?.title ?? d.title, changed: before !== after, before, after };
  });
}

export function computeEditStats(
  draft: AdvisoryPackContent,
  final: AdvisoryPackContent,
): PackEditStats {
  const diffs = diffPackSections(draft, final);
  let charsTotal = 0;
  let charsChanged = 0;
  let changed = 0;
  for (const d of diffs) {
    charsTotal += d.before.length;
    if (d.changed) {
      changed += 1;
      charsChanged += Math.min(
        editDistance(d.before, d.after),
        Math.max(d.before.length, d.after.length),
      );
    }
  }
  return {
    sections_total: diffs.length,
    sections_changed: changed,
    chars_total: charsTotal,
    chars_changed: charsChanged,
    edit_rate:
      charsTotal === 0 ? 0 : Math.min(1, Math.round((charsChanged / charsTotal) * 1000) / 1000),
  };
}

/** Threshold above which the pack was mostly rewritten — the quality tell to watch. */
export const HIGH_EDIT_RATE = 0.35;
