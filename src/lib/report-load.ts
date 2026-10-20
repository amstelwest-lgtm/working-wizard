/**
 * What a reports embed still has to fetch, and which sign-off row it may show.
 * Health already loaded `client_review_signoffs`. The scorecard uses that row.
 */

export type ReportFetchPlan = {
  benchmarks: boolean;
  budget: boolean;
  cashWorkflow: boolean;
};

/**
 * A single scorecard does not need sector benchmarks, budget actuals, or the
 * cash deliverable workflow. An empty list is the full catalogue.
 */
export function reportFetchPlan(onlyKeys: readonly string[] | null | undefined): ReportFetchPlan {
  if (!onlyKeys || onlyKeys.length === 0) {
    return { benchmarks: true, budget: true, cashWorkflow: true };
  }
  const keys = new Set(onlyKeys);
  return {
    benchmarks: keys.has("benchmark"),
    budget: keys.has("budget"),
    cashWorkflow: keys.has("forecast"),
  };
}

/**
 * Once the parent has loaded sign-offs, a missing scope is unsigned.
 * Before that, the studio's own row is the only copy it has.
 */
export function preferKnownReportSignoff<T>(input: {
  signoffsKnown: boolean;
  known: Partial<Record<string, T | null | undefined>> | null | undefined;
  scope: string;
  loaded: T | null;
}): T | null {
  if (!input.signoffsKnown) return input.loaded;
  return (input.known?.[input.scope] ?? null) as T | null;
}

/** Parent stale flags win for scopes they computed. Others keep the studio result. */
export function preferKnownSignoffStale(input: {
  signoffsKnown: boolean;
  known: Partial<Record<string, boolean>> | null | undefined;
  scope: string;
  computed: boolean;
}): boolean {
  if (!input.signoffsKnown || !input.known) return input.computed;
  if (Object.prototype.hasOwnProperty.call(input.known, input.scope)) {
    return input.known[input.scope] === true;
  }
  return input.computed;
}

/** Card and PDF stamp. Same row and same stale bit as Health when the parent knows. */
export function studioSignoffState<T>(input: {
  signoffsKnown: boolean;
  known: Partial<Record<string, T | null | undefined>> | null | undefined;
  knownStale?: Partial<Record<string, boolean>> | null;
  scope: string;
  loaded: T | null;
  computedStale: boolean;
}): { signoff: T | null; isStale: boolean } {
  const signoff = preferKnownReportSignoff(input);
  return {
    signoff,
    isStale: preferKnownSignoffStale({
      signoffsKnown: input.signoffsKnown,
      known: input.knownStale,
      scope: input.scope,
      computed: input.computedStale,
    }),
  };
}
