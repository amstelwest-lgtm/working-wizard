/**
 * Industry Benchmark preview when there are no rows.
 * The reports combobox always has a selection (it defaults to a SIC label).
 * That selection is a sector. A stored client profile is a sector too.
 * Ask the user to set a business type only when neither one is present.
 */

export type BenchmarkEmptyCopy = {
  message: string;
  offerSetBusinessType: boolean;
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
    };
  }
  return {
    message: `No benchmarks yet for ${name}.`,
    offerSetBusinessType: false,
  };
}
