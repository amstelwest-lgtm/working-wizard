/**
 * Optional product-line mix on clients.financials.productMix.
 * Directional (bands + best/worst), not SKU-level COGS. Hidden on the Profit
 * tab until the owner or accountant opts in via a 5-question funnel.
 */

export const PRODUCT_MIX_VERSION = 1 as const;
export const PRODUCT_MIX_MAX_LINES = 5;

export type ProductShareBand = "small" | "quarter" | "half" | "most";
export type ProductMarginBand = "high" | "mid" | "low" | "unknown";

export type ProductMixLine = {
  id: string;
  name: string;
  shareBand?: ProductShareBand;
  marginBand?: ProductMarginBand;
};

export type ProductMix = {
  version: typeof PRODUCT_MIX_VERSION;
  confirmedAt: string | null;
  /** false = single-line business / declined the breakdown */
  active: boolean;
  lines: ProductMixLine[];
  bestLineId?: string;
  worstLineId?: string;
};

export const SHARE_BANDS: Array<{
  id: ProductShareBand;
  label: string;
  hint: string;
  pct: number;
}> = [
  { id: "small", label: "A small slice", hint: "Roughly 10% of sales", pct: 10 },
  { id: "quarter", label: "About a quarter", hint: "Roughly 25% of sales", pct: 25 },
  { id: "half", label: "About half", hint: "Roughly 50% of sales", pct: 50 },
  { id: "most", label: "Most of the book", hint: "Roughly 70%+ of sales", pct: 70 },
];

const SHARE_IDS = new Set<ProductShareBand>(SHARE_BANDS.map((b) => b.id));

export function emptyProductMix(): ProductMix {
  return { version: PRODUCT_MIX_VERSION, confirmedAt: null, active: false, lines: [] };
}

export function declinedProductMix(at = new Date().toISOString()): ProductMix {
  return { version: PRODUCT_MIX_VERSION, confirmedAt: at, active: false, lines: [] };
}

