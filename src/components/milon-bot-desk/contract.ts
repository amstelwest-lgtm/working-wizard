/**
 * Data contract for the Milōn Bot desk.
 *
 * Eng2 renders this shape. Eng1 fills it from books already on the file.
 * Display helpers only format fields Eng1 passed. They do not score, age,
 * or compute a variance.
 */
import type { AdvisorySignoffState } from "@/lib/advisory-signoff";
import { signoffStatusLine, type SignoffStatusKind } from "@/lib/signoff-status";

export type MilonDeskCurrency = "USD" | "ZAR";

/** The three desk agents. Tags, the filter, and the activity log use these ids. */
export type MilonDeskAgentId = "accountant" | "analyst" | "advisor";

export type MilonDeskAgentTone = "ok" | "watch" | "idle";

export type MilonDeskAgent = {
  id: MilonDeskAgentId;
  /** Live line from books already on file. */
  status: string;
  /** Last real run. Null when this agent has not run. */
  lastRunAt: string | null;
  tone: MilonDeskAgentTone;
};

export const DESK_AGENTS: { id: MilonDeskAgentId; name: string }[] = [
  { id: "accountant", name: "Milōn Accountant" },
  { id: "analyst", name: "Milōn Analyst" },
  { id: "advisor", name: "Milōn Advisor" },
];

export type MilonDeskSignoff = {
  /** Return value of getAdvisorySignoffState. */
  state: AdvisorySignoffState;
  /**
   * Already formatted clock. signoffStatusLine uses it only for a clean
   * sign-off. Null when the pack is not signed.
   */
  signedDateLabel: string | null;
};

export type MilonDeskBriefingAction = "draft_fix" | "add_to_pack";

export type MilonDeskBriefingItem = {
  id: string;
  agent: MilonDeskAgentId;
  label: string;
  /** Preformatted figure. A blank figure is not shown. */
  figure: string;
  /**
   * One line from diagnosis already on file (whatMatters, ratio attention,
   * or the next-step reason). The desk does not write a second diagnosis.
   */
  why: string;
  /** Raw statement source. The desk passes it to figureSourceChipLabel. */
  source: string | null;
  action: MilonDeskBriefingAction;
  /**
   * Button label when "Draft fix" is the wrong verb. Health uses the
   * next-step action, such as "Draft plan".
   */
  actionLabel?: string | null;
};

export type MilonDeskJobKind = "collections_chase" | "budget_variance";

export type MilonDeskPrecardKind = "email" | "pack" | "bot";

export type MilonDeskJob = {
  id: string;
  agent: MilonDeskAgentId;
  kind: MilonDeskJobKind;
  /** Which pre-card allowance Approve spends. */
  precardKind: Extract<MilonDeskPrecardKind, "email" | "pack">;
  debtorCount?: number | null;
  olderThanDays?: number | null;
  amount?: number | null;
  /** VarianceLine.label Eng1 chose, such as the people-overhead line. */
  lineLabel?: string | null;
  /** VarianceLine.deltaPct. Not recomputed here. */
  deltaPct?: number | null;
};

export type MilonDeskActivityKind =
  | "sync"
  | "import"
  | "health_check"
  | "forecast"
  | "cash_watch"
  | "pack_draft"
  | "email_draft"
  | "signoff";

export type MilonDeskActivityEvent = {
  id: string;
  agent: MilonDeskAgentId;
  at: string;
  kind: MilonDeskActivityKind;
  /** Sentence Eng1 built from the row. The desk prints it unchanged. */
  line: string;
};

export type MilonDeskPrecard = {
  applies: boolean;
  blocked: Record<MilonDeskPrecardKind, boolean>;
};

export type MilonDeskModel = {
  clientName: string;
  currency: MilonDeskCurrency;
  /** Clock for the sync line. Fixtures pin this so the mockup does not drift. */
  now: string;
  /** Newest real sync or import time. Null when the file has neither. */
  syncedAt: string | null;
  agents: MilonDeskAgent[];
  signoff: MilonDeskSignoff;
  briefing: MilonDeskBriefingItem[];
  jobs: MilonDeskJob[];
  activity: MilonDeskActivityEvent[];
  precard: MilonDeskPrecard;
};

