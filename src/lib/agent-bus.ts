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
  let periodLabel = evidence.period_label;
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
    .replace(/\b\d+(?:\.\d+)?\s*-\s*days?\b/gi, " ")
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
  /(?:[R$£€]\s*)?-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s*[kmb]\b)?|(?:[R$£€]\s*)?-?\d+(?:\.\d+)?(?:\s*[kmb]\b)?/gi;

function scaleOfSuffix(suffix: string): number {
  if (suffix === "k") return 1_000;
  if (suffix === "m") return 1_000_000;
  if (suffix === "b") return 1_000_000_000;
  return 1;
}

/** `412k`, `R412k`, and `$0.4m` become the stored-figure scale. `412,000` stays one number. */
export function citedNumbers(text: string): CitedNumber[] {
  const matches = stripCitationNoise(text).match(CITED_NUMBER) ?? [];
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
