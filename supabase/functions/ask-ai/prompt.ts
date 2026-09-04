import type { AskAiContext, DisclosureTier } from "./types.ts";
import { fmtPct } from "./deliverable-summaries.ts";

/** Duplicated from src/lib/market/prompt.ts — Deno edge cannot import @/lib. */
function askAiSystemBase(copyPack: "za" | "us"): string {
  const taxWord = copyPack === "us" ? "EIN / tax IDs" : "VAT numbers";
  const currencyWord = copyPack === "us" ? "dollar/currency amounts" : "rand/currency amounts";
  const locale =
    copyPack === "us"
      ? "- US English. Sales tax is not income tax. Do not assume VAT or SARS."
      : "- South African English is fine. VAT and SARS context is allowed when the numbers support it.";
  return `You are a sharp, concise SME CFO copilot.
Rules:
- Answer in 3–6 short sentences or a tight bullet list.
- Be specific and grounded in the numbers provided.
- Never fabricate figures. If data is missing, say so plainly and name the one input needed.
- Do NOT reference company names, ${taxWord}, or raw ${currencyWord} — refer to them as "your revenue", "your margin" etc.
- Currency references: use "your local currency" not specific amounts.
- Offer 1–2 concrete next actions the owner can take today.
- Ground answers in the filled deliverables provided: profile answers, ratios, profitability waterfall (as % of revenue), cash-forecast outlook, product lines, recommended next moves, and action-plan tasks.
- Do not invent statement line items. Raw income-statement / balance-sheet inputs are not provided — use the outputs above.
${locale}`;
}