export function newProductLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `pl-${crypto.randomUUID()}`;
  }
  return `pl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function shareBandPct(band?: ProductShareBand): number {
  return SHARE_BANDS.find((b) => b.id === band)?.pct ?? 0;
}

export function shareBandLabel(band?: ProductShareBand): string {
  return SHARE_BANDS.find((b) => b.id === band)?.label ?? "—";
}

function parseShareBand(raw: unknown): ProductShareBand | undefined {
  return typeof raw === "string" && SHARE_IDS.has(raw as ProductShareBand)
    ? (raw as ProductShareBand)
    : undefined;
}

function parseMarginBand(raw: unknown): ProductMarginBand | undefined {
  return raw === "high" || raw === "mid" || raw === "low" || raw === "unknown" ? raw : undefined;
}

function parseLine(raw: unknown, index: number): ProductMixLine | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;
  const id = typeof r.id === "string" && r.id ? r.id : `pl-${index}`;
  return {
    id,
    name,
    shareBand: parseShareBand(r.shareBand),
    marginBand: parseMarginBand(r.marginBand),
  };
}

/** Coerce a financials.productMix blob into a typed mix. */
export function parseProductMix(raw: unknown): ProductMix {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyProductMix();
  const o = raw as Record<string, unknown>;
  const linesRaw = Array.isArray(o.lines) ? o.lines : [];
  const lines: ProductMixLine[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < linesRaw.length && lines.length < PRODUCT_MIX_MAX_LINES; i++) {
    const line = parseLine(linesRaw[i], i);
    if (!line) continue;
    let id = line.id;
    if (seen.has(id)) id = `${id}-${i}`;
    seen.add(id);
    lines.push({ ...line, id });
  }
  const confirmedAt = typeof o.confirmedAt === "string" && o.confirmedAt ? o.confirmedAt : null;
  const bestLineId = typeof o.bestLineId === "string" && o.bestLineId ? o.bestLineId : undefined;
  const worstLineId = typeof o.worstLineId === "string" && o.worstLineId ? o.worstLineId : undefined;
  const ids = new Set(lines.map((l) => l.id));
  return {
    version: PRODUCT_MIX_VERSION,
    confirmedAt,
    active: o.active === true && lines.length > 0,
    lines,
    bestLineId: bestLineId && ids.has(bestLineId) ? bestLineId : undefined,
    worstLineId: worstLineId && ids.has(worstLineId) ? worstLineId : undefined,
  };
}

export function hasProductMixAnswer(mix: ProductMix): boolean {
  return mix.confirmedAt != null;
}

export function namedProductLines(mix: ProductMix): ProductMixLine[] {
  return mix.lines.filter((l) => l.name.trim());
}

export function trimmedLineNames(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= PRODUCT_MIX_MAX_LINES) break;
  }
  return out;
}

/** Q2: at least two named lines before ranking. */
export function canAdvanceFromNames(names: string[]): boolean {
  return trimmedLineNames(names).length >= 2;
}

export function canAdvanceFromShares(lines: ProductMixLine[]): boolean {
  const named = namedProductLines({ ...emptyProductMix(), lines });
  return named.length >= 2 && named.every((l) => l.shareBand != null);
}

export function canSaveRanking(mix: ProductMix): boolean {
  const named = namedProductLines(mix);
  if (named.length < 2) return false;
  const ids = new Set(named.map((l) => l.id));
  if (!mix.bestLineId || !mix.worstLineId) return false;
  if (mix.bestLineId === mix.worstLineId) return false;
  return ids.has(mix.bestLineId) && ids.has(mix.worstLineId);
}

export function linesFromNames(names: string[], prev: ProductMixLine[] = []): ProductMixLine[] {
  const used = new Set<string>();
  return trimmedLineNames(names).map((name) => {
    const match = prev.find(
      (l) => l.name.trim().toLowerCase() === name.toLowerCase() && !used.has(l.id),
    );
    if (match) {
      used.add(match.id);
      return { ...match, name };
    }
    return { id: newProductLineId(), name };
  });
}

export function applyMarginFlags(mix: ProductMix): ProductMix {
  const named = namedProductLines(mix);
  return {
    ...mix,
    version: PRODUCT_MIX_VERSION,
    active: named.length > 0,
    lines: named.map((l) => ({
      ...l,
      marginBand:
        l.id === mix.bestLineId ? "high" : l.id === mix.worstLineId ? "low" : mix.bestLineId || mix.worstLineId ? "mid" : "unknown",
    })),
  };
}

export type RankedProductLine = {
  id: string;
  name: string;
  shareBand?: ProductShareBand;
  sharePct: number;
  marginBand?: ProductMarginBand;
  isBest: boolean;
  isWorst: boolean;
  barPct: number;
};

/** Rank by rough sales share; best/worst are margin callouts, not a second sort. */
export function rankProductLines(mix: ProductMix): RankedProductLine[] {
  if (!mix.active) return [];
  const named = namedProductLines(mix);
  const rows = named.map((l) => ({
    id: l.id,
    name: l.name,
    shareBand: l.shareBand,
    sharePct: shareBandPct(l.shareBand),
    marginBand: l.marginBand,
    isBest: l.id === mix.bestLineId,
    isWorst: l.id === mix.worstLineId,
  }));
  rows.sort((a, b) => b.sharePct - a.sharePct || a.name.localeCompare(b.name));
  const max = Math.max(1, ...rows.map((r) => r.sharePct));
  return rows.map((r) => ({ ...r, barPct: r.sharePct ? Math.round((r.sharePct / max) * 100) : 28 }));
}

export function productMixSummary(mix: ProductMix): string {
  if (!hasProductMixAnswer(mix)) return "See which lines drive margin — 5 quick questions";
  if (!mix.active || mix.lines.length === 0) return "One main line — breakdown skipped";
  const ranked = rankProductLines(mix);
  const best = ranked.find((r) => r.isBest);
  const worst = ranked.find((r) => r.isWorst);
  if (best && worst) {
    return `${ranked.length} lines · ${best.name} strongest · ${worst.name} needs a look`;
  }
  return `${ranked.length} product lines`;
}

/** Overlay mix onto an existing financials blob without wiping period scalars, weeks, or debt. */
export function overlayProductMix(
  existing: Record<string, unknown> | null | undefined,
  mix: ProductMix,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  base.productMix = mix;
  return base;
}
