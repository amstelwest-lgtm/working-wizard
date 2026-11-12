/**
 * Routine drafts for steps Milōn already covers.
 * A cadence is a label. Nothing is enqueued. No form is filled.
 */
import { analystRunCostUsd } from "@/lib/agent-analyst";
import { CLAUDE_OPUS_55, CLAUDE_SONNET_55, modelForAgent } from "@/lib/claude-request";
import type { PracticePlanStep } from "@/lib/setup-partner-plan";

export const IM_ROUTINE_KIND = "im_routine_proposal";

/** Locked default. Shown next to the cost. Not a field the firm can raise. */
export const ROUTINE_RUNS_PER_FIRM_MONTH = 20;

export const ROUTINE_EXAMPLE_INPUT_TOKENS = 8000;
export const ROUTINE_EXAMPLE_OUTPUT_TOKENS = 1000;

const FORM_FILL_RE = /\b(irp6|itr14|itr12|efiling|e-filing)\b/i;

export type RoutineAgent = "financial_manager" | "analyst" | "advisor";
export type RoutineCadence = "weekly" | "monthly";

export type RoutineProposal = {
  dedupeKey: string;
  agent: RoutineAgent;
  cadence: RoutineCadence;
  model: string;
  costUsd: number;
  costLabel: string;
  capUsd: number;
  title: string;
  detail: string;
  evidence: {
    figures: { monthlyRunCap: number; estimatedCostUsd: number };
    model: string;
    costLabel: string;
    cadence: RoutineCadence;
    scheduled: false;
    dedupeKey: string;
    step: string;
  };
};

export function routineAgent(step: PracticePlanStep): RoutineAgent | null {
  const blob = `${step.step} ${step.capability} ${step.covers}`;
  if (FORM_FILL_RE.test(blob) || /\btax\b/i.test(blob)) return null;
  if (step.bucket !== "covered") return null;
  const owner = `${step.capability} ${step.covers}`.toLowerCase();
  if (owner.includes("financial manager") || owner.includes("financial-manager")) return "financial_manager";
  if (owner.includes("analyst")) return "analyst";
  if (owner.includes("advisor")) return "advisor";
  return null;
}

export function routineCadence(step: PracticePlanStep): RoutineCadence {
  return step.step_type === "deadlines" ? "weekly" : "monthly";
}

/** Listed model only. Financial Manager is Opus. No override is accepted. */
export function routineModel(agent: RoutineAgent): string {
  return modelForAgent(agent);
}

export function routineCostUsd(agent: RoutineAgent): number {
  return analystRunCostUsd(
    ROUTINE_EXAMPLE_INPUT_TOKENS,
    ROUTINE_EXAMPLE_OUTPUT_TOKENS,
    0,
    0,
    routineModel(agent),
  );
}

export function routineCostLabel(agent: RoutineAgent): string {
  const model = routineModel(agent);
  const name = model === CLAUDE_OPUS_55 ? "Opus 5.5" : "Sonnet 5.5";
  return `${name}, about $${routineCostUsd(agent).toFixed(3)} a run`;
}

export function routineCapUsd(agent: RoutineAgent): number {
  return Math.round(routineCostUsd(agent) * ROUTINE_RUNS_PER_FIRM_MONTH * 100) / 100;
}

export function routineProposals(steps: readonly PracticePlanStep[]): RoutineProposal[] {
  const seen = new Set<string>();
  const proposals: RoutineProposal[] = [];
  for (const step of steps) {
    const agent = routineAgent(step);
    if (!agent || seen.has(step.dedupe_key)) continue;
    seen.add(step.dedupe_key);
    const cadence = routineCadence(step);
    const model = routineModel(agent);
    const costUsd = routineCostUsd(agent);
    const costLabel = routineCostLabel(agent);
    const capUsd = routineCapUsd(agent);
    proposals.push({
      dedupeKey: step.dedupe_key,
      agent,
      cadence,
      model,
      costUsd,
      costLabel,
      capUsd,
      title: `Routine: ${step.step}`.slice(0, 180),
      detail: `${step.covers}. Labelled ${cadence}. ${costLabel}. Locked cap: ${ROUTINE_RUNS_PER_FIRM_MONTH} routine runs a month, about $${capUsd.toFixed(2)}. Not scheduled.`,
      evidence: {
        figures: { monthlyRunCap: ROUTINE_RUNS_PER_FIRM_MONTH, estimatedCostUsd: costUsd },
        model,
        costLabel,
        cadence,
        scheduled: false,
        dedupeKey: step.dedupe_key,
        step: step.step,
      },
    });
  }
  return proposals;
}

export function routineIdempotencyKey(clientId: string, dedupeKey: string): string {
  return `im-routine:${clientId}:${dedupeKey}`;
}

export function routineRunInsert(input: {
  proposal: RoutineProposal;
  clientId: string;
  firmId: string;
  finishedAt: string;
}): Record<string, unknown> {
  const key = routineIdempotencyKey(input.clientId, input.proposal.dedupeKey);
  return {
    agent: input.proposal.agent,
    client_id: input.clientId,
    firm_id: input.firmId,
    trigger: "on_demand",
    audience: "accountant",
    idempotency_key: key,
    input_hash: key,
    status: "skipped",
    stop_reason: "proposal_only",
    summary: `${input.proposal.costLabel}. Proposal only. Not scheduled.`,
    cost_usd: input.proposal.costUsd,
    finished_at: input.finishedAt,
  };
}

export function routineFindingInsert(input: {
  proposal: RoutineProposal;
  clientId: string;
  runId: string;
}): Record<string, unknown> {
  return {
    agent: input.proposal.agent,
    client_id: input.clientId,
    run_id: input.runId,
    kind: IM_ROUTINE_KIND,
    severity: "info",
    title: input.proposal.title,
    detail: input.proposal.detail,
    evidence: input.proposal.evidence,
  };
}