function formatRatio(
  r: {
    key: string;
    value: number | null;
    format: string;
    p25: number | null;
    p50: number | null;
    higher_is_better: boolean | null;
  },
  copyPack: "za" | "us" = "za",
): string {
  if (r.value === null) return `${r.key}: n/a`;

  // computeRatios() stores pct values as fractions (e.g. 0.15 = 15%).
  // industry_benchmarks stores pct values as whole percentages (e.g. 15).
  // Display: multiply stored value by 100; display benchmark as-is (already whole %).
  const fmtVal =
    r.format === "pct"
      ? `${(r.value * 100).toFixed(1)}%`
      : r.format === "days"
        ? `${r.value.toFixed(0)} days`
        : r.value.toFixed(2);

  const hideMoney = copyPack === "us" && r.format !== "pct" && r.format !== "days";
  const bandLabel = copyPack === "us" ? "global SME band" : "industry median";
  const bench =
    r.p50 !== null && !hideMoney
      ? ` (${bandLabel}: ${
          r.format === "pct"
            ? `${r.p50.toFixed(1)}%` // benchmark already in whole %
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
  const copyPack = ctx.copyPack ?? "za";
  let system = askAiSystemBase(copyPack);
  if (copyPack === "us") {
    system +=
      "\n- Days and percentage bands are global SME bands, not US industry medians. Do not present them as US sector medians. Do not invent US money benchmarks.";
  }

  if (tier === "none") {
    // No client data in prompt
    return {
      system,
      user: `QUESTION: ${question}`,
    };
  }

  const deliverables = ctx.deliverables ?? [];
  const profileQuestions = ctx.profileQuestions ?? [];
  const productLines = ctx.productLines ?? [];
  const nextSteps = ctx.nextSteps ?? [];

  if (deliverables.length > 0) {
    const filled = deliverables.filter((d) => d.filled);
    if (filled.length > 0) {
      lines.push(
        "Filled deliverables: " +
          filled
            .map((d) => `${d.label}${d.signedOff ? " (signed off)" : ""}`)
            .join("; "),
      );
    }
    const empty = deliverables.filter((d) => !d.filled);
    if (empty.length > 0) {
      lines.push("Not yet filled: " + empty.map((d) => d.label).join("; "));
    }
  }

  if (profileQuestions.length > 0) {
    lines.push("\nCompany profile answers:");
    for (const q of profileQuestions) {
      lines.push(`  ${q.label}: ${q.value}`);
    }
  } else if (ctx.profile) {
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
      lines.push(`Customer concentration: ${op.customerConcentration.replace(/_/g, " ")}`);
      lines.push(`Debt position: ${op.debtPosition.replace(/_/g, " ")}`);
      lines.push(`Owner's stated goal: ${op.ownerGoal.replace(/_/g, " ")}`);
    }
  }

  if (ctx.profile?.annual_revenue) {
    const r = ctx.profile.annual_revenue;
    const bucket =
      r < 1_000_000
        ? "under 1M"
        : r < 5_000_000
          ? "1M–5M"
          : r < 20_000_000
            ? "5M–20M"
            : r < 100_000_000
              ? "20M–100M"
              : "over 100M";
    lines.push(`Revenue band: ${bucket}`);
  }

  if (ctx.scores?.overall_score !== null && ctx.scores?.overall_score !== undefined) {
    lines.push(`Overall health score: ${ctx.scores.overall_score.toFixed(0)}/100`);
  }

  if (ctx.ratios.length > 0) {
    lines.push("\nKey ratios:");
    for (const r of ctx.ratios) {
      lines.push(`  ${formatRatio(r, copyPack)}`);
    }
  }

  if (ctx.waterfall?.hasData) {
    lines.push(`\nProfitability waterfall (${ctx.waterfall.source} figures, % of revenue):`);
    for (const step of ctx.waterfall.steps) {
      lines.push(`  ${step.label}: ${fmtPct(step.pctOfRevenue)}`);
    }
  }

  if (ctx.cashForecast?.hasData) {
    const c = ctx.cashForecast;
    lines.push("\nCash forecast outlook (13-week, no raw balances):");
    lines.push(
      `  ${c.shortfall ? `Shortfall in week ${c.lowestWeek}` : "In the black across the horizon"}`,
    );
    if (c.runwayWeeks != null) {
      lines.push(
        `  Cash runway: ${c.runwayWeeks >= c.horizonWeeks ? `${c.horizonWeeks}+` : c.runwayWeeks} weeks above the floor`,
      );
    }
    lines.push(`  Negative weeks: ${c.negativeWeeks}`);
    if (c.trajectory) {
      lines.push(`  Trajectory: ${c.trajectory} · week-13 close vs opening: ${c.closingVsOpening}`);
    }
  }

  if (productLines.length > 0) {
    lines.push("\nProduct lines (share and margin only):");
    for (const line of productLines) {
      const tags = [line.isBest ? "best" : null, line.isWorst ? "watch" : null]
        .filter(Boolean)
        .join(", ");
      lines.push(
        `  ${line.name}: margin ${fmtPct(line.marginPct, 0)} · sales share ${fmtPct(line.revenueSharePct, 0)} · GP share ${fmtPct(line.gpSharePct, 0)}${tags ? ` (${tags})` : ""}`,
      );
    }
  }

  if (nextSteps.length > 0) {
    lines.push("\nTop recommended next moves:");
    for (const step of nextSteps) {
      lines.push(`  ${step.rank}. ${step.title} (lever: ${step.ratioName})`);
    }
  }

  if (ctx.actionPlan) {
    lines.push("\nAction plan:");
    if (ctx.actionPlan.outcomeGoal) {
      lines.push(`  Outcome goal: ${ctx.actionPlan.outcomeGoal}`);
    }
    if (ctx.actionPlan.open.length === 0) {
      lines.push(
        ctx.actionPlan.doneCount > 0
          ? `  No outstanding tasks (${ctx.actionPlan.doneCount} completed).`
          : "  No tasks planned yet.",
      );
    } else {
      lines.push("  Planned / outstanding:");
      for (const task of ctx.actionPlan.open) {
        const due = task.dueDate ? ` · due ${task.dueDate}` : "";
        lines.push(
          `  - ${task.title} [${task.status}, ${task.progressPct}%]${due}`,
        );
      }
      if (ctx.actionPlan.doneCount > 0) {
        lines.push(`  Completed: ${ctx.actionPlan.doneCount}`);
      }
    }
  }

  return {
    system,
    user: `QUESTION: ${question}\n\nBUSINESS CONTEXT:\n${lines.join("\n")}`,
  };
}
