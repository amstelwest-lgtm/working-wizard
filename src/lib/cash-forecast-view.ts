/**
 * Cash tab view: Graph is the default (no search param). `view=13week` opens
 * the weekly model. Old detailed-forecast anchors land on that same card.
 */
import { forecastFloorPosition } from "./cash-forecast-parity.ts";

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
  if (input.empty) return { value: "—", sub: "Not enough data" };
  const horizon = input.horizon > 0 ? input.horizon : 13;
  if (input.opensBelow) {
    if (input.weeksBelow <= 0) return { value: "Below floor now", sub: "recovers W1" };
    if (input.firstDipWeek != null) {
      const date = input.firstDipDate?.trim();
      return {
        value: "Below floor now",
        sub: date
          ? `first dip W${input.firstDipWeek} · ${date}`
          : `first dip W${input.firstDipWeek}`,
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
  return best ?? { key: "Now", week: 0, balance: 0, belowFloor: false, negative: false };
}

export type ForecastScreenTiles = {
  lowestValue: string;
  lowestSub: string;
  /** Null when there is no series to score against a floor. */
  lowestUnder: boolean | null;
  weeksValue: string;
  weeksSub: string;
  /** True when this same series opens under the floor or a closing does. */
  weeksAlert: boolean;
};

/**
 * Lowest point, the floor gap, and weeks-below-floor from one series.
 * An empty series does not fall back to the opening, and it does not
 * borrow the $50,000 fallback floor. Missing openings stay unscored.
 * "Above" / "under" follows the sign of lowest − floor.
 */
export function forecastScreenTiles(input: {
  empty: boolean;
  opening: number | null;
  closings: readonly number[];
  floor: number | null;
  format: (amount: number) => string;
  weekDates?: readonly (string | null | undefined)[];
}): ForecastScreenTiles {
  const unscored = (sub: string): ForecastScreenTiles => ({
    lowestValue: "—",
    lowestSub: sub,
    lowestUnder: null,
    weeksValue: "—",
    weeksSub: sub,
    weeksAlert: false,
  });
  if (input.empty) return unscored("Not enough data");
  const floor = input.floor;
  const opening = input.opening;
  if (opening == null || !Number.isFinite(opening) || floor == null || !Number.isFinite(floor)) {
    return unscored("Opening cash unknown");
  }
  const series = cashBalanceSeries({
    opening,
    closings: input.closings,
    floor,
  });
  const low = lowestCashPoint(series);
  const gap = low.balance - floor;
  const under = gap < 0;
  const relation = `${input.format(Math.abs(gap))} ${under ? "under" : "above"} the floor`;
  const pos = forecastFloorPosition({
    opening,
    closings: input.closings,
    floor,
  });
  const weeks = weeksBelowFloorCopy({
    empty: false,
    weeksBelow: pos.weeksBelow,
    horizon: input.closings.length > 0 ? input.closings.length : 13,
    firstDipWeek: pos.firstDipWeek,
    firstDipDate:
      pos.firstDipWeek != null ? (input.weekDates?.[pos.firstDipWeek - 1] ?? null) : null,
    opensBelow: pos.opensBelow,
  });
  return {
    lowestValue: input.format(low.balance),
    lowestSub: low.week === 0 ? `Opening · ${relation}` : `Week ${low.week} · ${relation}`,
    lowestUnder: under,
    weeksValue: weeks.value,
    weeksSub: weeks.sub,
    weeksAlert: pos.weeksBelow > 0 || pos.opensBelow,
  };
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

/**
 * Width to store for the cash graph. A hidden frame reports 0 and must not
 * reset a measured chart. A few pixels either side of the 440px tick
 * breakpoint must not flip the axis, or the chart margin and the measured
 * frame chase each other and lock the tab.
 */
/**
 * Y domain that keeps the runway floor on the chart.
 * Auto domain follows the cash line, so a floor above that line is clipped
 * and the breach fill paints the whole plot.
 */
export function cashYDomainIncludingFloor(
  dataMin: number,
  dataMax: number,
  floor: number,
): [number, number] {
  const lo = Math.min(dataMin, floor);
  const hi = Math.max(dataMax, floor);
  const pad = Math.max(hi - lo, 1) * 0.08;
  return [lo - pad, hi + pad];
}

export function stableCashChartWidth(previous: number, next: number): number {
  if (!Number.isFinite(next) || next <= 0) return previous > 0 ? previous : 0;
  const rounded = Math.round(next);
  if (previous <= 0) return rounded;
  if (rounded === previous || Math.abs(rounded - previous) < 2) return previous;
  const crossed = cashGraphWeekTickInterval(previous) !== cashGraphWeekTickInterval(rounded);
  if (crossed && Math.abs(rounded - 440) <= 24) return previous;
  return rounded;
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
