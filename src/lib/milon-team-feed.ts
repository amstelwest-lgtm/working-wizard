/**
 * Milōn team feed — typed view-model for three agents.
 *
 * Milōn Accountant closes and cleans the books.
 * Milōn Analyst owns the budget, the 13-week forecast, variances, and the board report.
 * Milōn Advisor owns the cash floor, debtors and collections, covenants, tax dates, and next moves.
 *
 * Pure builders only. The hook in `use-milon-team-feed` loads rows. Nothing here invents a figure.
 */

import { advisorySignoffGrounding, type AdvisorySignoffState } from "./advisory-signoff";
import { parseBrainSummary } from "./client-brain";
import { draftKindLabel } from "./client-brain-deliverable";
import { assessClientMetrics, persistedRunwayWeeks, runwayDisplayLabel } from "./client-metrics";
import {
  cashComfortThreshold,
  closingBalancesFromCashflow,
  type SavedCashflowLike,
} from "./cash-runway";
import {
  RATIO_NAME_TO_KEY,
  overviewRatios,
  scorecardHealthFromFinancials,
  scoreRatio,
  type ScoreMarket,
} from "./health-score";
import { formatMoneyCompact, type MoneyMarket } from "./market/format";
import { ZA_MARKET } from "./market/resolve";
import {
  PRECARD_CAP_CODE,
  PRECARD_CAP_MESSAGE,
  PRECARD_PACK_LIMIT,
  decidePrecardAllowance,
  precardUsageFromRow,
} from "./precard-cap";
import { periodMonthsOf, scoreTier } from "./ratios";

export type AgentKey = "accountant" | "analyst" | "advisor";

export const AGENT_KEYS = ["accountant", "analyst", "advisor"] as const;

export type AgentMapKind = "deliverable" | "proposal" | "event";

export interface TeamSource {
  label: string;
  asOf: string | null;
}

export interface TeamBriefingItem {
  id: string;
  agent: AgentKey;
  title: string;
  detail?: string;
  severity: "info" | "watch" | "act";
  source: TeamSource;
  jobId?: string;
}

export type TeamJobStatus =
  | "proposed"
  | "drafting"
  | "draft_ready"
  | "awaiting_signoff"
  | "signed_off"
  | "dismissed"
  | "failed";

export interface TeamJob {
  id: string;
  agent: AgentKey;
  title: string;
  summary: string;
  deliverableType: string | null;
  status: TeamJobStatus;
  createdAt: string;
  canApprove: boolean;
  blockedReason: "precard_cap" | "no_data" | null;
  href?: string;
}

export type TeamActivityKind =
  | "sync"
  | "upload"
  | "diagnosis"
  | "proposal"
  | "draft_created"
  | "approved"
  | "dismissed"
  | "signoff"
  | "data_request"
  | "query";

export interface TeamActivityEvent {
  id: string;
  agent: AgentKey;
  kind: TeamActivityKind;
  text: string;
  at: string;
  href?: string;
}

export interface TeamAgentStatus {
  agent: AgentKey;
  lastRunAt: string | null;
  lastRunKind: TeamActivityKind | null;
}

export interface PrecardState {
  capped: boolean;
  remaining: number | null;
  limit: number | null;
}

export interface MilonTeamFeed {
  briefing: TeamBriefingItem[];
  jobs: TeamJob[];
  activity: TeamActivityEvent[];
  agents: Record<AgentKey, TeamAgentStatus>;
  signoffLine: string | null;
  precard: PrecardState;
  loading: boolean;
  error: string | null;
}

export type ApproveResult =
  | { ok: true; draftId: string | null; href?: string }
  | { ok: false; reason: "precard_cap" | "error"; message: string };

/** Draft approval never sends. The draft edge writes status `draft` only. */
export const TEAM_DRAFT_AUTO_SEND = false;

const SEVERITY_RANK = { act: 0, watch: 1, info: 2 } as const;

const ADVISOR_DELIVERABLES = [
  "cash_floor",
  "debtor",
  "debtors",
  "debtordays",
  "creditordays",
  "workingcapitaldays",
  "collection",
  "collections",
  "covenant",
  "covenants",
  "tax_date",
  "tax_dates",
  "tax",
  "aged_debtors",
  "aged_creditors",
  "action_plan",
  "action",
  "plan",
  "next",
  "advisory_draft",
  "advisory",
  "client_email",
  "meeting_agenda",
  "email",
  "agenda",
] as const;

