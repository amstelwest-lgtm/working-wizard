/**
 * Manual edits of the period P&L the waterfall and the live sheet show.
 * The agent propose path inserts figure_proposals with the service role.
 * A signed-in person cannot insert that row, so a double-click stages the
 * same patch and writes clients.financials only after Confirm.
 * Confirm false does not build a blob and does not write.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  financialsWriteRev,
  guardFinancialsWrite,
  withFinancialsWriteRev,
} from "@/lib/statement-import-apply";
import {
  applyConfirmedWaterfallPatch,
  type WaterfallFigureKey,
  type WaterfallFigurePatch,
} from "@/lib/figure-proposal";

const STEP_FIELD: Record<string, WaterfallFigureKey> = {
  Revenue: "revenue",
  "Cost of Sales": "cogs",
  "Gross profit": "grossProfit",
  "Operating Expenses": "fixedCosts",
  "Operating Profit": "ebit",
  Interest: "interest",
  Tax: "tax",
  "Net Profit": "netIncome",
};

const ROW_FIELD: Record<string, WaterfallFigureKey> = {
  sales: "revenue",
  "other-income": "revenue",
  "total-income": "revenue",
  cogs: "cogs",
  "total-cogs": "cogs",
  "gross-profit": "grossProfit",
  "total-expenses": "fixedCosts",
  "operating-profit": "ebit",
  interest: "interest",
  tax: "tax",
  "net-profit": "netIncome",
};

function storedAmount(fin: Record<string, unknown>, key: string): number | null {
  const value = fin[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function waterfallFieldForStep(label: string): WaterfallFigureKey | null {
  return STEP_FIELD[label] ?? null;
}

export function waterfallFieldForPnlRow(id: string): WaterfallFigureKey | null {
  return ROW_FIELD[id] ?? null;
}

/**
 * Map a confirmed P&L cell edit onto the waterfall keys clients.financials stores.
 * Sales and other income are display splits of revenue; the patch always targets revenue.
 */
export function buildPnlFigureEditDraft(input: {
  rowId: string;
  label: string;
  rowAmount: number;
  nextAmount: number;
  financials: Record<string, unknown> | null | undefined;
}): FigureEditDraft | null {
  const key = waterfallFieldForPnlRow(input.rowId);
  if (!key) return null;
  const fin = input.financials ?? {};
  const revenue = storedAmount(fin, "revenue");
  const otherIncome = storedAmount(fin, "otherIncome") ?? 0;

  if (input.rowId === "sales") {
    const before = revenue ?? round2(input.rowAmount + otherIncome);
    return {
      key: "revenue",
      label: input.label,
      before,
      after: round2(input.nextAmount + otherIncome),
    };
  }
  if (input.rowId === "other-income") {
    const salesPart =
      revenue != null ? round2(revenue - otherIncome) : input.rowAmount === otherIncome ? 0 : input.rowAmount;
    const before = revenue ?? round2(salesPart + otherIncome);
    return {
      key: "revenue",
      label: input.label,
      before,
      after: round2(salesPart + input.nextAmount),
    };
  }

  const before = storedAmount(fin, key) ?? input.rowAmount;
  return {
    key,
    label: input.label,
    before,
    after: input.nextAmount,
  };
}

export type FigureEditDraft = {
  key: WaterfallFigureKey;
  label: string;
  before: number;
  after: number;
};

/**
 * Read the stored P&L, merge the confirmed patch, and write that blob.
 * The revision guard is the same one statement import uses, so an older
 * autosave cannot land on top of this confirm.
 */
export async function saveConfirmedWaterfallPatch(
  clientId: string,
  patch: WaterfallFigurePatch,
): Promise<{ ok: true; financials: Record<string, unknown> } | { ok: false; reason: string }> {
  const checked = applyConfirmedWaterfallPatch({}, patch, true);
  if (!checked.ok) return checked;
  const { data: row, error: readError } = await supabase
    .from("clients")
    .select("financials")
    .eq("id", clientId)
    .maybeSingle();
  if (readError) return { ok: false, reason: readError.message };
  const server =
    row?.financials && typeof row.financials === "object" && !Array.isArray(row.financials)
      ? (row.financials as Record<string, unknown>)
      : {};
  const merged = applyConfirmedWaterfallPatch(server, patch, true);
  if (!merged.ok) return merged;
  const seen = financialsWriteRev(server);
  const stamped = withFinancialsWriteRev(merged.financials);
  const query = guardFinancialsWrite(
    supabase
      .from("clients")
      .update({
        financials: stamped as never,
        financials_updated_at: new Date().toISOString(),
      })
      .eq("id", clientId),
    seen,
  );
  const { data: updated, error } = await query.select("id");
  if (error) return { ok: false, reason: error.message };
  if (!updated?.length) {
    return { ok: false, reason: "The figures changed. Look again, then confirm." };
  }
  return { ok: true, financials: stamped };
}
