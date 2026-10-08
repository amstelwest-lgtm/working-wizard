/**
 * Harness-only feed. Production never imports this module.
 * Copy here must not include the three agent display names; the desk
 * reads those from src/lib/milon-team.ts.
 */
import { useState } from "react";
import type { MilonTeamFeedApi } from "@/hooks/use-milon-team-feed";
import {
  emptyMilonTeamFeed,
  type ApproveResult,
  type MilonTeamFeed,
  type TeamJob,
} from "@/lib/milon-team-feed";

export const DESK_NOW = new Date("2026-10-08T12:00:00.000Z");

const POPULATED: MilonTeamFeed = {
  ...emptyMilonTeamFeed(),
  briefing: [
    {
      id: "close",
      agent: "bookkeeper",
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
      agent: "bookkeeper",
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
    bookkeeper: { agent: "bookkeeper", lastRunAt: "2026-10-08T10:00:00.000Z", lastRunKind: "sync" },
    analyst: { agent: "analyst", lastRunAt: "2026-10-07T12:00:00.000Z", lastRunKind: "diagnosis" },
    advisor: { agent: "advisor", lastRunAt: "2026-10-08T09:00:00.000Z", lastRunKind: "diagnosis" },
  },
  signoffLine: "September close is ready for your sign-off.",
  precard: { capped: true, remaining: 0, limit: 3 },
  loading: false,
  error: null,
};

const EMPTY: MilonTeamFeed = emptyMilonTeamFeed();

function feedFor(clientId: string): MilonTeamFeed {
  return clientId === "empty" ? EMPTY : POPULATED;
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
