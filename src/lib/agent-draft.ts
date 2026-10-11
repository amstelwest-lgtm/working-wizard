/**
 * Draft writes for the Financial Manager and the Advisor.
 *
 * Drafts are rows in agent_findings, not data_requests, proposed_next_steps,
 * or deliverable_drafts. data_requests open as live asks and can be emailed.
 * proposed_next_steps can be signed off. deliverable_drafts show in the
 * studio without the cited-number, period, and dismissed checks. A finding
 * stays a draft (evidence.draft, evidence.requires_human_approval) until a
 * person approves it. Nothing here sends email or marks a pack signed off.
 */
import {
  attachCitedEvidence,
  groundFindingEvidence,
  type FindingEvidence,
  type StoredFigures,
} from "./agent-bus.ts";
import { findingRecordKey } from "./agent-analyst.ts";

/** Hard cap for one Financial Manager or Advisor run. Do not start a call that would pass this. */
export const RUNNER_COST_CEILING_USD = 0.06;
/** A normal 2–3 turn run, including one draft, is sized to stay at or under this. */
export const RUNNER_COST_TARGET_USD = 0.05;
/** Per-call output cap. 500 cut record_draft off after the title. */
export const RUNNER_MAX_OUTPUT_TOKENS = 2000;
/** Detail the model is asked to write. Short enough to finish inside the output cap. */
export const DRAFT_DETAIL_MAX_CHARS = 600;

/**
 * Token envelope for a normal three-turn run: one cache write, then cache
 * reads, plus one draft reply. Priced with the Sonnet 5.5 rates in the
 * runner test. It stays at or under the $0.05 target.
 */
export const RUNNER_TOKEN_ENVELOPE = {
  uncachedInputTokens: 8_000,
  outputTokens: 2_400,
  cacheWriteTokens: 3_000,
  cacheReadTokens: 6_000,
} as const;

export const DRAFT_SEVERITIES = ["info", "watch", "act"] as const;

export const AGENT_OUTBOUND_TYPES = ["request", "handoff", "answer", "ack"] as const;
export type AgentOutboundType = (typeof AGENT_OUTBOUND_TYPES)[number];

const SIGNED_OFF = /\b(signed[\s-]*off|sign[\s-]*off)\b/i;

export function draftClaimsSignedOff(parts: readonly string[]): boolean {
  return parts.some((part) => SIGNED_OFF.test(part));
}

function roundUsd(amount: number): number {
  return Math.round(amount * 100_000) / 100_000;
}

/**
 * Last call's cost is the proxy for the next one. Stop before that next
 * call would take the run over the ceiling.
 */
export function runnerNextCallExceedsCeiling(input: {
  spentUsd: number;
  lastCallUsd: number;
  ceilingUsd?: number;
}): boolean {
  const ceiling = input.ceilingUsd ?? RUNNER_COST_CEILING_USD;
  return roundUsd(input.spentUsd + Math.max(0, input.lastCallUsd)) > ceiling;
}

export const CUT_OFF_DRAFT_RESULT =
  "The draft was cut off before detail finished. Resend record_draft with a shorter detail of at most 600 characters.";

/** A max_tokens stop left record_draft without a detail. Do not treat that as a missing field. */
export function recordDraftWasCutOff(input: {
  stopReason: string;
  name: string;
  args: Record<string, unknown>;
}): boolean {
  if (input.stopReason !== "max_tokens") return false;
  if (input.name !== "record_draft") return false;
  const detail = typeof input.args.detail === "string" ? input.args.detail.trim() : "";
  return detail.length === 0;
}

/** Draft kinds a person approves. They are not handed to another bot. */
const HUMAN_APPROVER_DRAFT_KINDS = new Set([
  "action_point_draft",
  "data_request_draft",
  "accountant_handoff_draft",
]);

export type DraftBotKey = "financial_manager" | "analyst" | "advisor";

export type DraftRecipient = {
  toAgent: DraftBotKey | null;
  /** True when a supplied value was not a peer bot key and was dropped. */
  normalised: boolean;
};

