/**
 * One Advisor job. Own queue, own memory, own prompt.
 * Background runs do not touch the pre-card allowance.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runQueueJob, type RunnerJob } from "../_shared/agent-core/job.ts";
import { ADVISOR_SYSTEM, advisorToolSchemas } from "../_shared/agent-prompts/advisor.ts";
import {
  ADVISOR_DRAFT_KINDS,
  ADVISOR_MAX_ITERATIONS,
  ADVISOR_TOOLS,
  ADVISOR_TOOL_LABELS,
  ADVISOR_WRITE_TOOLS,
  advisorRunOutcome,
} from "../../../src/lib/agent-advisor.ts";
import { executeAdvisorTool } from "./execute.ts";

const OBJECTIVE =
  "Draft the next move and any advisory deliverable from the stored figures and findings. Do not mark anything signed off. Drafts only: a person approves before anything is sent.";

export function runAdvisorJob(db: SupabaseClient, job: RunnerJob) {
  return runQueueJob(db, job, {
    agent: "advisor",
    queue: "agent_advisor",
    objective: OBJECTIVE,
    audience: "accountant",
    maxIterations: ADVISOR_MAX_ITERATIONS,
    allowedTools: ADVISOR_TOOLS,
    toolLabels: ADVISOR_TOOL_LABELS,
    system: ADVISOR_SYSTEM,
    toolSchemas: advisorToolSchemas,
    writeTools: ADVISOR_WRITE_TOOLS,
    fallbackDraftKind: ADVISOR_DRAFT_KINDS[0],
    runOutcome: advisorRunOutcome,
    execute: executeAdvisorTool,
  });
}