export function deskAgentName(id: MilonDeskAgentId): string {
  return DESK_AGENTS.find((agent) => agent.id === id)?.name ?? id;
}

export function deskAgentLastRun(lastRunAt: string | null, now: string): string {
  const ago = deskAgo(lastRunAt, now);
  return ago ? `Last run ${ago}` : "Not run yet";
}

export function deskSignoffKind(status: AdvisorySignoffState["status"]): SignoffStatusKind {
  if (status === "signed_stale") return "stale";
  if (status === "signed") return "signed";
  if (status === "in_review") return "ready";
  return "draft";
}

/** The only status sentence the desk shows. */
export function deskSignoffLine(signoff: MilonDeskSignoff): string {
  const kind = deskSignoffKind(signoff.state.status);
  return signoffStatusLine({
    kind,
    name: signoff.state.signedBy,
    date: kind === "signed" ? signoff.signedDateLabel : null,
    variant: kind === "stale" ? "short" : "full",
  });
}

export function formatDeskMoney(amount: number, currency: MilonDeskCurrency): string {
  const symbol = currency === "ZAR" ? "R" : "$";
  const abs = Math.abs(amount);
  const digits = abs >= 100 ? 0 : 2;
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${amount < 0 ? "-" : ""}${symbol}${formatted}`;
}

export function formatSignedPct(pct: number): string {
  const rounded = Math.round(pct);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

function deskAgo(at: string | null, now: string): string | null {
  const atMs = Date.parse(at ?? "");
  const nowMs = Date.parse(now);
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) return null;
  const mins = Math.round((nowMs - atMs) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)}h ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(atMs));
}

/** "Reviewed books · synced 2h ago", or the empty line when there is no timestamp. */
export function deskSyncedStatus(syncedAt: string | null, now: string): string {
  const ago = deskAgo(syncedAt, now);
  if (!ago) return "No books on file yet";
  return `Reviewed books · synced ${ago}`;
}

/**
 * Job sentence from the structured facts. Missing facts return null and the
 * card is omitted. This does not age invoices or recompute a variance.
 */
export function deskJobSentence(job: MilonDeskJob, currency: MilonDeskCurrency): string | null {
  if (job.kind === "collections_chase") {
    const count = job.debtorCount;
    const days = job.olderThanDays;
    const amount = job.amount;
    if (count == null || days == null || amount == null) return null;
    if (!Number.isFinite(count) || !Number.isFinite(days) || !Number.isFinite(amount)) return null;
    if (count < 1 || amount <= 0) return null;
    return `Collections: ${Math.round(count)} debtors >${Math.round(days)} days, ${formatDeskMoney(amount, currency)}. Draft chase emails?`;
  }
  const label = job.lineLabel?.trim() ?? "";
  const pct = job.deltaPct;
  if (!label || pct == null || !Number.isFinite(pct)) return null;
  const side = pct < 0 ? "under budget" : "over budget";
  return `Budget variance: ${label} ${formatSignedPct(pct)} ${side}. Explain to owner?`;
}

/**
 * The gold control on the status card.
 * Ready for review (and a stale sign-off) asks for review.
 * Draft keeps the pack action for that state.
 * A clean sign-off has no button.
 */
export function deskSignoffAction(signoff: MilonDeskSignoff): string | null {
  const kind = deskSignoffKind(signoff.state.status);
  if (kind === "signed") return null;
  if (kind === "ready" || kind === "stale") return "Review and sign off";
  if (signoff.state.version == null) return "Generate pack";
  return "Open the pack";
}

export function deskBriefingActionLabel(item: Pick<MilonDeskBriefingItem, "action" | "actionLabel">): string {
  const named = item.actionLabel?.trim();
  if (named) return named;
  return item.action === "add_to_pack" ? "Add to pack" : "Draft fix";
}

export function deskBriefingPrecardKind(action: MilonDeskBriefingAction): MilonDeskPrecardKind {
  return action === "add_to_pack" ? "pack" : "email";
}
