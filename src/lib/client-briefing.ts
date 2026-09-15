/**
 * Client briefing — the top of the accountant client page.
 *
 * Less dashboard, more briefing: one snapshot of status, a short
 * interpretation of what matters, and a Milōn-grounded workflow for the
 * month. Pure module — no I/O. The Claude call lives in
 * client-briefing.functions.ts; everything here also powers its fallback.
 */

import type { ClientOperatingProfile } from "@/lib/client-profile";
import { GOAL_TO_PRESSURE } from "@/lib/client-profile";
import { profileIndustryLabel, profileAiContext } from "@/lib/profile-signals";
import type { VarianceChip } from "@/lib/prior-period";
import { formatDate, formatMoneyCompact, type ResolvedMarket, ZA_MARKET } from "@/lib/market";

// ── Financial snapshot ────────────────────────────────────────────────────────

export type SnapshotMetric = {
  key: "revenue" | "gm" | "om" | "runway" | "updated";
  label: string;
  value: string;
  /** Directional movement vs the prior period; omitted when there is none. */
  delta?: { text: string; direction: "up" | "down" | "flat"; good: boolean };
  /** Muted helper, e.g. the prior period label. */
  hint?: string;
};

const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;

function deltaFor(chip: VarianceChip | undefined): SnapshotMetric["delta"] | undefined {
  if (!chip || chip.delta == null || chip.prior == null) return undefined;
  if (chip.status === "flat") return { text: "flat", direction: "flat", good: true };
  const dir = chip.delta > 0 ? "up" : "down";
  const good = chip.higherIsBetter ? chip.delta > 0 : chip.delta < 0;
  let text: string;
  if (chip.unit === "pct") {
    text = `${Math.abs(chip.delta * 100).toFixed(1)}pp`;
  } else if (chip.unit === "number" && chip.prior !== 0) {
    text = `${Math.abs((chip.delta / chip.prior) * 100).toFixed(1)}%`;
  } else {
    text = `${Math.abs(chip.delta).toFixed(1)}`;
  }
  return { text, direction: dir, good };
}

/**
 * Compact snapshot: only metrics that exist, deltas only where a prior period
 * exists. Cash runway appears once. "Last updated" is the freshest stamp on
 * figures or forecast.
 */
export function buildFinancialSnapshot(input: {
  chips: VarianceChip[];
  cashRunwayWeeks: number | null | undefined;
  financialsUpdatedAt?: string | null;
  lastForecastAt?: string | null;
  priorLabel?: string | null;
  market?: ResolvedMarket;
}): SnapshotMetric[] {
  const market = input.market ?? ZA_MARKET;
  const byKey = new Map(input.chips.map((c) => [c.key, c]));
  const out: SnapshotMetric[] = [];

  const rev = byKey.get("revenue");
  if (rev?.current != null) {
    out.push({
      key: "revenue",
      label: "Revenue",
      value: formatMoneyCompact(rev.current, market),
      delta: deltaFor(rev),
    });
  }
  const gm = byKey.get("gm");
  if (gm?.current != null && Number.isFinite(gm.current)) {
    out.push({ key: "gm", label: "Gross margin", value: fmtPct(gm.current), delta: deltaFor(gm) });
  }
  const om = byKey.get("om");
  if (om?.current != null && Number.isFinite(om.current)) {
    out.push({
      key: "om",
      label: "Operating margin",
      value: fmtPct(om.current),
      delta: deltaFor(om),
    });
  }
  if (input.cashRunwayWeeks != null && Number.isFinite(input.cashRunwayWeeks)) {
    const w = input.cashRunwayWeeks;
    out.push({
      key: "runway",
      label: "Cash runway",
      value: `${Number.isInteger(w) ? w : w.toFixed(1)} ${w === 1 ? "week" : "weeks"}`,
    });
  }
  const updated = [input.financialsUpdatedAt, input.lastForecastAt]
    .filter((s): s is string => Boolean(s))
    .sort()
    .at(-1);
  if (updated) {
    out.push({
      key: "updated",
      label: "Last updated",
      value: formatDate(updated, market, { day: "numeric", month: "short", year: "numeric" }),
      hint: input.priorLabel ? `vs ${input.priorLabel}` : undefined,
    });
  }
  return out;
}