const ACCOUNTANT_DELIVERABLES = [
  "reconciliation",
  "recon",
  "upload",
  "pdf_upload",
  "sync",
  "data_request",
  "query",
  "queries",
  "signoff",
  "sign_off",
  "books",
  "bank_statement",
  "management_accounts",
  "accounting_connection",
  "bank_balance",
  "payroll",
] as const;

const ANALYST_DELIVERABLES = [
  "budget",
  "variance",
  "forecast",
  "13_week",
  "cash",
  "ratios",
  "ratio",
  "profit",
  "reports",
  "report_pdf",
  "report",
  "exec_summary",
  "health_summary",
  "summary",
  "scorecard",
  "waterfall",
  "benchmark",
  "intervention",
  "cycle",
  "leverage",
  "assets",
  "labor",
  "movement",
  "board_report",
  "board",
  "grossmargin",
  "operatingmargin",
  "netmargin",
  "revenuegrowth",
] as const;

const ADVISOR_PROPOSALS = [
  "cash",
  "debtor_days",
  "creditor_days",
  "collection",
  "collections",
  "covenant",
  "tax",
  "tax_date",
  "action",
  "plan",
  "next",
  "other",
] as const;

const ANALYST_PROPOSALS = [
  "profit",
  "revenue",
  "gross_margin",
  "stock_days",
  "budget",
  "variance",
  "forecast",
  "board",
] as const;

const ACCOUNTANT_PROPOSALS = [
  "sync",
  "upload",
  "query",
  "reconciliation",
  "recon",
  "data_request",
  "signoff",
  "books",
] as const;

const ANALYST_EVENTS = [
  "diagnosis",
  "diagnosis.reviewed",
  "forecast.published",
  "pack.generated",
  "budget",
  "variance",
  "board_report",
] as const;

const ADVISOR_EVENTS = [
  "proposal",
  "draft_created",
  "approved",
  "dismissed",
  "recommendation.proposed",
  "recommendation.approved",
  "recommendation.rejected",
  "recommendation.superseded",
  "action.created",
  "action.started",
  "action.completed",
  "action.blocked",
] as const;

const ACCOUNTANT_EVENTS = [
  "sync",
  "upload",
  "query",
  "data_request",
  "signoff",
  "data.uploaded",
  "data.validated",
  "data.request_opened",
  "data.request_fulfilled",
  "review.signed_off",
  "review.retracted",
  "pack.approved",
] as const;

const SYNC_SOURCES = new Set(["xero", "qbo", "sage"]);
const UPLOAD_SOURCES = new Set(["upload", "pdf_upload"]);

export type TeamDiagnosisRatio = {
  name: string;
  key: string;
  value: number;
  score: number | null;
  asOf: string | null;
};

export type TeamDiagnosisProposal = {
  id: string;
  title: string;
  summary: string;
  type: string | null;
  priority: string | null;
  createdAt: string;
};

export type TeamDiagnosis = {
  market: MoneyMarket;
  health: {
    score: number;
    label: string;
    tier: "healthy" | "at_risk" | "critical";
    asOf: string | null;
  } | null;
  ratios: TeamDiagnosisRatio[];
  brain: {
    headline: string | null;
    body: string | null;
    asOf: string | null;
  } | null;
  proposals: TeamDiagnosisProposal[];
  cash: {
    runwayLabel: string | null;
    runwayWeeks: number | null;
    lowestClosing: number | null;
    floor: number | null;
    dipsBelowFloorWeek: number | null;
    asOf: string | null;
  } | null;
  debtors: {
    outstanding: number | null;
    debtorDays: number | null;
    asOf: string | null;
  } | null;
};

export type TeamFeedProposal = {
  id: string;
  title: string;
  summary: string;
  type: string | null;
  priority: string | null;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  updatedAt: string;
  signedOffAt: string | null;
  note: string | null;
};

