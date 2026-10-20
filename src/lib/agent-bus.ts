/**
 * Pure rules for the agent bus. The migration's SQL mirrors these decisions.
 * Nothing here talks to the database or to a model.
 */
import { groundAdvisoryNarrative } from "./advisory-narrative.ts";
import { liveOverallFromRecord, quoteLiveScoreOnly } from "./draft-figures.ts";
import { cashComfortThreshold } from "./cash-runway.ts";
import { formatMoney, type MoneyMarket } from "./market/format.ts";
import { statementSpanLabel } from "./statement-period.ts";
export type { MoneyMarket };
import { coerceMarketSelection } from "./market/parse.ts";

export const AGENT_KEYS = ["financial_manager", "analyst", "advisor"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const AGENT_MESSAGE_TYPES = ["finding", "request", "answer", "handoff", "ack"] as const;
export type AgentMessageType = (typeof AGENT_MESSAGE_TYPES)[number];

export const AGENT_HOP_LIMIT = 4;
export const AGENT_CORRELATION_CAP = 12;
export const AGENT_LEASE_MS = 5 * 60 * 1000;
export const AGENT_DEBOUNCE_MS = 10 * 60 * 1000;
export const AGENT_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** A pending event this far past run_after is dropped instead of run late. */
export const AGENT_PROMOTE_STALE_MS = 30 * 60 * 1000;
/** After these delays the next failure is dead-lettered. */
export const AGENT_RETRY_BACKOFF_SECONDS = [60, 300, 900] as const;

export function agentQueueName(agent: AgentKey): string {
  if (agent === "financial_manager") return "agent_fm";
  if (agent === "analyst") return "agent_analyst";
  return "agent_advisor";
}

export function agentIdempotencyMaterial(input: {
  agent: string;
  clientId: string;
  trigger: string;
  inputs: string;
}): string {
  return [input.agent, input.clientId, input.trigger, input.inputs].join("\n");
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash of agent + client + trigger + inputs. Same parts always yield the same key. */
export async function agentIdempotencyKey(input: {
  agent: string;
  clientId: string;
  trigger: string;
  inputs: string;
}): Promise<string> {
  return sha256Hex(agentIdempotencyMaterial(input));
}

export async function agentInputHash(inputs: string): Promise<string> {
  return sha256Hex(inputs);
}

export type LeaseRow = { runId: string; expiresAtMs: number };

/**
 * True when this run may take the (agent, client) lease.
 * An expired lease is free. The holder may renew. A live other holder is not.
 */
export function leaseAcquired(
  current: LeaseRow | null,
  request: { runId: string; nowMs: number },
): boolean {
  if (!current) return true;
  if (current.runId === request.runId) return true;
  return current.expiresAtMs < request.nowMs;
}

export function messageHopAllowed(hop: number): boolean {
  return Number.isInteger(hop) && hop >= 0 && hop <= AGENT_HOP_LIMIT;
}

/** Queues a new message is delivered to. Findings from anyone but the coordinator also go to them. */
export function routeAgentMessage(message: {
  fromAgent: AgentKey;
  toAgent: AgentKey | null;
  type: AgentMessageType;
}): string[] {
  const queues: string[] = [];
  if (message.toAgent) queues.push(agentQueueName(message.toAgent));
  if (message.type === "finding" && message.fromAgent !== "financial_manager") {
    const fm = agentQueueName("financial_manager");
    if (!queues.includes(fm)) queues.push(fm);
  }
  return queues;
}

export function acceptAgentMessage(input: {
  fromAgent: AgentKey;
  toAgent: AgentKey | null;
  type: AgentMessageType;
  hop: number;
  correlationCount: number;
}): { ok: true; queues: string[] } | { ok: false; error: string } {
  if (!messageHopAllowed(input.hop)) {
    return { ok: false, error: "agent message hop limit is 4" };
  }
  if (input.toAgent != null && input.toAgent === input.fromAgent) {
    return { ok: false, error: "an agent cannot message itself" };
  }
  if (input.correlationCount >= AGENT_CORRELATION_CAP) {
    return { ok: false, error: "agent correlation is capped at 12 messages" };
  }
  return {
    ok: true,
    queues: routeAgentMessage({
      fromAgent: input.fromAgent,
      toAgent: input.toAgent,
      type: input.type,
    }),
  };
}

/** Latest of created, last login, and the books timestamp from before this write. */
export function clientActivityMs(input: {
  createdAtMs: number;
  lastLoginAtMs: number | null;
  previousBooksAtMs: number | null;
}): number {
  return Math.max(
    input.createdAtMs,
    input.lastLoginAtMs ?? input.createdAtMs,
    input.previousBooksAtMs ?? input.createdAtMs,
  );
}

export function isClientIdle(input: {
  nowMs: number;
  createdAtMs: number;
  lastLoginAtMs: number | null;
  previousBooksAtMs: number | null;
  idleMs?: number;
}): boolean {
  const activity = clientActivityMs(input);
  return input.nowMs - activity > (input.idleMs ?? AGENT_IDLE_MS);
}

export type PendingAgentEvent = { runAfterMs: number; consumed: boolean };

/** Several events inside the window share the first run_after. A finished window starts a new one. */
export function debounceEnqueue(input: {
  nowMs: number;
  pending: PendingAgentEvent | null;
  debounceMs?: number;
}): { action: "schedule" | "coalesce"; runAfterMs: number } {
  const debounce = input.debounceMs ?? AGENT_DEBOUNCE_MS;
  if (input.pending && !input.pending.consumed && input.pending.runAfterMs > input.nowMs) {
    return { action: "coalesce", runAfterMs: input.pending.runAfterMs };
  }
  return { action: "schedule", runAfterMs: input.nowMs + debounce };
}

export function promoteDecision(input: {
  nowMs: number;
  runAfterMs: number;
  consumed: boolean;
  staleMs?: number;
}): "wait" | "promote" | "stale" {
  if (input.consumed) return "wait";
  if (input.runAfterMs > input.nowMs) return "wait";
  const stale = input.staleMs ?? AGENT_PROMOTE_STALE_MS;
  if (input.nowMs - input.runAfterMs > stale) return "stale";
  return "promote";
}

/** attempt is 1-based and counts the failure that just happened. */
export function retryAfterFailure(
  attempt: number,
): { action: "retry"; delaySeconds: number } | { action: "dead_letter" } {
  const delay = AGENT_RETRY_BACKOFF_SECONDS[attempt - 1];
  if (delay == null) return { action: "dead_letter" };
  return { action: "retry", delaySeconds: delay };
}

/** Strip tokens before anything is stored on agent_runs.error. */
export function sanitizeAgentError(message: string): string {
  return message
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/claude/gi, "the model")
    .slice(0, 500);
}

export type StoredFigures = {
  snapshotId: string | null;
  periodLabel: string | null;
  figures: Record<string, number>;
};

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * A claimed number matches a stored one when both round to 4 decimal places,
 * or when the claim is the stored number rounded to fewer places and the
 * relative gap is at most 0.5% (43.8 against 43.79). Anything looser is rejected.
 */
export function figuresClose(claimed: number, stored: number): boolean {
  if (!Number.isFinite(claimed) || !Number.isFinite(stored)) return false;
  if (round4(claimed) === round4(stored)) return true;
  if (stored === 0 || claimed === 0) return false;
  const rel = Math.abs(claimed - stored) / Math.abs(stored);
  if (rel > 0.005) return false;
  const text = String(claimed);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return false;
  const frac = text.includes(".") ? text.split(".")[1] : "";
  const decimals = frac.replace(/0+$/, "").length;
  const factor = 10 ** decimals;
  const rounded = Math.round(stored * factor) / factor;
  return rounded === claimed;
}

function readLabel(row: StoredFigures): string {
  return row.periodLabel || row.snapshotId || "read";
}

function formatRead(row: StoredFigures): string {
  const bits = Object.entries(row.figures)
    .slice(0, 16)
    .map(([key, value]) => `${key}=${value}`);
  return `${readLabel(row)}: ${bits.join(", ")}`;
}

const PILLAR_IDS = new Set(["profit", "assets", "financing", "cash"]);

function looseKey(value: string): string {
  return value.toLowerCase().replace(/[\s_]+/g, "");
}

/**
 * Map a cited key onto the key a read actually returned.
 * When the pool has both `debtor_days` and `Debtor Days`, the display label wins
 * so the mixed-period check sees one key.
 */
export function canonicalEvidenceKey(key: string, poolKeys: ReadonlySet<string>): string {
  const collapsed = looseKey(key);
  const looseMatches = [...poolKeys].filter((candidate) => looseKey(candidate) === collapsed);
  if (looseMatches.length > 0) {
    const display = looseMatches.find((candidate) => candidate.includes(" ") || /[A-Z]/.test(candidate));
    if (display) return display;
    if (poolKeys.has(key)) return key;
    const exact = looseMatches.find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    if (exact) return exact;
    return looseMatches[0];
  }

  const score = key.match(/^score[_:](\d{4})[-_](\d{2})[-_](\d{2})$/i);
  if (score) return `score:${score[1]}-${score[2]}-${score[3]}`;

  const pillarScore = key.match(/^([a-z]+)_pillar_score$/i);
  if (pillarScore && PILLAR_IDS.has(pillarScore[1].toLowerCase())) {
    return `pillar:${pillarScore[1].toLowerCase()}`;
  }
  const pillarPrefixed = key.match(/^pillar[_:]([a-z]+)$/i);
  if (pillarPrefixed && PILLAR_IDS.has(pillarPrefixed[1].toLowerCase())) {
    return `pillar:${pillarPrefixed[1].toLowerCase()}`;
  }
  const bare = key.toLowerCase();
  if (PILLAR_IDS.has(bare) && poolKeys.has(`pillar:${bare}`)) return `pillar:${bare}`;

  return key;
}

export type EvidenceFigures = Record<string, number> | Record<string, Record<string, number>>;

export type FindingEvidence = {
  snapshot_id: string | null;
  period_label: string | null;
  figures: EvidenceFigures;
  /** Display numbers beside the raw figures. value is the stored number, not the rounded quote. */
  metrics?: EvidenceMetric[];
  /** healthy from info, attention from watch, critical from act or a cash floor breach. */
  status?: AgentCopyStatus;
  /** Margins and live overall this draft was written against. Display compares it to the books. */
  figures_hash?: string | null;
};

function poolKeySet(reads: StoredFigures[]): Set<string> {
  const keys = new Set<string>();
  for (const row of reads) {
    for (const key of Object.keys(row.figures)) keys.add(key);
  }
  return keys;
}

/** One key per alias, display label first, before a period is chosen. */
function normalizeFigureMap(
  figures: Record<string, number>,
  poolKeys: ReadonlySet<string>,
): Record<string, number> {
  const entries = Object.entries(figures).sort(([a], [b]) => {
    const aPreferred = a === canonicalEvidenceKey(a, poolKeys) ? 0 : 1;
    const bPreferred = b === canonicalEvidenceKey(b, poolKeys) ? 0 : 1;
    return aPreferred - bPreferred;
  });
  const out: Record<string, number> = {};
  for (const [key, value] of entries) {
    const canon = canonicalEvidenceKey(key, poolKeys);
    if (canon in out && !figuresClose(out[canon], value)) continue;
    out[canon] = value;
  }
  return out;
}

function normalizeStoredReads(reads: StoredFigures[]): StoredFigures[] {
  const poolKeys = poolKeySet(reads);
  return reads.map((row) => ({ ...row, figures: normalizeFigureMap(row.figures, poolKeys) }));
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

type MetaHint = { snapshotId: string | null; periodLabel: string | null };

type ParsedClaim =
  | { shape: "empty"; hint: MetaHint }
  | { shape: "flat"; figures: Record<string, number>; hint: MetaHint }
  | { shape: "nested"; periods: Record<string, Record<string, number>>; hint: MetaHint }
  | { shape: "invalid"; error: string };

function emptyHint(): MetaHint {
  return { snapshotId: null, periodLabel: null };
}

function isEvidenceMetaKey(key: string): boolean {
  const norm = key.toLowerCase().replace(/[\s_-]/g, "");
  return norm === "snapshotid" || norm === "periodlabel";
}

function takeMeta(key: string, value: unknown, hint: MetaHint): boolean {
  if (!isEvidenceMetaKey(key)) return false;
  const norm = key.toLowerCase().replace(/[\s_-]/g, "");
  if (typeof value === "string" && value.trim()) {
    if (norm === "snapshotid") hint.snapshotId = value.trim();
    if (norm === "periodlabel") hint.periodLabel = value.trim();
  }
  return true;
}

function takeNumber(
  into: Record<string, number>,
  key: string,
  value: number,
  poolKeys: ReadonlySet<string>,
): string | null {
  const canon = canonicalEvidenceKey(key, poolKeys);
  if (canon in into && !figuresClose(into[canon], value)) {
    return `The key ${canon} is cited twice with different values.`;
  }
  into[canon] = value;
  return null;
}

function parseClaimedFigures(raw: unknown, poolKeys: ReadonlySet<string>): ParsedClaim {
  if (raw == null) return { shape: "empty", hint: emptyHint() };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { shape: "invalid", error: "figures must be an object of numbers, or period labels holding numbers." };
  }
  const hint = emptyHint();
  const entries = Object.entries(raw as Record<string, unknown>).filter(([key, value]) => !takeMeta(key, value, hint));
  if (entries.length === 0) return { shape: "empty", hint };
  const hasNested = entries.some(([, value]) => value != null && typeof value === "object" && !Array.isArray(value));
  const hasFlat = entries.some(([, value]) => typeof value === "number");
  if (hasNested && hasFlat) {
    return {
      shape: "invalid",
      error: "figures mix a flat number with a period map. Use one shape: a flat map for one snapshot, or period labels holding numbers.",
    };
  }
  if (hasNested) {
    const periods: Record<string, Record<string, number>> = {};
    for (const [period, value] of entries) {
      if (takeMeta(period, value, hint)) continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { shape: "invalid", error: `The period ${period} must hold a map of numbers.` };
      }
      const inner: Record<string, number> = {};
      for (const [key, n] of Object.entries(value as Record<string, unknown>)) {
        if (takeMeta(key, n, hint)) continue;
        if (typeof n !== "number" || !Number.isFinite(n)) {
          return { shape: "invalid", error: `The figure ${period}.${key} must be a number.` };
        }
        const clash = takeNumber(inner, key, n, poolKeys);
        if (clash) return { shape: "invalid", error: clash };
      }
      if (Object.keys(inner).length === 0) continue;
      periods[period] = inner;
    }
    if (Object.keys(periods).length === 0) return { shape: "empty", hint };
    return { shape: "nested", periods, hint };
  }
  const figures: Record<string, number> = {};
  for (const [key, n] of entries) {
    if (takeMeta(key, n, hint)) continue;
    if (typeof n !== "number" || !Number.isFinite(n)) {
      return { shape: "invalid", error: `The figure ${key} must be a number.` };
    }
    const clash = takeNumber(figures, key, n, poolKeys);
    if (clash) return { shape: "invalid", error: clash };
  }
  if (Object.keys(figures).length === 0) return { shape: "empty", hint };
  return { shape: "flat", figures, hint };
}