/**
 * Missing or invalid to_agent uses the default. It is not a rejection.
 * Financial Manager drafts for a person stay with no bot recipient.
 * A Financial Manager next move goes to the Advisor.
 * An Advisor draft goes to the Financial Manager.
 */
export function defaultDraftRecipient(agent: "financial_manager" | "advisor", kind: string): DraftBotKey | null {
  if (agent === "advisor") return "financial_manager";
  if (HUMAN_APPROVER_DRAFT_KINDS.has(kind)) return null;
  return "advisor";
}

export function resolveDraftRecipient(input: {
  agent: "financial_manager" | "advisor";
  kind: string;
  toAgent: unknown;
  peers: readonly string[];
}): DraftRecipient {
  const raw = typeof input.toAgent === "string" ? input.toAgent.trim() : "";
  if (raw && input.peers.includes(raw)) {
    return { toAgent: raw as DraftBotKey, normalised: false };
  }
  return {
    toAgent: defaultDraftRecipient(input.agent, input.kind),
    normalised: raw.length > 0,
  };
}

/**
 * Once a draft is on file, the next turn does not call the model.
 * Same finish as the Analyst after a finding: the run is complete.
 */
export function runnerEarlyFinish(draftsRecorded: number): {
  reason: "objective_complete";
  summary: string;
} | null {
  if (draftsRecorded < 1) return null;
  return {
    reason: "objective_complete",
    summary: "Drafts are recorded. A person approves them before anything is sent.",
  };
}

export function draftMessageType(kind: string): "request" | "handoff" {
  if (kind === "data_request_draft") return "request";
  return "handoff";
}

export type DraftEvidence = FindingEvidence & {
  draft: true;
  requires_human_approval: true;
};

export function withDraftFlags(evidence: FindingEvidence): DraftEvidence {
  return { ...evidence, draft: true, requires_human_approval: true };
}

export function prepareDraftRecord(input: {
  kind: string;
  allowedKinds: readonly string[];
  severity: string;
  title: string;
  detail: string;
  claimedFigures: unknown;
  pool: StoredFigures[];
  recordedKeys: ReadonlySet<string>;
}):
  | {
      ok: true;
      kind: string;
      severity: string;
      title: string;
      detail: string;
      evidence: DraftEvidence;
      warning?: string;
      recordKeys: string[];
    }
  | { ok: false; error: string; tool_blocked?: boolean } {
  const title = input.title.trim().slice(0, 200);
  const detail = input.detail.trim().slice(0, 2000);
  const kind = input.kind.trim();
  const severity = input.severity.trim();
  if (!title) return { ok: false, error: "A draft needs a title." };
  if (!detail) return { ok: false, error: "A draft needs a detail." };
  if (!(input.allowedKinds as readonly string[]).includes(kind)) {
    return { ok: false, error: `kind must be one of: ${input.allowedKinds.join(", ")}.` };
  }
  if (draftClaimsSignedOff([kind, title, detail])) {
    return {
      ok: false,
      error: "Signed off is accountant-only. This draft was not saved.",
      tool_blocked: true,
    };
  }
  if (!(DRAFT_SEVERITIES as readonly string[]).includes(severity)) {
    return { ok: false, error: "Severity must be info, watch, or act." };
  }
  const grounded = groundFindingEvidence({ pool: input.pool, claimedFigures: input.claimedFigures });
  if (!grounded.ok) return { ok: false, error: grounded.error, tool_blocked: true };
  const cited = attachCitedEvidence({
    title,
    detail,
    pool: input.pool,
    evidence: grounded.evidence,
  });
  if (!cited.ok) return { ok: false, error: cited.error, tool_blocked: true };
  const evidence = withDraftFlags(cited.evidence);
  const recordKeys = [
    findingRecordKey({
      kind,
      periodLabel: grounded.evidence.period_label,
      snapshotId: grounded.evidence.snapshot_id,
    }),
    findingRecordKey({
      kind,
      periodLabel: evidence.period_label,
      snapshotId: evidence.snapshot_id,
    }),
  ];
  if (recordKeys.some((key) => input.recordedKeys.has(key))) {
    return { ok: false, error: "Already recorded, call finish.", tool_blocked: true };
  }
  return {
    ok: true,
    kind,
    severity,
    title,
    detail,
    evidence,
    recordKeys,
    ...(cited.warning ? { warning: cited.warning } : {}),
  };
}

