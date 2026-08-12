/**
 * Current-period financial snapshot upsert — keeps deliveries / movement reports
 * pointed at real history instead of live-only autosaves (G20).
 *
 * One row per (client_id, period_label); autosave updates in place so we do not
 * flood the table on every keystroke debounce.
 */

import { supabase } from "@/integrations/supabase/client";
import { computeRatios, type RatioInputs } from "@/lib/ratios";

export type SnapshotSource = "autosave" | "manual" | "upload" | "qbo";

/** Calendar period label used across Studio / score history / autosave. */
export function currentPeriodLabel(now = new Date()): string {
  return now.toLocaleString("en-US", { month: "short", year: "numeric" });
}

export function currentPeriodDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
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
  const periodLabel = currentPeriodLabel();
  const periodDate = currentPeriodDate();
  const ratiosOut =
    opts.ratios ??
    computeRatios(opts.financials as unknown as RatioInputs);

  const { data: existing } = await supabase
    .from("client_financial_snapshots")
    .select("id")
    .eq("client_id", opts.clientId)
    .eq("period_label", periodLabel)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("client_financial_snapshots")
      .update({
        financials: opts.financials as never,
        ratios: ratiosOut as never,
      })
      .eq("id", existing.id);
    if (error) return { id: null, error: error.message };
    return { id: existing.id, error: null };
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

  if (error) return { id: null, error: error.message };
  return { id: (data as { id: string } | null)?.id ?? null, error: null };
}
