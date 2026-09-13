/**
 * Score-loop projections — a thin wrapper around the existing health engine.
 *
 * Does NOT invent a second score. It shocks the inputs that feed one driver,
 * then calls `healthFromRatioInputs` twice (conservative / stretch) and diffs.
 *
 * Numeric overall/pillar ranges are only emitted for Clear working-capital
 * levers (debtor / inventory / creditor days). Everything else is direction
 * only — Complex/Complicated moves must not look like a promised score lift.
 *
 * The standing $ "potential impact" is stored as a label, never summed.
 */

import { computeRatios, type RatioInputs } from "@/lib/ratios";
import {
  PILLAR_LABELS,
  RATIO_NAME_TO_KEY,
  healthFromRatioInputs,
  pillarForRatioName,
  type HealthPillarId,
  type ScoreMarket,
} from "@/lib/health-score";

export const SCORE_PROJECTION_VERSION = 1 as const;

/** Clear working-capital levers that may carry a numeric score range. */
export const NUMERIC_PROJECTION_KEYS = [
  "debtorDays",
  "inventoryDays",
  "creditorDays",
] as const;

export type NumericProjectionKey = (typeof NUMERIC_PROJECTION_KEYS)[number];

export type FrozenScoreProjection = {
  v: typeof SCORE_PROJECTION_VERSION;
  driverKey: string;
  driverName: string;
  kind: "numeric" | "direction";
  condition: string;
  pillar: HealthPillarId;
  /** Standing illustrative $ from the Next Move card — never summed. */
  impactLabel: string | null;
  frozenAt: string;
  financialsUpdatedAt: string | null;
  driver: {
    from: number | null;
    toConservative: number | null;
    toStretch: number | null;
    format: "days" | "pct" | "x" | "money";
  };
  overall: { from: number | null; toLow: number | null; toHigh: number | null } | null;
  pillarScore: { from: number | null; toLow: number | null; toHigh: number | null } | null;
};

export type ScoreProjectionCompare = {
  measured: boolean;
  driverActual: number | null;
  overallActual: number | null;
  pillarActual: number | null;
  doneCount: number;
  plannedCount: number;
  weSaid: string;
  whatMoved: string;
  read: string;
};

const KEY_TO_RATIO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(RATIO_NAME_TO_KEY).map(([name, key]) => [key, name]),
);

export function isNumericProjectionKey(key: string): key is NumericProjectionKey {
  return (NUMERIC_PROJECTION_KEYS as readonly string[]).includes(key);
}

export function driverKeyFromMoveKey(moveKey: string): string {
  return moveKey.split(":")[0] || moveKey;
}

function parseField(inputs: RatioInputs, key: keyof RatioInputs): number {
  const n = parseFloat(String(inputs[key] ?? ""));
  return Number.isFinite(n) ? n : NaN;
}

function withField(inputs: RatioInputs, key: keyof RatioInputs, value: number): RatioInputs {
  return { ...inputs, [key]: String(Math.round(value * 100) / 100) };
}

function scaleField(
  inputs: RatioInputs,
  key: keyof RatioInputs,
  factor: number,
): RatioInputs | null {
  const n = parseField(inputs, key);
  if (!Number.isFinite(n) || n <= 0) return null;
  return withField(inputs, key, n * factor);
}

/**
 * Conservative = 8% shock. Stretch = 15% (matches the existing illustrative
 * debtor-days cash line). Creditor days stretch *up* (longer supplier terms).
 */
export function shockInputsForDriver(
  inputs: RatioInputs,
  driverKey: string,
  intensity: "conservative" | "stretch",
): RatioInputs | null {
  const pct = intensity === "stretch" ? 0.15 : 0.08;
  if (driverKey === "debtorDays") return scaleField(inputs, "receivables", 1 - pct);
  if (driverKey === "inventoryDays") return scaleField(inputs, "inventory", 1 - pct);
  if (driverKey === "creditorDays") return scaleField(inputs, "payables", 1 + pct);
  return null;
}

function pillarOf(health: ReturnType<typeof healthFromRatioInputs>, id: HealthPillarId): number | null {
  const hit = health.pillars.find((p) => p.id === id);
  return hit && Number.isFinite(hit.score) ? hit.score : null;
}

