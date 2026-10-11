/**
 * One Financial Manager job. Own queue, own memory, own prompt.
 * Background runs do not touch the pre-card allowance.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runQueueJob, type RunnerJob } from "../_shared/agent-core/job.ts";
import { FINANCIAL_MANAGER_SYSTEM, financialManagerToolSchemas } from "../_shared/agent-prompts/financial-manager.ts";
import {
  FM_COST_STOP_USD,
  FM_DRAFT_KINDS,
  FM_MAX_ITERATIONS,
  FM_TOOLS,
  FM_TOOL_LABELS,
  FM_WRITE_TOOLS,
  fmRunOutcome,
} from "../../../src/lib/agent-financial-manager.ts";
import { executeFinancialManagerTool } from "./execute.ts";

const OBJECTIVE =
  "Check data quality from QuickBooks, Xero, Sage, and uploads, the saved cashflow, and the budget. Draft action points, data requests, or an accountant hand-off. Drafts only: a person approves before anything is sent.";

export function runFinancialManagerJob(db: SupabaseClient, job: RunnerJob) {
  return runQueueJob(db, job, {
    agent: "financial_manager",
    queue: "agent_fm",
    objective: OBJECTIVE,
    audience: "accountant",
    maxIterations: FM_MAX_ITERATIONS,
    allowedTools: FM_TOOLS,
    toolLabels: FM_TOOL_LABELS,
    system: FINANCIAL_MANAGER_SYSTEM,
    toolSchemas: financialManagerToolSchemas,
    writeTools: FM_WRITE_TOOLS,
    fallbackDraftKind: FM_DRAFT_KINDS[0],
    costStopUsd: FM_COST_STOP_USD,
    runOutcome: fmRunOutcome,
    execute: executeFinancialManagerTool,
  });
}
