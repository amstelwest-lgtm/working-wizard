/**
 * One sign-off vocabulary for Health, Profitability, Cash, Budget, Action Plan,
 * and the pack.
 *
 *   Draft
 *   Ready for review
 *   Signed off by X · date
 *   Signed off by X · figures have changed since; re-review
 *
 * Page and report staleness is read-side. A stored approval stays. A later
 * statement period, a newer freshness timestamp, or a health score that no
 * longer matches the score on file at sign-off keeps the signer and says so.
 */

export const SIGNOFF_STATUS_DRAFT = "Draft";
export const SIGNOFF_STATUS_READY = "Ready for review";
/** Page and report sign-offs. Pack approvals still say regenerate. */
export const PAGE_FIGURES_CHANGED_CLAUSE = "figures have changed since; re-review";
/** Pill when the sentence already carries the long stale line. */
export const SIGNOFF_STATUS_STALE_SHORT = "Signed off · figures changed";

export type SignoffStatusKind = "draft" | "ready" | "signed" | "stale";

/** Which of the four lines applies. Does not format the sentence. */
export function signoffStatusKind(input: {
  hasSignoff: boolean;
  isStale: boolean;
  readyForReview: boolean;
}): SignoffStatusKind {
  if (input.hasSignoff && input.isStale) return "stale";
  if (input.hasSignoff) return "signed";
  if (input.readyForReview) return "ready";
  return "draft";
}

/** Short scope for the status pill. The status words themselves stay below. */
export function signoffScopeLabel(scope: string | null | undefined): string | null {
  switch ((scope ?? "").trim()) {
    case "financials":
      return "Financials";
    case "profitability":
      return "Profit";
    case "cash_forecast":
      return "Cash";
    case "budget":
      return "Budget";
    case "action_plan":
      return "Action plan";
    case "advisory":
      return "Advisory";
    default:
      return null;
  }
}

