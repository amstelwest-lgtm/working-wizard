import type { AskAiContext, DisclosureTier } from "./types.ts";
import { fmtPct, slicedWaterfallQuote } from "./deliverable-summaries.ts";
import { DISPLAY_TO_CAMEL } from "./derive-ratios.ts";
import { formatOverviewForPrompt } from "./overview-brief.ts";
import { formatAdvisorySignoffGrounding } from "../../../src/lib/advisory-signoff.ts";
import { formatStatementMargin } from "../../../src/lib/statement-margin.ts";
import { chatReplyFormatRules, humanDate } from "../_shared/chat-reply.ts";
import { productFactsBlock } from "../_shared/product-facts.ts";
import { TAX_SPECIALIST_CHAT_PERSONA } from "../_shared/agent-prompts/tax-specialist.ts";
import {
  appendClientIdentity,
  applyRedaction,
  createRedactionSession,
  rehydrateWorkingContext,
  type IdentifierSubject,
  type RedactionSession,
} from "../_shared/redact-identifiers.ts";

/** Duplicated from src/lib/market/prompt.ts — Deno edge cannot import @/lib. */
function askAiSystemBase(
  copyPack: "za" | "us",
  audience: "owner" | "accountant",
  moneyPack: "za" | "us" = copyPack,
): string {
  const taxWord = copyPack === "us" ? "EIN / tax IDs" : "VAT numbers";
  const currencyWord = moneyPack === "us" ? "dollar/currency amounts" : "rand/currency amounts";
  const locale =
    copyPack === "us"
      ? "- US English. Sales tax is not income tax. Do not assume VAT or SARS."
      : "- South African English is fine. VAT and SARS context is allowed when the numbers support it.";
  return `You are a sharp, concise SME CFO copilot.
Rules:
- Be specific and grounded in the numbers provided.
- Never fabricate figures. If data is missing, say so plainly and name the one input needed.
- Do NOT reference company names or ${taxWord}.
- Do not invent ${currencyWord}. Quote cash, revenue, runway, margins, inventory, inventory days, current ratio, and other days only when the OVERVIEW FIGURES block lists them. If a figure is listed there, it is already on file — do not ask for it, and do not substitute a different health score.
- Pillar names are Profit, Assets, Financing, and Cash. Do not say Profit Drivers, Profitability, Leverage & Finance, or Financing & Solvency. Quote a health or pillar score as the bare number 60, never 60/100, 60 out of 100, or 60%. A ratio nickname is a sub-factor under its pillar, such as Profit · Bottom-line strength.
- Creditor days use the healthy band named in OVERVIEW FIGURES (30–60 days). Do not call that a 40-day band. 40 is the health-score Watch floor, not a day count.
- Quote a stored total liabilities figure. Do not replace it with assets minus equity. A total liabilities line marked (derived) is an estimate.
- "Cash generative" is a valid cash runway. Report it as written. It is not zero weeks and it is not a missing figure.
- When OVERVIEW FIGURES says gross margin or cash runway is not available, say not available. Do not replace either line with 0 or with a figure you calculate.
- Operating margin is EBIT divided by revenue. Net margin is net income divided by revenue. Use those names from OVERVIEW FIGURES. Do not relabel operating margin as EBIT, and do not quote a waterfall percentage in place of either.
- When OVERVIEW FIGURES lists Net profit, Gross profit, Operating profit, or Profit before tax, quote that stored amount. Do not multiply a margin by revenue to recreate it.
- When cash on file is listed, that balance is present. Never say there is no bank balance or that cash is missing. If runway cannot be estimated, say no cash-flow statement is on file.
- When OVERVIEW FIGURES says the stored period is year to date, answer a revenue year-to-date question with the listed revenue and the exact "year to date to <end date>" phrase from that block. Do not say no year-to-date split is stored.
- When asked which deliverable to prepare first, recommend one deliverable and why, using OVERVIEW FIGURES. Do not say a draft or a pack version was saved.
- Advisory pack sign-off and version come only from the ADVISORY PACK SIGN-OFF block. Quote its Status line. Do not say no sign-off or version is on file when that block is present. Do not create or save a pack version while answering.
- Offer 1–3 concrete next actions under Next actions.
- Ground answers in the filled deliverables provided: profile answers, ratios, profitability waterfall (as % of revenue), cash-forecast outlook, product lines, recommended next moves, and action-plan tasks.
- Do not invent statement line items. Quote Net profit, Gross profit, Operating profit, Profit before tax, Inventory, and Current ratio when OVERVIEW FIGURES lists them. Do not multiply a margin by revenue in their place. Raw income-statement and balance-sheet lines other than those listed headlines are not provided — use the outputs above.
${locale}
${chatReplyFormatRules(copyPack, moneyPack)}

${productFactsBlock(audience)}`;
}

