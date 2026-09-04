/**
 * Optional product-line mix on clients.financials.productMix.
 * Per-unit selling price and cost → margin is calculated, not guessed.
 * Q5 asks rand of stated total revenue per named line — sales share and GP share
 * are derived. Hidden on the Profit tab until opted in via a 5-question funnel.
 */

import { formatMoney, ZA_MARKET, type MoneyMarket } from "@/lib/market";

export const PRODUCT_MIX_VERSION = 3 as const;
export const PRODUCT_MIX_MAX_LINES = 5;

export type ProductShareBand = "small" | "quarter" | "half" | "most";
export type ProductMarginBand = "high" | "mid" | "low" | "unknown";

export type ProductMixLine = {
  id: string;
  name: string;
  /** @deprecated v1/v2 guessed bands — kept so old blobs still parse */
  shareBand?: ProductShareBand;
  sellPrice?: number;
  unitCost?: number;
  marginPct?: number;
  marginBand?: ProductMarginBand;
  /** Rand of stated total revenue from this line. */
  revenueAmount?: number;
  revenueSharePct?: number;
  gpAmount?: number;
  gpSharePct?: number;
};

export type ProductMix = {
  version: typeof PRODUCT_MIX_VERSION;
  confirmedAt: string | null;
  active: boolean;
  lines: ProductMixLine[];
  bestLineId?: string;
  worstLineId?: string;
  /** Snapshot of the Profit tab total revenue used in Q5. */
  totalRevenue?: number;
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

export function formatRand(n: number | undefined, market: MoneyMarket = ZA_MARKET): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatMoney(n, market, { maximumFractionDigits: 2 });
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
    revenueAmount: parseMoney(r.revenueAmount),
    revenueSharePct: parseMoney(r.revenueSharePct),
    gpAmount: parseMoney(r.gpAmount),
    gpSharePct: parseMoney(r.gpSharePct),
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
  const bestLineId =
    typeof o.bestLineId === "string" && o.bestLineId ? o.bestLineId : derived.bestLineId;
  const worstLineId =
    typeof o.worstLineId === "string" && o.worstLineId ? o.worstLineId : derived.worstLineId;
  const ids = new Set(lines.map((l) => l.id));
  return {
    version: PRODUCT_MIX_VERSION,
    confirmedAt,
    active: o.active === true && lines.length > 0,
    lines,
    bestLineId: bestLineId && ids.has(bestLineId) ? bestLineId : derived.bestLineId,
    worstLineId: worstLineId && ids.has(worstLineId) ? worstLineId : derived.worstLineId,
    totalRevenue: parseMoney(o.totalRevenue),
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

export function canAdvanceFromRevenue(lines: ProductMixLine[]): boolean {
  const named = namedProductLines({ ...emptyProductMix(), lines });
  return named.length >= 2 && named.every((l) => l.revenueAmount != null);
}

export function canSaveUnitMix(mix: ProductMix): boolean {
  return (
    canAdvanceFromPrices(mix.lines) &&
    canAdvanceFromCosts(mix.lines) &&
    canAdvanceFromRevenue(mix.lines)
  );
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
  const scored = lines.map((l) => ({
    id: l.id,
    gp: l.gpSharePct,
    margin: unitMarginPct(l.sellPrice, l.unitCost),
  }));
  const byGp = scored.filter((r) => r.gp != null) as Array<{
    id: string;
    gp: number;
    margin: number | null;
  }>;
  if (byGp.length >= 2) {
    const sorted = [...byGp].sort(
      (a, b) => b.gp - a.gp || (b.margin ?? -Infinity) - (a.margin ?? -Infinity),
    );
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if (best && worst && best.id !== worst.id)
      return { bestLineId: best.id, worstLineId: worst.id };
  }
  const byMargin = scored.filter((r) => r.margin != null) as Array<{ id: string; margin: number }>;
  if (byMargin.length < 2) return {};
  const sorted = [...byMargin].sort((a, b) => b.margin - a.margin || a.id.localeCompare(b.id));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (!best || !worst || best.id === worst.id) return { bestLineId: best?.id };
  return { bestLineId: best.id, worstLineId: worst.id };
}

export function allocatedRevenue(lines: ProductMixLine[]): number {
  return namedProductLines({ ...emptyProductMix(), lines }).reduce(
    (s, l) => s + (l.revenueAmount ?? 0),
    0,
  );
}

/** Stamp margin, revenue share, GP share, and best/worst. */
export function applyUnitEconomics(
  mix: ProductMix,
  totalRevenue = mix.totalRevenue ?? 0,
): ProductMix {
  const withMargin = namedProductLines(mix).map((l) => {
    const marginPct = unitMarginPct(l.sellPrice, l.unitCost) ?? undefined;
    return {
      ...l,
      marginPct,
      marginBand: marginBandFromPct(marginPct ?? null),
    };
  });
  const allocated = allocatedRevenue(withMargin);
  const denom = totalRevenue > 0 ? totalRevenue : allocated;
  const withRev = withMargin.map((l) => {
    const revenueAmount = l.revenueAmount;
    const revenueSharePct =
      denom > 0 && revenueAmount != null ? (revenueAmount / denom) * 100 : undefined;
    const gpAmount =
      revenueAmount != null && l.marginPct != null
        ? revenueAmount * (l.marginPct / 100)
        : undefined;
    return { ...l, revenueSharePct, gpAmount };
  });
  const totalGp = withRev.reduce((s, l) => s + (l.gpAmount ?? 0), 0);
  const lines = withRev.map((l) => ({
    ...l,
    gpSharePct: totalGp > 0 && l.gpAmount != null ? (l.gpAmount / totalGp) * 100 : undefined,
  }));
  const flags = deriveBestWorst(lines);
  return {
    ...mix,
    version: PRODUCT_MIX_VERSION,
    active: lines.length > 0,
    lines,
    totalRevenue: totalRevenue > 0 ? totalRevenue : allocated || undefined,
    bestLineId: flags.bestLineId,
    worstLineId: flags.worstLineId,
  };
}

export function shareContrastLabel(revenueSharePct?: number, gpSharePct?: number): string {
  const sales =
    revenueSharePct != null && Number.isFinite(revenueSharePct)
      ? `${revenueSharePct.toFixed(0)}% of sales`
      : null;
  const gp =
    gpSharePct != null && Number.isFinite(gpSharePct) ? `${gpSharePct.toFixed(0)}% of GP` : null;
  if (sales && gp) return `${sales} · ${gp}`;
  return sales ?? gp ?? "";
}

export type RankedProductLine = {
  id: string;
  name: string;
  shareBand?: ProductShareBand;
  sharePct: number;
  revenueAmount?: number;
  revenueSharePct?: number;
  gpAmount?: number;
  gpSharePct?: number;
  sellPrice?: number;
  unitCost?: number;
  marginPct: number | null;
  marginBand?: ProductMarginBand;
  isBest: boolean;
  isWorst: boolean;
  barPct: number;
};

/** Rank by GP share (then unit margin). Bar width follows GP share when present. */
export function rankProductLines(mix: ProductMix): RankedProductLine[] {
  if (!mix.active) return [];
  const named = namedProductLines(mix);
  const rows = named.map((l) => {
    const marginPct = unitMarginPct(l.sellPrice, l.unitCost);
    const sharePct = l.revenueSharePct ?? shareBandPct(l.shareBand);
    return {
      id: l.id,
      name: l.name,
      shareBand: l.shareBand,
      sharePct,
      revenueAmount: l.revenueAmount,
      revenueSharePct: l.revenueSharePct,
      gpAmount: l.gpAmount,
      gpSharePct: l.gpSharePct,
      sellPrice: l.sellPrice,
      unitCost: l.unitCost,
      marginPct,
      marginBand: l.marginBand ?? marginBandFromPct(marginPct),
      isBest: l.id === mix.bestLineId,
      isWorst: l.id === mix.worstLineId,
    };
  });
  rows.sort((a, b) => {
    const ga = a.gpSharePct ?? -Infinity;
    const gb = b.gpSharePct ?? -Infinity;
    if (ga !== gb && Number.isFinite(ga) && Number.isFinite(gb)) return gb - ga;
    const ma = a.marginPct ?? -Infinity;
    const mb = b.marginPct ?? -Infinity;
    return mb - ma || b.sharePct - a.sharePct || a.name.localeCompare(b.name);
  });
  const max = Math.max(1, ...rows.map((r) => Math.max(0, r.gpSharePct ?? r.marginPct ?? 0)));
  return rows.map((r) => {
    const weight = r.gpSharePct ?? r.marginPct;
    return {
      ...r,
      barPct: weight != null ? Math.max(8, Math.round((Math.max(0, weight) / max) * 100)) : 12,
    };
  });
}

export function productMixSummary(mix: ProductMix): string {
  if (!hasProductMixAnswer(mix)) return "Of total revenue — how much is from each line";
  if (!mix.active || mix.lines.length === 0) return "One main line — breakdown skipped";
  const ranked = rankProductLines(mix);
  const best = ranked.find((r) => r.isBest) ?? ranked[0];
  const worst = ranked.find((r) => r.isWorst) ?? ranked[ranked.length - 1];
  if (best && worst && best.id !== worst.id) {
    const bestContrast = shareContrastLabel(best.revenueSharePct, best.gpSharePct);
    if (bestContrast) {
      return `${ranked.length} lines · ${best.name}: ${bestContrast}`;
    }
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
