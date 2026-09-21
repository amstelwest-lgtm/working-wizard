/**
 * Statement period labels shared by the Xero sync and the Profitability /
 * cash-forecast UI. Pure — safe to import from client components.
 */

export type StatementMeta = {
  statementSource: string | null;
  periodLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function utcDate(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Calendar month containing `now`, shifted back `monthsBack` months. Month 0 ends today when the month is still open. */
export function calendarMonthBounds(
  now = new Date(),
  monthsBack = 0,
): { from: string; to: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() - monthsBack;
  const start = new Date(Date.UTC(y, m, 1));
  const monthEnd = new Date(Date.UTC(y, m + 1, 0));
  let end = monthEnd;
  if (monthsBack === 0) {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (today < monthEnd) end = today;
  }
  return { from: isoDateUTC(start), to: isoDateUTC(end) };
}

/**
 * Comparison column 0 is the primary range. Later columns are full calendar
 * months stepping backward (Xero `timeframe=MONTH`).
 */
export function columnPeriod(
  primaryFrom: string,
  primaryTo: string,
  column: number,
): { from: string; to: string } {
  if (column <= 0) return { from: primaryFrom, to: primaryTo };
  const start = utcDate(primaryFrom);
  if (!start) return { from: primaryFrom, to: primaryTo };
  const shifted = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - column, 1));
  const end = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0));
  return { from: isoDateUTC(shifted), to: isoDateUTC(end) };
}

/** "Sep 2026" for a full month, "1–21 Sep 2026" for a month-to-date range. */
export function formatStatementPeriodLabel(fromIso: string, toIso: string): string {
  const from = utcDate(fromIso);
  const to = utcDate(toIso);
  if (!from || !to) return "";
  const fy = from.getUTCFullYear();
  const fm = from.getUTCMonth();
  const fd = from.getUTCDate();
  const ty = to.getUTCFullYear();
  const tm = to.getUTCMonth();
  const td = to.getUTCDate();
  if (fy === ty && fm === tm) {
    const last = new Date(Date.UTC(fy, fm + 1, 0)).getUTCDate();
    if (fd === 1 && td === last) return `${MONTHS[fm]} ${fy}`;
    return `${fd}–${td} ${MONTHS[fm]} ${fy}`;
  }
  return `${fd} ${MONTHS[fm]} ${fy} – ${td} ${MONTHS[tm]} ${ty}`;
}

/** Short month stamp used by older snapshots (`Sep 2026`), UTC so it matches the report month. */
export function calendarMonthStamp(iso: string): string {
  const d = utcDate(iso);
  if (!d) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function str(fields: Record<string, unknown>, key: string): string | null {
  const v = fields[key];
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

export function readStatementMeta(fields: object | null | undefined): StatementMeta {
  const f = (fields ?? {}) as Record<string, unknown>;
  const periodStart = str(f, "periodStart");
  const periodEnd = str(f, "periodEnd");
  const explicit = str(f, "periodLabel");
  return {
    statementSource: str(f, "statementSource"),
    periodStart,
    periodEnd,
    periodLabel:
      explicit ||
      (periodStart && periodEnd ? formatStatementPeriodLabel(periodStart, periodEnd) : null),
  };
}
