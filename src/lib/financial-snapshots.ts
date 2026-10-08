/**
 * Period-true financial snapshot upsert — keeps deliveries / movement reports
 * pointed at real history instead of live-only autosaves (G20).
 *
 * One row per (client_id, period_date) when we know the date, else period_label.
 * Autosave updates the current calendar month in place so we do not flood
 * the table on every keystroke debounce.
 */

import { supabase } from "@/integrations/supabase/client";
import { computeRatios, type RatioInputs } from "@/lib/ratios";
import { mergeStatementFinancials, type StatementKind } from "@/lib/statement-parse";
import { readStatementMeta, resolveSnapshotPeriodLabel } from "@/lib/statement-period";

export type SnapshotSource = "autosave" | "manual" | "upload" | "qbo" | "xero" | "sage" | "pdf_upload";

export type SnapshotRecency = {
  created_at?: string | null;
  period_date?: string | null;
  /**
   * Reserved. client_financial_snapshots has no pin column. If one appears
   * later, a pinned row wins over created_at. Do not invent a migration.
   */
  pinned?: boolean | null;
};

/**
 * The snapshot shown as "on file" / the data card. Newest upload wins by
 * created_at, not by the period label. Period-date order stays the history
 * used for prior-period movement.
 */
export function pickCurrentSnapshot<T extends SnapshotRecency>(rows: readonly T[] | null | undefined): T | null {
  const list = (rows ?? []).filter((row): row is T => row != null);
  if (!list.length) return null;
  const pinned = list.find((row) => row.pinned === true);
  if (pinned) return pinned;
  return [...list].sort((a, b) => {
    const created = Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "");
    if (Number.isFinite(created) && created !== 0) return created;
    return (b.period_date ?? "").localeCompare(a.period_date ?? "");
  })[0];
}

/** Statement uploads are stored as both "upload" and "pdf_upload". */
export function isUploadSnapshot(source: string | null | undefined): boolean {
  return source === "upload" || source === "pdf_upload" || source === "financial_statement";
}

/** Calendar period label used across Studio / score history / autosave. */
export function currentPeriodLabel(now = new Date()): string {
  return now.toLocaleString("en-US", { month: "short", year: "numeric" });
}

export function currentPeriodDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function periodLabelFromDate(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (!Number.isFinite(d.getTime())) return currentPeriodLabel();
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

export function periodDateFromUnknown(
  raw: string | null | undefined,
  fallback = currentPeriodDate(),
): string {
  const s = raw?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  return fallback;
}

export async function upsertPeriodSnapshot(opts: {
  clientId: string;
  financials: Record<string, unknown>;
  periodDate?: string | null;
  periodLabel?: string | null;
  ratios?: Record<string, number> | null;
  source?: SnapshotSource;
  /** When set, an existing row is merged. The import writes only this statement. */
  statementKind?: StatementKind | null;
}): Promise<{ id: string | null; error: string | null; periodLabel: string; periodDate: string }> {
  const periodDate = periodDateFromUnknown(opts.periodDate);
  const requestedLabel = opts.periodLabel?.trim() || periodLabelFromDate(periodDate);

  const byDate = await supabase
    .from("client_financial_snapshots")
    .select("id, period_label, financials")
    .eq("client_id", opts.clientId)
    .eq("period_date", periodDate)
    .maybeSingle();

  let existing = byDate.data as {
    id?: string;
    period_label?: string | null;
    financials?: unknown;
  } | null;
  let existingId = existing?.id ?? null;
  if (!existingId) {
    const byLabel = await supabase
      .from("client_financial_snapshots")
      .select("id, period_label, financials")
      .eq("client_id", opts.clientId)
      .eq("period_label", requestedLabel)
      .maybeSingle();
    existing = byLabel.data as typeof existing;
    existingId = existing?.id ?? null;
  }

  const mergeOnWrite = Boolean(existingId) && (Boolean(opts.statementKind) || isUploadSnapshot(opts.source));
  const financialsToWrite = mergeOnWrite
    ? mergeStatementFinancials(existing?.financials, opts.financials, opts.statementKind)
    : opts.financials;
  const ratiosOut = mergeOnWrite
    ? computeRatios(financialsToWrite as unknown as RatioInputs)
    : (opts.ratios ?? computeRatios(opts.financials as unknown as RatioInputs));

  const periodLabel = resolveSnapshotPeriodLabel(existing?.period_label, requestedLabel);
  const statementSource = readStatementMeta(opts.financials).statementSource;
  const ledgerSource =
    statementSource === "qbo" || statementSource === "xero" || statementSource === "sage"
      ? statementSource
      : null;

  if (existingId) {
    const { error } = await supabase
      .from("client_financial_snapshots")
      .update({
        financials: financialsToWrite as never,
        ratios: ratiosOut as never,
        period_label: periodLabel,
        period_date: periodDate,
        ...(ledgerSource ? { source: ledgerSource } : {}),
      })
      .eq("id", existingId);
    if (error) return { id: null, error: error.message, periodLabel, periodDate };
    return { id: existingId, error: null, periodLabel, periodDate };
  }

  const { data, error } = await supabase
    .from("client_financial_snapshots")
    .insert({
      client_id: opts.clientId,
      period_label: periodLabel,
      period_date: periodDate,
      financials: financialsToWrite as never,
      ratios: ratiosOut as never,
      source: ledgerSource ?? opts.source ?? "autosave",
    })
    .select("id")
    .maybeSingle();

  if (error) return { id: null, error: error.message, periodLabel, periodDate };
  return {
    id: (data as { id: string } | null)?.id ?? null,
    error: null,
    periodLabel,
    periodDate,
  };
}

/**
 * Upsert this month's snapshot with the given financials blob + derived ratios.
 * Returns the snapshot id when known, else null (best-effort — never throws).
 */
export async function upsertCurrentPeriodSnapshot(opts: {
  clientId: string;
  financials: Record<string, unknown>;
  /** Optional precomputed ratios; otherwise derived from RatioInputs-shaped financials. */
  ratios?: Record<string, number> | null;
  source?: SnapshotSource;
}): Promise<{ id: string | null; error: string | null }> {
  const result = await upsertPeriodSnapshot({
    clientId: opts.clientId,
    financials: opts.financials,
    periodDate: currentPeriodDate(),
    periodLabel: currentPeriodLabel(),
    ratios: opts.ratios,
    source: opts.source,
  });
  return { id: result.id, error: result.error };
}
