/**
 * App-owned Milonbot loop.
 *
 * Claude returns one decision per turn (a tool, or finish). This module
 * executes or refuses that decision, records the result, and asks again.
 * It does not let the model run an open-ended tool loop.
 *
 * bot_tool_calls is an audit of tool name + hash. It cannot hold an
 * objective, a stop reason, or a verified trace, so a run is a separate
 * record. The loop itself is pure and is what the tests drive.
 */

import { compactJson } from "../../milon-bot/logic.ts";

export const AGENT_MAX_ITERATIONS = 6;
export const AGENT_REPEAT_LIMIT = 3;

export const AGENT_STOP_REASONS = [
  "objective_complete",
  "no_further_action",
  "insufficient_information",
  "tool_blocked",
  "needs_human",
  "safety_limit",
] as const;

export type AgentStopReason = (typeof AGENT_STOP_REASONS)[number];

export const AGENT_OUTCOME_LABELS: Record<AgentStopReason, string> = {
  objective_complete: "Objective complete",
  no_further_action: "No further action",
  insufficient_information: "Not enough information",
  tool_blocked: "Blocked — the action did not happen",
  needs_human: "Needs a person",
  safety_limit: "Stopped at the safety limit",
};

/** Reads, existing draft writers, and two bounded action-plan writes. */
export const AGENT_TOOLS = [
  "get_company",
  "get_financial_snapshot",
  "get_health",
  "get_cash_flow",
  "get_statement_history",
  "list_recommendations",
  "list_prior_outcomes",
  "list_tasks",
  "list_data_requests",
  "get_advisory_position",
  "list_blockers",
  "answer_from_brain",
  "get_invite_status",
  "propose_next_steps",
  "draft_deliverable",
  "create_task_from_recommendation",
  "assign_task",
  "request_human",
] as const;

export type AgentToolName = (typeof AGENT_TOOLS)[number];

export const AGENT_ACT_TOOLS = [
  "propose_next_steps",
  "draft_deliverable",
  "create_task_from_recommendation",
  "assign_task",
] as const;

export const AGENT_TOOL_LABELS: Record<AgentToolName, string> = {
  get_company: "Company",
  get_financial_snapshot: "Statements",
  get_health: "Health",
  get_cash_flow: "Cash flow",
  get_statement_history: "History",
  list_recommendations: "Recommendations",
  list_prior_outcomes: "Prior outcomes",
  list_tasks: "Tasks",
  list_data_requests: "Data requests",
  get_advisory_position: "Advisory position",
  list_blockers: "Blockers",
  answer_from_brain: "Client Brain",
  get_invite_status: "Invite status",
  propose_next_steps: "Draft next steps",
  draft_deliverable: "Draft pack",
  create_task_from_recommendation: "Create task",
  assign_task: "Assign task",
  request_human: "Ask a person",
};

const FORBIDDEN = new Set([
  "send_email",
  "send_message",
  "approve_recommendation",
  "reject_recommendation",
  "mint_invite",
  "write_ledger",
  "post_journal",
  "stripe",
  "update_financials",
]);

export type AgentAudience = "owner" | "accountant";

export type AgentDecision =
  | { kind: "tool"; name: string; args: Record<string, unknown>; why: string }
  | {
      kind: "stop";
      reason: AgentStopReason;
      summary: string;
      escalationReason?: string;
      questions?: string[];
    };

export type AgentStepStatus = "ok" | "empty" | "error" | "refused" | "needs_human";

export type AgentStep = {
  iteration: number;
  tool: string | null;
  label: string;
  why: string;
  status: AgentStepStatus;
  verified: boolean | null;
  happened: boolean;
  detail: string;
  /** Set only for record_finding, so other traces keep the same keys. */
  args?: Record<string, unknown>;
};

export type AgentReasonContext = {
  objective: string;
  audience: AgentAudience;
  iteration: number;
  maxIterations: number;
  transcript: AgentStep[];
  allowedTools: readonly string[];
};

