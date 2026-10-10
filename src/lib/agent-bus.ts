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

/**
 * A finding may only carry figures that a tool read from stored books.
 * Every claimed number must match some read in the run. The evidence row is
 * the read with the most matches. A recorded finding is not itself a read.
 */
export function groundFindingEvidence(input: {
  pool: StoredFigures[];
  claimedFigures?: Record<string, number> | null;
}):
  | { ok: true; evidence: { snapshot_id: string | null; period_label: string | null; figures: Record<string, number> } }
  | { ok: false; error: string } {
  const reads = input.pool.filter((row) => Object.keys(row.figures).length > 0);
  if (reads.length === 0) {
    return {
      ok: false,
      error: "No stored figures were read. A finding needs evidence from the books on file.",
    };
  }
  const claimed = input.claimedFigures ?? null;
  if (!claimed || Object.keys(claimed).length === 0) {
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

  const matchesByRead = reads.map((row) => {
    const matched: Record<string, number> = {};
    for (const [key, value] of Object.entries(claimed)) {
      const stored = row.figures[key];
      if (typeof stored === "number" && figuresClose(value, stored)) matched[key] = stored;
    }
    return matched;
  });
  let winner = 0;
  for (let i = 1; i < matchesByRead.length; i++) {
    if (Object.keys(matchesByRead[i]).length >= Object.keys(matchesByRead[winner]).length) winner = i;
  }

  const figures: Record<string, number> = {};
  const failed: string[] = [];
  for (const [key, value] of Object.entries(claimed)) {
    let stored: number | undefined = matchesByRead[winner][key];
    if (stored == null) {
      for (let i = matchesByRead.length - 1; i >= 0; i--) {
        if (matchesByRead[i][key] != null) {
          stored = matchesByRead[i][key];
          break;
        }
      }
    }
    if (stored == null) failed.push(`${key}=${value}`);
    else figures[key] = stored;
  }
  if (failed.length > 0) {
    const available = reads.slice(0, 8).map(formatRead).join("; ");
    return {
      ok: false,
      error: `The finding's figures do not match the books that were read. Failed: ${failed.join(", ")}. Available: ${available}.`,
    };
  }
  const best = reads[winner];
  return {
    ok: true,
    evidence: {
      snapshot_id: best.snapshotId,
      period_label: best.periodLabel,
      figures,
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
  figures: Record<string, number>,
  evidencePeriod: string | null,
): boolean {
  if (evidencePeriod === period) return true;
  if (`${title}\n${detail}`.includes(period)) return true;
  return Object.keys(figures).some((key) => key.includes(period));
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
  evidenceFigures: Record<string, number>;
  evidencePeriod: string | null;
}): { ok: true } | { ok: false; error: string } {
  const text = `${input.title}\n${input.detail}`;
  const cited = citedNumbers(text);
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
    const inEvidence = Object.values(input.evidenceFigures).some((value) => figuresClose(n, value));
    if (!inEvidence) {
      missingValues.push(token);
      continue;
    }
    const periods = [...new Set(reads.map((row) => row.periodLabel).filter((p): p is string => Boolean(p)))];
    if (periods.length === 0) continue;
    const carried = periods.some((period) =>
      periodCarried(period, input.title, input.detail, input.evidenceFigures, input.evidencePeriod),
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