// ── Health ────────────────────────────────────────────────────────────────────

export function healthHeadline(score: number | null | undefined, label: string): string {
  if (score == null || !Number.isFinite(score)) return "Not scored yet";
  return `${Math.round(score)} / 100 · ${label}`;
}

// ── About this business ───────────────────────────────────────────────────────

const GOAL_PHRASE: Record<ClientOperatingProfile["ownerGoal"], string> = {
  survive_cash: "getting through a cash squeeze",
  lift_margins: "making more from the same revenue",
  grow_revenue: "growing sales and winning more work",
  free_working_capital: "freeing up cash tied up in the business",
  reduce_founder_dependence: "making the business run without the founder",
  build_to_exit: "building value for a sale or handover",
};

const PAY_PHRASE: Partial<Record<ClientOperatingProfile["payMotion"], string>> = {
  goods: "sells physical goods",
  time_delivery: "sells time and delivered work",
  access_capacity: "sells access to capacity",
  recurring_rights: "earns recurring fees",
  take_rate: "earns a commission on flow",
  funding: "is grant and programme funded",
};

/** One sentence: what kind of business, what the owner is trying to achieve. */
export function describeBusiness(
  profile: ClientOperatingProfile | null | undefined,
  fallbackType: string | null | undefined,
): string | null {
  const industry = profileIndustryLabel(profile, fallbackType ?? "");
  if (!profile) return industry ? `${industry} business.` : null;
  const parts: string[] = [];
  const base = industry ? `${industry} business` : "Business";
  const goal = GOAL_PHRASE[profile.ownerGoal];
  parts.push(`${base} focused on ${goal}.`);
  const colour: string[] = [];
  const pay = PAY_PHRASE[profile.payMotion];
  if (pay && profile.payMotion !== "mix") colour.push(pay);
  if (profile.debtorDaysDefault >= 45)
    colour.push(`customers pay in ${profile.debtorDaysDefault}+ days`);
  if (profile.seasonality === "strong") colour.push("strongly seasonal");
  if (profile.costShape === "payroll_heavy") colour.push("payroll-heavy cost base");
  if (colour.length) {
    const s = colour.slice(0, 2).join(", ");
    parts.push(`${s.charAt(0).toUpperCase()}${s.slice(1)}.`);
  }
  return parts.join(" ");
}

// ── What matters ──────────────────────────────────────────────────────────────

export type BriefingSignals = {
  healthScore: number | null | undefined;
  healthStatus: "healthy" | "at_risk" | "critical" | null | undefined;
  chips: VarianceChip[];
  cashRunwayWeeks: number | null | undefined;
  profile: ClientOperatingProfile | null | undefined;
  hasFigures: boolean;
};

function chip(chips: VarianceChip[], key: string): VarianceChip | undefined {
  return chips.find((c) => c.key === key);
}

/**
 * One or two sentences on the most commercially meaningful thing in the data.
 * Rule-based and deliberately understated: no alert just because a metric exists.
 */
