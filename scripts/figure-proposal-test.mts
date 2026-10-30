/**
 * Propose → confirm → apply for cash, budget, and the profitability waterfall.
 * Run: pnpm test:figure-proposal
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { executeAnalystGate } from "../src/lib/agent-analyst.ts";
import { ADVISOR_TOOLS, executeAdvisorGate } from "../src/lib/agent-advisor.ts";
import { FM_TOOLS, executeFinancialManagerGate } from "../src/lib/agent-financial-manager.ts";
import { classifyResult } from "../supabase/functions/_shared/agent-core/loop.ts";
import {
  FINANCIAL_MANAGER_SYSTEM,
  financialManagerToolSchemas,
} from "../supabase/functions/_shared/agent-prompts/financial-manager.ts";
import { askAiAgentPersona } from "../supabase/functions/ask-ai/prompt.ts";
import { FigureProposals } from "../src/components/figure-proposals.tsx";
import { baseCashflow, rollForwardForecast } from "../src/lib/client-metrics.ts";
import { parseAskAiBody } from "../src/lib/ask-ai-response.ts";
import { routeMilonIntent } from "../src/lib/milon-bot-copy.ts";
import {
  applyFigureProposal,
  applyWeekNetDelta,
  buildFigureProposal,
  figureBeforeValues,
  figureProposalCardCopy,
  figureProposalTurn,
  parseFigureProposalArgs,
  rejectFigureProposal,
  withConfirmedForecastAdjustments,
  FIGURE_PROPOSAL_TOOL,
} from "../src/lib/figure-proposal.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const CHILL = "79c4c485-9fa7-4499-9139-e1bb7cb40649";
const AT = "2026-10-29T12:00:00.000Z";

const cashBooks = {
  openingBalance: "1000",
  revenue: [{ id: "room", name: "Rooms", amount: "400" }],
  revAdj: 100,
};
const budgetBooks = {
  version: 1 as const,
  openingCash: 5000,
  gpPct: 40,
  wc: { debtorDays: 30, creditorDays: 20, inventoryDays: 10 },
  revenueLines: [{ id: "rooms", amount: 100 }],
};
const waterfallBooks = {
  revenue: "420000",
  cogs: "80000",
  fixedCosts: "140000",
  periodEnd: "2026-09-30",
};

function pending(surface: "cash" | "budget" | "waterfall", patch: Record<string, string | number>, stored: unknown) {
  const proposal = buildFigureProposal({
    clientId: CHILL,
    surface,
    patch,
    beforeValues: figureBeforeValues(surface, stored, patch),
    note: "Bring the forecast in line with the books.",
    at: AT,
  });
  proposal.id = `${surface}-proposal`;
  return proposal;
}

{
  const bad = parseFigureProposalArgs({ surface: "cash", reason: "Because", patch: { vatRate: 15 } });
  assert(bad.ok === false, "an unknown cash key is refused");
  const empty = parseFigureProposalArgs({ surface: "budget", reason: "Because", patch: {} });
  assert(empty.ok === false, "an empty patch is refused");
  const analyst = executeAnalystGate(FIGURE_PROPOSAL_TOOL);
  assert(analyst.allowed === false, "the analyst cannot propose a figure change");
  assert(!(FM_TOOLS as readonly string[]).includes("propose_cash_forecast_adjustment"), "the cash-only tool name is gone");
  assert((FM_TOOLS as readonly string[]).includes(FIGURE_PROPOSAL_TOOL), "the financial manager can propose");
  assert(executeFinancialManagerGate(FIGURE_PROPOSAL_TOOL).allowed === true, "the financial manager gate allows the proposal");
  assert(!(ADVISOR_TOOLS as readonly string[]).includes(FIGURE_PROPOSAL_TOOL), "the advisor does not get the write");
  assert(executeAdvisorGate(FIGURE_PROPOSAL_TOOL).allowed === false, "the advisor gate refuses the write");
}

{
  const proposal = pending("cash", { revAdj: 80, openingBalance: "25000" }, cashBooks);
  assert(proposal.status === "pending", "a cash proposal starts pending");
  assert(proposal.clientId === CHILL, "the proposal is for Chill Pepper");
  assert(proposal.beforeValues.revAdj === 100, "the audit stores the cash value before the change");
  const blocked = applyFigureProposal(proposal, { cashflow: cashBooks, budget: budgetBooks, financials: waterfallBooks }, { confirm: false });
  assert(blocked.applied === false && blocked.blocked === true, "cash apply is blocked without confirm");
  assert(blocked.cashflow === cashBooks, "a blocked cash apply returns the same cashflow");
  assert(JSON.stringify(cashBooks) === JSON.stringify({
    openingBalance: "1000",
    revenue: [{ id: "room", name: "Rooms", amount: "400" }],
    revAdj: 100,
  }), "a blocked cash apply does not change the stored cashflow");
  const applied = applyFigureProposal(
    proposal,
    { cashflow: cashBooks, budget: budgetBooks, financials: waterfallBooks },
    { confirm: true, decidedBy: "accountant-1", at: AT },
  );
  assert(applied.applied === true && applied.proposal.status === "applied", "confirm applies the cash proposal");
  assert(applied.proposal.decidedBy === "accountant-1" && applied.proposal.appliedAt === AT, "the audit names who confirmed and when");
  const next = applied.cashflow as { revAdj: number; openingBalance: string; revenue: unknown; confirmedForecastAdjustments: { proposalId: string } };
  assert(next.revAdj === 80 && next.openingBalance === "25000", "the cash patch is on the cashflow");
  assert(JSON.stringify(next.revenue) === JSON.stringify(cashBooks.revenue), "unrelated cash lines stay");
  assert(next.confirmedForecastAdjustments.proposalId === proposal.id, "the confirmed marker points at the proposal");
  assert(applied.budget === budgetBooks && applied.financials === waterfallBooks, "a cash apply does not touch budget or the waterfall");
  const rejected = rejectFigureProposal(pending("cash", { revAdj: 90 }, cashBooks), { decidedBy: "accountant-1", at: AT });
  assert(rejected.ok === true && rejected.proposal.status === "rejected", "reject marks the cash proposal rejected");
  const afterReject = applyFigureProposal(rejected.proposal, { cashflow: cashBooks }, { confirm: true, at: AT });
  assert(afterReject.applied === false && afterReject.cashflow === cashBooks, "a rejected cash proposal cannot be applied");
  const preserved = withConfirmedForecastAdjustments(
    { ...baseCashflow({ openingBalance: "10" }), revenue: [] },
    next,
  );
  assert(preserved.revAdj === 80, "a later cash save keeps the confirmed revenue adjustment");
}

{
  const proposal = pending("budget", { gpPct: 55, debtorDays: 45 }, budgetBooks);
  assert(proposal.status === "pending" && proposal.beforeValues.debtorDays === 30, "a budget proposal records the old debtor days");
  const blocked = applyFigureProposal(proposal, { budget: budgetBooks, cashflow: cashBooks }, { confirm: false });
  assert(blocked.applied === false && blocked.budget === budgetBooks, "budget apply is blocked without confirm");
  const applied = applyFigureProposal(proposal, { budget: budgetBooks, cashflow: cashBooks }, { confirm: true, decidedBy: "accountant-1", at: AT });
  assert(applied.applied && applied.proposal.status === "applied", "confirm applies the budget proposal");
  const next = applied.budget as { gpPct: number; wc: { debtorDays: number; creditorDays: number }; revenueLines: unknown; version: number };
  assert(next.gpPct === 55 && next.wc.debtorDays === 45 && next.wc.creditorDays === 20, "budget scalars and working-capital days update");
  assert(JSON.stringify(next.revenueLines) === JSON.stringify(budgetBooks.revenueLines), "budget lines that were not in the patch stay");
  assert(next.version === 1, "the budget document stays a budget");
  assert(applied.cashflow === cashBooks, "a budget apply does not touch cash");
  const missing = applyFigureProposal(proposal, { budget: null }, { confirm: true, at: AT });
  assert(missing.applied === false && missing.reason === "budget_missing", "confirm does not invent a budget");
  const rejected = rejectFigureProposal(pending("budget", { openingCash: 1 }, budgetBooks), { at: AT });
  assert(rejected.ok, "a budget proposal can be rejected");
  const unchanged = applyFigureProposal(rejected.proposal, { budget: budgetBooks }, { confirm: true });
  assert(unchanged.applied === false && unchanged.budget === budgetBooks, "reject leaves the budget unchanged");
}

{
  const proposal = pending("waterfall", { revenue: 390000, fixedCosts: 150000 }, waterfallBooks);
  assert(proposal.status === "pending", "a waterfall proposal starts pending");
  assert(proposal.beforeValues.revenue === "420000", "the audit stores the P&L revenue before the change");
  const blocked = applyFigureProposal(proposal, { financials: waterfallBooks, cashflow: cashBooks }, { confirm: false });
  assert(blocked.applied === false && blocked.financials === waterfallBooks, "waterfall apply is blocked without confirm");
  const applied = applyFigureProposal(
    proposal,
    { financials: waterfallBooks, cashflow: cashBooks },
    { confirm: true, decidedBy: "accountant-1", at: AT },
  );
  assert(applied.applied && applied.proposal.status === "applied", "confirm applies the waterfall proposal");
  const next = applied.financials as { revenue: string; fixedCosts: string; cogs: string; periodEnd: string };
  assert(next.revenue === "390000" && next.fixedCosts === "150000", "the P&L patch keeps the string shape already on file");
  assert(next.cogs === "80000" && next.periodEnd === "2026-09-30", "other statement fields stay");
  assert(applied.cashflow === cashBooks, "a waterfall apply does not touch cash");
  const rejected = rejectFigureProposal(pending("waterfall", { tax: 1000 }, waterfallBooks), { at: AT });
  const after = applyFigureProposal(rejected.proposal, { financials: waterfallBooks }, { confirm: true });
  assert(after.applied === false && after.financials === waterfallBooks, "reject leaves the waterfall figures unchanged");
}

{
  const classified = classifyResult(FIGURE_PROPOSAL_TOOL, {
    proposed: true,
    status: "pending",
    applied: false,
  });
  assert(classified.happened === true && classified.status === "ok", "a saved proposal happened");
  assert(/not changed/i.test(classified.detail), "the trace says the saved figures were not changed");
  assert(/Confirm on the Cash forecast page/i.test(classified.detail), "a saved proposal points at Confirm on Cash");
  assert(/cannot propose/i.test(classified.detail), "the trace forbids saying she cannot propose");
  assert(FINANCIAL_MANAGER_SYSTEM.includes("propose_figure_adjustment"), "the financial manager prompt names the tool");
  assert(/confirm/i.test(FINANCIAL_MANAGER_SYSTEM), "the prompt requires a person to confirm");
  assert(FINANCIAL_MANAGER_SYSTEM.includes("waterfall"), "the prompt covers the profitability waterfall");
  assert(FINANCIAL_MANAGER_SYSTEM.includes("budget"), "the prompt covers the budget");
  assert(
    /call propose_figure_adjustment with surface cash and patch capexAmount/.test(FINANCIAL_MANAGER_SYSTEM) &&
      /capexWeek/.test(FINANCIAL_MANAGER_SYSTEM),
    "CapEx in a week is a propose_figure_adjustment call",
  );
  assert(/Do not refuse/.test(FINANCIAL_MANAGER_SYSTEM), "the prompt does not stall on approval before the call");
  assert(
    /netWeek set to that week, and netDelta set to the negative/.test(FINANCIAL_MANAGER_SYSTEM),
    "a non-CapEx week outflow is a negative net delta",
  );
  assert(
    /Confirm on the Cash forecast page/.test(FINANCIAL_MANAGER_SYSTEM) &&
      /Never say you cannot propose/.test(FINANCIAL_MANAGER_SYSTEM),
    "after the call she points at Confirm and does not refuse",
  );
  const proposeTool = financialManagerToolSchemas().find((tool) => tool.name === FIGURE_PROPOSAL_TOOL);
  assert(proposeTool != null, "the runner exposes the proposal tool");
  const toolText = `${proposeTool?.description ?? ""} ${JSON.stringify(proposeTool?.input_schema ?? {})}`;
  assert(/capexAmount plus capexWeek/.test(toolText), "the tool description names the CapEx patch");
  assert(/negative netDelta/.test(toolText), "the tool description names a week outflow");
  assert(/Do not refuse/.test(toolText), "the tool description forbids stalling before the call");
  const persona = askAiAgentPersona("financial_manager", "accountant");
  assert(/confirm/i.test(persona) && /do not say/i.test(persona), "Ask FM does not claim a live write");
  assert(
    /call propose_figure_adjustment with surface cash and patch capexAmount and capexWeek/.test(persona),
    "Ask FM calls the CapEx proposal instead of waiting",
  );
  assert(/negative netDelta/.test(persona), "Ask FM proposes a non-CapEx week outflow");
  assert(/Confirm on the Cash forecast page/.test(persona) && /cannot propose/.test(persona), "Ask FM points at Confirm");
  const objective = readFileSync(resolve("supabase/functions/agent-financial-manager/run.ts"), "utf8");
  assert(/capexAmount and capexWeek/.test(objective), "the runner objective calls the CapEx proposal");
  assert(/negative netDelta/.test(objective), "the runner objective calls a week outflow");
  assert(/Do not wait for approval before the call/.test(objective), "the runner objective does not stall");
  const sql = readFileSync(resolve("supabase/migrations/20261029120000_figure_proposals.sql"), "utf8");
  assert(sql.includes("IF p_confirm IS NOT TRUE"), "apply refuses when confirm is not true");
  assert(sql.includes("figure_confirm_required"), "the refusal is named");
  const rejectFn = sql.slice(sql.indexOf("FUNCTION public.reject_figure_proposal"));
  assert(!rejectFn.includes("UPDATE public.clients"), "reject does not write clients");
  const execute = readFileSync(resolve("supabase/functions/agent-financial-manager/execute.ts"), "utf8");
  assert(execute.includes("figure_proposals"), "the financial manager inserts a proposal row");
  assert(!execute.includes(".update("), "the financial manager tool does not update clients");
  assert(!execute.includes("apply_figure_proposal"), "the agent cannot apply its own proposal");
  const analyst = readFileSync(resolve("src/lib/agent-analyst.ts"), "utf8");
  assert(!analyst.includes(FIGURE_PROPOSAL_TOOL), "the analyst allow-list has no figure write");
  const card = renderToStaticMarkup(
    createElement(FigureProposals, {
      surface: "cash",
      proposals: [
        {
          id: "p1",
          surface: "cash",
          note: "Revenue is soft.",
          patch: { revAdj: 80 },
          beforeValues: { revAdj: 100 },
        },
      ],
      busyId: null,
      onConfirm: () => {},
      onReject: () => {},
    }),
  );
  assert(card.includes("Confirm and apply") && card.includes("Reject"), "the confirm card offers both decisions");
  assert(card.includes("Revenue 100% → 80%"), "the card shows the proposed delta");
  assert(
    renderToStaticMarkup(
      createElement(FigureProposals, {
        surface: "budget",
        proposals: [],
        busyId: null,
        onConfirm: () => {},
        onReject: () => {},
      }),
    ) === "",
    "an empty queue renders nothing",
  );
}

const AQA = "Propose changing W1 net by R100 in the cash forecast.";

{
  assert(routeMilonIntent(AQA) === "ask-ai", "the numbers chat still owns a free-text figure ask");
  const analyst = figureProposalTurn("analyst", AQA);
  const advisor = figureProposalTurn("advisor", AQA);
  assert(analyst?.kind === "refuse" && /nothing was saved/i.test(analyst.answer), "the analyst chat refuses the write");
  assert(advisor?.kind === "refuse" && /nothing was saved/i.test(advisor.answer), "the advisor chat refuses the write");
  assert(figureProposalTurn("financial_manager", "What's the cash runway?") == null, "a cash question is not a proposal");
  const turn = figureProposalTurn("financial_manager", AQA);
  assert(turn?.kind === "propose" && turn.tool === FIGURE_PROPOSAL_TOOL, "the financial manager chat calls the proposal tool");
  if (turn?.kind !== "propose") throw new Error("expected a proposal");
  assert(turn.args.surface === "cash" && turn.args.patch.netWeek === 1 && turn.args.patch.netDelta === 100, "W1 net by R100 is week 1 plus 100");
  const copy = figureProposalCardCopy({
    surface: "cash",
    patch: turn.args.patch,
    beforeValues: { netWeek: 1, netDelta: 0 },
    canDecide: true,
  });
  assert(copy.actions[0] === "Confirm and apply" && copy.actions[1] === "Reject", "the chat card offers both decisions");
  assert(copy.lines.some((line) => line === "Week 1 net +100"), "the card names the week net change");
  const owner = figureProposalCardCopy({
    surface: "cash",
    patch: turn.args.patch,
    beforeValues: {},
    canDecide: false,
  });
  assert(owner.actions.length === 0, "a read-only owner does not get Confirm or Reject");
  const net = applyWeekNetDelta([10, 20], 1, 100);
  assert(net[0] === 110 && net[1] === 20, "the week net change lands on week 1 only");
  const base = {
    openingBalance: "1000",
    revenue: [{ id: "room", name: "Rooms", amount: "400", frequency: "once-off", startWeek: 1 }],
    expenses: [],
    other: [],
  };
  const plain = rollForwardForecast(base);
  const shifted = rollForwardForecast({ ...base, netWeek: 1, netDelta: 100 });
  assert(plain && shifted, "both forecasts roll");
  assert(shifted!.closing[0] === plain!.closing[0] + 100, "confirming the proposal moves week 1 closing by 100");
  assert(shifted!.closing[1] === plain!.closing[1] + 100, "later weeks keep that net change");
  const parsed = parseAskAiBody(200, {
    answer: "A figure change is waiting for you. Nothing is saved until you confirm.",
    tools: [{ name: FIGURE_PROPOSAL_TOOL, status: "ok" }],
    proposal: {
      id: "p-w1",
      surface: "cash",
      note: AQA,
      patch: { netWeek: 1, netDelta: 100 },
      beforeValues: { netDelta: 0 },
      canDecide: true,
    },
  });
  assert(parsed.ok && parsed.proposal?.id === "p-w1" && parsed.proposal.canDecide === true, "the chat turn keeps the pending proposal");
  const widget = readFileSync(resolve("src/lib/ask-ai.js"), "utf8");
  assert(widget.includes('mode: "figure-proposal"'), "the financial manager chat posts the proposal mode");
  assert(widget.includes("buildFigureCard"), "the card is built for the thread");
  const cardAppend = widget.indexOf("if (figureCard) panel.appendChild(figureCard);");
  const threadAppend = widget.indexOf("panel.appendChild(thread)", cardAppend);
  assert(cardAppend > 0 && threadAppend > cardAppend, "the card is appended beside the thread");
  const threadOpen = widget.lastIndexOf('thread.className = "ask-ai-thread"', cardAppend);
  assert(threadOpen > 0 && !widget.slice(threadOpen, threadAppend).includes("ask-ai-figure-card"), "the card is not inside the clipped thread");
  const desk = readFileSync(resolve("src/components/milon-team/milon-team-desk.css"), "utf8");
  assert(desk.includes(".ask-ai-figure-card") && desk.includes("grid-row: 1"), "the card sits above the 220px reply");
  assert(/max-height:\s*220px/.test(desk), "the reply thread stays clipped");
  const bot = readFileSync(resolve("supabase/functions/milon-bot/index.ts"), "utf8");
  assert(bot.includes('body.mode === "figure-proposal"'), "the bot saves the proposal without the numbers model");
  assert(bot.includes("executeFinancialManagerTool"), "the chat uses the financial manager tool");
  const weekSql = readFileSync(resolve("supabase/migrations/20261029180000_figure_proposal_week_net.sql"), "utf8");
  assert(weekSql.includes("'netWeek'") && weekSql.includes("'netDelta'"), "confirm accepts a week net patch");
  const page = readFileSync(resolve("src/components/figure-proposals.tsx"), "utf8");
  assert(page.includes("figure-proposals-changed"), "the cash page reloads when the chat saves a proposal");
}

console.log("figure-proposal: ok");
