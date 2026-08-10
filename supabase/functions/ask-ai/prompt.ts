import type { AskAiContext, DisclosureTier } from "./types.ts";

const SYSTEM_BASE = `You are a sharp, concise SME CFO copilot.
Rules:
- Answer in 3–6 short sentences or a tight bullet list.
- Be specific and grounded in the numbers provided.
- Never fabricate figures. If data is missing, say so plainly and name the one input needed.
- Do NOT reference company names, VAT numbers, or raw rand/currency amounts — refer to them as "your revenue", "your margin" etc.
- Currency references: use "your local currency" not specific amounts.
- Offer 1–2 concrete next actions the owner can take today.`;

function formatRatio(r: { key: string; value: number | null; format: string; p25: number | null; p50: number | null; higher_is_better: boolean | null }): string {
  if (r.value === null) return `${r.key}: n/a`;

  // computeRatios() stores pct values as fractions (e.g. 0.15 = 15%).
  // industry_benchmarks stores pct values as whole percentages (e.g. 15).
  // Display: multiply stored value by 100; display benchmark as-is (already whole %).
  const fmtVal = r.format === "pct"
    ? `${(r.value * 100).toFixed(1)}%`
    : r.format === "days"
    ? `${r.value.toFixed(0)} days`
    : r.value.toFixed(2);

  const bench = r.p50 !== null
    ? ` (industry median: ${
        r.format === "pct"
          ? `${r.p50.toFixed(1)}%`           // benchmark already in whole %
          : r.format === "days"
          ? `${r.p50.toFixed(0)} days`
          : r.p50.toFixed(2)
      })`
    : "";
  return `${r.key}: ${fmtVal}${bench}`;
}

export function buildPrompt(
  question: string,
  ctx: AskAiContext,
  tier: DisclosureTier,
): { system: string; user: string } {
  const lines: string[] = [];

  if (tier === "none") {
    // No client data in prompt
    return {
      system: SYSTEM_BASE,
      user: `QUESTION: ${question}`,
    };
  }

  if (ctx.profile) {
    if (ctx.profile.business_type) lines.push(`Business type: ${ctx.profile.business_type}`);
    const op = ctx.profile.operating;
    if (op) {
      lines.push(`Business model: ${op.industry.replace(/_/g, " ")}`);
      lines.push(`Revenue driver: ${op.volumeUnit.replace(/_/g, " ")}`);
      lines.push(
        op.debtorDaysDefault === 0
          ? "Cash timing: paid cash on sale"
          : `Cash timing: customers pay around ${op.debtorDaysDefault} days`,
      );
      lines.push(`Cost base: ${op.costShape.replace(/_/g, " ")}`);
      lines.push(`Seasonality: ${op.seasonality}`);
      lines.push(`Inventory intensity: ${op.inventoryIntensity}`);
      lines.push(`Team size: ${op.teamSize}`);
      lines.push(`Revenue band: ${op.revenueBand.replace(/_/g, " ")}`);
      lines.push(`Owner's stated top pressure: ${op.primaryPressure.replace(/_/g, " ")}`);
    }
    if (ctx.profile.annual_revenue) {
      // Bucket revenue to avoid exact amounts
      const r = ctx.profile.annual_revenue;
      const bucket =
        r < 1_000_000 ? "under 1M"
        : r < 5_000_000 ? "1M–5M"
        : r < 20_000_000 ? "5M–20M"
        : r < 100_000_000 ? "20M–100M"
        : "over 100M";
      lines.push(`Revenue band: ${bucket}`);
    }
  }

  if (ctx.scores?.overall_score !== null && ctx.scores?.overall_score !== undefined) {
    lines.push(`Overall health score: ${ctx.scores.overall_score.toFixed(0)}/100`);
  }

  if (ctx.ratios.length > 0) {
    lines.push("\nKey ratios:");
    for (const r of ctx.ratios) {
      lines.push(`  ${formatRatio(r)}`);
    }
  }

  return {
    system: SYSTEM_BASE,
    user: `QUESTION: ${question}\n\nBUSINESS CONTEXT:\n${lines.join("\n")}`,
  };
}