export function whatMatters(s: BriefingSignals): string | null {
  if (!s.hasFigures) return null;
  const rev = chip(s.chips, "revenue");
  const gm = chip(s.chips, "gm");
  const om = chip(s.chips, "om");
  const runway = s.cashRunwayWeeks;
  const gmV = gm?.current ?? null;
  const omV = om?.current ?? null;

  const profitable = omV != null && omV > 0;
  const strongGm = gmV != null && gmV >= 0.5;
  const thinOm = omV != null && omV < 0.05;
  const lossMaking = omV != null && omV < 0;
  const tightCash = runway != null && runway <= 8;
  const veryTightCash = runway != null && runway <= 4;
  const revUp =
    rev?.status === "up" && rev.delta != null && rev.prior && rev.delta / rev.prior >= 0.03;
  const revDown =
    rev?.status === "down" &&
    rev.delta != null &&
    rev.prior &&
    Math.abs(rev.delta / rev.prior) >= 0.03;
  const marginsUp = gm?.status === "up" || om?.status === "up";
  const marginsDown = om?.status === "down" && om.delta != null && Math.abs(om.delta) >= 0.01;

  const runwayText =
    runway != null ? `${Number.isInteger(runway) ? runway : runway.toFixed(1)} weeks` : "";

  if (lossMaking && tightCash) {
    return `The business is trading at an operating loss and cash runway is ${runwayText} — short-term liquidity is the issue to address this month.`;
  }
  if (veryTightCash) {
    const opener = profitable
      ? strongGm
        ? "The business is profitable with a strong gross margin"
        : "The business is profitable"
      : "Trading is holding up";
    return `${opener}, but cash runway is currently only ${runwayText}. Near-term cash is the priority.`;
  }
  if (lossMaking) {
    return `Operating margin is negative${revDown ? " and revenue is down on the prior period" : ""}. Profitability, not growth, is the first conversation.`;
  }
  if (tightCash) {
    return `${profitable ? "Profitable, but" : "Cash is the constraint:"} runway is ${runwayText}. Worth understanding what is driving the cash position before anything else.`;
  }
  if (revDown && marginsDown) {
    return "Revenue and operating margin both slipped against the prior period. Understand whether this is volume, price or cost before client management reacts.";
  }
  if (revUp && marginsDown) {
    return "Revenue is growing but operating margin has narrowed — growth is being bought with cost. Margin discipline is the theme this month.";
  }
  if (revDown) {
    return `Revenue is down on the prior period while margins have held${gmV != null ? ` (gross margin ${fmtPct(gmV)})` : ""}. The question is where the volume went.`;
  }
  if (thinOm && strongGm) {
    return `Gross margin is strong at ${fmtPct(gmV!)} but operating margin is thin at ${fmtPct(omV!)} — overheads are absorbing the gross profit.`;
  }
  if (revUp && (marginsUp || strongGm)) {
    return `Revenue and margins are improving and there is no immediate cash-flow concern${runway != null ? ` (runway ${runwayText})` : ""}. A good month to talk about the next step, not the next fire.`;
  }
  if (s.healthStatus === "healthy") {
    return `The business appears financially healthy${runway != null ? `, with ${runwayText} of cash runway` : ""} and no single metric demanding attention this month.`;
  }
  if (s.healthStatus === "critical") {
    return "Several indicators are weak at the same time. Start with cash, then profitability — this is a month for a focused conversation with client management.";
  }
  if (s.healthStatus === "at_risk") {
    return `The overall position is watchful rather than urgent${
      thinOm ? " — operating margin is thin" : ""
    }. One or two ratios need attention; the rest are holding.`;
  }
  return null;
}

// ── Milōn capability catalogue (grounds the workflow recommendation) ─────────

export type MilonCapability = {
  id: string;
  name: string;
  where: string;
  does: string;
  output: string;
};

