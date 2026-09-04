/**
 * Optional product-line mix on clients.financials.productMix.
 * Per-unit selling price and cost → margin is calculated, not guessed.
 * Hidden on the Profit tab until opted in via a 5-question funnel.
 */

export const PRODUCT_MIX_VERSION = 2 as const;
export const PRODUCT_MIX_MAX_LINES = 5;

export type ProductShareBand = "small" | "quarter" | "half" | "most";
export type ProductMarginBand = "high" | "mid" | "low" | "unknown";

export type ProductMixLine = {
  id: string;
  name: string;
  shareBand?: ProductShareBand;
  /** Selling price per unit (rand). */
  sellPrice?: number;
  /** Direct cost per unit (rand). */
  unitCost?: number;
  /** (price − cost) / price, 0–100. Derived on save. */
  marginPct?: number;
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

export function parseMoney(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/** Gross margin % from selling price and unit cost. Null if price is missing or 0. */
export function unitMarginPct(sellPrice?: number, unitCost?: number): number | null {
  if (sellPrice == null || sellPrice <= 0 || unitCost == null) return null;
  return ((sellPrice - unitCost) / sellPrice) * 100;
}

export function marginBandFromPct(pct: number | null): ProductMarginBand {
  if (pct == null) return "unknown";
  if (pct >= 40) return "high";
  if (pct >= 20) return "mid";
  return "low";
}

export function formatRand(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `R\u00a0${n.toLocaleString("en-ZA", { maximumFractionDigits: 2 })}`;
}

export function formatMarginPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(0)}%`;
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
  const sellPrice = parseMoney(r.sellPrice);
  const unitCost = parseMoney(r.unitCost);
  const computed = unitMarginPct(sellPrice, unitCost);
  const storedPct = parseMoney(r.marginPct);
  return {
    id,
    name,
    shareBand: parseShareBand(r.shareBand),
    sellPrice,
    unitCost,
    marginPct: computed ?? storedPct,
    marginBand: parseMarginBand(r.marginBand) ?? marginBandFromPct(computed),
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
  const derived = deriveBestWorst(lines);
  const bestLineId = typeof o.bestLineId === "string" && o.bestLineId ? o.bestLineId : derived.bestLineId;
  const worstLineId = typeof o.worstLineId === "string" && o.worstLineId ? o.worstLineId : derived.worstLineId;
  const ids = new Set(lines.map((l) => l.id));
  return {
    version: PRODUCT_MIX_VERSION,
    confirmedAt,
    active: o.active === true && lines.length > 0,
    lines,
    bestLineId: bestLineId && ids.has(bestLineId) ? bestLineId : derived.bestLineId,
    worstLineId: worstLineId && ids.has(worstLineId) ? worstLineId : derived.worstLineId,
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

/** Q2: at least two named lines before unit economics. */
export function canAdvanceFromNames(names: string[]): boolean {
  return trimmedLineNames(names).length >= 2;
}

export function canAdvanceFromPrices(lines: ProductMixLine[]): boolean {
  const named = namedProductLines({ ...emptyProductMix(), lines });
  return named.length >= 2 && named.every((l) => l.sellPrice != null && l.sellPrice > 0);
}

export function canAdvanceFromCosts(lines: ProductMixLine[]): boolean {
  const named = namedProductLines({ ...emptyProductMix(), lines });
  return named.length >= 2 && named.every((l) => l.unitCost != null);
}

export function canAdvanceFromShares(lines: ProductMixLine[]): boolean {
  const named = namedProductLines({ ...emptyProductMix(), lines });
  return named.length >= 2 && named.every((l) => l.shareBand != null);
}

export function canSaveUnitMix(mix: ProductMix): boolean {
  return canAdvanceFromPrices(mix.lines) && canAdvanceFromCosts(mix.lines) && canAdvanceFromShares(mix.lines);
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

function deriveBestWorst(lines: ProductMixLine[]): { bestLineId?: string; worstLineId?: string } {
  const scored = lines
    .map((l) => ({ id: l.id, pct: unitMarginPct(l.sellPrice, l.unitCost) }))
    .filter((r) => r.pct != null) as Array<{ id: string; pct: number }>;
  if (scored.length < 2) return {};
  const byPct = [...scored].sort((a, b) => b.pct - a.pct || a.id.localeCompare(b.id));
  const best = byPct[0];
  const worst = byPct[byPct.length - 1];
  if (!best || !worst || best.id === worst.id) return { bestLineId: best?.id };
  return { bestLineId: best.id, worstLineId: worst.id };
}

/** Stamp computed margin % / bands and best/worst from unit economics. */
export function applyUnitEconomics(mix: ProductMix): ProductMix {
  const named = namedProductLines(mix).map((l) => {
    const marginPct = unitMarginPct(l.sellPrice, l.unitCost) ?? undefined;
    return {
      ...l,
      marginPct,
      marginBand: marginBandFromPct(marginPct ?? null),
    };
  });
  const flags = deriveBestWorst(named);
  return {
    ...mix,
    version: PRODUCT_MIX_VERSION,
    active: named.length > 0,
    lines: named,
    bestLineId: flags.bestLineId,
    worstLineId: flags.worstLineId,
  };
}

export type RankedProductLine = {
  id: string;
  name: string;
  shareBand?: ProductShareBand;
  sharePct: number;
  sellPrice?: number;
  unitCost?: number;
  marginPct: number | null;
  marginBand?: ProductMarginBand;
  isBest: boolean;
  isWorst: boolean;
  barPct: number;
};

/** Rank by unit margin (most profitable per unit). Bar width follows margin, floored so zeros still show. */
export function rankProductLines(mix: ProductMix): RankedProductLine[] {
  if (!mix.active) return [];
  const named = namedProductLines(mix);
  const rows = named.map((l) => {
    const marginPct = unitMarginPct(l.sellPrice, l.unitCost);
    return {
      id: l.id,
      name: l.name,
      shareBand: l.shareBand,
      sharePct: shareBandPct(l.shareBand),
      sellPrice: l.sellPrice,
      unitCost: l.unitCost,
      marginPct,
      marginBand: l.marginBand ?? marginBandFromPct(marginPct),
      isBest: l.id === mix.bestLineId,
      isWorst: l.id === mix.worstLineId,
    };
  });
  rows.sort((a, b) => {
    const ma = a.marginPct ?? -Infinity;
    const mb = b.marginPct ?? -Infinity;
    return mb - ma || b.sharePct - a.sharePct || a.name.localeCompare(b.name);
  });
  const max = Math.max(1, ...rows.map((r) => Math.max(0, r.marginPct ?? 0)));
  return rows.map((r) => ({
    ...r,
    barPct: r.marginPct != null ? Math.max(8, Math.round((Math.max(0, r.marginPct) / max) * 100)) : 12,
  }));
}

export function productMixSummary(mix: ProductMix): string {
  if (!hasProductMixAnswer(mix)) return "Unit price and cost — 5 questions, margin calculated";
  if (!mix.active || mix.lines.length === 0) return "One main line — breakdown skipped";
  const ranked = rankProductLines(mix);
  const best = ranked.find((r) => r.isBest) ?? ranked[0];
  const worst = ranked.find((r) => r.isWorst) ?? ranked[ranked.length - 1];
  if (best && worst && best.id !== worst.id) {
    return `${ranked.length} lines · ${best.name} ${formatMarginPct(best.marginPct)} · ${worst.name} ${formatMarginPct(worst.marginPct)}`;
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
