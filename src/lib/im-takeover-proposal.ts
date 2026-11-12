/**
 * Takeover drafts for a confirmed practice map.
 * Stored later as agent_findings. Nothing is scheduled and no form is filled.
 */
import { analystRunCostUsd } from "@/lib/agent-analyst";
import { CLAUDE_OPUS_55, CLAUDE_SONNET_55, modelForAgent } from "@/lib/claude-request";
import type { PracticePlanStep } from "@/lib/setup-partner-plan";

export const IM_TAKEOVER_KIND = "im_takeover_proposal";

/** Token shape used to label a proposal. Not a live model call. */
export const PROPOSAL_EXAMPLE_INPUT_TOKENS = 8000;
export const PROPOSAL_EXAMPLE_OUTPUT_TOKENS = 1000;

const FORM_FILL_RE = /\b(irp6|itr14|itr12|efiling|e-filing)\b/i;

export type ProposalAgent = "financial_manager" | "analyst" | "advisor";

export type TakeoverProposal = {
  dedupeKey: string;
  agent: ProposalAgent;
  model: string;
  costUsd: number;
  costLabel: string;
  title: string;
  detail: string;
  evidence: {
    figures: { proposal: number; estimatedCostUsd: number };
    model: string;
    costLabel: string;
    scheduled: false;
    dedupeKey: string;
    step: string;
  };
};

export function proposalAgent(step: PracticePlanStep): ProposalAgent {
  const blob = `${step.capability} ${step.covers}`.toLowerCase();
  if (blob.includes("financial manager") || blob.includes("financial-manager")) return "financial_manager";
  if (blob.includes("analyst")) return "analyst";
  return "advisor";
}

/** The priced model for that agent. Financial Manager is Opus. Nothing else is. */
export function proposalModel(agent: ProposalAgent): string {
  return modelForAgent(agent);
}

export function proposalCostUsd(agent: ProposalAgent): number {
  return analystRunCostUsd(
    PROPOSAL_EXAMPLE_INPUT_TOKENS,
    PROPOSAL_EXAMPLE_OUTPUT_TOKENS,
    0,
    0,
    proposalModel(agent),
  );
}

export function proposalCostLabel(agent: ProposalAgent): string {
  const model = proposalModel(agent);
  const name = model === CLAUDE_OPUS_55 ? "Opus 5.5" : "Sonnet 5.5";
  const cost = proposalCostUsd(agent).toFixed(3);
  return `${name}, about $${cost} a run`;
}

export function isTakeoverStep(step: PracticePlanStep): boolean {
  if (step.bucket !== "covered" && step.bucket !== "client_setup") return false;
  const blob = `${step.step} ${step.covers} ${step.capability}`;
  if (FORM_FILL_RE.test(blob)) return false;
  return step.step.trim().length > 0;
}

export function takeoverProposals(steps: readonly PracticePlanStep[]): TakeoverProposal[] {
  const seen = new Set<string>();
  const proposals: TakeoverProposal[] = [];
  for (const step of steps) {
    if (!isTakeoverStep(step) || seen.has(step.dedupe_key)) continue;
    seen.add(step.dedupe_key);
    const agent = proposalAgent(step);
    const model = proposalModel(agent);
    const costUsd = proposalCostUsd(agent);
    const costLabel = proposalCostLabel(agent);
    proposals.push({
      dedupeKey: step.dedupe_key,
      agent,
      model,
      costUsd,
      costLabel,
      title: `Take over: ${step.step}`.slice(0, 180),
      detail: `${step.covers}. Milōn drafts this step. ${costLabel}. Nothing posts until a person approves. Not scheduled.`,
      evidence: {
        figures: { proposal: 1, estimatedCostUsd: costUsd },
        model,
        costLabel,
        scheduled: false,
        dedupeKey: step.dedupe_key,
        step: step.step,
      },
    });
  }
  return proposals;
}

export function takeoverIdempotencyKey(clientId: string, dedupeKey: string): string {
  return `im-takeover:${clientId}:${dedupeKey}`;
}

export function takeoverRunInsert(input: {
  proposal: TakeoverProposal;
  clientId: string;
  firmId: string;
  finishedAt: string;
}): Record<string, unknown> {
  const key = takeoverIdempotencyKey(input.clientId, input.proposal.dedupeKey);
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

export function takeoverFindingInsert(input: {
  proposal: TakeoverProposal;
  clientId: string;
  runId: string;
}): Record<string, unknown> {
  return {
    agent: input.proposal.agent,
    client_id: input.clientId,
    run_id: input.runId,
    kind: IM_TAKEOVER_KIND,
    severity: "info",
    title: input.proposal.title,
    detail: input.proposal.detail,
    evidence: input.proposal.evidence,
  };
}

export function proposalUsesListedModel(agent: ProposalAgent): boolean {
  const model = proposalModel(agent);
  return agent === "financial_manager" ? model === CLAUDE_OPUS_55 : model === CLAUDE_SONNET_55;
}