const CAMEL_TO_DISPLAY: Record<string, string> = {};
for (const [display, camel] of Object.entries(DISPLAY_TO_CAMEL)) {
  CAMEL_TO_DISPLAY[camel] = display;
}

export function formatRatio(
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
  if (!Number.isFinite(r.value)) {
    const label = CAMEL_TO_DISPLAY[r.key] ?? r.key;
    return `${label}: not meaningful`;
  }

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
  const label = CAMEL_TO_DISPLAY[r.key] ?? r.key;
  return `${label}: ${fmtVal}${bench}`;
}

export type AskAiAgent = "financial_manager" | "analyst" | "advisor" | "tax_specialist";

/**
 * Role for one agent chat, owner or accountant. Display names stay in
 * src/lib/milon-team.ts. Each agent only sees its own thread.
 */
export function askAiAgentPersona(agent: AskAiAgent, audience: "owner" | "accountant" = "owner"): string {
  const whose = audience === "accountant" ? "this client's" : "this owner's";
  switch (agent) {
    case "financial_manager":
      return `You are ${whose} financial manager. You look after the books, the 13-week cash forecast, the budget, the profitability waterfall, action points, and hand-offs to the accountant. When they ask to add CapEx, a one-off CapEx, or CapEx in week N, call propose_figure_adjustment with surface cash and patch capexAmount and capexWeek. When they ask to add an outflow in week N and they did not name CapEx, call propose_figure_adjustment with netWeek and a negative netDelta. Calling that tool is the proposal. Do not refuse, and do not stall by saying a proposal or approval must come first. You do not write the saved figures from this reply. After the tool succeeds, tell them to Confirm on the Cash forecast page. Do not say the cash forecast, budget, or waterfall was updated, and do not say a proposal was saved unless that tool ran. Never say you cannot propose. Keep the headline to one plain sentence. Do not diagnose ratios.`;
    case "analyst":
      return `You are ${whose} analyst. Show what the books already say about profit and who owes the business. Do not write explanatory sentences or walk through the reasoning. Put the reasoning in the figure labels instead, for example "- Fixed costs: 36.4% of revenue, the main drag". Do not coordinate the team.`;
    case "advisor":
      return `You are ${whose} advisor. Suggest the next move ${audience === "accountant" ? "the accountant can raise with the owner" : "the owner can act on"}. Do not coordinate the team.`;
    case "tax_specialist":
      return TAX_SPECIALIST_CHAT_PERSONA;
  }
}

