/**
 * Cash tab view: Graph is the default (no search param). `view=13week` opens
 * the weekly model. Old detailed-forecast anchors land on that same card.
 */

export const CASH_FORECAST_CARD_ID = "wizard-cash-table";

/** Hashes that used to point at the separate detailed-forecast section. */
export const CASH_DETAIL_ANCHORS = [
  "detailed-forecast",
  "detailed-cashflow",
  "detailed-cashflow-forecast",
  "cash-detailed-forecast",
  "wizard-cash-table",
] as const;

export type CashForecastView = "graph" | "13week";

export function cashForecastViewFromSearch(view: string | null | undefined): CashForecastView {
  return view === "13week" ? "13week" : "graph";
}

/** Graph drops `view`. 13-week sets `view=13week` and keeps every other param. */
export function cashForecastSearchWithView(
  prev: Record<string, unknown>,
  view: CashForecastView,
): Record<string, unknown> {
  const next = { ...prev };
  if (view === "13week") next.view = "13week";
  else delete next.view;
  return next;
}

/** Tile copy for weeks under the floor. The runway readout stays off this tile. */
export function weeksBelowFloorCopy(input: {
  empty: boolean;
  weeksBelow: number;
  horizon: number;
  firstDipWeek: number | null;
  firstDipDate: string | null;
  opensBelow: boolean;
}): { value: string; sub: string } {
  if (input.empty) return { value: "—", sub: "Add a bank balance or lines" };
  const horizon = input.horizon > 0 ? input.horizon : 13;
  const value = `${input.weeksBelow} of ${horizon}`;
  if (input.firstDipWeek != null) {
    const date = input.firstDipDate?.trim();
    return {
      value,
      sub: date ? `first dip W${input.firstDipWeek} · ${date}` : `first dip W${input.firstDipWeek}`,
    };
  }
  if (input.opensBelow) return { value, sub: "opening is under the floor" };
  return { value, sub: "stays above the floor" };
}

/**
 * Recharts `interval` for the cash graph. `0` shows every week. `2` keeps
 * W1, W4, W7, W10 and W13 (every third tick, both ends included).
 * An unmeasured width stays on every week until the frame is laid out.
 */
export function cashGraphWeekTickInterval(chartWidth: number): 0 | 2 {
  if (!Number.isFinite(chartWidth) || chartWidth <= 0 || chartWidth >= 440) return 0;
  return 2;
}

export function hashIsCashDetailAnchor(hash: string | null | undefined): boolean {
  const id = (hash ?? "").replace(/^#/, "").split("?")[0].trim().toLowerCase();
  return (CASH_DETAIL_ANCHORS as readonly string[]).includes(id);
}

/**
 * Stored forecast source → a key `figureSourceChipLabel` already names
 * (Xero, QuickBooks, Uploaded statement, Bank, Assumption, …).
 */
export function forecastChipSource(source: string | null | undefined): string {
  switch ((source ?? "").trim()) {
    case "xero":
    case "xero-bank-summary":
      return "xero";
    case "qbo":
    case "qbo-bank-activity":
      return "qbo";
    case "sage":
      return "sage";
    case "upload":
    case "pdf_upload":
      return "upload";
    case "financial_statement":
      return "financial_statement";
    case "bank":
    case "bank_pack":
      return "bank_pack";
    case "manual":
    case "accountant":
      return "manual";
    case "autosave":
      return "autosave";
    case "lighthouse_import":
      return "lighthouse_import";
    case "statement":
      return "statement";
    default:
      return "assumption";
  }
}