function orderedRange(a: number | null, b: number | null): { toLow: number | null; toHigh: number | null } {
  if (a == null && b == null) return { toLow: null, toHigh: null };
  if (a == null) return { toLow: b, toHigh: b };
  if (b == null) return { toLow: a, toHigh: a };
  return { toLow: Math.min(a, b), toHigh: Math.max(a, b) };
}

function fmtScore(n: number | null): string {
  return n == null || !Number.isFinite(n) ? "—" : String(Math.round(n));
}

function fmtDriver(n: number | null, format: FrozenScoreProjection["driver"]["format"]): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (format === "days") return `${Math.round(n)} days`;
  if (format === "pct") return `${(n * 100).toFixed(1)}%`;
  return n.toFixed(2);
}

export function buildScoreProjection(input: {
  driverKey: string;
  inputs: RatioInputs;
  market?: ScoreMarket;
  cashRunwayWeeks?: number | null;
  impactLabel?: string | null;
  financialsUpdatedAt?: string | null;
  now?: string;
}): FrozenScoreProjection {
  const driverKey = driverKeyFromMoveKey(input.driverKey);
  const driverName = KEY_TO_RATIO_NAME[driverKey] ?? driverKey;
  const pillar = pillarForRatioName(driverName);
  const baseRatios = computeRatios(input.inputs);
  const baseHealth = healthFromRatioInputs(input.inputs, input.cashRunwayWeeks, input.market);
  const driverFrom = Number.isFinite(baseRatios[driverName]) ? baseRatios[driverName] : null;
  const format: FrozenScoreProjection["driver"]["format"] = driverName.includes("Days")
    ? "days"
    : driverName.includes("Margin") || driverName.includes("Share") || driverName.includes("Ratio")
      ? "pct"
      : "x";

  const numeric = isNumericProjectionKey(driverKey);
  const conservativeInputs = numeric ? shockInputsForDriver(input.inputs, driverKey, "conservative") : null;
  const stretchInputs = numeric ? shockInputsForDriver(input.inputs, driverKey, "stretch") : null;

  let toConservative: number | null = null;
  let toStretch: number | null = null;
  let overallRange: FrozenScoreProjection["overall"] = null;
  let pillarRange: FrozenScoreProjection["pillarScore"] = null;

  if (numeric && conservativeInputs && stretchInputs) {
    const cRatios = computeRatios(conservativeInputs);
    const sRatios = computeRatios(stretchInputs);
    const cHealth = healthFromRatioInputs(conservativeInputs, input.cashRunwayWeeks, input.market);
    const sHealth = healthFromRatioInputs(stretchInputs, input.cashRunwayWeeks, input.market);
    toConservative = Number.isFinite(cRatios[driverName]) ? cRatios[driverName] : null;
    toStretch = Number.isFinite(sRatios[driverName]) ? sRatios[driverName] : null;
    overallRange = {
      from: baseHealth.overall,
      ...orderedRange(cHealth.overall, sHealth.overall),
    };
    pillarRange = {
      from: pillarOf(baseHealth, pillar),
      ...orderedRange(pillarOf(cHealth, pillar), pillarOf(sHealth, pillar)),
    };
  }

  const kind: FrozenScoreProjection["kind"] =
    numeric && overallRange && overallRange.toLow != null ? "numeric" : "direction";

  const condition =
    kind === "numeric"
      ? `If ${driverName.toLowerCase()} moves toward ${fmtDriver(toStretch, format)} (illustrative ${driverKey === "creditorDays" ? "8–15% longer supplier terms" : "8–15% lift on the balance-sheet line"}), ${PILLAR_LABELS[pillar]} could move and the overall score may follow. If the driver does not move, the score does not move.`
      : `This lever is not a clean forecast. If ${driverName.toLowerCase()} actually improves in the next figures, ${PILLAR_LABELS[pillar]} is the pillar to watch. Completing the task does not move the score.`;

  return {
    v: SCORE_PROJECTION_VERSION,
    driverKey,
    driverName,
    kind,
    condition,
    pillar,
    impactLabel: input.impactLabel ?? null,
    frozenAt: input.now ?? new Date().toISOString(),
    financialsUpdatedAt: input.financialsUpdatedAt ?? null,
    driver: { from: driverFrom, toConservative, toStretch, format },
    overall: kind === "numeric" ? overallRange : null,
    pillarScore: kind === "numeric" ? pillarRange : null,
  };
}

