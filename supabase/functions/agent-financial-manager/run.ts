/**
 * One Financial Manager job. Own queue, own memory, own prompt.
 * Background runs do not touch the pre-card allowance.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runQueueJob, type RunnerJob } from "../_shared/agent-core/job.ts";
import { CLAUDE_MODEL, CLAUDE_MODEL_FM } from "../_shared/claude-model.ts";
import {
  FINANCIAL_MANAGER_SYSTEM,
  financialManagerToolSchemas,
} from "../_shared/agent-prompts/financial-manager.ts";
import { CLAUDE_OPUS_55, modelForAgent } from "../../../src/lib/claude-request.ts";
import {
  FM_COST_CEILING_USD,
  FM_DRAFT_KINDS,
  FM_MAX_ITERATIONS,
  FM_TOOLS,
  FM_TOOL_LABELS,
  FM_WRITE_TOOLS,
  fmRunOutcome,
} from "../../../src/lib/agent-financial-manager.ts";
import { financialManagerJobObjective } from "../../../src/lib/client-report-prepare.ts";
import { executeFinancialManagerTool } from "./execute.ts";

const OBJECTIVE =
  "Check data quality from QuickBooks, Xero, Sage, and uploads, the saved cashflow, and the budget. Draft action points, data requests, or an accountant hand-off. When asked to add CapEx in a week, call propose_figure_adjustment with capexAmount and capexWeek. When asked to add an outflow that is not CapEx, call it with netWeek and a negative netDelta. That call is the proposal. Do not wait for approval before the call. After it is saved, say Confirm on the Cash forecast page. Do not say the figures were updated. Drafts only: a person approves before anything is sent.";

export function runFinancialManagerJob(db: SupabaseClient, job: RunnerJob) {
  return runQueueJob(db, job, {
    agent: "financial_manager",
    queue: "agent_fm",
    objective: financialManagerJobObjective(OBJECTIVE, job.inputs),
    audience: "accountant",
    maxIterations: FM_MAX_ITERATIONS,
    allowedTools: FM_TOOLS,
    toolLabels: FM_TOOL_LABELS,
    system: FINANCIAL_MANAGER_SYSTEM,
    toolSchemas: financialManagerToolSchemas,
    writeTools: FM_WRITE_TOOLS,
    fallbackDraftKind: FM_DRAFT_KINDS[0],
    costCeilingUsd: FM_COST_CEILING_USD,
    // claude-opus-5-5. CLAUDE_MODEL does not select this agent. Opus list
    // rates are about double Sonnet 5.5, and adaptive thinking is billed as
    // output, so the unchanged $0.06 ceiling can stop a run sooner.
    model: modelForAgent("financial_manager", {
      standard: CLAUDE_MODEL,
      financialManager: CLAUDE_MODEL_FM || CLAUDE_OPUS_55,
    }),
    runOutcome: fmRunOutcome,
    execute: executeFinancialManagerTool,
  });
}
