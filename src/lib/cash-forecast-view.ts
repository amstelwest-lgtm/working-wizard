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
  if (input.opensBelow) {
    if (input.weeksBelow <= 0) return { value: "Below floor now", sub: "recovers W1" };
    if (input.firstDipWeek != null) {
      const date = input.firstDipDate?.trim();
      return {
        value: "Below floor now",
        sub: date ? `first dip W${input.firstDipWeek} · ${date}` : `first dip W${input.firstDipWeek}`,
      };
    }
    return { value: "Below floor now", sub: `${input.weeksBelow} of ${horizon} weeks` };
  }
  const value = `${input.weeksBelow} of ${horizon}`;
  if (input.firstDipWeek != null) {
    const date = input.firstDipDate?.trim();
    return {
      value,
      sub: date ? `first dip W${input.firstDipWeek} · ${date}` : `first dip W${input.firstDipWeek}`,
    };
  }
  return { value, sub: "stays above the floor" };
}

/** Opening, then each week's close. The graph, the low point, and the table tint share this. */
export type CashBalancePoint = {
  key: string;
  week: number;
  balance: number;
  belowFloor: boolean;
  negative: boolean;
};

export function cashBalanceSeries(input: {
  opening: number;
  closings: readonly number[];
  floor: number;
}): CashBalancePoint[] {
  const floor = input.floor;
  const opening = Number.isFinite(input.opening) ? input.opening : 0;
  const points: CashBalancePoint[] = [
    {
      key: "Now",
      week: 0,
      balance: opening,
      belowFloor: opening < floor,
      negative: opening < 0,
    },
  ];
  input.closings.forEach((raw, index) => {
    const balance = Number.isFinite(raw) ? raw : 0;
    points.push({
      key: `W${index + 1}`,
      week: index + 1,
      balance,
      belowFloor: balance < floor,
      negative: balance < 0,
    });
  });
  return points;
}

/** First minimum wins, so an opening that ties a later close stays the low point. */
export function lowestCashPoint(series: readonly CashBalancePoint[]): CashBalancePoint {
  let best = series[0];
  for (const point of series) {
    if (!best || point.balance < best.balance) best = point;
  }
  return (
    best ?? { key: "Now", week: 0, balance: 0, belowFloor: false, negative: false }
  );
}

/**
 * Tick labels for the cash graph. A wide or unmeasured frame shows every
 * point. A narrow frame keeps Now (when present), then W4, W7, W10 and W13.
 */
export function cashGraphAxisTicks(
  chartWidth: number,
  keys: readonly string[],
): string[] | undefined {
  if (cashGraphWeekTickInterval(chartWidth) === 0 || keys.length === 0) return undefined;
  const first = keys[0]!;
  const weeks = first === "Now" ? keys.slice(1) : keys;
  const picked: string[] = first === "Now" ? [first] : weeks.length ? [weeks[0]!] : [];
  for (let i = 3; i < weeks.length; i += 3) picked.push(weeks[i]!);
  const last = keys[keys.length - 1]!;
  if (picked[picked.length - 1] !== last) picked.push(last);
  return picked;
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