export type AgentReasoner = (ctx: AgentReasonContext) => Promise<AgentDecision>;

export type AgentToolExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export type AgentTraceStep = {
  iteration: number;
  label: string;
  tool: string | null;
  status: AgentStepStatus;
  verified: boolean | null;
  happened: boolean;
  detail: string;
  /** Set only for record_finding. */
  args?: Record<string, unknown>;
};

export type AgentRun = {
  id?: string;
  objective: string;
  audience: AgentAudience;
  status: AgentStopReason;
  outcomeLabel: string;
  summary: string;
  /** Set when the model's own completion claim was replaced. */
  claimRejected: boolean;
  escalationReason: string | null;
  questions: string[];
  steps: AgentStep[];
  trace: AgentTraceStep[];
  tools: Array<{ name: string; status: AgentStepStatus }>;
};

export function isAgentToolName(value: string): value is AgentToolName {
  return (AGENT_TOOLS as readonly string[]).includes(value);
}

export function isAgentStopReason(value: string): value is AgentStopReason {
  return (AGENT_STOP_REASONS as readonly string[]).includes(value);
}

/** Drop self-approval. The recommendation RPC must be called with p_approve false. */
export function sanitizeToolArgs(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...args };
  if (name === "create_task_from_recommendation") {
    delete next.approve;
    delete next.p_approve;
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function classifyResult(
  name: string,
  payload: unknown,
): { status: AgentStepStatus; verified: boolean | null; happened: boolean; detail: string } {
  const rec = isRecord(payload) ? payload : {};
  const err = typeof rec.error === "string" ? rec.error.trim() : "";
  const needsHuman = rec.needs_human === true || /must be approved/i.test(err);

  if (needsHuman) {
    return {
      status: "needs_human",
      verified: false,
      happened: false,
      detail: err || "A person needs to decide before this can continue.",
    };
  }
  if (err) {
    return { status: "error", verified: false, happened: false, detail: err };
  }

  if (name === "create_task_from_recommendation") {
    const happened =
      rec.created === true && rec.verified === true && typeof rec.action_item_id === "string";
    return {
      status: happened ? "ok" : "error",
      verified: happened,
      happened,
      detail: happened
        ? `Task ${String(rec.action_item_id)} is on the action plan.`
        : "The task was not created. The tool did not verify a row.",
    };
  }

  if (name === "assign_task") {
    const happened = rec.assigned === true && rec.verified === true;
    return {
      status: happened ? "ok" : "error",
      verified: happened,
      happened,
      detail: happened
        ? "Assignment verified. No email was sent."
        : "The assignment was not verified, so it did not happen.",
    };
  }

  if (name === "propose_next_steps") {
    const inserted = typeof rec.stepsInserted === "number" ? rec.stepsInserted : 0;
    const happened = inserted > 0;
    return {
      status: happened ? "ok" : "empty",
      verified: happened,
      happened,
      detail: happened
        ? `Drafted ${inserted} next step(s). They are not approved.`
        : "No new draft steps were saved.",
    };
  }

  if (name === "draft_deliverable") {
    const happened = rec.draftInserted === true;
    return {
      status: happened ? "ok" : "empty",
      verified: happened,
      happened,
      detail: happened ? "Draft pack saved. It was not sent." : "No draft pack was saved.",
    };
  }

  if (rec.empty === true) {
    return {
      status: "empty",
      verified: null,
      happened: false,
      detail: "Nothing on file for that.",
    };
  }

  return {
    status: "ok",
    verified: null,
    happened: false,
    detail: compactJson(payload, 500) || "Read completed.",
  };
}

function failedAct(step: AgentStep): boolean {
  if (!step.tool || !(AGENT_ACT_TOOLS as readonly string[]).includes(step.tool)) return false;
  if (step.status === "empty") return false;
  return step.happened !== true;
}

/**
 * The model may say the objective is done. MILŌN only accepts that when
 * every consequential action in the trace actually verified.
 */
export function reconcileStop(
  steps: AgentStep[],
  decision: Extract<AgentDecision, { kind: "stop" }>,
): {
  decision: Extract<AgentDecision, { kind: "stop" }>;
  claimRejected: boolean;
} {
  const broken = steps.some(failedAct);
  const anyEvidence = steps.some((s) => s.status === "ok" || s.happened);
  const closing =
    decision.reason === "objective_complete" || decision.reason === "no_further_action";

  if (closing && broken) {
    const human = steps.some((s) => s.status === "needs_human");
    return {
      claimRejected: true,
      decision: {
        kind: "stop",
        reason: human ? "needs_human" : "tool_blocked",
        summary: human
          ? "Stopped. A person still has to decide, and the action did not happen."
          : "Stopped. The action was not verified, so it did not happen.",
        escalationReason: human
          ? decision.escalationReason ||
            "Approval is still required. Milonbot will not approve a recommendation itself."
          : decision.escalationReason,
        questions: decision.questions,
      },
    };
  }

  if (decision.reason === "objective_complete" && !anyEvidence) {
    return {
      claimRejected: true,
      decision: {
        kind: "stop",
        reason: "insufficient_information",
        summary: "Stopped. Nothing was read or verified, so the objective is not complete.",
        escalationReason: decision.escalationReason,
        questions: decision.questions,
      },
    };
  }

  return { decision, claimRejected: false };
}

function asQuestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.trim().slice(0, 240))
    .slice(0, 5);
}

function stableArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of keys) sorted[key] = args[key];
  return JSON.stringify(sorted);
}

function toRun(
  input: { objective: string; audience: AgentAudience },
  steps: AgentStep[],
  decision: Extract<AgentDecision, { kind: "stop" }>,
  claimRejected: boolean,
): AgentRun {
  const trace: AgentTraceStep[] = steps.map((s) => {
    const row: AgentTraceStep = {
      iteration: s.iteration,
      label: s.label,
      tool: s.tool,
      status: s.status,
      verified: s.verified,
      happened: s.happened,
      detail: s.detail,
    };
    if (s.tool === "record_finding" && s.args) row.args = s.args;
    return row;
  });
  return {
    objective: input.objective,
    audience: input.audience,
    status: decision.reason,
    outcomeLabel: AGENT_OUTCOME_LABELS[decision.reason],
    summary: decision.summary.trim() || AGENT_OUTCOME_LABELS[decision.reason],
    claimRejected,
    escalationReason: decision.escalationReason?.trim() || null,
    questions: decision.questions ?? [],
    steps,
    trace,
    tools: steps
      .filter((s) => s.tool && s.tool !== "request_human")
      .map((s) => ({ name: s.tool as string, status: s.status })),
  };
}

function pushStep(steps: AgentStep[], step: AgentStep) {
  steps.push(step);
}

function toolLabel(name: string, labels?: Readonly<Record<string, string>>): string {
  if (labels && labels[name]) return labels[name];
  if (isAgentToolName(name)) return AGENT_TOOL_LABELS[name];
  return name;
}

