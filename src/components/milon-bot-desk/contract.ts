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

export type MilonDeskCoverage = {
  /** Health and the books are on file. */
  controller: boolean;
  /** A budget variance is on file. */
  fpa: boolean;
  /** Cash or aged receivables are on file. */
  treasury: boolean;
};

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
  label: string;
  /** Preformatted figure. A blank figure is not shown. */
  figure: string;
  /** Raw statement source. The desk passes it to figureSourceChipLabel. */
  source: string | null;
  action: MilonDeskBriefingAction;
};

export type MilonDeskJobKind = "collections_chase" | "budget_variance";

export type MilonDeskPrecardKind = "email" | "pack" | "bot";

export type MilonDeskJob = {
  id: string;
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
  | "pack_draft"
  | "email_draft"
  | "signoff";

export type MilonDeskActivityEvent = {
  id: string;
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
  coverage: MilonDeskCoverage;
  signoff: MilonDeskSignoff;
  briefing: MilonDeskBriefingItem[];
  jobs: MilonDeskJob[];
  activity: MilonDeskActivityEvent[];
  precard: MilonDeskPrecard;
};

const COVERAGE_CHIPS: { key: keyof MilonDeskCoverage; label: string }[] = [
  { key: "controller", label: "Controller" },
  { key: "fpa", label: "FP&A" },
  { key: "treasury", label: "Treasury" },
];

export function deskCoverageChips(coverage: MilonDeskCoverage): { label: string; active: boolean }[] {
  return COVERAGE_CHIPS.map((chip) => ({ label: chip.label, active: coverage[chip.key] }));
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

/** "Reviewed books · synced 2h ago", or the empty line when there is no timestamp. */
export function deskSyncedStatus(syncedAt: string | null, now: string): string {
  const syncedMs = Date.parse(syncedAt ?? "");
  const nowMs = Date.parse(now);
  if (!Number.isFinite(syncedMs) || !Number.isFinite(nowMs)) return "No books on file yet";
  const mins = Math.round((nowMs - syncedMs) / 60_000);
  let ago = "just now";
  if (mins >= 60 * 36) {
    ago = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(syncedMs));
  } else if (mins >= 60) {
    ago = `${Math.round(mins / 60)}h ago`;
  } else if (mins >= 1) {
    ago = `${mins}m ago`;
  }
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
  return `Budget variance: ${label} ${formatSignedPct(pct)}. Explain to owner?`;
}

export function deskBriefingActionLabel(action: MilonDeskBriefingAction): string {
  return action === "add_to_pack" ? "Add to pack" : "Draft fix";
}

export function deskBriefingPrecardKind(action: MilonDeskBriefingAction): MilonDeskPrecardKind {
  return action === "add_to_pack" ? "pack" : "email";
}