/** What Milōn actually does today for an accountant — nothing aspirational. */
export const MILON_CAPABILITIES: MilonCapability[] = [
  {
    id: "health",
    name: "Financial Health Score & ratio drill-down",
    where: "Health & Ratios tab",
    does: "Scores the business 0–100 across four pillars (profitability, asset efficiency, financing, cash & working capital) from the uploaded figures, with each ratio explained and benchmarked to the sector.",
    output: "Health score, pillar breakdown, per-ratio commentary and playbook steps.",
  },
  {
    id: "profit",
    name: "Profitability waterfall & product mix",
    where: "Profitability tab",
    does: "Breaks revenue down to operating profit, shows weekly P&L inputs, and unit price/cost margin by product line.",
    output: "Waterfall, margin by product line, where profit leaks.",
  },
  {
    id: "cash",
    name: "13-week cash forecast from bank statements",
    where: "13-Week Cash Forecast tab",
    does: "Builds a weekly cash forecast from uploaded bank statements (or manual lines), classifies recurring movements, and shows the movements trial balance and runway in weeks. Scenario sliders test collections delay, headcount and capex.",
    output: "Weekly closing balance, runway, scenario what-ifs.",
  },
  {
    id: "budget",
    name: "Driver-based FY budget with variance",
    where: "Budget tab",
    does: "Seeds a full-year monthly budget from the figures (volume × price, overheads, working-capital days), then compares actuals by month.",
    output: "FY budget, month-by-month variance to actuals.",
  },
  {
    id: "reports",
    name: "Branded PDF reports",
    where: "Reports tab",
    does: "Generates firm-branded client reports: health, ratio movement over 3/6/12 months, profitability, working capital cycle, leverage, labour productivity, benchmark, intervention plan and 13-week forecast — with the accountant's sign-off stamp.",
    output: "PDF deliverables to send to client management.",
  },
  {
    id: "plan",
    name: "Action plan shared with client management",
    where: "Action Plan tab",
    does: "A live list of agreed actions with owners and due dates; client management sees the same plan in their app and can tick items off.",
    output: "Agreed actions, follow-up nudges.",
  },
  {
    id: "advisory",
    name: "Advisory drafter",
    where: "Advisory Drafter tab",
    does: "Drafts a plain-language advisory note or email to client management from the current figures, ready to edit and send; delivery and acknowledgement are tracked.",
    output: "Advisory note / email to the client.",
  },
  {
    id: "notes",
    name: "In-context notes and queries",
    where: "Anywhere on the client page",
    does: "Leaves a note or query on any figure or tab; client management is notified and the thread is kept until resolved.",
    output: "Open / resolved queries with the client.",
  },
  {
    id: "signoff",
    name: "Accountant sign-off",
    where: "Each deliverable tab",
    does: "Stamps a deliverable as reviewed by the accountant; any later change to the figures flags it for re-review.",
    output: "Signed-off deliverables client management can trust.",
  },
  {
    id: "bot",
    name: "Milōn Bot Q&A",
    where: "Milōn Bot tab",
    does: "Answers questions about this client's numbers and next steps from the same figures.",
    output: "Grounded answers to specific questions.",
  },
];

export function milonCapabilityContext(): string {
  return MILON_CAPABILITIES.map(
    (c) => `- ${c.name} (${c.where}): ${c.does} Output: ${c.output}`,
  ).join("\n");
}

// ── Workflow recommendation ──────────────────────────────────────────────────

export type WorkflowContext = {
  clientName: string;
  profile: ClientOperatingProfile | null | undefined;
  businessType: string | null | undefined;
  healthScore: number | null | undefined;
  healthLabel: string | null | undefined;
  snapshot: SnapshotMetric[];
  chips: VarianceChip[];
  cashRunwayWeeks: number | null | undefined;
  whatMatters: string | null;
  openQueries?: number | null;
};

