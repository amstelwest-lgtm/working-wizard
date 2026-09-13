/** Per-week amount overrides on a cash-forecast line item. Keys are week indexes "0"…"12". */
export type WeekOverrides = Record<string, number>;

export function applyWeekOverrides(
  vals: number[],
  overrides?: WeekOverrides | null,
): number[] {
  if (!overrides) return vals;
  const out = vals.slice();
  for (const [k, raw] of Object.entries(overrides)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= out.length) continue;
    if (!Number.isFinite(raw)) continue;
    out[i] = raw;
  }
  return out;
}

/** Set or clear one week. Empty / non-finite clears the override (formula wins again). */
export function setWeekOverride(
  overrides: WeekOverrides | undefined,
  weekIndex: number,
  value: number | null,
): WeekOverrides | undefined {
  const next: WeekOverrides = { ...(overrides ?? {}) };
  const key = String(weekIndex);
  if (value == null || !Number.isFinite(value)) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return Object.keys(next).length ? next : undefined;
}

export function parseEditableAmount(raw: string): number | null {
  const cleaned = raw.replace(/[\s,]/g, "").trim();
  if (cleaned === "" || cleaned === "-" || cleaned === "—") return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