export async function runAgentLoop(input: {
  objective: string;
  audience: AgentAudience;
  reason: AgentReasoner;
  execute: AgentToolExecutor;
  maxIterations?: number;
  /** Defaults to AGENT_TOOLS. Milonbot omits this, so its allow-list is unchanged. */
  allowedTools?: readonly string[];
  toolLabels?: Readonly<Record<string, string>>;
  /** Milonbot leaves this unset. A caller that sets it handles model failures itself. */
  rethrowReasonerErrors?: boolean;
}): Promise<AgentRun> {
  const max = input.maxIterations ?? AGENT_MAX_ITERATIONS;
  const allowed = new Set<string>(input.allowedTools ?? AGENT_TOOLS);
  const steps: AgentStep[] = [];
  const seen = new Map<string, number>();
  let refusalsInARow = 0;

  const stop = (
    decision: Extract<AgentDecision, { kind: "stop" }>,
    claimRejected = false,
  ): AgentRun => toRun(input, steps, decision, claimRejected);

  for (let iteration = 1; iteration <= max; iteration++) {
    let decision: AgentDecision;
    try {
      decision = await input.reason({
        objective: input.objective,
        audience: input.audience,
        iteration,
        maxIterations: max,
        transcript: steps,
        allowedTools: input.allowedTools ?? AGENT_TOOLS,
      });
    } catch (e) {
      if (input.rethrowReasonerErrors) throw e;
      return stop({
        kind: "stop",
        reason: "safety_limit",
        summary:
          "Stopped because the reasoning step failed. No unverified action is treated as done.",
        escalationReason: (e as Error).message || "Reasoning failed",
      });
    }

    if (!decision || (decision.kind !== "tool" && decision.kind !== "stop")) {
      return stop({
        kind: "stop",
        reason: "safety_limit",
        summary: "Stopped because the reasoning step did not return a decision.",
      });
    }

    if (decision.kind === "stop") {
      if (!isAgentStopReason(decision.reason)) {
        decision = {
          ...decision,
          reason: "insufficient_information",
          summary: decision.summary || "Stopped. The stop reason was not one MILŌN accepts.",
        };
      }
      const reconciled = reconcileStop(steps, decision);
      return stop(reconciled.decision, reconciled.claimRejected);
    }

    const requested = decision.name.trim();
    if (!allowed.has(requested) || FORBIDDEN.has(requested)) {
      refusalsInARow += 1;
      pushStep(steps, {
        iteration,
        tool: requested || "unknown",
        label: "Refused",
        why: decision.why,
        status: "refused",
        verified: false,
        happened: false,
        detail: "MILŌN refused that tool. It is not on the allowlist.",
      });
      if (refusalsInARow >= 2) {
        return stop({
          kind: "stop",
          reason: "safety_limit",
          summary: "Stopped after repeated tools MILŌN will not run.",
        });
      }
      continue;
    }

    refusalsInARow = 0;

    if (requested === "request_human") {
      const reason = typeof decision.args.reason === "string" ? decision.args.reason.trim() : "";
      if (!reason) {
        pushStep(steps, {
          iteration,
          tool: requested,
          label: toolLabel(requested, input.toolLabels),
          why: decision.why,
          status: "error",
          verified: false,
          happened: false,
          detail: "A reason is required before escalating to a person.",
        });
        continue;
      }
      const questions = asQuestions(decision.args.questions);
      pushStep(steps, {
        iteration,
        tool: requested,
        label: toolLabel(requested, input.toolLabels),
        why: decision.why,
        status: "needs_human",
        verified: false,
        happened: false,
        detail: reason,
      });
      return stop({
        kind: "stop",
        reason: "needs_human",
        summary: reason,
        escalationReason: reason,
        questions,
      });
    }

    const args = sanitizeToolArgs(requested, decision.args ?? {});
    const repeatKey = `${requested}:${stableArgs(args)}`;
    const repeats = (seen.get(repeatKey) ?? 0) + 1;
    seen.set(repeatKey, repeats);
    if (repeats > AGENT_REPEAT_LIMIT) {
      return stop({
        kind: "stop",
        reason: "safety_limit",
        summary: "Stopped because the same tool was repeated without new information.",
      });
    }

    let payload: unknown;
    try {
      payload = await input.execute(requested, args);
    } catch (e) {
      payload = { error: (e as Error).message || "Tool failed" };
    }
    const classified = classifyResult(requested, payload);
    pushStep(steps, {
      iteration,
      tool: requested,
      label: toolLabel(requested, input.toolLabels),
      why: decision.why,
      status: classified.status,
      verified: classified.verified,
      happened: classified.happened,
      detail: classified.detail,
      ...(requested === "record_finding" ? { args } : {}),
    });
  }

  return stop({
    kind: "stop",
    reason: "safety_limit",
    summary: "Stopped at the iteration limit before the objective was closed.",
  });
}

