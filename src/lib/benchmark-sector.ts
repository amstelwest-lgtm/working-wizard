/**
 * One sector key for industry_benchmarks.business_type.
 *
 * Stored values are mixed: business-type ids (`retail`), display labels
 * (`Retail`), and SIC names (`Wholesale Trade — Non-Specialised`). The table
 * keys are lowercase (`retail`, `services`, `saas`, `hospitality`,
 * `construction`, `manufacturing`, `professional`, `other`).
 *
 * `industry_benchmarks` has no market or region column. Callers filter on
 * this key only, so a US client is not excluded from retail.
 *
 * Unknown labels return null. Callers must not invent rows. `other` is
 * returned only when the existing business-type map already sends that
 * model there (distribution, product, logistics, and the wholesale labels
 * that mean distribution).
 */
import { BUSINESS_TYPE_TO_BENCHMARK } from "@/lib/ratios";

export const BENCHMARK_BUSINESS_TYPES = [
  "retail",
  "services",
  "saas",
  "hospitality",
  "construction",
  "manufacturing",
  "professional",
  "other",
] as const;

export type BenchmarkBusinessType = (typeof BENCHMARK_BUSINESS_TYPES)[number];

const BENCHMARK_KEYS = new Set<string>(BENCHMARK_BUSINESS_TYPES);

/**
 * Display labels and SIC names that are not business-type ids.
 * Wholesale follows `distribution`, which the existing map sends to `other`.
 */
const LABEL_TO_TYPE_ID: Record<string, string> = {
  "service business": "service",
  "product business": "product",
  "saas and software": "saas",
  "marketplaces and platforms": "marketplace",
  "asset based business": "asset_heavy",
  "wholesale and distribution": "distribution",
  retail: "retail",
  manufacturing: "manufacturing",
  "project based services": "project",
  franchise: "franchise",
  "subscription business": "subscription",
  agency: "agency",
  "transport and logistics": "logistics",
  hospitality: "hospitality",
  "healthcare practices": "healthcare",
  "construction and contracting": "construction",
  "mixed model": "hybrid",
  "professional services": "professional",
  "hotels and accommodation": "hospitality",
  "restaurants and hospitality": "hospitality",
  "restaurants and food service": "hospitality",
  "fuel retail": "retail",
  "retail trade food and beverages": "retail",
  "construction general building": "construction",
  "it services and software": "saas",
  "professional and legal services": "professional",
  "professional practices": "professional",
  "road freight transport": "logistics",
  "estate and deal agencies": "agency",
  "media and marketing agencies": "agency",
  "wholesale trade non specialised": "distribution",
  "wholesale trade non specialized": "distribution",
  "security services": "service",
  "salons and personal services": "service",
  "retainer services": "service",
  "labour and staffing": "service",
  "labor and staffing": "service",
};

function foldLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asBenchmarkKey(typeId: string): BenchmarkBusinessType | null {
  if (BENCHMARK_KEYS.has(typeId)) return typeId as BenchmarkBusinessType;
  const mapped = BUSINESS_TYPE_TO_BENCHMARK[typeId];
  if (mapped && BENCHMARK_KEYS.has(mapped)) return mapped as BenchmarkBusinessType;
  return null;
}

/** Trim, case-fold, and map a stored type or display label. Null when unmapped. */
export function benchmarkBusinessType(
  raw: string | null | undefined,
): BenchmarkBusinessType | null {
  const folded = foldLabel(raw ?? "");
  if (!folded) return null;
  const direct = asBenchmarkKey(folded);
  if (direct) return direct;
  const labelled = LABEL_TO_TYPE_ID[folded];
  if (!labelled) return null;
  return asBenchmarkKey(labelled);
}

/**
 * Stored business type wins. A template label is used only when that type
 * does not map. The reports industry combobox is not an input.
 */
export function benchmarkSectorForClient(input: {
  businessType?: string | null;
  templateLabel?: string | null;
}): BenchmarkBusinessType | null {
  return (
    benchmarkBusinessType(input.businessType) ?? benchmarkBusinessType(input.templateLabel)
  );
}
