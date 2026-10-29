/**
 * Fixed "What this shows" lines for the Advisory Management Report.
 * The same sentence for every client. The meaning and the actions are frozen
 * on the pack and are not stored here.
 */
export const PACK_SHOWS = {
  health:
    "The health score by pillar, and the ratios that move it, from the figures signed off for this report.",
  dupont:
    "Return on equity split into net margin, asset turnover, and the equity multiplier, for this period and the prior period.",
  cash: "Expected cash in the bank at the end of each of the next 13 weeks, based on the approved forecast inputs.",
  profit:
    "How revenue becomes profit, step by step, and how gross, operating, and net margin compare with the prior period.",
} as const;

export type PackShowsKey = keyof typeof PACK_SHOWS;
