/**
 * Intervention steps quote the ratio on file.
 * A positive net margin is a profit. It is not a loss and not a critical rescue.
 */

export type InterventionTier = "critical" | "at_risk" | "healthy";

export type GroundedIntervention = {
  tier: InterventionTier;
  title: string;
  description: string;
};

function compactKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

export function isNetMarginRatio(ratioKey: string, ratioName: string): boolean {
  const key = compactKey(ratioKey);
  return key === "netmargin" || ratioName.trim().toLowerCase() === "net margin";
}

/** Fractions (0.022) and percent points (2.2) both become a fraction. */
export function marginFraction(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.abs(value) > 1.5 ? value / 100 : value;
}

export function groundInterventionStep(input: {
  ratioKey: string;
  ratioName: string;
  tier: InterventionTier;
  value: number | null;
  formattedValue?: string | null;
  title: string;
  description: string;
  revenue?: number | null;
  netProfit?: number | null;
  formatMoney?: (amount: number) => string;
}): GroundedIntervention {
  const formatted = input.formattedValue?.trim() || "";
  const cited = formatted
    ? `${input.ratioName} is ${formatted}.`
    : input.value != null && Number.isFinite(input.value)
      ? `${input.ratioName} is ${input.value}.`
      : "";

  if (!isNetMarginRatio(input.ratioKey, input.ratioName) || input.value == null || !Number.isFinite(input.value)) {
    return {
      tier: input.tier,
      title: input.title,
      description: cited ? `${cited} ${input.description}`.trim() : input.description,
    };
  }

  const fraction = marginFraction(input.value);
  const pct = `${(fraction * 100).toFixed(1)}%`;
  const money = input.formatMoney;
  const revenue =
    money && input.revenue != null && Number.isFinite(input.revenue)
      ? ` on revenue of ${money(input.revenue)}`
      : "";
  const profit =
    money && input.netProfit != null && Number.isFinite(input.netProfit)
      ? ` Net profit is ${money(input.netProfit)}.`
      : "";
  const head = `Net margin is ${pct}${revenue}.`;

  if (fraction > 0) {
    const tier: InterventionTier = fraction >= 0.15 ? "healthy" : "at_risk";
    return {
      tier,
      title: `Net margin is ${pct}`,
      description: `${head}${profit} That is a profit, not a loss. It is thin enough to watch, and it is not a critical rescue.`,
    };
  }
  if (fraction < 0) {
    return {
      tier: "critical",
      title: `Net margin is ${pct}`,
      description: `${head}${profit} Net margin is negative, so this period is a loss. ${input.description}`.trim(),
    };
  }
  return {
    tier: "at_risk",
    title: "Net margin is 0.0%",
    description: `${head}${profit} The period breaks even. That is not a loss.`.trim(),
  };
}

type PlaybookCopy = {
  ratio_key: string;
  ratio_name: string;
  health_tier: string;
  step_number: number;
  step_title: string;
  step_description: string;
};

/**
 * The first playbook step is the one the Intervention Plan shows.
 * A positive net margin keeps that step number (sign-off still attaches to it)
 * and replaces the loss pack with the grounded sentence.
 */
export function groundPlaybookSteps<T extends PlaybookCopy>(
  steps: T[],
  input: {
    ratioKey: string;
    ratioName: string;
    tier: InterventionTier;
    value: number | null;
    formattedValue?: string | null;
    revenue?: number | null;
    netProfit?: number | null;
    formatMoney?: (amount: number) => string;
  },
): { tier: InterventionTier; steps: T[] } {
  if (steps.length === 0) return { tier: input.tier, steps };
  const first = steps[0];
  const grounded = groundInterventionStep({
    ratioKey: input.ratioKey,
    ratioName: input.ratioName,
    tier: input.tier,
    value: input.value,
    formattedValue: input.formattedValue,
    title: first.step_title,
    description: first.step_description,
    revenue: input.revenue,
    netProfit: input.netProfit,
    formatMoney: input.formatMoney,
  });
  const netMargin = isNetMarginRatio(input.ratioKey, input.ratioName);
  if (!netMargin || input.value == null || !Number.isFinite(input.value)) {
    return {
      tier: input.tier,
      steps: steps.map((step, index) =>
        index === 0 ? { ...step, step_description: grounded.description } : step,
      ),
    };
  }
  if (grounded.tier === "healthy" || grounded.tier !== input.tier) {
    return {
      tier: grounded.tier,
      steps: [
        {
          ...first,
          health_tier: grounded.tier,
          step_title: grounded.title,
          step_description: grounded.description,
        },
      ],
    };
  }
  return {
    tier: grounded.tier,
    steps: [
      { ...first, step_title: grounded.title, step_description: grounded.description },
      ...steps.slice(1),
    ],
  };
}