function booksMismatch(failed: string[], reads: StoredFigures[]): string {
  const available = reads.slice(0, 8).map(formatRead).join("; ");
  return `The finding's figures do not match the books that were read. Failed: ${failed.join(", ")}. Available: ${available}.`;
}

function periodGroupKey(row: StoredFigures): string {
  return `${row.snapshotId ?? ""}\t${row.periodLabel ?? ""}`;
}

function groupCovers(group: StoredFigures[], figures: Record<string, number>): Record<string, number> | null {
  const stored: Record<string, number> = {};
  for (const [key, value] of Object.entries(figures)) {
    let found: number | undefined;
    for (const row of group) {
      const candidate = row.figures[key];
      if (typeof candidate === "number" && figuresClose(value, candidate)) found = candidate;
    }
    if (found == null) return null;
    stored[key] = found;
  }
  return stored;
}

function unmatchedKeys(reads: StoredFigures[], figures: Record<string, number>): string[] {
  const failed: string[] = [];
  for (const [key, value] of Object.entries(figures)) {
    const hit = reads.some((row) => {
      const stored = row.figures[key];
      return typeof stored === "number" && figuresClose(value, stored);
    });
    if (!hit) failed.push(`${key}=${value}`);
  }
  return failed;
}

function readsForPeriod(reads: StoredFigures[], period: string): StoredFigures[] {
  const want = normalizeLabel(period);
  return reads.filter(
    (row) =>
      (row.periodLabel != null && normalizeLabel(row.periodLabel) === want) ||
      (row.snapshotId != null && row.snapshotId === period),
  );
}