export function projectionWeSaid(p: FrozenScoreProjection): string {
  if (p.kind === "numeric" && p.overall && p.pillarScore) {
    return `If ${p.driverName.toLowerCase()} moved toward ${fmtDriver(p.driver.toStretch, p.driver.format)}, ${PILLAR_LABELS[p.pillar]} ${fmtScore(p.pillarScore.from)} → ${fmtScore(p.pillarScore.toLow)}–${fmtScore(p.pillarScore.toHigh)}, overall ${fmtScore(p.overall.from)} → ${fmtScore(p.overall.toLow)}–${fmtScore(p.overall.toHigh)}. Illustrative — not a promise.`;
  }
  return `We would watch ${p.driverName} and ${PILLAR_LABELS[p.pillar]}. No overall number was promised — this is not a clean forecast.`;
}

export function compareScoreProjection(input: {
  projection: FrozenScoreProjection;
  currentRatios: Record<string, number>;
  currentOverall: number | null;
  currentPillars: Array<{ id: HealthPillarId; score: number | null }>;
  currentFinancialsUpdatedAt?: string | null;
  plannedCount: number;
  doneCount: number;
}): ScoreProjectionCompare {
  const p = input.projection;
  const measured =
    Boolean(input.currentFinancialsUpdatedAt) &&
    input.currentFinancialsUpdatedAt !== p.financialsUpdatedAt &&
    Boolean(p.frozenAt);
  const driverActual = Number.isFinite(input.currentRatios[p.driverName])
    ? input.currentRatios[p.driverName]
    : null;
  const pillarActual =
    input.currentPillars.find((x) => x.id === p.pillar)?.score ?? null;
  const overallActual = input.currentOverall;

  const whatMoved = `${p.driverName}: ${fmtDriver(p.driver.from, p.driver.format)} → ${fmtDriver(driverActual, p.driver.format)}. ${PILLAR_LABELS[p.pillar]}: ${fmtScore(p.pillarScore?.from ?? null)} → ${fmtScore(pillarActual)}. Overall: ${fmtScore(p.overall?.from ?? null)} → ${fmtScore(overallActual)}.`;

  let read =
    "The score follows the figures, not the ticks. Completing work is effort; the next pack of figures is the evidence.";
  if (measured && p.driver.from != null && driverActual != null) {
    const wanted = p.driver.toStretch ?? p.driver.toConservative;
    const toward =
      wanted != null &&
      ((wanted < p.driver.from && driverActual < p.driver.from) ||
        (wanted > p.driver.from && driverActual > p.driver.from));
    if (!toward) {
      read =
        "The work may be done, but this driver did not move the way the condition required. That is useful — the bottleneck may be elsewhere, or the action was not the right lever. Recalibrate with your accountant.";
    } else if (
      p.overall?.from != null &&
      overallActual != null &&
      overallActual < p.overall.from
    ) {
      read =
        "The planned driver moved, but the overall score dropped because it is a blend of four pillars. The action can be right and the score still fall. Read the pillar that got worse.";
    } else if (
      p.overall?.from != null &&
      overallActual != null &&
      Math.abs(overallActual - p.overall.from) < 1
    ) {
      read =
        "The driver shifted; the overall barely moved. Other ratios likely offset it. Do not credit or blame a single task for the score.";
    } else {
      read =
        "The driver moved with the figures. Treat that as correlation with the period, not proof that one task caused the score change.";
    }
  } else if (!measured) {
    read =
      "Waiting on the next figures. The score stays put until they land — ticking a box does not move it.";
  }

  return {
    measured,
    driverActual,
    overallActual,
    pillarActual,
    doneCount: input.doneCount,
    plannedCount: input.plannedCount,
    weSaid: projectionWeSaid(p),
    whatMoved,
    read,
  };
}

/** Never sum illustrative $ labels — keep the first standing estimate. */
export function standingImpactLabel(labels: Array<string | null | undefined>): string | null {
  for (const label of labels) {
    if (label && label.trim()) return label.trim();
  }
  return null;
}
