/**
 * Chart palette shared by the profit waterfall and the cash forecast, so the
 * two read as one product: cobalt for balances and totals, green for money in,
 * red for money out or a shortfall, navy for reference lines.
 */
export type PaletteTone = "navy" | "cobalt" | "green" | "red" | "redDeep";

export const PALETTE: Record<PaletteTone, { from: string; to: string }> = {
  navy: { from: "#2c5580", to: "#1a3a5c" },
  cobalt: { from: "#2563eb", to: "#0b5fff" },
  green: { from: "#41c586", to: "#1f9e62" },
  red: { from: "#f29191", to: "#e76a6a" },
  redDeep: { from: "#d6565a", to: "#bf3a44" },
};

/** Soft tile tints behind KPI values, matching the waterfall's status chips. */
export const PALETTE_TINT = {
  neutral: "#e8f1fe",
  good: "rgba(31, 158, 98, 0.06)",
  bad: "rgba(231, 106, 106, 0.06)",
} as const;

export function paletteGradient(tone: PaletteTone): string {
  const { from, to } = PALETTE[tone];
  return `linear-gradient(180deg, ${from}, ${to})`;
}
