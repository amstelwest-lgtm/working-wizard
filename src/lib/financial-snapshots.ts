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

export type SnapshotSource = "autosave" | "manual" | "upload" | "qbo" | "pdf_upload";

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
}): Promise<{ id: string | null; error: string | null; periodLabel: string; periodDate: string }> {
  const periodDate = periodDateFromUnknown(opts.periodDate);
  const periodLabel = opts.periodLabel?.trim() || periodLabelFromDate(periodDate);
  const ratiosOut =
    opts.ratios ?? computeRatios(opts.financials as unknown as RatioInputs);

  const byDate = await supabase
    .from("client_financial_snapshots")
    .select("id")
    .eq("client_id", opts.clientId)
    .eq("period_date", periodDate)
    .maybeSingle();

  let existingId = (byDate.data as { id?: string } | null)?.id ?? null;
  if (!existingId) {
    const byLabel = await supabase
      .from("client_financial_snapshots")
      .select("id")
      .eq("client_id", opts.clientId)
      .eq("period_label", periodLabel)
      .maybeSingle();
    existingId = (byLabel.data as { id?: string } | null)?.id ?? null;
  }

  if (existingId) {
    const { error } = await supabase
      .from("client_financial_snapshots")
      .update({
        financials: opts.financials as never,
        ratios: ratiosOut as never,
        period_label: periodLabel,
        period_date: periodDate,
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
      financials: opts.financials as never,
      ratios: ratiosOut as never,
      source: opts.source ?? "autosave",
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