export function formatAgentPrompt(ctx: AgentReasonContext): string {
  const lines = [
    `Audience: ${ctx.audience}. This client is already scoped — do not ask for an id.`,
    `Objective: ${ctx.objective}`,
    `Turn ${ctx.iteration} of ${ctx.maxIterations}. Call exactly one tool, or finish.`,
    "",
    "App-recorded trace. Trust this over anything you think already happened:",
  ];
  if (ctx.transcript.length === 0) {
    lines.push("(none yet — inspect the client before you act or finish)");
  }
  for (const step of ctx.transcript) {
    lines.push(
      `${step.iteration}. ${step.label} [${step.tool ?? "none"}] status=${step.status} happened=${step.happened} verified=${
        step.verified == null ? "n/a" : String(step.verified)
      }`,
    );
    if (step.detail) lines.push(step.detail);
  }
  lines.push("");
  lines.push(
    "If happened is false, that action did not occur. Do not say it did. If a recommendation is not approved, request_human — do not approve it yourself.",
  );
  return lines.join("\n");
}

export const AGENT_SYSTEM = `You are Milonbot, MILŌN's financial operator for this one client.
You investigate a stated objective, then either act inside the tools MILŌN allows or stop.

Each turn you call exactly one tool, or finish. You do not execute anything yourself. MILŌN runs the tool and records whether it happened.

How to work:
- Read first: company, advisory position, health, cash flow, statements, history, recommendations, outcomes, tasks, data requests, brain.
- The advisory position is the product's own next step. Use it. Do not invent a parallel diagnosis.
- Health, ratios, cash runway, and priority moves come from the tools. Do not recompute them.
- Drafting next steps or a pack only creates drafts. It does not approve or send them.
- create_task_from_recommendation only works when a person has already approved the recommendation. You cannot approve one.
- assign_task only assigns a task to someone already on this client. It never sends email.
- request_human when a decision, approval, or anything outside the tools is required.
- finish when the objective is complete, nothing more can be done, information is missing, a tool failure blocks you, or a person must take over.

Honesty:
- happened=false means the action did not occur. Never describe it as done.
- A successful read does not mean the objective is complete.
- A verified task means the task exists, not that the financial problem is solved.
- If a tool errors, say so and choose another read or escalate. Do not paper over it.

Never send email, mint invites, post to the ledger, or touch billing.`;

export function decisionFromClaude(input: {
  text: string;
  toolUses: Array<{ name: string; input: Record<string, unknown> }>;
}): AgentDecision {
  const use = input.toolUses[0];
  if (!use) {
    return {
      kind: "stop",
      reason: "insufficient_information",
      summary: input.text.trim() || "No decision was returned.",
    };
  }
  if (use.name === "finish") {
    const reasonRaw = typeof use.input.reason === "string" ? use.input.reason : "";
    const reason = isAgentStopReason(reasonRaw) ? reasonRaw : "insufficient_information";
    const summary =
      (typeof use.input.summary === "string" && use.input.summary.trim()) ||
      input.text.trim() ||
      AGENT_OUTCOME_LABELS[reason];
    const escalation =
      typeof use.input.escalation_reason === "string" ? use.input.escalation_reason.trim() : "";
    return {
      kind: "stop",
      reason,
      summary,
      escalationReason: escalation || undefined,
      questions: asQuestions(use.input.questions),
    };
  }
  return {
    kind: "tool",
    name: use.name,
    args: use.input,
    why: input.text.trim(),
  };
}

type ClaudeTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

const EMPTY = { type: "object", properties: {}, additionalProperties: false };

