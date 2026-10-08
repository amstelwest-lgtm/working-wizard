/**
 * Local mirror of the feed Eng1 is adding in src/lib/milon-team-feed.ts.
 * When that module lands, replace this file with one re-export line:
 *   export type { AgentKey, TeamSource, TeamBriefingItem, TeamJobStatus, TeamJob, TeamActivityKind, TeamActivityEvent, TeamAgentStatus, PrecardState, MilonTeamFeed, ApproveResult } from "@/lib/milon-team-feed";
 * Do not add a second definition beside Eng1's file.
 */

export type AgentKey = "bookkeeper" | "analyst" | "advisor";

export interface TeamSource {
  label: string;
  asOf: string | null;
}

export interface TeamBriefingItem {
  id: string;
  agent: AgentKey;
  title: string;
  detail?: string;
  severity: "info" | "watch" | "act";
  source: TeamSource;
  jobId?: string;
}

export type TeamJobStatus =
  | "proposed"
  | "drafting"
  | "draft_ready"
  | "awaiting_signoff"
  | "signed_off"
  | "dismissed"
  | "failed";

export interface TeamJob {
  id: string;
  agent: AgentKey;
  title: string;
  summary: string;
  deliverableType: string | null;
  status: TeamJobStatus;
  createdAt: string;
  canApprove: boolean;
  blockedReason: "precard_cap" | "no_data" | null;
  href?: string;
}

export type TeamActivityKind =
  | "sync"
  | "upload"
  | "diagnosis"
  | "proposal"
  | "draft_created"
  | "approved"
  | "dismissed"
  | "signoff"
  | "data_request"
  | "query";

export interface TeamActivityEvent {
  id: string;
  agent: AgentKey;
  kind: TeamActivityKind;
  text: string;
  at: string;
  href?: string;
}

export interface TeamAgentStatus {
  agent: AgentKey;
  lastRunAt: string | null;
  lastRunKind: TeamActivityKind | null;
}

export interface PrecardState {
  capped: boolean;
  remaining: number | null;
  limit: number | null;
}

export interface MilonTeamFeed {
  briefing: TeamBriefingItem[];
  jobs: TeamJob[];
  activity: TeamActivityEvent[];
  agents: Record<AgentKey, TeamAgentStatus>;
  signoffLine: string | null;
  precard: PrecardState;
  loading: boolean;
  error: string | null;
}

export type ApproveResult =
  | { ok: true; draftId: string | null; href?: string }
  | { ok: false; reason: "precard_cap" | "error"; message: string };

export interface MilonTeamFeedApi extends MilonTeamFeed {
  approveJob(id: string): Promise<ApproveResult>;
  dismissJob(id: string, reason?: string): Promise<{ ok: boolean; message?: string }>;
  refresh(): void;
}