/** Stable key for caching: regenerate only when the inputs change. */
export function workflowInputsHash(ctx: WorkflowContext): string {
  const s = JSON.stringify({
    p: ctx.profile
      ? [
          ctx.profile.templateId,
          ctx.profile.ownerGoal,
          ctx.profile.debtPosition,
          ctx.profile.customerConcentration,
        ]
      : null,
    h: ctx.healthScore == null ? null : Math.round(ctx.healthScore),
    m: ctx.snapshot
      .filter((m) => m.key !== "updated")
      .map((m) => [m.key, m.value, m.delta?.text ?? ""]),
    r: ctx.cashRunwayWeeks ?? null,
    w: ctx.whatMatters,
  });
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function workflowPrompt(ctx: WorkflowContext): string {
  const metrics = ctx.snapshot
    .filter((m) => m.key !== "updated")
    .map(
      (m) =>
        `- ${m.label}: ${m.value}${m.delta ? ` (${m.delta.direction} ${m.delta.text} vs prior period)` : ""}`,
    )
    .join("\n");
  const profile =
    profileAiContext(ctx.profile) ?? `Business type: ${ctx.businessType ?? "unknown"}`;
  return `You are writing one line of a monthly client briefing for an accountant who uses Milōn, an advisory tool that sits on top of the client's figures.

MILŌN — WHAT IT CAN DO TODAY (the only capabilities you may reference):
${milonCapabilityContext()}

CLIENT: ${ctx.clientName}
Business profile (from the accountant's 10-question profile): ${profile}
Financial Health Score: ${ctx.healthScore == null ? "not scored" : `${Math.round(ctx.healthScore)} / 100 (${ctx.healthLabel ?? ""})`}
Financial snapshot:
${metrics || "- No figures yet"}
${ctx.cashRunwayWeeks != null ? `Cash runway: ${ctx.cashRunwayWeeks} weeks` : ""}
${ctx.whatMatters ? `What matters (already shown to the accountant): ${ctx.whatMatters}` : ""}
${ctx.openQueries ? `Open queries with the client: ${ctx.openQueries}` : ""}

TASK: Write "This month's Milōn workflow" — one or two sentences, max 55 words, telling the accountant (1) which Milōn capability or deliverable to use for this client this month, (2) what to investigate with it, and (3) what to point out or discuss with client management. Tie it to the stated goal and the most important thing in the figures.

RULES:
- Only recommend actions Milōn can actually perform from the list above. Never imply capabilities that do not exist (no integrations, no automation, no tax work, no payroll).
- Sound like professional guidance from a senior colleague, not AI commentary. Do not say "I", "AI", "model", "Claude", "Milonbot", "Milōn thinks", or anything about pricing, plans or how this text was produced.
- Be specific to these numbers. Do not overstate: if the position is healthy, say what to build on rather than inventing a risk.
- British/South African spelling. Plain text only, no bullet points, no headings, no quotes.`;
}

const FORBIDDEN =
  /\b(claude|anthropic|milonbot|milōnbot|model|token|subscription|pricing|as an ai|i think|i recommend)\b/i;

/** Trim to two sentences and refuse anything that leaks the machinery. */
export function sanitizeWorkflowText(raw: string): string | null {
  const text = raw
    .replace(/^["'“”\s]+|["'“”\s]+$/g, "")
    .replace(/^this month'?s mil[oō]n workflow:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || FORBIDDEN.test(text)) return null;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  const out = sentences.slice(0, 2).join("").trim();
  if (out.split(/\s+/).length > 80) return null;
  return out;
}

/** Deterministic recommendation used when Claude is unavailable. */
export function fallbackWorkflow(ctx: WorkflowContext): string {
  const runway = ctx.cashRunwayWeeks;
  const om = ctx.chips.find((c) => c.key === "om");
  const rev = ctx.chips.find((c) => c.key === "revenue");
  const pressure = ctx.profile
    ? (ctx.profile.primaryPressure ?? GOAL_TO_PRESSURE[ctx.profile.ownerGoal])
    : null;

  if (runway != null && runway <= 8) {
    return `Use the 13-Week Cash Forecast and its movements view to trace what is driving the ${runway}-week runway, then use the resulting picture to agree near-term cash actions with client management and log them in the Action Plan.`;
  }
  if (om?.current != null && om.current < 0.05) {
    return "Use the Profitability waterfall and product mix to show where gross profit is being absorbed by overheads, then draft an advisory note that names the two cost lines to act on this month.";
  }
  if (rev?.status === "down") {
    return "Use the Ratio Movement report to show client management how revenue and margins have shifted over 3, 6 and 12 months, then agree in the Action Plan what recovers the volume.";
  }
  if (pressure === "growth") {
    return "Use the Budget tab to test what client management's growth target does to overheads and working capital, then use the Health report to show which ratios must hold as sales grow.";
  }
  if (pressure === "working_capital") {
    return "Use the Working Capital cycle report and debtor-days ratio to quantify cash tied up with customers, then set a collections target with client management in the Action Plan.";
  }
  if (pressure === "people") {
    return "Use the Labour Productivity report and Action Plan to make client management's dependence visible and agree the first responsibilities to hand over this month.";
  }
  return "Use the Health & Ratios drill-down to confirm the position is holding, sign off the deliverables, and send the branded Health report with a short advisory note on the one thing to build on next.";
}