export type TeamFeedDraft = {
  id: string;
  kind: string | null;
  body: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type TeamActivityRecords = {
  snapshots: Array<{ id: string; source: string | null; periodLabel: string | null; at: string | null }>;
  uploads: Array<{ id: string; label: string | null; at: string | null }>;
  diagnosisEvents: Array<{ id: string; at: string | null }>;
  proposals: TeamFeedProposal[];
  drafts: TeamFeedDraft[];
  signoffAt: string | null;
  signoffText: string | null;
  dataRequests: Array<{ id: string; title: string; at: string | null }>;
  queries: Array<{ id: string; text: string; at: string | null }>;
  href?: string;
};

function norm(type: string | null | undefined): string {
  return (type ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function matches(key: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => {
    if (key === token) return true;
    if (token.length < 4) return false;
    return key.startsWith(`${token}_`) || key.endsWith(`_${token}`) || key.includes(`_${token}_`);
  });
}

/**
 * One map from a deliverable type, a proposal type, or an event type onto an agent.
 * Unknown deliverables and proposals stay with Milōn Advisor. Unknown events stay
 * with Milōn Accountant (books traffic) only when they are not a move.
 */
export function agentFor(kind: AgentMapKind, type: string | null | undefined): AgentKey {
  const key = norm(type);
  if (!key) {
    if (kind === "event") return "accountant";
    return "advisor";
  }
  if (kind === "deliverable") {
    if (matches(key, ADVISOR_DELIVERABLES)) return "advisor";
    if (matches(key, ACCOUNTANT_DELIVERABLES)) return "accountant";
    if (matches(key, ANALYST_DELIVERABLES)) return "analyst";
    return "advisor";
  }
  if (kind === "proposal") {
    if (matches(key, ACCOUNTANT_PROPOSALS)) return "accountant";
    if (matches(key, ANALYST_PROPOSALS)) return "analyst";
    if (matches(key, ADVISOR_PROPOSALS)) return "advisor";
    return "advisor";
  }
  if (matches(key, ANALYST_EVENTS)) return "analyst";
  if (matches(key, ADVISOR_EVENTS)) return "advisor";
  if (matches(key, ACCOUNTANT_EVENTS)) return "accountant";
  return "accountant";
}

function finiteNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clip(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space >= 80 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function money(n: number, market: MoneyMarket): string {
  return formatMoneyCompact(n, market);
}

export function workspaceHasDraftContext(diagnosis: TeamDiagnosis): boolean {
  return Boolean(
    diagnosis.health ||
      diagnosis.ratios.length ||
      diagnosis.brain ||
      diagnosis.proposals.length ||
      diagnosis.cash ||
      diagnosis.debtors,
  );
}

function severityForScore(score: number | null): "info" | "watch" | "act" | null {
  if (score == null || !Number.isFinite(score)) return null;
  const tier = scoreTier(score);
  if (tier === "critical") return "act";
  if (tier === "at_risk") return "watch";
  return "info";
}

function severityForPriority(priority: string | null): "info" | "watch" | "act" {
  if (priority === "critical" || priority === "high") return "act";
  if (priority === "medium") return "watch";
  return "info";
}

function ratioDetail(row: TeamDiagnosisRatio): string | undefined {
  if (row.name.toLowerCase().includes("margin") || row.key.toLowerCase().includes("margin")) {
    const pct = Math.abs(row.value) <= 1.5 ? row.value * 100 : row.value;
    return `${row.name} ${pct.toFixed(1)}%`;
  }
  if (/days$/i.test(row.name) || /days$/i.test(row.key)) {
    return `${row.name} ${Math.round(row.value)}`;
  }
  return `${row.name} ${row.value}`;
}

export function buildTeamBriefing(diagnosis: TeamDiagnosis): TeamBriefingItem[] {
  const items: TeamBriefingItem[] = [];
  const market = diagnosis.market;

  if (diagnosis.health && Number.isFinite(diagnosis.health.score)) {
    const tier = diagnosis.health.tier;
    items.push({
      id: "health",
      agent: agentFor("deliverable", "health_summary"),
      title: `Health score ${Math.round(diagnosis.health.score)} · ${diagnosis.health.label}`,
      severity: tier === "critical" ? "act" : tier === "at_risk" ? "watch" : "info",
      source: { label: "Health score", asOf: diagnosis.health.asOf },
    });
  }

  for (const ratio of diagnosis.ratios) {
    const severity = severityForScore(ratio.score);
    if (!severity || severity === "info") continue;
    if (!Number.isFinite(ratio.value)) continue;
    items.push({
      id: `ratio:${ratio.key}`,
      agent: agentFor("deliverable", ratio.key),
      title: ratio.name,
      detail: ratioDetail(ratio),
      severity,
      source: { label: "Ratios", asOf: ratio.asOf },
    });
  }

  if (diagnosis.brain && (diagnosis.brain.headline || diagnosis.brain.body)) {
    const title = diagnosis.brain.headline || clip(diagnosis.brain.body || "", 120);
    const detail =
      diagnosis.brain.headline && diagnosis.brain.body ? clip(diagnosis.brain.body) : undefined;
    items.push({
      id: "brain",
      agent: agentFor("deliverable", "advisory"),
      title,
      detail,
      severity: "info",
      source: { label: "Client Brain", asOf: diagnosis.brain.asOf },
    });
  }

  for (const step of diagnosis.proposals) {
    const title = step.title.trim();
    if (!title) continue;
    const item: TeamBriefingItem = {
      id: `proposal:${step.id}`,
      agent: agentFor("proposal", step.type),
      title,
      severity: severityForPriority(step.priority),
      source: { label: "Client Brain proposals", asOf: step.createdAt || null },
      jobId: step.id,
    };
    const summary = step.summary.trim();
    if (summary) item.detail = clip(summary);
    items.push(item);
  }

  if (diagnosis.cash) {
    const cash = diagnosis.cash;
    const bits: string[] = [];
    if (cash.runwayLabel) bits.push(cash.runwayLabel);
    if (cash.lowestClosing != null) bits.push(`lowest close ${money(cash.lowestClosing, market)}`);
    items.push({
      id: "cash-forecast",
      agent: agentFor("deliverable", "forecast"),
      title: "13-week cash forecast",
      detail: bits.length ? bits.join(" · ") : undefined,
      severity: cash.dipsBelowFloorWeek === 1 || cash.runwayWeeks === 0 ? "act" : cash.dipsBelowFloorWeek ? "watch" : "info",
      source: { label: "13-week cash forecast", asOf: cash.asOf },
    });
    if (
      cash.lowestClosing != null &&
      cash.floor != null &&
      cash.lowestClosing < cash.floor
    ) {
      items.push({
        id: "cash-floor",
        agent: agentFor("deliverable", "cash_floor"),
        title: "Cash under the floor",
        detail: `Lowest close ${money(cash.lowestClosing, market)} · floor ${money(cash.floor, market)}`,
        severity: cash.lowestClosing < 0 || cash.runwayWeeks === 0 ? "act" : "watch",
        source: { label: "Cash floor", asOf: cash.asOf },
      });
    }
  }

  if (diagnosis.debtors && (diagnosis.debtors.outstanding != null || diagnosis.debtors.debtorDays != null)) {
    const parts: string[] = [];
    if (diagnosis.debtors.outstanding != null) {
      parts.push(`${money(diagnosis.debtors.outstanding, market)} outstanding`);
    }
    if (diagnosis.debtors.debtorDays != null) {
      parts.push(`${Math.round(diagnosis.debtors.debtorDays)} debtor days`);
    }
    const daysScore =
      diagnosis.debtors.debtorDays != null ? scoreRatio("Debtor Days", diagnosis.debtors.debtorDays) : null;
    const severity = severityForScore(daysScore) ?? "info";
    items.push({
      id: "debtors",
      agent: agentFor("deliverable", "debtors"),
      title: "Debtors",
      detail: parts.join(" · ") || undefined,
      severity,
      source: { label: "Debtors", asOf: diagnosis.debtors.asOf },
    });
  }

  return items.sort((a, b) => {
    const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (rank !== 0) return rank;
    return a.id.localeCompare(b.id);
  });
}

function blockedReasonFor(
  status: TeamJobStatus,
  precard: PrecardState,
  hasData: boolean,
): "precard_cap" | "no_data" | null {
  if (status !== "proposed") return null;
  if (precard.capped) return "precard_cap";
  if (!hasData) return "no_data";
  return null;
}

function proposalJobStatus(status: string, signedOffAt: string | null): TeamJobStatus | null {
  if (status === "proposed") return "proposed";
  if (status === "approved" || status === "edited") return signedOffAt ? "signed_off" : "awaiting_signoff";
  if (status === "rejected") return "dismissed";
  return null;
}

function draftJobStatus(status: string): TeamJobStatus | null {
  if (status === "draft") return "drafting";
  if (status === "ready") return "draft_ready";
  if (status === "discarded") return "dismissed";
  return null;
}

export function buildTeamJobs(input: {
  clientId: string;
  proposals: TeamFeedProposal[];
  drafts: TeamFeedDraft[];
  precard: PrecardState;
  hasData: boolean;
}): TeamJob[] {
  const jobs: TeamJob[] = [];
  const clientId = input.clientId.trim();
  const hrefFor = (section: string, tab = "overview") =>
    clientId ? `/clients/${clientId}?tab=${tab}&section=${section}` : undefined;

  for (const step of input.proposals) {
    const status = proposalJobStatus(step.status, step.signedOffAt);
    if (!status) continue;
    const title = step.title.trim();
    if (!title) continue;
    const agent = agentFor("proposal", step.type);
    const blockedReason = blockedReasonFor(status, input.precard, input.hasData);
    const section = agent === "accountant" ? "books" : agent === "analyst" ? "budget" : "moves";
    jobs.push({
      id: step.id,
      agent,
      title,
      summary: step.summary.trim() || title,
      deliverableType: step.type,
      status,
      createdAt: step.createdAt,
      canApprove: status === "proposed" && blockedReason == null,
      blockedReason,
      href: hrefFor(section),
    });
  }

  for (const draft of input.drafts) {
    const status = draftJobStatus(draft.status);
    if (!status) continue;
    const kind = draft.kind;
    const agent = agentFor("deliverable", kind);
    const title = draftKindLabel(kind);
    const body = (draft.body ?? "").replace(/^\s*SUBJECT:\s*.+\n+/i, "").trim();
    jobs.push({
      id: draft.id,
      agent,
      title,
      summary: body ? clip(body, 180) : title,
      deliverableType: kind,
      status,
      createdAt: draft.createdAt,
      canApprove: false,
      blockedReason: null,
      href: hrefFor("drafter", "deliverables"),
    });
  }

  const open = new Set<TeamJobStatus>(["proposed", "drafting", "draft_ready", "awaiting_signoff"]);
  return jobs.sort((a, b) => {
    const aOpen = open.has(a.status) ? 0 : 1;
    const bOpen = open.has(b.status) ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function pushEvent(out: TeamActivityEvent[], event: TeamActivityEvent | null) {
  if (!event) return;
  const at = event.at.trim();
  const text = event.text.trim();
  if (!at || !text) return;
  if (!Number.isFinite(Date.parse(at))) return;
  out.push({ ...event, at, text });
}

function providerLabel(source: string): string {
  if (source === "xero") return "Xero";
  if (source === "qbo") return "QuickBooks";
  if (source === "sage") return "Sage";
  return source;
}

export function buildTeamActivity(records: TeamActivityRecords): TeamActivityEvent[] {
  const out: TeamActivityEvent[] = [];
  const href = records.href;

  for (const row of records.snapshots) {
    const source = norm(row.source);
    if (!row.at) continue;
    if (SYNC_SOURCES.has(source)) {
      const period = row.periodLabel?.trim();
      pushEvent(out, {
        id: `sync:${row.id}`,
        agent: agentFor("event", "sync"),
        kind: "sync",
        text: period ? `${providerLabel(source)} sync · ${period}` : `${providerLabel(source)} sync`,
        at: row.at,
        href,
      });
    } else if (UPLOAD_SOURCES.has(source)) {
      const period = row.periodLabel?.trim();
      pushEvent(out, {
        id: `upload:${row.id}`,
        agent: agentFor("event", "upload"),
        kind: "upload",
        text: period ? `Statement upload · ${period}` : "Statement upload",
        at: row.at,
        href,
      });
    }
  }

  for (const row of records.uploads) {
    if (!row.at) continue;
    const label = row.label?.trim();
    pushEvent(out, {
      id: `artifact:${row.id}`,
      agent: agentFor("event", "upload"),
      kind: "upload",
      text: label ? `Upload · ${label}` : "Upload",
      at: row.at,
      href,
    });
  }

  for (const row of records.diagnosisEvents) {
    if (!row.at) continue;
    pushEvent(out, {
      id: `diagnosis:${row.id}`,
      agent: agentFor("event", "diagnosis.reviewed"),
      kind: "diagnosis",
      text: "Diagnosis reviewed",
      at: row.at,
      href,
    });
  }

  for (const step of records.proposals) {
    const title = step.title.trim();
    if (!title) continue;
    const agent = agentFor("proposal", step.type);
    pushEvent(out, {
      id: `proposal:${step.id}`,
      agent,
      kind: "proposal",
      text: title,
      at: step.createdAt,
      href,
    });
    if (step.status === "approved" || step.status === "edited") {
      pushEvent(out, {
        id: `approved:${step.id}`,
        agent,
        kind: "approved",
        text: `Approved · ${title}`,
        at: step.decidedAt || step.updatedAt,
        href,
      });
    }
    if (step.status === "rejected") {
      const note = step.note?.trim();
      pushEvent(out, {
        id: `dismissed:${step.id}`,
        agent,
        kind: "dismissed",
        text: note ? `Dismissed · ${title} · ${note}` : `Dismissed · ${title}`,
        at: step.decidedAt || step.updatedAt,
        href,
      });
    }
  }

  for (const draft of records.drafts) {
    const agent = agentFor("deliverable", draft.kind);
    pushEvent(out, {
      id: `draft:${draft.id}`,
      agent,
      kind: "draft_created",
      text: `${draftKindLabel(draft.kind)} draft saved`,
      at: draft.createdAt,
      href,
    });
    if (draft.status === "discarded" && draft.updatedAt && draft.updatedAt !== draft.createdAt) {
      pushEvent(out, {
        id: `draft-dismissed:${draft.id}`,
        agent,
        kind: "dismissed",
        text: `${draftKindLabel(draft.kind)} draft dismissed`,
        at: draft.updatedAt,
        href,
      });
    }
  }

  if (records.signoffAt && records.signoffText?.trim()) {
    pushEvent(out, {
      id: `signoff:${records.signoffAt}`,
      agent: agentFor("event", "signoff"),
      kind: "signoff",
      text: records.signoffText.trim(),
      at: records.signoffAt,
      href,
    });
  }

  for (const row of records.dataRequests) {
    if (!row.at || !row.title.trim()) continue;
    pushEvent(out, {
      id: `data-request:${row.id}`,
      agent: agentFor("event", "data_request"),
      kind: "data_request",
      text: row.title.trim(),
      at: row.at,
      href,
    });
  }

  for (const row of records.queries) {
    if (!row.at || !row.text.trim()) continue;
    pushEvent(out, {
      id: `query:${row.id}`,
      agent: agentFor("event", "query"),
      kind: "query",
      text: clip(row.text, 180),
      at: row.at,
      href,
    });
  }

  return out.sort((a, b) => {
    const delta = Date.parse(b.at) - Date.parse(a.at);
    if (delta !== 0) return delta;
    return b.id.localeCompare(a.id);
  });
}

export function emptyAgentStatuses(): Record<AgentKey, TeamAgentStatus> {
  return {
    accountant: { agent: "accountant", lastRunAt: null, lastRunKind: null },
    analyst: { agent: "analyst", lastRunAt: null, lastRunKind: null },
    advisor: { agent: "advisor", lastRunAt: null, lastRunKind: null },
  };
}

/** Latest real event per agent. Activity must already be newest-first. */
export function agentStatusesFromActivity(
  activity: readonly TeamActivityEvent[],
): Record<AgentKey, TeamAgentStatus> {
  const agents = emptyAgentStatuses();
  for (const event of activity) {
    const slot = agents[event.agent];
    if (slot.lastRunAt) continue;
    slot.lastRunAt = event.at;
    slot.lastRunKind = event.kind;
  }
  return agents;
}

export function precardStateFromFirm(
  row: {
    precard_cap_applies?: boolean | null;
    precard_pack_generations?: number | null;
    precard_email_drafts?: number | null;
    precard_bot_messages?: number | null;
  } | null,
): PrecardState {
  if (!row || row.precard_cap_applies !== true) {
    return { capped: false, remaining: null, limit: null };
  }
  const decision = decidePrecardAllowance({
    applies: true,
    kind: "pack",
    usage: precardUsageFromRow(row as Record<string, unknown>),
  });
  if (!decision.allowed) return { capped: true, remaining: 0, limit: PRECARD_PACK_LIMIT };
  return { capped: false, remaining: decision.remaining, limit: PRECARD_PACK_LIMIT };
}

export function signoffLineFromState(
  state: AdvisorySignoffState | null,
  market?: Parameters<typeof advisorySignoffGrounding>[1],
): string | null {
  if (!state) return null;
  return advisorySignoffGrounding(state, market).line;
}

export function mapApproveResult(input: {
  code?: string | null;
  message?: string | null;
  draftId?: string | null;
  href?: string;
  failed?: boolean;
}): ApproveResult {
  const message = (input.message ?? "").trim();
  const capped =
    input.code === PRECARD_CAP_CODE ||
    message === PRECARD_CAP_MESSAGE ||
    message.includes(PRECARD_CAP_CODE);
  if (capped) {
    return { ok: false, reason: "precard_cap", message: message || PRECARD_CAP_MESSAGE };
  }
  if (input.failed) {
    return { ok: false, reason: "error", message: message || "Could not save the draft" };
  }
  const ok: ApproveResult = { ok: true, draftId: input.draftId ?? null };
  if (input.href) return { ...ok, href: input.href };
  return ok;
}

export function withPrecardCap(feed: MilonTeamFeed): MilonTeamFeed {
  const limit = feed.precard.limit ?? PRECARD_PACK_LIMIT;
  return {
    ...feed,
    precard: { capped: true, remaining: 0, limit },
    jobs: feed.jobs.map((job) =>
      job.status === "proposed" ? { ...job, canApprove: false, blockedReason: "precard_cap" } : job,
    ),
  };
}

export function emptyMilonTeamFeed(): MilonTeamFeed {
  return {
    briefing: [],
    jobs: [],
    activity: [],
    agents: emptyAgentStatuses(),
    signoffLine: null,
    precard: { capped: false, remaining: null, limit: null },
    loading: false,
    error: null,
  };
}

export function buildMilonTeamFeed(input: {
  clientId: string;
  diagnosis: TeamDiagnosis;
  proposals: TeamFeedProposal[];
  drafts: TeamFeedDraft[];
  activityRecords: Omit<TeamActivityRecords, "proposals" | "drafts" | "signoffAt" | "signoffText">;
  signoff: AdvisorySignoffState | null;
  signoffMarket?: Parameters<typeof advisorySignoffGrounding>[1];
  precard: PrecardState;
  loading?: boolean;
  error?: string | null;
}): MilonTeamFeed {
  const signoffLine = signoffLineFromState(input.signoff, input.signoffMarket);
  const signed =
    input.signoff?.status === "signed" || input.signoff?.status === "signed_stale"
      ? input.signoff.signedAt
      : null;
  const href = input.clientId.trim()
    ? `/clients/${input.clientId.trim()}?tab=overview&section=books`
    : undefined;
  const activity = buildTeamActivity({
    ...input.activityRecords,
    proposals: input.proposals,
    drafts: input.drafts,
    signoffAt: signed,
    signoffText: signed ? signoffLine : null,
    href,
  });
  const hasData = workspaceHasDraftContext(input.diagnosis);
  return {
    briefing: buildTeamBriefing(input.diagnosis),
    jobs: buildTeamJobs({
      clientId: input.clientId,
      proposals: input.proposals,
      drafts: input.drafts,
      precard: input.precard,
      hasData,
    }),
    activity,
    agents: agentStatusesFromActivity(activity),
    signoffLine,
    precard: input.precard,
    loading: input.loading === true,
    error: input.error ?? null,
  };
}

export type WorkspaceDiagnosisInput = {
  financials: unknown;
  cashflow: unknown;
  financialsUpdatedAt: string | null;
  lastForecastAt: string | null;
  fyStartMonth: number | null;
  market: ScoreMarket & MoneyMarket;
  timeZone?: string | null;
  brainSummary: unknown;
  brainSummaryUpdatedAt: string | null;
  snapshotAsOf: string | null;
  proposals: TeamDiagnosisProposal[];
};

/**
 * Health, ratios, brain, cash, and debtors from the blobs already stored on the client.
 * Uses the same health and 13-week calls as the studio. A P&L-only forecast estimate
 * is not presented as a saved 13-week forecast.
 */
export function diagnosisFromWorkspace(input: WorkspaceDiagnosisInput): TeamDiagnosis {
  const financials = asRecord(input.financials);
  const market = input.market;
  const asOf = input.snapshotAsOf || input.financialsUpdatedAt;
  const periodMonths = financials ? periodMonthsOf(financials) : null;
  const assessed = assessClientMetrics({
    financials,
    cashflow: input.cashflow,
    financialsUpdatedAt: input.financialsUpdatedAt,
    fyStartMonth: input.fyStartMonth,
    timeZone: input.timeZone,
  });
  const cashText = financials?.cash;
  const cashBalance = finiteNum(cashText);
  const cashKnown = cashBalance != null;
  const runwayWeeks = persistedRunwayWeeks(assessed.runway);
  const healthRaw = scorecardHealthFromFinancials({
    financials,
    fyStartMonth: input.fyStartMonth,
    periodMonths,
    cashRunwayWeeks: cashKnown ? runwayWeeks : null,
    cashBalance: cashKnown ? cashBalance : null,
    market,
    shortfallWeek: assessed.outlook.shortfallWeek,
  });

  const ratioMap = overviewRatios(financials, {
    fyStartMonth: input.fyStartMonth,
    periodMonths,
  });
  const seen = new Set<string>();
  const ratios: TeamDiagnosisRatio[] = [];
  for (const [name, value] of Object.entries(ratioMap)) {
    if (!Number.isFinite(value)) continue;
    const key = RATIO_NAME_TO_KEY[name] ?? norm(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const scored = scoreRatio(name, value, market);
    ratios.push({
      name,
      key,
      value,
      score: Number.isFinite(scored) ? scored : null,
      asOf,
    });
  }

  const parsed = parseBrainSummary(input.brainSummary);
  const brain =
    parsed && (parsed.headline || parsed.body)
      ? {
          headline: parsed.headline ?? null,
          body: parsed.body ?? null,
          asOf: input.brainSummaryUpdatedAt,
        }
      : null;

  const storedClosings = closingBalancesFromCashflow(input.cashflow as SavedCashflowLike | null);
  const outlook = assessed.outlook;
  const savedForecast = outlook.source === "stored" || storedClosings != null;
  const estimateOnly = Boolean(outlook.estimateLabel) && storedClosings == null && outlook.source !== "stored";
  let cash: TeamDiagnosis["cash"] = null;
  if (savedForecast && !estimateOnly) {
    const series = storedClosings ?? (outlook.closing.length ? outlook.closing : null);
    const lowest = series && series.length ? Math.min(...series) : null;
    const floor =
      Number.isFinite(outlook.floor) && outlook.floor > 0
        ? outlook.floor
        : cashComfortThreshold(market.currency);
    cash = {
      runwayLabel: runwayDisplayLabel(assessed.runway),
      runwayWeeks,
      lowestClosing: lowest,
      floor,
      dipsBelowFloorWeek: outlook.dipsBelowFloorWeek,
      asOf: input.lastForecastAt || input.financialsUpdatedAt,
    };
  }

  const outstanding = finiteNum(financials?.receivables);
  const debtorDays = finiteNum(ratioMap["Debtor Days"]);
  const debtors =
    outstanding != null || debtorDays != null
      ? { outstanding, debtorDays, asOf }
      : null;

  const health =
    healthRaw.overall == null
      ? null
      : {
          score: healthRaw.overall,
          label: healthRaw.displayLabel,
          tier: healthRaw.displayStatus,
          asOf,
        };

  return {
    market,
    health,
    ratios,
    brain,
    proposals: input.proposals.filter((step) => step.title.trim()),
    cash,
    debtors,
  };
}