export function buildPrompt(
  question: string,
  ctx: AskAiContext,
  tier: DisclosureTier,
  audience: "owner" | "accountant" = "owner",
  agent: AskAiAgent | null = null,
): { system: string; user: string } {
  const lines: string[] = [];
  const copyPack = ctx.copyPack ?? "za";
  const moneyPack = ctx.moneyPack ?? copyPack;
  let system = askAiSystemBase(copyPack, audience, moneyPack);
  if (agent) {
    system += `\n- ${askAiAgentPersona(agent, audience)} Use only the tools and figures already in this prompt. Earlier chats with the other agents are not part of this conversation.`;
  }
  if (audience === "accountant") {
    system +=
      "\n- You are briefing an accountant about this SME client. Address the accountant. Say \"this client\" or \"the owner\" for the business — not \"you\" unless you mean the accountant's next action.";
  }
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
  const named = ctx.clientName?.trim();
  if (named) lines.push(`Client name: ${named}`);
  const overviewBlock = ctx.overview ? formatOverviewForPrompt(ctx.overview, audience) : "";
  if (overviewBlock) lines.push(overviewBlock);
  if (ctx.advisorySignoff) lines.push(formatAdvisorySignoffGrounding(ctx.advisorySignoff));

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

  if (
    !overviewBlock &&
    ctx.scores?.overall_score !== null &&
    ctx.scores?.overall_score !== undefined
  ) {
    lines.push(`Overall health score: ${ctx.scores.overall_score.toFixed(0)}`);
  }

  const pillars = ctx.scores?.pillars?.filter((p) => p.score != null) ?? [];
  if (pillars.length > 0) {
    lines.push("Score breakdown by category (these feed the overall score):");
    for (const p of pillars) {
      lines.push(`  ${p.label}: ${p.score}`);
    }
    const weakest = [...pillars].sort((a, b) => (a.score ?? 100) - (b.score ?? 100))[0];
    if (weakest) {
      lines.push(`  Weakest category vs this client's own mix: ${weakest.label}`);
    }
  }

  if (ctx.ratios.length > 0) {
    lines.push("\nKey ratios vs peer / industry bands (p25 / p50 when known):");
    for (const r of ctx.ratios) {
      lines.push(`  ${formatRatio(r, copyPack)}`);
    }
  } else if (tier === "full" || tier === "focused") {
    lines.push(
      "\nKey ratios: not yet on file. Ask for the missing period figures rather than inventing a drag.",
    );
  }

  if (ctx.waterfall?.hasData) {
    lines.push(
      `\nProfitability waterfall (${ctx.waterfall.source} figures, % of revenue). Not a substitute for Operating margin or Net margin:`,
    );
    const firmYearQuote = slicedWaterfallQuote(ctx.waterfall, moneyPack);
    if (firmYearQuote) lines.push(`  ${firmYearQuote}`);
    for (const step of ctx.waterfall.steps) {
      if (step.label === "EBIT" && ctx.overview?.operatingMargin != null) {
        const shown = formatStatementMargin(ctx.overview.operatingMargin) ?? "n/a";
        lines.push(`  Operating margin: ${shown} (Overview — do not quote a reconstructed EBIT instead)`);
        continue;
      }
      if (step.label === "Net income" && ctx.overview?.netMargin != null) {
        const shown = formatStatementMargin(ctx.overview.netMargin) ?? "n/a";
        lines.push(`  Net margin: ${shown} (Overview — net income divided by revenue)`);
        continue;
      }
      lines.push(`  ${step.label}: ${fmtPct(step.pctOfRevenue)}`);
    }
  }

  if (ctx.cashForecast?.hasData) {
    const c = ctx.cashForecast;
    const weeksBelow = c.weeksBelowFloor ?? 0;
    const dipped = weeksBelow > 0 || c.negativeWeeks > 0;
    lines.push(
      "\nCash forecast outlook (13-week trajectory). Cash on file, when listed under OVERVIEW FIGURES, is not missing:",
    );
    if (c.floor != null && Number.isFinite(c.floor)) {
      lines.push(`  Floor: ${Math.round(c.floor)}`);
    }
    if (c.lowestCash != null && Number.isFinite(c.lowestCash)) {
      lines.push(
        `  Lowest cash point: ${Math.round(c.lowestCash)} in week ${c.lowestCashWeek ?? c.lowestWeek}`,
      );
    }
    if (!dipped || c.negativeWeeks > 0) {
      lines.push(`  Negative weeks: ${c.negativeWeeks} of ${c.horizonWeeks}`);
    }
    lines.push(`  Weeks below the floor: ${weeksBelow} of ${c.horizonWeeks}`);
    if (dipped) {
      const parts = [
        weeksBelow > 0 ? `${weeksBelow} of ${c.horizonWeeks} weeks below the floor` : null,
        c.negativeWeeks > 0 ? `${c.negativeWeeks} weeks close under zero` : null,
        c.lowestWeek ? `first dip in week ${c.lowestWeek}` : null,
        c.timingNote,
      ].filter(Boolean);
      lines.push(`  ${parts.join("; ")}`);
      lines.push("  Do not call this cash generative, in the black, or 0 negative weeks.");
    } else {
      lines.push(
        `  ${
          c.shortfall
            ? `Shortfall in week ${c.lowestWeek}${c.timingNote ? ` (${c.timingNote})` : ""}`
            : "In the black across the horizon"
        }`,
      );
      if (c.cashGenerative) {
        lines.push("  Cash runway: cash generative — not counted as zero weeks");
      } else if (c.runwayWeeks != null) {
        lines.push(
          `  Cash runway: ${c.runwayWeeks >= c.horizonWeeks ? `${c.horizonWeeks}+` : c.runwayWeeks} weeks`,
        );
      }
    }
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
        const due = task.dueDate
          ? ` · due ${humanDate(String(task.dueDate), copyPack) ?? task.dueDate}`
          : "";
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

/** System + user text actually sent to the model. Client names stay tokenized. */
export function sealAskAiPrompt(
  built: { system: string; user: string },
  subject?: IdentifierSubject,
): {
  system: string;
  user: string;
  session: RedactionSession;
  /** Client name restored for local reasoning. Not sent to Anthropic or the cache. */
  workingContext: string;
} {
  const session = createRedactionSession(subject);
  const includeIdentity = /BUSINESS CONTEXT:/.test(built.user) && Boolean(session.clientName);
  const system = applyRedaction(built.system, session);
  const user = applyRedaction(built.user, session);
  const sealedSystem = includeIdentity ? appendClientIdentity(system, session) : system;
  return {
    system: sealedSystem,
    user,
    session,
    workingContext: rehydrateWorkingContext(`${sealedSystem}\n${user}`, session),
  };
}
