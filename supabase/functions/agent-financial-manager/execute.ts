/**
 * Financial Manager tools. The allow-list is checked before any read or write.
 * Drafts copy figures from tool results. Nothing is emailed.
 */
import type { AgentKey } from "../../../src/lib/agent-bus.ts";
import {
  executeFinancialManagerGate,
  FM_DRAFT_KINDS,
  FM_OWN_READS,
  FM_PEERS,
  FM_REUSED_READS,
  type FmToolName,
} from "../../../src/lib/agent-financial-manager.ts";
import { buildPrepareClientReportResult } from "../../../src/lib/client-report-prepare.ts";
import {
  buildFigureProposal,
  figureBeforeValues,
  parseFigureProposalArgs,
  type FigureSurface,
} from "../../../src/lib/figure-proposal.ts";
import {
  readBooksQuality,
  readBudgetStatus,
  readCash13Week,
  readInbox,
  readOwnMemory,
  readReusedAnalystTool,
  readTeamFindings,
  recordAgentDraft,
  sendAgentMessage,
  type AgentToolCtx,
} from "../_shared/agent-desk.ts";

const REUSED = new Set<string>(FM_REUSED_READS);
const OWN = new Set<string>(FM_OWN_READS);

export async function executeFinancialManagerTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentToolCtx,
): Promise<unknown> {
  const gate = executeFinancialManagerGate(name);
  if (!gate.allowed) return gate;
  const tool: FmToolName = gate.name;
  if (REUSED.has(tool)) return readReusedAnalystTool(tool, ctx);
  if (tool === "get_books_quality") return readBooksQuality(ctx);
  if (tool === "get_cash_13_week") return readCash13Week(ctx);
  if (tool === "get_budget_status") return readBudgetStatus(ctx);
  if (tool === "get_inbox") return readInbox(ctx);
  if (tool === "get_team_findings") return readTeamFindings(ctx);
  if (tool === "get_own_memory") return readOwnMemory(ctx);
  if (OWN.has(tool)) return { error: "That read is not wired." };
  if (tool === "send_agent_message") return sendAgentMessage(args, ctx, FM_PEERS);
  if (tool === "propose_figure_adjustment") return proposeFigureAdjustment(args, ctx);
  if (tool === "prepare_client_report") return prepareClientReport(args, ctx);
  return recordAgentDraft(args, ctx, FM_PEERS as readonly AgentKey[], FM_DRAFT_KINDS);
}

/** A queue run id is stored. A chat proposal has no agent_runs row, so the id stays null. */
function persistedRunId(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

/** Names the PDF. Does not write clients, drafts, packs, or figure rows. */
function prepareClientReport(args: Record<string, unknown>, ctx: AgentToolCtx): unknown {
  const built = buildPrepareClientReportResult(ctx.clientId, args.report_key);
  if (!built.ok) return { error: built.error, tool_blocked: true };
  return built.result;
}

const SURFACE_PAGE: Record<FigureSurface, string> = {
  cash: "Cash forecast page",
  budget: "Budget page",
  waterfall: "Profitability waterfall",
};

/**
 * Saves a pending proposal. Does not update clients.cashflow, clients.budget,
 * or clients.financials. A person confirms on the matching page first.
 */
async function proposeFigureAdjustment(
  args: Record<string, unknown>,
  ctx: AgentToolCtx,
): Promise<unknown> {
  const parsed = parseFigureProposalArgs(args);
  if (!parsed.ok) return { error: parsed.error, tool_blocked: true };
  const { data: client, error } = await ctx.db
    .from("clients")
    .select("cashflow, budget, financials, firm_id")
    .eq("id", ctx.clientId)
    .maybeSingle();
  if (error) return { error: error.message };
  const stored =
    parsed.surface === "cash"
      ? client?.cashflow
      : parsed.surface === "budget"
        ? client?.budget
        : client?.financials;
  const at = new Date().toISOString();
  const before = figureBeforeValues(parsed.surface, stored, parsed.patch);
  const proposal = buildFigureProposal({
    clientId: ctx.clientId,
    firmId: (client?.firm_id as string | null) ?? ctx.firmId,
    runId: persistedRunId(ctx.runId),
    surface: parsed.surface,
    patch: parsed.patch,
    beforeValues: before,
    note: parsed.note,
    at,
  });
  const { data, error: insertError } = await ctx.db
    .from("figure_proposals")
    .insert({
      client_id: proposal.clientId,
      firm_id: proposal.firmId,
      proposed_by: proposal.proposedBy,
      run_id: proposal.runId,
      surface: proposal.surface,
      patch: proposal.patch,
      before_values: proposal.beforeValues,
      note: proposal.note,
      status: "pending",
      created_at: at,
    })
    .select("id")
    .maybeSingle();
  if (insertError || !data?.id)
    return { error: insertError?.message || "The proposal was not saved." };
  return {
    proposed: true,
    proposal_id: data.id,
    status: "pending",
    applied: false,
    requires_human_approval: true,
    client_id: ctx.clientId,
    surface: parsed.surface,
    patch: parsed.patch,
    before_values: before,
    note: `Proposal saved. Tell them to Confirm on the ${SURFACE_PAGE[parsed.surface]}. The saved figures were not changed. Do not say you cannot propose.`,
  };
}