export function periodsFromFindingEvidence(evidence: unknown): Array<{
  period_label: string | null;
  snapshot_id: string | null;
  figures: Record<string, number>;
}> {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
  const row = evidence as Record<string, unknown>;
  const snapshotId = typeof row.snapshot_id === "string" ? row.snapshot_id : null;
  const periodLabel = typeof row.period_label === "string" ? row.period_label : null;
  const figures = row.figures;
  if (!figures || typeof figures !== "object" || Array.isArray(figures)) return [];
  const flat: Record<string, number> = {};
  const nested: Array<{ period_label: string; figures: Record<string, number> }> = [];
  for (const [key, value] of Object.entries(figures as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      flat[key] = value;
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const inner: Record<string, number> = {};
    for (const [innerKey, n] of Object.entries(value as Record<string, unknown>)) {
      if (typeof n === "number" && Number.isFinite(n)) inner[innerKey] = n;
    }
    if (Object.keys(inner).length > 0) nested.push({ period_label: key, figures: inner });
  }
  const out: Array<{ period_label: string | null; snapshot_id: string | null; figures: Record<string, number> }> = [];
  if (Object.keys(flat).length > 0) {
    out.push({ period_label: periodLabel, snapshot_id: snapshotId, figures: flat });
  }
  for (const item of nested) {
    out.push({ period_label: item.period_label, snapshot_id: null, figures: item.figures });
  }
  return out;
}

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false };

const FIGURES_SCHEMA = {
  type: "object",
  additionalProperties: {
    anyOf: [{ type: "number" }, { type: "object", additionalProperties: { type: "number" } }],
  },
  description:
    "A flat map of numbers from one snapshot, or period labels whose values are number maps. Copy the evidence keys from the read.",
};

export function readToolSchema(name: string, description: string) {
  return { name, description, input_schema: EMPTY_SCHEMA };
}

export function recordDraftToolSchema(kinds: readonly string[], peers: readonly string[]) {
  return {
    name: "record_draft",
    description:
      "Save one draft for a person to approve. Nothing is emailed or sent. figures must match numbers a read tool returned. Signed off is accountant-only.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [...kinds],
          description: kinds.join(", "),
        },
        severity: {
          type: "string",
          enum: [...DRAFT_SEVERITIES],
          description:
            "info: a stored fact, no action. watch: the books are drifting. act: the stored figures need a decision soon.",
        },
        title: { type: "string", minLength: 1, maxLength: 200 },
        detail: {
          type: "string",
          minLength: 1,
          maxLength: DRAFT_DETAIL_MAX_CHARS,
          description: "Required. At most 600 characters. Comes before figures. Books on file only. Do not say signed off.",
        },
        figures: FIGURES_SCHEMA,
        to_agent: {
          type: "string",
          enum: [...peers],
          description:
            "Optional bot key. Never the accountant or the owner. Human approval is implied by draft=true. Omit it to use the default recipient.",
        },
      },
      required: ["kind", "severity", "title", "detail"],
      additionalProperties: false,
    },
  };
}

export function sendMessageToolSchema(peers: readonly string[]) {
  return {
    name: "send_agent_message",
    description:
      "Tell one other bot about this client. Does not send email and does not create a task or a data request.",
    input_schema: {
      type: "object",
      properties: {
        to_agent: { type: "string", enum: [...peers] },
        type: { type: "string", enum: [...AGENT_OUTBOUND_TYPES] },
        body: { type: "string", minLength: 1, maxLength: 2000 },
      },
      required: ["to_agent", "type", "body"],
      additionalProperties: false,
    },
  };
}

export function finishToolSchema() {
  return {
    name: "finish",
    description:
      "Stop. reason is one of objective_complete, no_further_action, insufficient_information, tool_blocked, needs_human, safety_limit.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        summary: { type: "string" },
      },
      required: ["reason", "summary"],
      additionalProperties: false,
    },
  };
}
