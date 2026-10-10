/**
 * Harness-only feed. Production never imports this module.
 * Copy here must not include the three agent display names; the desk
 * reads those from src/lib/milon-team.ts.
 */
import { useState } from "react";
import type { MilonTeamFeedApi } from "@/hooks/use-milon-team-feed";
import { ZA_MARKET } from "@/lib/market/resolve";
import type { AgentActivitySnapshot } from "@/lib/milon-team-activity";
import {
  emptyMilonTeamFeed,
  type ApproveResult,
  type MilonTeamFeed,
  type TeamJob,
} from "@/lib/milon-team-feed";

export const DESK_NOW = new Date("2026-10-08T12:00:00.000Z");
export const LIVE_NOW = new Date("2026-10-09T12:00:00.000Z");

const POPULATED: MilonTeamFeed = {
  ...emptyMilonTeamFeed(),
  briefing: [
    {
      id: "close",
      agent: "financial_manager",
      title: "September close matches the bank",
      detail: "The ledger and the bank statement agree.",
      severity: "info",
      source: { label: "Books", asOf: "2026-10-08" },
    },
    {
      id: "forecast",
      agent: "analyst",
      title: "People costs sit inside the 13-week forecast",
      detail: "The board pack can use this week's upload.",
      severity: "info",
      source: { label: "Forecast", asOf: "2026-10-07" },
    },
    {
      id: "floor",
      agent: "advisor",
      title: "Cash floor is close",
      detail: "Debtors are stretching past terms.",
      severity: "act",
      source: { label: "Cash", asOf: "2026-10-08" },
      jobId: "collections",
    },
  ],
  jobs: [
    {
      id: "board",
      agent: "analyst",
      title: "Draft the board note",
      summary: "People costs stay in the 13-week forecast. Nothing is sent until you open the draft.",
      deliverableType: "board_report",
      status: "proposed",
      createdAt: "2026-10-08T11:00:00.000Z",
      canApprove: true,
      blockedReason: null,
    },
    {
      id: "collections",
      agent: "advisor",
      title: "Note the debtors past terms",
      summary: "A collections note is waiting on a card.",
      deliverableType: "collections",
      status: "proposed",
      createdAt: "2026-10-08T11:10:00.000Z",
      canApprove: false,
      blockedReason: "precard_cap",
    },
  ],
  activity: [
    {
      id: "synced",
      agent: "financial_manager",
      kind: "sync",
      text: "Bank feed synced for September.",
      at: "2026-10-08T10:00:00.000Z",
    },
    {
      id: "forecasted",
      agent: "analyst",
      kind: "diagnosis",
      text: "13-week forecast refreshed from the latest upload.",
      at: "2026-10-07T12:00:00.000Z",
    },
    {
      id: "flagged",
      agent: "advisor",
      kind: "diagnosis",
      text: "Flagged the cash floor.",
      at: "2026-10-08T09:00:00.000Z",
    },
  ],
  agents: {
    financial_manager: { agent: "financial_manager", lastRunAt: "2026-10-08T10:00:00.000Z", lastRunKind: "sync" },
    analyst: { agent: "analyst", lastRunAt: "2026-10-07T12:00:00.000Z", lastRunKind: "diagnosis" },
    advisor: { agent: "advisor", lastRunAt: "2026-10-08T09:00:00.000Z", lastRunKind: "diagnosis" },
  },
  signoffLine: "September close is ready for your sign-off.",
  precard: { capped: false, remaining: 3, limit: 3 },
  loading: false,
  error: null,
};

const EMPTY: MilonTeamFeed = emptyMilonTeamFeed();