function snapshotOf(rows: StoredFigures[]): string | null {
  const ids = [...new Set(rows.map((row) => row.snapshotId).filter((id): id is string => Boolean(id)))];
  return ids.length === 1 ? ids[0] : null;
}

function applyEvidenceHint(evidence: FindingEvidence, hint: MetaHint, reads: StoredFigures[]): FindingEvidence {
  let snapshotId = evidence.snapshot_id;
  let periodLabel = evidence.period_label; // date-ok: evidence period key, formatted when printed
  if (!snapshotId && hint.snapshotId && reads.some((row) => row.snapshotId === hint.snapshotId)) {
    snapshotId = hint.snapshotId;
  }
  if (!periodLabel && hint.periodLabel) {
    const match = reads.find(
      (row) => row.periodLabel != null && normalizeLabel(row.periodLabel) === normalizeLabel(hint.periodLabel as string),
    );
    if (match?.periodLabel) periodLabel = match.periodLabel;
  }
  return { ...evidence, snapshot_id: snapshotId, period_label: periodLabel };
}

/**
 * A finding may only carry figures that a tool read from stored books.
 * A flat map must belong to one snapshot and period. Numbers from more than
 * one period belong under their period labels. A recorded finding is not a read.
 */
export function groundFindingEvidence(input: {
  pool: StoredFigures[];
  claimedFigures?: unknown;
}): { ok: true; evidence: FindingEvidence } | { ok: false; error: string } {
  const reads = normalizeStoredReads(input.pool.filter((row) => Object.keys(row.figures).length > 0));
  if (reads.length === 0) {
    return {
      ok: false,
      error: "No stored figures were read. A finding needs evidence from the books on file.",
    };
  }
  const parsed = parseClaimedFigures(input.claimedFigures, poolKeySet(reads));
  if (parsed.shape === "invalid") return { ok: false, error: parsed.error };
  if (parsed.shape === "empty") {
    const latest = reads[reads.length - 1];
    return {
      ok: true,
      evidence: applyEvidenceHint(
        {
          snapshot_id: latest.snapshotId,
          period_label: latest.periodLabel,
          figures: { ...latest.figures },
        },
        parsed.hint,
        reads,
      ),
    };
  }

  if (parsed.shape === "nested") {
    const figures: Record<string, Record<string, number>> = {};
    for (const [period, claimed] of Object.entries(parsed.periods)) {
      const periodReads = readsForPeriod(reads, period);
      if (periodReads.length === 0) {
        const available = [...new Set(reads.map(readLabel))].join(", ");
        return {
          ok: false,
          error: `No stored read is labeled ${period}. Available periods: ${available}.`,
        };
      }
      const failed = unmatchedKeys(periodReads, claimed);
      if (failed.length > 0) return { ok: false, error: booksMismatch(failed, periodReads) };
      const covered = groupCovers(periodReads, claimed);
      figures[period] = covered ?? claimed;
    }
    const periods = Object.keys(figures);
    const onePeriod = periods.length === 1 ? periods[0] : null;
    return {
      ok: true,
      evidence: applyEvidenceHint(
        {
          snapshot_id: onePeriod ? snapshotOf(readsForPeriod(reads, onePeriod)) : null,
          period_label: onePeriod,
          figures,
        },
        parsed.hint,
        reads,
      ),
    };
  }

  const failed = unmatchedKeys(reads, parsed.figures);
  if (failed.length > 0) return { ok: false, error: booksMismatch(failed, reads) };

  const groups = new Map<string, StoredFigures[]>();
  for (const row of reads) {
    const key = periodGroupKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const covering: Array<{ rows: StoredFigures[]; figures: Record<string, number> }> = [];
  for (const rows of groups.values()) {
    const covered = groupCovers(rows, parsed.figures);
    if (covered) covering.push({ rows, figures: covered });
  }
  if (covering.length === 1) {
    const winner = covering[0];
    return {
      ok: true,
      evidence: applyEvidenceHint(
        {
          snapshot_id: snapshotOf(winner.rows),
          period_label: winner.rows.find((row) => row.periodLabel)?.periodLabel ?? null,
          figures: winner.figures,
        },
        parsed.hint,
        reads,
      ),
    };
  }
  const nested = nestUnambiguousFlat(groups, parsed.figures);
  if (nested) {
    return { ok: true, evidence: applyEvidenceHint(nested, parsed.hint, reads) };
  }
  const labels = [...new Set(reads.map(readLabel))].join(", ");
  return {
    ok: false,
    error: `These figures come from more than one period (${labels}). File them as { period_label: { key: value } } so one snapshot is not stamped on every period.`,
  };
}

function groupLabel(rows: StoredFigures[]): string {
  return rows.find((row) => row.periodLabel)?.periodLabel ?? rows.find((row) => row.snapshotId)?.snapshotId ?? "period";
}

const SCORE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `Sep 2026` and `1 Jan 2026 – 30 Sep 2026` are one period end. A score day
 * stays its own period, so 5 Oct and 6 Oct are not collapsed into October.
 */
function statementPeriodIdentity(label: string): string {
  if (SCORE_DAY.test(label)) return `day:${label}`;
  const end = periodEndKey(label);
  if (end) return `end:${end}`;
  return `label:${normalizeLabel(label)}`;
}

/** A month stamp wins over the longer range that ends in the same month. */
function preferPeriodLabel(labels: string[]): string {
  const month = labels.find(
    (label) =>
      !SCORE_DAY.test(label) &&
      periodEndKey(label) != null &&
      !/[\u2010-\u2015]|\bto\b/i.test(label),
  );
  return month ?? labels[0];
}

type PeriodHome = { label: string; rows: StoredFigures[]; stored: number };

function homesByPeriod(
  groups: Map<string, StoredFigures[]>,
  key: string,
  value: number,
): Map<string, PeriodHome[]> {
  const homes: PeriodHome[] = [];
  for (const rows of groups.values()) {
    let stored: number | undefined;
    for (const row of rows) {
      const candidate = row.figures[key];
      if (typeof candidate === "number" && figuresClose(value, candidate)) stored = candidate;
    }
    if (stored == null) continue;
    homes.push({ label: groupLabel(rows), rows, stored });
  }
  const byPeriod = new Map<string, PeriodHome[]>();
  for (const home of homes) {
    const identity = statementPeriodIdentity(home.label);
    const list = byPeriod.get(identity) ?? [];
    list.push(home);
    byPeriod.set(identity, list);
  }
  return byPeriod;
}

function choosePeriodHome(matches: PeriodHome[]): PeriodHome {
  const label = preferPeriodLabel(matches.map((home) => home.label));
  return matches.find((home) => home.label === label) ?? matches[0];
}

/**
 * A flat map is filed under the periods its figures belong to. A figure that
 * lives in one period is filed there. A figure that also matches another
 * period follows the period the rest of the map already uses. A month and the
 * range that ends in that month are one period. A figure that still fits two
 * period ends stays a rejection.
 */
function nestUnambiguousFlat(
  groups: Map<string, StoredFigures[]>,
  figures: Record<string, number>,
): FindingEvidence | null {
  const nested: Record<string, Record<string, number>> = {};
  const rowsByLabel = new Map<string, StoredFigures[]>();
  const chosenIdentity = new Map<string, string>();
  const ambiguous: Array<{ key: string; byPeriod: Map<string, PeriodHome[]> }> = [];
  const file = (key: string, home: PeriodHome, identity: string) => {
    const bucket = nested[home.label] ?? {};
    bucket[key] = home.stored;
    nested[home.label] = bucket;
    rowsByLabel.set(home.label, home.rows);
    chosenIdentity.set(key, identity);
  };
  for (const [key, value] of Object.entries(figures)) {
    const byPeriod = homesByPeriod(groups, key, value);
    if (byPeriod.size === 0) return null;
    if (byPeriod.size === 1) {
      const [identity, matches] = [...byPeriod.entries()][0];
      file(key, choosePeriodHome(matches), identity);
      continue;
    }
    ambiguous.push({ key, byPeriod });
  }
  const anchored = new Set(chosenIdentity.values());
  for (const item of ambiguous) {
    const overlap = [...item.byPeriod.keys()].filter((identity) => anchored.has(identity));
    if (overlap.length !== 1) return null;
    const matches = item.byPeriod.get(overlap[0]) ?? [];
    file(item.key, choosePeriodHome(matches), overlap[0]);
  }
  const labels = Object.keys(nested);
  if (labels.length === 0) return null;
  if (labels.length === 1) {
    return {
      snapshot_id: snapshotOf(rowsByLabel.get(labels[0]) ?? []),
      period_label: labels[0],
      figures: nested[labels[0]],
    };
  }
  return { snapshot_id: null, period_label: null, figures: nested };
}

const PERIOD_LABEL =
  "january|february|march|april|may|june|july|august|september|october|november|december|sept|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec";

const MONTH = `(?:${PERIOD_LABEL})`;
const ORDINAL_DAY = "\\d{1,2}(?:st|nd|rd|th)?";
const MONTH_INDEX: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sept: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/**
 * Year-month of the period's end. `1 Jan 2026 – 30 Sep 2026`, `Sep 2026`,
 * and `2026-09-30` are all `2026-09`.
 */
export function periodEndKey(label: string): string | null {
  const text = label.trim().replace(/\s+/g, " ");
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})(?:-\d{2})?(?:[tT ].*)?$/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const parts = text.split(/\s+(?:[\u2010-\u2015-]|\bto\b)\s+/i);
  const side = parts[parts.length - 1] ?? text;
  const monthFirst = side.match(
    new RegExp(`\\b(${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i"),
  );
  const dayFirst = side.match(
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH})\\.?\\s+(\\d{4})\\b`, "i"),
  );
  const monthYear = side.match(new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{4})\\b`, "i"));
  const hit = monthFirst || dayFirst || monthYear;
  if (!hit) return null;
  const month = MONTH_INDEX[hit[1].toLowerCase().replace(/\.$/, "")];
  if (month == null) return null;
  return `${hit[2]}-${String(month + 1).padStart(2, "0")}`;
}

/** Distinct period ends named in prose. One date range counts as its end month. */
export function periodEndsMentioned(text: string): Set<string> {
  const ends = new Set<string>();
  const range = new RegExp(
    `\\b${ORDINAL_DAY}\\s+${MONTH}\\.?\\s+\\d{4}\\s*[\\u2010-\\u2015-]\\s*${ORDINAL_DAY}\\s+${MONTH}\\.?\\s+\\d{4}\\b`,
    "gi",
  );
  const withoutRanges = text.replace(range, (match) => {
    const end = periodEndKey(match);
    if (end) ends.add(end);
    return " ";
  });
  const stamp = new RegExp(`\\b${MONTH}\\.?\\s+\\d{4}\\b`, "gi");
  for (const match of withoutRanges.match(stamp) ?? []) {
    const end = periodEndKey(match);
    if (end) ends.add(end);
  }
  for (const match of withoutRanges.match(/\b(\d{4})-(\d{2})-\d{2}\b/g) ?? []) {
    const end = periodEndKey(match);
    if (end) ends.add(end);
  }
  return ends;
}

/**
 * Drop ids, dates, period labels, and years so their digits are not cited figures.
 * Longer date forms go first. "30 Sep 2026", "Sep 30", and "1 Jan 2026 – 30 Sep 2026"
 * must not leave the day of the month behind as a citation.
 */
export function stripCitationNoise(text: string): string {
  const dayRange = new RegExp(
    `\\b${ORDINAL_DAY}\\s*[\\u2010-\\u2015-]\\s*${ORDINAL_DAY}\\s+${MONTH}\\.?(?:,?\\s+\\d{4})?\\b`,
    "gi",
  );
  const monthDayYear = new RegExp(`\\b${MONTH}\\.?\\s+${ORDINAL_DAY},?\\s+\\d{4}\\b`, "gi");
  const dayMonthYear = new RegExp(`\\b${ORDINAL_DAY}(?:\\s+of)?\\s+${MONTH}\\.?,?\\s+\\d{4}\\b`, "gi");
  const monthDay = new RegExp(`\\b${MONTH}\\.?\\s+${ORDINAL_DAY}\\b`, "gi");
  const dayMonth = new RegExp(`\\b${ORDINAL_DAY}(?:\\s+of)?\\s+${MONTH}\\.?\\b`, "gi");
  return text
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ")
    .replace(/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, " ")
    .replace(/\((?:[^)]*\b(?:median|band|floor)[^)]*)\)/gi, " ")
    .replace(
      /\b(?:peer\s+median|healthy\s+band|watch\s+floor)\s+(?:of\s+)?\d+(?:\.\d+)?(?:\s*[\u2010-\u2015-]\s*\d+(?:\.\d+)?)?(?:\s+days?)?\b/gi,
      " ",
    )
    .replace(/\b[R$£€]\s?\d{1,3}(?:[ \u00a0,]\d{3})+(?:\.\d+)?\s+(?:minimum|floor)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*-\s*days?\b/gi, " ")
    .replace(/\bscore[_: ]\d{4}-\d{2}-\d{2}\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:[\u2010-\u2015\-]|to)\s*\d+(?:\.\d+)?\s+days?\b/gi, " ")
    .replace(
      /\b\d{4}-\d{2}-\d{2}(?:[tT ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
      " ",
    )
    .replace(/\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, " ")
    .replace(/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g, " ")
    .replace(new RegExp(`\\b${ORDINAL_DAY}-${MONTH}-\\d{4}\\b`, "gi"), " ")
    .replace(dayRange, " ")
    .replace(monthDayYear, " ")
    .replace(dayMonthYear, " ")
    .replace(monthDay, " ")
    .replace(dayMonth, " ")
    .replace(new RegExp(`\\b${MONTH}\\.?\\s+\\d{4}\\b`, "gi"), " ")
    .replace(/\b\d{4}-\d{2}\b/g, " ")
    .replace(/\bq[1-4]\s+\d{4}\b/gi, " ")
    .replace(/\bfy\s*\d{4}\b/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ");
}

export type CitedNumber = { raw: string; value: number; decimals: number; scale: number };

const CITED_NUMBER =
  /[R$£€]\s*-?\d{1,3}(?:[ \u00a0]\d{3})+(?:\.\d+)?|-?\d{1,3}(?:[ \u00a0]\d{3})+(?:\.\d+)?|(?:[R$£€]\s*)?-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s*[kmb]\b)?|(?:[R$£€]\s*)?-?\d+(?:\.\d+)?(?:\s*[kmb]\b)?/gi;

function scaleOfSuffix(suffix: string): number {
  if (suffix === "k") return 1_000;
  if (suffix === "m") return 1_000_000;
  if (suffix === "b") return 1_000_000_000;
  return 1;
}

/** `412k`, `R412k`, and `$0.4m` become the stored-figure scale. `412,000` stays one number. */
export function citedNumbers(text: string): CitedNumber[] {
  // A hyphen between numbers is a range, not a minus. "30-60" must not become -60.
  const cleaned = stripCitationNoise(text).replace(/(\d)\s*[\u2010-\u2015\-]\s*(?=\d)/g, "$1 ");
  const matches = cleaned.match(CITED_NUMBER) ?? [];
  const out: CitedNumber[] = [];
  for (const raw of matches) {
    const suffix = raw.trim().match(/[kmb]\s*$/i)?.[0]?.toLowerCase() ?? "";
    const scale = scaleOfSuffix(suffix);
    const numeric = raw.replace(/[R$£€\s]/gi, "").replace(/[kmb]$/i, "").replace(/,/g, "");
    const mantissa = Number(numeric);
    if (!Number.isFinite(mantissa)) continue;
    const frac = numeric.includes(".") ? (numeric.split(".")[1] ?? "") : "";
    out.push({ raw, value: mantissa * scale, decimals: frac.length, scale });
  }
  return out;
}

function atPrecision(n: number, decimals: number, mode: "round" | "trunc"): number {
  const factor = 10 ** decimals;
  const scaled = n * factor;
  const whole = mode === "round" ? Math.round(scaled) : Math.trunc(scaled);
  return whole / factor;
}

function sameCitedNumber(claimed: number, stored: number): boolean {
  return Math.abs(claimed - stored) <= 1e-9 * Math.max(1, Math.abs(claimed), Math.abs(stored));
}

/**
 * A cited number matches a stored figure when it is that figure rounded or
 * truncated to the cited precision, including the percent form (×100).
 * An integer also matches within ±0.5.
 */
export function citedFigureMatches(claimed: number, decimals: number, stored: number, scale = 1): boolean {
  if (!Number.isFinite(claimed) || !Number.isFinite(stored)) return false;
  if (scale !== 1 && scale > 0) {
    const mantissa = claimed / scale;
    if (matchesAtPrecision(mantissa, decimals, stored / scale)) return true;
    return decimals === 0 && Math.trunc(Math.abs(stored) / scale) === Math.abs(mantissa);
  }
  if (matchesAtPrecision(claimed, decimals, stored)) return true;
  if (matchesAtPrecision(claimed, decimals, stored * 100)) return true;
  // A bare 412 is the thousands (or millions) form of a stored revenue. Scores and day counts stay below 100.
  if (decimals === 0 && Math.abs(claimed) >= 100) {
    if (matchesAtPrecision(claimed, 0, stored / 1_000)) return true;
    if (matchesAtPrecision(claimed, 0, stored / 1_000_000)) return true;
    if (Math.trunc(Math.abs(stored) / 1_000) === Math.abs(claimed)) return true;
    if (Math.trunc(Math.abs(stored) / 1_000_000) === Math.abs(claimed)) return true;
  }
  return false;
}

function matchesAtPrecision(claimed: number, decimals: number, stored: number): boolean {
  if (figuresClose(claimed, stored)) return true;
  if (sameCitedNumber(claimed, atPrecision(stored, decimals, "round"))) return true;
  if (sameCitedNumber(claimed, atPrecision(stored, decimals, "trunc"))) return true;
  return decimals === 0 && Math.abs(claimed - stored) <= 0.5;
}

/** Small counts and 100 are ordinal or percent noise, not a missing book figure. */
export function isHarmlessCitedNumber(value: number): boolean {
  return Math.abs(value) <= 12 || Math.abs(value) === 100;
}

type EvidenceBucket = {
  periodLabel: string | null;
  snapshotId: string | null;
  figures: Record<string, number>;
};

function bucketId(periodLabel: string | null, snapshotId: string | null): string {
  if (periodLabel) return `p:${normalizeLabel(periodLabel)}`;
  if (snapshotId) return `s:${snapshotId}`;
  return "none";
}

function matchingFigureKeys(row: StoredFigures, cited: CitedNumber): Array<[string, number]> {
  const matches = Object.entries(row.figures).filter(
    ([, value]) => typeof value === "number" && citedFigureMatches(cited.value, cited.decimals, value, cited.scale),
  );
  if (row.periodLabel) {
    const specific = matches.filter(([key]) => key.includes(row.periodLabel as string));
    if (specific.length > 0) return specific;
  }
  return matches;
}

function periodBucketKey(label: string | null): string | null {
  if (!label) return null;
  return periodEndKey(label) ?? normalizeLabel(label);
}

function namedPeriodKeys(text: string, reads: StoredFigures[]): Set<string> {
  const mentioned = periodEndsMentioned(text);
  const named = new Set<string>();
  const hay = text.toLowerCase();
  for (const row of reads) {
    const key = periodBucketKey(row.periodLabel);
    if (!key) continue;
    if (mentioned.has(key)) named.add(key);
    if (row.periodLabel && hay.includes(row.periodLabel.toLowerCase())) named.add(key);
  }
  return named;
}

function restrictToNamed<T extends { periodLabel: string | null }>(hits: T[], named: Set<string>): T[] {
  if (named.size === 0) return hits;
  const narrowed = hits.filter((hit) => {
    const key = periodBucketKey(hit.periodLabel);
    return key != null && named.has(key);
  });
  return narrowed.length > 0 ? narrowed : hits;
}

function putFigure(
  buckets: Map<string, EvidenceBucket>,
  hit: { periodLabel: string | null; snapshotId: string | null; key: string; value: number },
) {
  const id = bucketId(hit.periodLabel, hit.snapshotId);
  const bucket = buckets.get(id) ?? {
    periodLabel: hit.periodLabel,
    snapshotId: hit.snapshotId,
    figures: {},
  };
  if (!bucket.snapshotId && hit.snapshotId) bucket.snapshotId = hit.snapshotId;
  if (!bucket.periodLabel && hit.periodLabel) bucket.periodLabel = hit.periodLabel;
  bucket.figures[hit.key] = hit.value;
  buckets.set(id, bucket);
}

/** File each claimed figure on the read that holds it, under that read's period and canonical key. */
function fileClaimedFigures(
  buckets: Map<string, EvidenceBucket>,
  reads: StoredFigures[],
  figures: EvidenceFigures,
  named: Set<string>,
  poolKeys: ReadonlySet<string>,
) {
  const entries = Object.entries(figures);
  const nested = entries.some(([, value]) => value != null && typeof value === "object");
  const pairs: Array<[string, number]> = [];
  if (!nested) {
    for (const [key, value] of entries) {
      if (typeof value === "number" && Number.isFinite(value)) pairs.push([key, value]);
    }
  } else {
    for (const [, value] of entries) {
      if (!value || typeof value !== "object") continue;
      for (const [key, n] of Object.entries(value)) {
        if (typeof n === "number" && Number.isFinite(n)) pairs.push([key, n]);
      }
    }
  }
  for (const [key, value] of pairs) {
    const canon = canonicalEvidenceKey(key, poolKeys);
    const hits = restrictToNamed(
      reads.filter((row) => {
        const stored = row.figures[canon];
        return typeof stored === "number" && figuresClose(value, stored);
      }),
      named,
    );
    for (const row of hits) {
      const stored = row.figures[canon];
      if (typeof stored !== "number") continue;
      putFigure(buckets, {
        periodLabel: row.periodLabel,
        snapshotId: row.snapshotId,
        key: canon,
        value: stored,
      });
    }
  }
}

function evidenceFromBuckets(buckets: Map<string, EvidenceBucket>): FindingEvidence {
  const rows = [...buckets.values()].filter((bucket) => Object.keys(bucket.figures).length > 0);
  if (rows.length === 1) {
    const only = rows[0];
    return {
      snapshot_id: only.snapshotId,
      period_label: only.periodLabel,
      figures: only.figures,
    };
  }
  const figures: Record<string, Record<string, number>> = {};
  for (const bucket of rows) {
    const label = bucket.periodLabel || bucket.snapshotId || "period";
    figures[label] = { ...(figures[label] ?? {}), ...bucket.figures };
  }
  return { snapshot_id: null, period_label: null, figures };
}

/**
 * A stored number in the title or detail is copied onto the evidence with the
 * key and period from the read. Ids, dates, and years are ignored. A small or
 * ordinal leftover is a warning. Only a substantive number missing from every
 * read is refused.
 */
export function attachCitedEvidence(input: {
  title: string;
  detail: string;
  pool: StoredFigures[];
  evidence: FindingEvidence;
}): { ok: true; evidence: FindingEvidence; warning?: string } | { ok: false; error: string } {
  const prose = `${input.title}\n${input.detail}`;
  const cited = citedNumbers(prose);
  const seen = new Set<string>();
  const missing: string[] = [];
  const harmless: string[] = [];
  const reads = normalizeStoredReads(input.pool.filter((row) => Object.keys(row.figures).length > 0));
  const poolKeys = poolKeySet(reads);
  const named = namedPeriodKeys(prose, reads);
  const buckets = new Map<string, EvidenceBucket>();
  fileClaimedFigures(buckets, reads, input.evidence.figures, named, poolKeys);
  for (const n of cited) {
    if (seen.has(n.raw)) continue;
    seen.add(n.raw);
    const hits = restrictToNamed(
      reads.flatMap((row) =>
        matchingFigureKeys(row, n).map(([key, value]) => ({
          periodLabel: row.periodLabel,
          snapshotId: row.snapshotId,
          key: canonicalEvidenceKey(key, poolKeys),
          value,
        })),
      ),
      named,
    );
    if (hits.length === 0) {
      if (n.scale === 1 && isHarmlessCitedNumber(n.value)) harmless.push(n.raw);
      else missing.push(n.raw);
      continue;
    }
    for (const hit of hits) putFigure(buckets, hit);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      error: `The title or detail cites ${missing.join(", ")}, which is not in the books that were read.`,
    };
  }
  const next = evidenceFromBuckets(buckets);
  const evidence = Object.keys(next.figures).length === 0 ? input.evidence : next;
  if (harmless.length === 0) return { ok: true, evidence };
  return {
    ok: true,
    evidence,
    warning: `Ignored small numbers not on the books: ${harmless.join(", ")}.`,
  };
}

export const AGENT_COPY_STATUSES = ["healthy", "attention", "critical"] as const;
export type AgentCopyStatus = (typeof AGENT_COPY_STATUSES)[number];

export type EvidenceMetricUnit = "currency" | "percent" | "days" | "count" | "ratio";

export type EvidenceMetric = {
  metric: string;
  /** Percentage points when unit is percent (60, 8.6). Other units keep the stored number. */
  value: number;
  /** The stored fraction, only when value was scaled from it. */
  value_raw?: number;
  unit: EvidenceMetricUnit;
  period: string | null;
  floor?: number;
  count?: number;
};

/** South Africa when the client market is missing. United States when the row says US. */
export function moneyMarketFromClient(raw: unknown): MoneyMarket {
  const sel = coerceMarketSelection(raw);
  if (sel.country === "US") return { currency: "USD", locale: "en-US" };
  return { currency: "ZAR", locale: "en-ZA" };
}

export const AGENT_COPY_GUIDE = `How to write a title, detail, or summary:
- A title or a home summary is 1–2 complete sentences, in sentence case, each ending with a full stop.
- A detail is ≤4 short sentences, ≤600 chars.
- Amounts use the client's format. South Africa: R 13 846. United States: $13,846. Cashflow amounts are $46,300 or R 46 300, never a bare 46300 or 128 450.
- A ratio is a percentage with one decimal. 0.6 is written 60%. 0.086 is written 8.6%, not 9%.
- A health or pillar score is the bare number. 60 is written 60, not 60/100, 60 out of 100, or 60%. Pillar names are Profit, Assets, Financing, and Cash. Do not write Profit Drivers, Profitability, Leverage & Finance, or Financing & Solvency. A ratio nickname is a sub-factor under its pillar, such as Profit · Bottom-line strength.
- Quote the live health score only. Do not write "stored 69 vs live 67" or any stored-versus-live comparison. stored_score is not a number for the title or the detail.
- Days are whole days. 43.8 is written 44 days.
- Quote a day band only when both numbers were stored. Do not invent "30–60 day healthy band on file" or "the stored 30–60 day band".
- Bad: "Low R 36 154. R 13 846 under R 50 000. get emails out to 10 clients"
- Good: "Cash is R 13 846 below your R 50 000 minimum. Send reminder emails to 10 clients."
- A data request title is the ask itself. Bad: "Gross margin is 0.6. Debtor days are 43.8." Good: "Send the September debtors age analysis."`;

const METRIC_WORD =
  /\b(?:gross|operating|net)\s+margin\b|\b(?:debtor|creditor|inventory|working\s+capital|wip)\s+days\b|\b(?:current|fixed\s+cost)\s+ratio\b|\bdebt[-\s]to[-\s]equity\b|\brevenue\s+growth\b|\breturn\s+on\s+(?:assets|equity)\b|\b(?:tax|interest)\s+burden\b|\basset\s+turnover\b|\brevenue\b|\bcash\b/i;

function compactMetricKey(key: string): string {
  return key.toLowerCase().replace(/[\s_-]/g, "");
}

/**
 * Health and pillar scores are bare numbers. Days metrics are checked after
 * that, so "Working Capital Days" stays days and a health score of 69 does not.
 */
function isScoreMetricKey(compact: string): boolean {
  if (compact.includes("day")) return false;
  if (compact.startsWith("pillar")) return true;
  if (compact === "health" || compact === "overall" || compact === "storedscore" || compact === "liveoverall") {
    return true;
  }
  return compact.includes("score");
}

/** Unit for a draft figure. Health is a score (no unit). Days say days. Margins say %. */
export function draftMetricUnit(key: string, value: number): EvidenceMetricUnit {
  const compact = compactMetricKey(key);
  if (isScoreMetricKey(compact)) return "count";
  if (/day/.test(compact)) return "days";
  if (/margin|percent|growth|rate|burden|costratio|returnon/.test(compact)) return "percent";
  if (/turnover|multiplier|multiple|debttoequity|currentratio/.test(compact)) return "ratio";
  if (/closing|openingbalance|openingcash|bankbalance/.test(compact)) return "currency";
  if (/week|runway|horizon|upload|ledger|sync/.test(compact)) return "count";
  if (
    /revenue|cash|expense|asset|liabilit|balance|amount|sales|profit|wage|cogs|payable|receivable|cost/.test(compact) ||
    Math.abs(value) >= 1000
  ) {
    return "currency";
  }
  return "count";
}

function metricUnit(key: string, value: number): EvidenceMetricUnit {
  return draftMetricUnit(key, value);
}

const QUOTE_RATIO_NAMES = [
  "Debtor Days",
  "Creditor Days",
  "Inventory Days",
  "Working Capital Days",
  "Gross Margin",
  "Operating Margin",
  "Net Margin",
] as const;

function metricContextAt(text: string, offset: number): "score" | "days" | "margin" | "other" {
  const before = text.slice(Math.max(0, offset - 80), offset).toLowerCase();
  if (/\b(?:debtor|creditor|inventory|working\s+capital|wip)\s+days\b[^.\n]*$/.test(before)) return "days";
  if (/\b(?:gross|operating|net)\s+margin\b[^.\n]*$/.test(before)) return "margin";
  if (/\b(?:health|overall|pillar)\b[^.\n]*$/.test(before)) return "score";
  if (/\bscore\b[^.\n]{0,24}$/.test(before)) return "score";
  return "other";
}

/**
 * A days figure must not rewrite a health score that shares its number, and a
 * unit already written stays once. "73 days days" and "health 69 days" are the
 * QA US failures.
 */
export function repairDraftMetricUnits(text: string): string {
  const stripped = text.replace(
    /\b((?:stored\s+|live\s+)?(?:health|overall)(?:\s+score)?|health\s+score|pillar(?:\s+score)?)\b([^.\n]{0,60}?)(\d+(?:\.\d+)?)(\s+days)\b/gi,
    (_full, label: string, mid: string, num: string) => `${label}${mid}${num}`,
  );
  return stripped.replace(/\bdays(?:\s+days)+\b/gi, "days");
}

/** Latest scorecard ratios in the read pool. Later reads win. */
export function canonicalQuoteRatios(pool: readonly StoredFigures[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const row of pool) {
    for (const name of QUOTE_RATIO_NAMES) {
      const value = row.figures[name];
      if (typeof value === "number" && Number.isFinite(value)) out[name] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

function quoteRatiosFromFigures(
  figures: EvidenceFigures | undefined,
  canonical?: Record<string, number> | null,
): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const leaf of figureLeaves(figures)) {
    if ((QUOTE_RATIO_NAMES as readonly string[]).includes(leaf.key)) out[leaf.key] = leaf.value;
  }
  if (canonical) {
    for (const name of QUOTE_RATIO_NAMES) {
      const value = canonical[name];
      if (typeof value === "number" && Number.isFinite(value)) out[name] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

function cashFloor(key: string, unit: EvidenceMetricUnit, market: MoneyMarket): number | undefined {
  if (unit !== "currency") return undefined;
  const compact = compactMetricKey(key);
  if (/week|runway|upload|ledger/.test(compact)) return undefined;
  if (!/cash|closing|openingbalance|bankbalance/.test(compact)) return undefined;
  return cashComfortThreshold(market.currency);
}

/**
 * A percent metric stores percentage points. A stored fraction (|value| ≤ 1.5)
 * is multiplied by 100 and rounded to one decimal. value_raw keeps that fraction.
 */
export function percentMetricValue(value: number): { value: number; value_raw?: number } {
  if (Math.abs(value) > 1.5) return { value };
  const points = Math.round(value * 1000) / 10;
  return { value: points, value_raw: value };
}

function percentPoints(value: number): number {
  return percentMetricValue(value).value;
}

function proseForMetric(unit: EvidenceMetricUnit, value: number, market: MoneyMarket): string {
  if (unit === "days") return `${Math.round(value)} days`;
  if (unit === "percent") {
    const pct = percentPoints(value);
    const body = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
    return `${body}%`;
  }
  if (unit === "currency") return formatMoney(value, market);
  if (unit === "ratio") return `${value.toFixed(2)}×`;
  return String(Math.round(value));
}

/** Whole-percent spellings that are looser than the one-decimal quote. 8.6% also replaces 9% and 8%. */
function loosePercentSpellings(value: number): string[] {
  const pct = percentPoints(value);
  const body = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  const out: string[] = [];
  for (const whole of [Math.round(pct), Math.trunc(pct)]) {
    const text = String(whole);
    if (text !== body) out.push(`${text}%`);
  }
  return out;
}

function figureLeaves(figures: EvidenceFigures | undefined): Array<{ key: string; value: number; period: string | null }> {
  if (!figures) return [];
  const out: Array<{ key: string; value: number; period: string | null }> = [];
  for (const [key, value] of Object.entries(figures)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out.push({ key, value, period: null });
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [innerKey, inner] of Object.entries(value)) {
      if (typeof inner === "number" && Number.isFinite(inner)) {
        out.push({ key: innerKey, value: inner, period: key });
      }
    }
  }
  return out;
}

/** Structured fields beside the raw figures. The figures map itself stays as stored. */
export function evidenceMetrics(
  figures: EvidenceFigures | undefined,
  periodLabel: string | null,
  market: MoneyMarket = moneyMarketFromClient(null),
): EvidenceMetric[] {
  return figureLeaves(figures).map((leaf) => {
    const unit = metricUnit(leaf.key, leaf.value);
    const floor = cashFloor(leaf.key, unit, market);
    const scaled = unit === "percent" ? percentMetricValue(leaf.value) : { value: leaf.value };
    const metric: EvidenceMetric = {
      metric: leaf.key,
      value: scaled.value,
      unit,
      period: statementSpanLabel({
        periodLabel: leaf.period ?? periodLabel,
        market,
      }),
    };
    if (scaled.value_raw != null) metric.value_raw = scaled.value_raw;
    if (floor != null) metric.floor = floor;
    if (unit === "count") metric.count = metric.value;
    return metric;
  });
}

/** Currency figures in the client's format, for a read tool to show beside the raw numbers. */
export function displayAmounts(
  figures: Record<string, number> | undefined,
  market: MoneyMarket = moneyMarketFromClient(null),
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(figures ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (metricUnit(key, value) !== "currency") continue;
    out[key] = formatMoney(value, market);
  }
  return out;
}

/** info → healthy, watch → attention, act → critical. Status never disagrees with severity. */
export function agentCopyStatus(severity: string): AgentCopyStatus {
  if (severity === "act") return "critical";
  if (severity === "watch") return "attention";
  return "healthy";
}

/** A cash figure under the comfort floor is act, so its status is critical too. */
export function severityWithFloor(severity: string, metrics: readonly EvidenceMetric[]): string {
  const breach = metrics.some((metric) => metric.floor != null && metric.value < metric.floor);
  if (breach) return "act";
  return severity;
}

function rawAmountSpellings(value: number): string[] {
  const out = [String(value)];
  if (!Number.isInteger(value)) {
    out.push(value.toFixed(2), value.toFixed(4));
    const one = value.toFixed(1);
    if (Number(one) === value) out.push(one);
  }
  const rounded = Math.round(value);
  if (Math.abs(value) >= 1000 && Math.abs(value - rounded) < 0.001) {
    const digits = String(Math.abs(rounded));
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const sign = rounded < 0 ? "-" : "";
    const body = `${sign}${grouped}`;
    out.push(body, body.replace(/,/g, " "));
  }
  return [...new Set(out)];
}

type DraftAmountReplacement = { raw: string; formatted: string; unit: EvidenceMetricUnit };

function applyCopyReplacements(text: string, replacements: DraftAmountReplacement[]): string {
  const byRaw = new Map<string, DraftAmountReplacement[]>();
  for (const item of replacements) {
    if (!item.raw || item.raw === item.formatted) continue;
    const list = byRaw.get(item.raw) ?? [];
    if (!list.some((row) => row.unit === item.unit && row.formatted === item.formatted)) list.push(item);
    byRaw.set(item.raw, list);
  }
  const raws = [...byRaw.keys()].sort((a, b) => b.length - a.length);
  if (!raws.length) return text;
  const pattern = raws.map((raw) => raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(
    new RegExp(`(?<![R$£€][ \\u00a0\\u202f]?)(?<![\\d.])(?:${pattern})(?![\\d×%])`, "g"),
    (match, offset: number) => {
      const options = byRaw.get(match) ?? [];
      const after = text.slice(offset + match.length, offset + match.length + 20);
      if (/^\s+out of\s+100\b/i.test(after) || /^\s*\/\s*100\b/.test(after)) return match;
      const ctx = metricContextAt(text, offset);
      if (ctx === "score") return match;
      const preferred =
        ctx === "days"
          ? options.find((row) => row.unit === "days")
          : ctx === "margin"
            ? options.find((row) => row.unit === "percent")
            : options.length === 1
              ? options[0]
              : undefined;
      if (!preferred) return match;
      if (preferred.unit === "days" && /^\s*days\b/i.test(after)) return match;
      if (preferred.unit === "percent" && /^\s*%/.test(after)) return match;
      return preferred.formatted;
    },
  );
}

const DAY_BAND =
  /\b(?:(the)\s+(?:stored\s+)?)?(\d+(?:\.\d+)?)\s*(?:[\u2010-\u2015\-]|to)\s*(\d+(?:\.\d+)?)\s*day\s+(healthy\s+)?band(?:\s+on\s+file)?/gi;

/**
 * Drop an N–M day band whose endpoints were not in the grounded reads.
 * No read returns the creditor healthy band. It lives in the ratio table, not the books.
 */
export function stripUnstoredHealthyBand(text: string, stored: readonly number[]): string {
  return text.replace(DAY_BAND, (match, the: string | undefined, leftRaw: string, rightRaw: string, healthy: string | undefined) => {
    const left = Number(leftRaw);
    const right = Number(rightRaw);
    const known = (n: number) => stored.some((value) => figuresClose(n, value));
    if (known(left) && known(right)) return match;
    const label = healthy ? "healthy band" : "band";
    return the ? `the ${label}` : label;
  });
}

export function storedFigureValues(rows: readonly StoredFigures[]): number[] {
  const out: number[] = [];
  for (const row of rows) {
    for (const value of Object.values(row.figures)) {
      if (typeof value === "number" && Number.isFinite(value)) out.push(value);
    }
  }
  return out;
}

function formatCopyAmounts(text: string, figures: EvidenceFigures | undefined, market: MoneyMarket): string {
  const replacements: DraftAmountReplacement[] = [];
  for (const leaf of figureLeaves(figures)) {
    const unit = metricUnit(leaf.key, leaf.value);
    if (unit === "count") continue;
    const formatted = proseForMetric(unit, leaf.value, market);
    for (const raw of rawAmountSpellings(leaf.value)) replacements.push({ raw, formatted, unit });
    if (unit === "percent") {
      for (const raw of loosePercentSpellings(leaf.value)) replacements.push({ raw, formatted, unit });
    }
  }
  return repairDraftMetricUnits(applyCopyReplacements(text, replacements))
    .replace(/\$\s*\$/g, "$")
    .replace(/R(?:[\u00a0 ]+)R(?:[\u00a0 ])/g, "R ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCopySentences(text: string): string[] {
  return text
    .split(/(?<!\d)[.!?]+|[.!?]+(?!\d)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sentenceCase(sentence: string): string {
  const first = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  const body = first.replace(/[.!?]+$/, "");
  return `${body}.`;
}

function isMetricSentence(sentence: string): boolean {
  if (!/\d|%/.test(sentence) || !METRIC_WORD.test(sentence)) return false;
  const rest = sentence
    .replace(new RegExp(METRIC_WORD.source, "gi"), " ")
    .replace(/-?\d[\d\s,]*(?:\.\d+)?%?/g, " ")
    .replace(/\b(?:is|are|of|and|the|a|an|both|periods?|shows?|with|at|for|in|was|were|on|to|from|vs|versus|days)\b/gi, " ")
    .replace(/[R$£€]/g, " ")
    .replace(/[^A-Za-z]+/g, " ")
    .trim();
  return rest.length === 0;
}

function isMetricDump(text: string): boolean {
  const parts = splitCopySentences(text);
  return parts.length > 0 && parts.every(isMetricSentence);
}

const COPY_SENTENCE_LIMIT = { title: 2, summary: 2, detail: 4 } as const;
const COPY_CHAR_LIMIT = { title: 200, summary: 500, detail: 600 } as const;

function isBareNumber(text: string): boolean {
  const compact = text.replace(/[.!?]+$/g, "").trim();
  if (!compact) return false;
  return /^(?:[R$£€]\s*)?-?\d[\d\s,\u00a0]*(?:\.\d+)?%?$/.test(compact);
}

function fitCopyChars(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(1, max - 1));
  const last = cut.lastIndexOf(". ");
  if (last >= 40) return cut.slice(0, last + 1).trim();
  const body = cut.replace(/[.!?\s]+$/g, "").trim();
  const sentence = body ? `${body}.` : "";
  return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1)}.`;
}

