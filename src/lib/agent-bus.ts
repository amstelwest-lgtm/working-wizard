/**
 * Pure rules for the agent bus. The migration's SQL mirrors these decisions.
 * Nothing here talks to the database or to a model.
 */

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

/** Map a cited key onto the key a read actually returned. */
export function canonicalEvidenceKey(key: string, poolKeys: ReadonlySet<string>): string {
  if (poolKeys.has(key)) return key;
  const exact = [...poolKeys].find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  if (exact) return exact;

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

  const collapsed = looseKey(key);
  const loose = [...poolKeys].find((candidate) => looseKey(candidate) === collapsed);
  if (loose) return loose;
  return key;
}

export type EvidenceFigures = Record<string, number> | Record<string, Record<string, number>>;

export type FindingEvidence = {
  snapshot_id: string | null;
  period_label: string | null;
  figures: EvidenceFigures;
};

function poolKeySet(reads: StoredFigures[]): Set<string> {
  const keys = new Set<string>();
  for (const row of reads) {
    for (const key of Object.keys(row.figures)) keys.add(key);
  }
  return keys;
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

type ParsedClaim =
  | { shape: "empty" }
  | { shape: "flat"; figures: Record<string, number> }
  | { shape: "nested"; periods: Record<string, Record<string, number>> }
  | { shape: "invalid"; error: string };

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
  if (raw == null) return { shape: "empty" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { shape: "invalid", error: "figures must be an object of numbers, or period labels holding numbers." };
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) return { shape: "empty" };
  const hasNested = entries.some(([, value]) => value != null && typeof value === "object");
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
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { shape: "invalid", error: `The period ${period} must hold a map of numbers.` };
      }
      const inner: Record<string, number> = {};
      for (const [key, n] of Object.entries(value as Record<string, unknown>)) {
        if (typeof n !== "number" || !Number.isFinite(n)) {
          return { shape: "invalid", error: `The figure ${period}.${key} must be a number.` };
        }
        const clash = takeNumber(inner, key, n, poolKeys);
        if (clash) return { shape: "invalid", error: clash };
      }
      if (Object.keys(inner).length === 0) {
        return { shape: "invalid", error: `The period ${period} has no numbers.` };
      }
      periods[period] = inner;
    }
    return { shape: "nested", periods };
  }
  const figures: Record<string, number> = {};
  for (const [key, n] of entries) {
    if (typeof n !== "number" || !Number.isFinite(n)) {
      return { shape: "invalid", error: `The figure ${key} must be a number.` };
    }
    const clash = takeNumber(figures, key, n, poolKeys);
    if (clash) return { shape: "invalid", error: clash };
  }
  return { shape: "flat", figures };
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

/**
 * A finding may only carry figures that a tool read from stored books.
 * A flat map must belong to one snapshot and period. Numbers from more than
 * one period belong under their period labels. A recorded finding is not a read.
 */
export function groundFindingEvidence(input: {
  pool: StoredFigures[];
  claimedFigures?: unknown;
}): { ok: true; evidence: FindingEvidence } | { ok: false; error: string } {
  const reads = input.pool.filter((row) => Object.keys(row.figures).length > 0);
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
      evidence: {
        snapshot_id: latest.snapshotId,
        period_label: latest.periodLabel,
        figures: { ...latest.figures },
      },
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
      evidence: {
        snapshot_id: onePeriod ? snapshotOf(readsForPeriod(reads, onePeriod)) : null,
        period_label: onePeriod,
        figures,
      },
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
  if (covering.length !== 1) {
    const labels = [...new Set(reads.map(readLabel))].join(", ");
    return {
      ok: false,
      error: `These figures come from more than one period (${labels}). File them as { period_label: { key: value } } so one snapshot is not stamped on every period.`,
    };
  }
  const winner = covering[0];
  return {
    ok: true,
    evidence: {
      snapshot_id: snapshotOf(winner.rows),
      period_label: winner.rows.find((row) => row.periodLabel)?.periodLabel ?? null,
      figures: winner.figures,
    },
  };
}

function citedNumbers(text: string): number[] {
  const withoutDates = text.replace(/\d{4}-\d{2}-\d{2}/g, " ");
  const matches = withoutDates.match(/-?\d+(?:\.\d+)?/g) ?? [];
  const out: number[] = [];
  for (const raw of matches) {
    if (/^\d{4}$/.test(raw)) {
      const year = Number(raw);
      if (year >= 1900 && year <= 2100) continue;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function periodCarried(
  period: string,
  title: string,
  detail: string,
  figureKeys: string[],
  evidencePeriod: string | null,
): boolean {
  if (evidencePeriod === period) return true;
  if (`${title}\n${detail}`.includes(period)) return true;
  return figureKeys.some((key) => key.includes(period));
}

function evidenceFacts(figures: EvidenceFigures): { keys: string[]; numbers: number[] } {
  const keys: string[] = [];
  const numbers: number[] = [];
  for (const [key, value] of Object.entries(figures)) {
    keys.push(key);
    if (typeof value === "number") {
      if (Number.isFinite(value)) numbers.push(value);
      continue;
    }
    for (const [inner, n] of Object.entries(value)) {
      keys.push(inner);
      keys.push(`${key}:${inner}`);
      if (typeof n === "number" && Number.isFinite(n)) numbers.push(n);
    }
  }
  return { keys, numbers };
}

/**
 * A number in the title or detail that equals a stored figure has to be in
 * the evidence, with the period of that figure. "Dropped from 78 to 69"
 * needs both scores and both periods.
 */
export function citedFiguresCovered(input: {
  title: string;
  detail: string;
  pool: StoredFigures[];
  evidenceFigures: EvidenceFigures;
  evidencePeriod: string | null;
}): { ok: true } | { ok: false; error: string } {
  const text = `${input.title}\n${input.detail}`;
  const cited = citedNumbers(text);
  const evidence = evidenceFacts(input.evidenceFigures);
  const missingValues: string[] = [];
  const missingPeriods: string[] = [];
  const seen = new Set<string>();
  for (const n of cited) {
    const token = String(n);
    if (seen.has(token)) continue;
    seen.add(token);
    const reads = input.pool.filter((row) =>
      Object.values(row.figures).some((value) => figuresClose(n, value)),
    );
    if (reads.length === 0) continue;
    const inEvidence = evidence.numbers.some((value) => figuresClose(n, value));
    if (!inEvidence) {
      missingValues.push(token);
      continue;
    }
    const periods = [...new Set(reads.map((row) => row.periodLabel).filter((p): p is string => Boolean(p)))];
    if (periods.length === 0) continue;
    const carried = periods.some((period) =>
      periodCarried(period, input.title, input.detail, evidence.keys, input.evidencePeriod),
    );
    if (!carried) missingPeriods.push(`${token} (${periods.join(" or ")})`);
  }
  if (missingValues.length === 0 && missingPeriods.length === 0) return { ok: true };
  const parts: string[] = [];
  if (missingValues.length > 0) {
    parts.push(
      `The title or detail cites ${missingValues.join(", ")}, which is on the books, but the finding figures do not include it.`,
    );
  }
  if (missingPeriods.length > 0) {
    parts.push(`The finding cites a stored figure without its period: ${missingPeriods.join("; ")}.`);
  }
  parts.push("Include every cited figure and the period it came from.");
  return { ok: false, error: parts.join(" ") };
}