export function agentClaudeTools(): ClaudeTool[] {
  return [
    {
      name: "get_company",
      description:
        "Client name, type, advisory state, whether a firm is attached, and people on the client (id, name, role). No email addresses.",
      input_schema: EMPTY,
    },
    {
      name: "get_financial_snapshot",
      description:
        "Latest statement period, bounded ratios, and a short list of statement totals. Does not return the raw upload.",
      input_schema: EMPTY,
    },
    {
      name: "get_health",
      description:
        "Health pillars and priority moves from the existing ratio scorer. Includes stored cash runway weeks.",
      input_schema: EMPTY,
    },
    {
      name: "get_cash_flow",
      description:
        "13-week cash position: runway weeks, lowest week, trajectory. Amounts are omitted.",
      input_schema: EMPTY,
    },
    {
      name: "get_statement_history",
      description: "Recent statement periods and a few ratios each. For trend, not a full archive.",
      input_schema: EMPTY,
    },
    {
      name: "list_recommendations",
      description:
        "Prior and open recommendations: status, priority, problem, expected impact, and whether a task already exists. Status proposed means a person has not decided.",
      input_schema: EMPTY,
    },
    {
      name: "list_prior_outcomes",
      description:
        "Measured outcomes of past recommendations (expected vs actual). Empty if none have been measured.",
      input_schema: EMPTY,
    },
    {
      name: "list_tasks",
      description:
        "Open action-plan tasks with ids, status, due date, and assignee. Use an id with assign_task.",
      input_schema: EMPTY,
    },
    {
      name: "list_data_requests",
      description: "Open asks for missing documents or figures.",
      input_schema: EMPTY,
    },
    {
      name: "get_advisory_position",
      description:
        "The product's advisory state and the one next step resolveNextStep would show this audience. Read this before deciding what to do.",
      input_schema: EMPTY,
    },
    {
      name: "list_blockers",
      description: "Unanswered Client Brain questions.",
      input_schema: EMPTY,
    },
    {
      name: "answer_from_brain",
      description:
        "Context facts, brain summary, and the latest ratio snapshot. Missing fields stay empty.",
      input_schema: {
        type: "object",
        properties: { topic: { type: "string" } },
        additionalProperties: false,
      },
    },
    {
      name: "get_invite_status",
      description: "Owner-handoff invite status. Never returns a token.",
      input_schema: EMPTY,
    },
    {
      name: "propose_next_steps",
      description: "Call the existing brain-propose function. Drafts only. Never approves.",
      input_schema: EMPTY,
    },
    {
      name: "draft_deliverable",
      description: "Call the existing brain-deliverable-draft function. Draft only. Never sends.",
      input_schema: EMPTY,
    },
    {
      name: "create_task_from_recommendation",
      description:
        "Create an action-plan task from a recommendation that is already approved or edited. Fails closed if it is still proposed. Does not approve it.",
      input_schema: {
        type: "object",
        properties: {
          recommendationId: { type: "string" },
          title: { type: "string" },
          dueDate: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["recommendationId"],
        additionalProperties: false,
      },
    },
    {
      name: "assign_task",
      description:
        "Set the assignee on an existing task to a person already returned by get_company. Does not send email.",
      input_schema: {
        type: "object",
        properties: {
          actionItemId: { type: "string" },
          employeeId: { type: "string" },
        },
        required: ["actionItemId", "employeeId"],
        additionalProperties: false,
      },
    },
    {
      name: "request_human",
      description:
        "Stop and escalate. Use for approvals and any decision you are not allowed to make. Does not approve, reject, or email.",
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string" },
          questions: { type: "array", items: { type: "string" } },
          recommendationId: { type: "string" },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
    {
      name: "finish",
      description:
        "Stop the loop. reason is one of objective_complete, no_further_action, insufficient_information, tool_blocked, needs_human, safety_limit.",
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string" },
          summary: { type: "string" },
          escalation_reason: { type: "string" },
          questions: { type: "array", items: { type: "string" } },
        },
        required: ["reason", "summary"],
        additionalProperties: false,
      },
    },
  ];
}