/**
 * Sentence case, a full stop, and the client's amount format.
 * A long title or summary keeps the first two sentences. A detail keeps four.
 * Only an empty string or a bare number is refused.
 */
export function polishAgentCopy(input: {
  text: string;
  role: "title" | "detail" | "summary";
  kind?: string;
  figures?: EvidenceFigures;
  market?: MoneyMarket;
  /** Live scorecard ratios. A stored operating margin is rewritten to this figure. */
  canonicalRatios?: Record<string, number> | null;
  /** Every number a read returned. A healthy band is kept only when both ends are here. */
  storedNumbers?: readonly number[];
}): { ok: true; text: string } | { ok: false; error: string } {
  const market = input.market ?? moneyMarketFromClient(null);
  const stored = input.storedNumbers ?? figureLeaves(input.figures).map((leaf) => leaf.value);
  const stripped = stripUnstoredHealthyBand(input.text.replace(/\s+/g, " ").trim(), stored);
  const ratios = quoteRatiosFromFigures(input.figures, input.canonicalRatios);
  const formatted = quoteLiveScoreOnly(
    repairDraftMetricUnits(
      ratios
        ? groundAdvisoryNarrative(formatCopyAmounts(stripped, input.figures, market), ratios)
        : formatCopyAmounts(stripped, input.figures, market),
    ),
    liveOverallFromRecord(input.figures as Record<string, unknown> | undefined),
  );
  if (!formatted) return { ok: false, error: `A ${input.role} needs a complete sentence.` };
  const parts = splitCopySentences(formatted);
  if (parts.length === 0) return { ok: false, error: `A ${input.role} needs a complete sentence.` };
  const sentences = parts.slice(0, COPY_SENTENCE_LIMIT[input.role]).map(sentenceCase);
  const text = fitCopyChars(sentences.join(" "), COPY_CHAR_LIMIT[input.role]);
  if (!text || isBareNumber(text)) {
    return { ok: false, error: `A ${input.role} needs a complete sentence, not a bare number.` };
  }
  if (input.role === "title" && input.kind === "data_request_draft" && isMetricDump(text)) {
    return {
      ok: false,
      error: 'A data request title is the ask itself. For example: "Send the September debtors age analysis."',
    };
  }
  return { ok: true, text };
}

