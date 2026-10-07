/**
 * Industry Benchmark preview when the sector has no rows.
 *
 * A stored type or a selected industry is named in the sentence. The profile
 * link stays in both cases: when the type is unset the accountant sets it,
 * and when it is set they can review or change it. The link does not invent
 * benchmark rows.
 */

export const BENCHMARK_SET_BUSINESS_TYPE_CTA = "Set the client's business type";
export const BENCHMARK_REVIEW_BUSINESS_TYPE_CTA = "Set or review the client's business type";

export type BenchmarkEmptyCopy = {
  message: string;
  /** True only when neither the profile nor the industry combobox has a sector. */
  offerSetBusinessType: boolean;
  /** Always a profile link. The wording depends on whether a type is already set. */
  cta: string;
};

export function benchmarkEmptyCopy(input: {
  /** Label from the client profile / business type, when one is stored. */
  profileSectorName?: string | null;
  /** Industry the reports combobox is showing. */
  studioSectorName?: string | null;
}): BenchmarkEmptyCopy {
  const profile = input.profileSectorName?.trim() ?? "";
  const studio = input.studioSectorName?.trim() ?? "";
  const name = profile || studio;
  if (!name || name === "—") {
    return {
      message:
        "No sector benchmarks available — set the client business type / profile, then regenerate.",
      offerSetBusinessType: true,
      cta: BENCHMARK_SET_BUSINESS_TYPE_CTA,
    };
  }
  return {
    message: `No benchmarks yet for ${name}.`,
    offerSetBusinessType: false,
    cta: BENCHMARK_REVIEW_BUSINESS_TYPE_CTA,
  };
}