export function signoffStatusLine(input: {
  kind: SignoffStatusKind;
  name?: string | null;
  /** Already formatted clock. Used for a clean sign-off. */
  date?: string | null;
  /**
   * `short` is the pill when the sentence already says who signed and that
   * the figures changed. Other kinds ignore it.
   */
  variant?: "full" | "short";
  /** Optional prefix, e.g. "Financials: signed off · figures changed". */
  scopeLabel?: string | null;
  /**
   * Replaces the default stale clause and keeps the sign-off date.
   * Budget uses "figures changed since sign-off".
   */
  staleClause?: string | null;
}): string {
  const line = signoffStatusBody(input);
  const scope = input.scopeLabel?.trim() || "";
  if (!scope) return line;
  return `${scope}: ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
}

function signoffStatusBody(input: {
  kind: SignoffStatusKind;
  name?: string | null;
  date?: string | null;
  variant?: "full" | "short";
  staleClause?: string | null;
}): string {
  if (input.kind === "ready") return SIGNOFF_STATUS_READY;
  const name = input.name?.trim() || "";
  if (input.kind === "signed") {
    const date = input.date?.trim() || "";
    if (name && date) return `Signed off by ${name} · ${date}`;
    if (name) return `Signed off by ${name}`;
  }
  if (input.kind === "stale") {
    const clause = input.staleClause?.trim() || "";
    if (clause) {
      const date = input.date?.trim() || "";
      const who = name ? `Signed off by ${name}` : "Signed off";
      if (date) return `${who} · ${date} · ${clause}`;
      return name ? `Signed off by ${name} · ${clause}` : clause;
    }
    if (input.variant === "short") return SIGNOFF_STATUS_STALE_SHORT;
    if (name) return `Signed off by ${name} · ${PAGE_FIGURES_CHANGED_CLAUSE}`;
    return PAGE_FIGURES_CHANGED_CLAUSE;
  }
  return SIGNOFF_STATUS_DRAFT;
}

/** True when an input clock is later than the signature, past the same-sitting grace. */
export function inputsChangedSinceSignoff(
  signedOffAt: string | null | undefined,
  inputsUpdatedAt: string | null | undefined,
): boolean {
  const signed = Date.parse(signedOffAt ?? "");
  const updated = Date.parse(inputsUpdatedAt ?? "");
  if (!Number.isFinite(signed) || !Number.isFinite(updated)) return false;
  return updated > signed + SIGNED_PERIOD_GRACE_MS;
}

/** Uploads that land in the same sitting as the signature are the signed period. */
const SIGNED_PERIOD_GRACE_MS = 15 * 60 * 1000;

export type SignoffPeriodSnapshot = {
  created_at?: string | null;
  period_label?: string | null;
  period_date?: string | null;
  financials?: unknown;
};

function periodKey(snap: SignoffPeriodSnapshot): string {
  const fields =
    snap.financials && typeof snap.financials === "object"
      ? (snap.financials as Record<string, unknown>)
      : null;
  const start = typeof fields?.periodStart === "string" ? fields.periodStart.slice(0, 10) : "";
  const end = typeof fields?.periodEnd === "string" ? fields.periodEnd.slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) return `${start}/${end}`;
  return (snap.period_label || snap.period_date || "").trim().toLowerCase().replace(/\s+/g, " "); // date-ok: sign-off period key, not printed copy
}

/**
 * True when the figures a page or report sign-off covered are no longer the
 * figures on screen. Same idea as `advisoryPackFiguresChanged`: compare what
 * was current at sign-off with what is current now. Does not write.
 */
/**
 * Budget stamp only. The clock is not a figure: an autosave that only moves
 * `budget_updated_at` is not stale. Stale means the signed figure snapshot
 * and the plan on screen are different. No snapshot is not stale.
 */
export function budgetSignoffIsStale(
  signoff: { signed_off_at: string } | null | undefined,
  _budgetUpdatedAt: string | null | undefined,
  figuresChanged?: boolean,
): boolean {
  if (!signoff) return false;
  return figuresChanged === true;
}

/**
 * Cash stamp only. Same rule as the budget stamp: stale when the signed
 * figure snapshot and the forecast on file differ. No snapshot is not stale.
 */
export function cashSignoffIsStale(
  signoff: { signed_off_at: string } | null | undefined,
  _forecastUpdatedAt: string | null | undefined,
  figuresChanged?: boolean,
): boolean {
  if (!signoff) return false;
  return figuresChanged === true;
}

export function reviewFiguresChanged(input: {
  signedOffAt?: string | null;
  dataUpdatedAt?: string | null;
  snapshots?: readonly SignoffPeriodSnapshot[] | null;
  liveHealth?: number | null;
  /** Health recorded on or before the sign-off day. */
  signedHealth?: number | null;
}): boolean {
  const signedAt = input.signedOffAt?.trim() ?? "";
  const signedMs = Date.parse(signedAt);
  if (!signedAt || !Number.isFinite(signedMs)) return false;

  const updatedMs = Date.parse(input.dataUpdatedAt ?? "");
  if (Number.isFinite(updatedMs) && updatedMs > signedMs) return true;

  if (
    input.liveHealth != null &&
    input.signedHealth != null &&
    Number.isFinite(input.liveHealth) &&
    Number.isFinite(input.signedHealth) &&
    Math.round(input.liveHealth) !== Math.round(input.signedHealth)
  ) {
    return true;
  }

  const cutoff = signedMs + SIGNED_PERIOD_GRACE_MS;
  const dated = (input.snapshots ?? []).flatMap((snap) => {
    const ms = Date.parse(snap.created_at ?? "");
    const key = periodKey(snap);
    if (!Number.isFinite(ms) || !key) return [];
    return [{ ms, key }];
  });
  const then = dated.filter((snap) => snap.ms <= cutoff).sort((a, b) => b.ms - a.ms)[0];
  if (!then) return false;
  return dated.some((snap) => snap.ms > cutoff && snap.key !== then.key);
}

/** Latest score history row on or before the sign-off day. Read-side. */
export function signedHealthFromHistory(
  history: readonly { period_date: string; score: number }[] | null | undefined,
  signedOffAt: string,
): number | null {
  const day = signedOffAt.slice(0, 10);
  const prior = (history ?? [])
    .filter((row) => row.period_date <= day && Number.isFinite(row.score))
    .sort((a, b) => b.period_date.localeCompare(a.period_date));
  return prior[0]?.score ?? null;
}