export function shapeRecordedCopy(input: {
  title: string;
  detail: string;
  kind: string;
  severity: string;
  figures: EvidenceFigures;
  periodLabel: string | null;
  market?: MoneyMarket;
  canonicalRatios?: Record<string, number> | null;
  storedNumbers?: readonly number[];
}):
  | {
      ok: true;
      title: string;
      detail: string;
      metrics: EvidenceMetric[];
      severity: string;
      status: AgentCopyStatus;
    }
  | { ok: false; error: string } {
  const market = input.market ?? moneyMarketFromClient(null);
  const title = polishAgentCopy({
    text: input.title,
    role: "title",
    kind: input.kind,
    figures: input.figures,
    market,
    canonicalRatios: input.canonicalRatios,
    storedNumbers: input.storedNumbers,
  });
  if (!title.ok) return title;
  const detail = polishAgentCopy({
    text: input.detail,
    role: "detail",
    kind: input.kind,
    figures: input.figures,
    market,
    canonicalRatios: input.canonicalRatios,
    storedNumbers: input.storedNumbers,
  });
  if (!detail.ok) return detail;
  const metrics = evidenceMetrics(input.figures, input.periodLabel, market);
  const severity = severityWithFloor(input.severity, metrics);
  return {
    ok: true,
    title: title.text,
    detail: detail.text,
    metrics,
    severity,
    status: agentCopyStatus(severity),
  };
}
