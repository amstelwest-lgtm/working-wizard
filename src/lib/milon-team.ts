import {
  AGENT_KEYS,
  type AgentKey,
  type TeamActivityKind,
  type TeamAgentStatus,
  type TeamBriefingItem,
} from "@/lib/milon-team-feed";

/** Display order follows Eng1's key list. Names for those keys live only here. */
export const AGENT_ORDER: readonly AgentKey[] = AGENT_KEYS;

const DISPLAY_NAME: Record<AgentKey, string> = {
  financial_manager: "Milōn Bookkeeper",
  analyst: "Milōn Analyst",
  advisor: "Milōn Advisor",
};

const SHORT_NAME: Record<AgentKey, string> = {
  financial_manager: "Bookkeeper",
  analyst: "Analyst",
  advisor: "Advisor",
};

const INITIAL: Record<AgentKey, string> = {
  financial_manager: "B",
  analyst: "A",
  advisor: "A",
};

const JOB_LINE: Record<AgentKey, string> = {
  financial_manager: "Close, clean books, reconciliation, and sign-off readiness.",
  analyst: "Budget, 13-week forecast, variances, and the board report.",
  advisor: "Cash floor, debtors, covenants, tax dates, and next moves.",
};

/** 24px stroke icons. The desk is the only renderer. */
const MARK_PATH: Record<AgentKey, string> = {
  financial_manager: "M6 3.5h12a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1zM8 8h8M8 12h8M8 16h5",
  analyst: "M4 19h16M6 15.5l4.2-5 3.1 2.8L18 6",
  advisor: "M12 3.2l7.2 3.6v5.4c0 4.6-3.1 7.4-7.2 8.8-4.1-1.4-7.2-4.2-7.2-8.8V6.8L12 3.2z",
};

export type AgentStatusTone = "clear" | "watch" | "idle";

export interface AgentHeaderStatus {
  label: string;
  tone: AgentStatusTone;
  lastRun: string | null;
}

export function agentDisplayName(agent: AgentKey): string {
  return DISPLAY_NAME[agent];
}

export function agentShortName(agent: AgentKey): string {
  return SHORT_NAME[agent];
}

export function agentInitial(agent: AgentKey): string {
  return INITIAL[agent];
}

export function agentAriaLabel(agent: AgentKey, status: string): string {
  return `${DISPLAY_NAME[agent]}. ${status}`;
}

export function agentJobLine(agent: AgentKey): string {
  return JOB_LINE[agent];
}

export function agentMarkPath(agent: AgentKey): string {
  return MARK_PATH[agent];
}

function alertLabel(count: number): string {
  return `${count} alert${count === 1 ? "" : "s"}`;
}

export function formatAgo(at: string | null, now: Date = new Date()): string | null {
  if (!at) return null;
  const then = new Date(at).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.round((now.getTime() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatLastRun(at: string | null, now: Date = new Date()): string | null {
  const ago = formatAgo(at, now);
  return ago ? `Last run ${ago}` : null;
}

const AS_OF_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** en-ZA short date. The year is omitted when it is the clock's year. */
export function formatAsOf(asOf: string | null, now: Date = new Date()): string | null {
  if (!asOf) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(asOf.trim());
  if (!match) return asOf;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthName = AS_OF_MONTHS[month - 1];
  if (!monthName || day < 1 || day > 31) return asOf;
  if (year === now.getFullYear()) return `${day} ${monthName}`;
  return `${day} ${monthName} ${year}`;
}

function kindLabel(kind: TeamActivityKind | null): string {
  switch (kind) {
    case "sync":
      return "Books synced";
    case "upload":
      return "Statement in";
    case "diagnosis":
      return "Diagnosis in";
    case "proposal":
      return "Proposal ready";
    case "draft_created":
      return "Draft on file";
    case "approved":
      return "Draft approved";
    case "dismissed":
      return "Item dismissed";
    case "signoff":
      return "Signed off";
    case "data_request":
      return "Data requested";
    case "query":
      return "Question logged";
    default:
      return "Ran";
  }
}

/**
 * Header status from the agent's last run plus briefing severity.
 * An act item on Advisor is the cash-watch line. Clean books and a
 * refreshed forecast are said only when that agent has actually run
 * and nothing in the briefing is asking for a watch.
 */
export function teamAgentHeaderStatus(
  agent: AgentKey,
  status: TeamAgentStatus,
  briefing: readonly TeamBriefingItem[],
  now: Date = new Date(),
): AgentHeaderStatus {
  const mine = briefing.filter((item) => item.agent === agent);
  const act = mine.filter((item) => item.severity === "act").length;
  const watch = mine.filter((item) => item.severity === "watch").length;
  const lastRun = formatLastRun(status.lastRunAt, now);

  if (!status.lastRunAt && mine.length === 0) {
    return { label: "Not run yet", tone: "idle", lastRun: null };
  }

  if (agent === "advisor" && act > 0) {
    return { label: `Cash watch: ${alertLabel(act)}`, tone: "watch", lastRun };
  }
  if (act > 0) {
    return { label: alertLabel(act), tone: "watch", lastRun };
  }
  if (watch > 0) {
    return { label: `${watch} to watch`, tone: "watch", lastRun };
  }

  const booksTouched =
    status.lastRunKind === "sync" ||
    status.lastRunKind === "upload" ||
    status.lastRunKind === "diagnosis" ||
    status.lastRunKind === "signoff";

  if (agent === "financial_manager" && status.lastRunAt && booksTouched) {
    return { label: "Books clean ✓", tone: "clear", lastRun };
  }
  if (agent === "analyst" && status.lastRunAt) {
    return { label: "Forecast updated", tone: "clear", lastRun };
  }
  if (status.lastRunAt) {
    return { label: kindLabel(status.lastRunKind), tone: "clear", lastRun };
  }
  return { label: "On the desk", tone: "clear", lastRun: null };
}