const LIVE: MilonTeamFeed = {
  ...emptyMilonTeamFeed(),
  briefing: [
    {
      id: "ratio:debtToEquity",
      agent: "analyst",
      title: "Debt-to-Equity",
      detail: "Debt-to-Equity 0.7795",
      severity: "act",
      source: { label: "Ratios", asOf: "2026-09-30" },
    },
    {
      id: "ratio:currentRatio",
      agent: "analyst",
      title: "Current Ratio",
      detail: "Current Ratio 1.15",
      severity: "watch",
      source: { label: "Ratios", asOf: "2026-09-30" },
    },
    {
      id: "ratio:assetTurnover",
      agent: "analyst",
      title: "Asset Turnover",
      detail: "Asset Turnover 0.84",
      severity: "watch",
      source: { label: "Ratios", asOf: "2026-09-30" },
    },
    {
      id: "ratio:equityMultiplier",
      agent: "analyst",
      title: "Equity Multiplier",
      detail: "Equity Multiplier 2.4",
      severity: "watch",
      source: { label: "Ratios", asOf: "2026-09-30" },
    },
    {
      id: "ratio:grossMargin",
      agent: "analyst",
      title: "Gross Margin",
      detail: "Gross Margin 42.0%",
      severity: "watch",
      source: { label: "Ratios", asOf: "2026-09-30" },
    },
    {
      id: "proposal:loan",
      agent: "advisor",
      title: "Bring Debt-to-Equity back under the line",
      detail: "Pay down the short-term loan before the next review.",
      severity: "act",
      source: { label: "Client Brain proposals", asOf: null },
    },
  ],
  agents: {
    financial_manager: { agent: "financial_manager", lastRunAt: null, lastRunKind: null },
    analyst: { agent: "analyst", lastRunAt: "2026-10-09T08:00:00.000Z", lastRunKind: "diagnosis" },
    advisor: { agent: "advisor", lastRunAt: null, lastRunKind: null },
  },
};

export const EMPTY_ACTIVITY: AgentActivitySnapshot = {
  runs: [],
  findings: [],
  messages: [],
  market: ZA_MARKET,
};

export const LIVE_ACTIVITY: AgentActivitySnapshot = {
  market: ZA_MARKET,
  runs: [
    {
      id: "run-fm",
      agent: "financial_manager",
      client_id: "harbour-glass",
      status: "succeeded",
      queued_at: "2026-10-09T11:55:00.000Z",
      started_at: "2026-10-09T11:55:00.000Z",
      finished_at: "2026-10-09T11:55:00.000Z",
    },
    {
      id: "run-analyst",
      agent: "analyst",
      client_id: "harbour-glass",
      status: "running",
      queued_at: "2026-10-09T11:58:00.000Z",
      started_at: "2026-10-09T11:58:00.000Z",
      finished_at: null,
    },
    {
      id: "run-advisor",
      agent: "advisor",
      client_id: "harbour-glass",
      status: "failed",
      queued_at: "2026-10-09T11:00:00.000Z",
      started_at: "2026-10-09T11:00:00.000Z",
      finished_at: "2026-10-09T11:02:00.000Z",
    },
  ],
  findings: [
    {
      id: "finding-margin",
      agent: "analyst",
      client_id: "harbour-glass",
      title: "Gross margin is 0.4200",
      detail: null,
      evidence: { period_label: "Sep 2026", figures: { gross_margin: 0.42 } },
      as_of: "2026-09-30",
      created_at: "2026-10-09T11:40:00.000Z",
    },
  ],
  messages: [
    {
      id: "handoff-1",
      client_id: "harbour-glass",
      from_agent: "analyst",
      to_agent: "advisor",
      type: "handoff",
      payload: { text: "Review the cash floor before the next meeting." },
      created_at: "2026-10-09T11:50:00.000Z",
    },
  ],
};

function feedFor(clientId: string): MilonTeamFeed {
  if (clientId === "empty") return EMPTY;
  if (clientId === "live") return LIVE;
  return POPULATED;
}

export function useMilonTeamFeedStub(clientId: string): MilonTeamFeedApi {
  const base = feedFor(clientId);
  const [jobs, setJobs] = useState<TeamJob[]>(base.jobs);
  const [seen, setSeen] = useState(clientId);
  if (seen !== clientId) {
    setSeen(clientId);
    setJobs(feedFor(clientId).jobs);
  }

  return {
    ...base,
    jobs,
    async approveJob(id: string): Promise<ApproveResult> {
      const job = jobs.find((item) => item.id === id);
      if (!job) return { ok: false, reason: "error", message: "That job is not on the desk." };
      if (!job.canApprove || job.blockedReason === "precard_cap") {
        return { ok: false, reason: "precard_cap", message: "Add a card to start your 14-day free trial" };
      }
      const href = `#draft-${id}`;
      setJobs((current) =>
        current.map((item) => (item.id === id ? { ...item, status: "draft_ready", href } : item)),
      );
      return { ok: true, draftId: `draft-${id}`, href };
    },
    async dismissJob(id: string) {
      setJobs((current) => current.map((item) => (item.id === id ? { ...item, status: "dismissed" } : item)));
      return { ok: true };
    },
    refresh() {
      setJobs(feedFor(clientId).jobs);
    },
  };
}
