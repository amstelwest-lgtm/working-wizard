/**
 * Client briefing header: one snapshot, no duplicated metrics, grounded
 * interpretation, Milōn-only workflow recommendation.
 * Run: pnpm test:client-briefing
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MILON_CAPABILITIES,
  buildFinancialSnapshot,
  describeBusiness,
  fallbackWorkflow,
  healthHeadline,
  milonCapabilityContext,
  sanitizeWorkflowText,
  whatMatters,
  workflowInputsHash,
  workflowPrompt,
  type WorkflowContext,
} from "../src/lib/client-briefing";
import { parseBriefingWorkflow, workflowCacheFresh } from "../src/lib/client-briefing.functions";
import { buildVarianceChips } from "../src/lib/prior-period";
import type { ClientOperatingProfile } from "../src/lib/client-profile";
import { resolveMarket } from "../src/lib/market";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const US = resolveMarket({ country: "US", regionCode: "NY" });

const profile: ClientOperatingProfile = {
  version: 1,
  payMotion: "time_delivery",
  volumeUnit: "day_shift",
  secondaryVolumeUnits: [],
  templateId: "day_labour",
  debtorDaysDefault: 30,
  costShape: "payroll_heavy",
  seasonality: "mild",
  inventoryIntensity: "none",
  customerConcentration: "moderate",
  debtPosition: "light",
  ownerGoal: "grow_revenue",
  primaryPressure: "growth",
  businessTypeId: "services",
  fyStartMonth: 1,
  depth: "full",
  confirmedAt: "2026-01-01T00:00:00.000Z",
} as ClientOperatingProfile;

// ── snapshot ─────────────────────────────────────────────────────────────────
const chips = buildVarianceChips({
  currentFinancials: { revenue: 1_550_000, cogs: 451_000, ebit: 271_000 },
  currentRatios: { "Gross Margin": 0.709, "Operating Margin": 0.175 },
  prior: {
    period_label: "Sep 2025",
    period_date: "2025-09-30",
    financials: { revenue: 1_430_000, cogs: 446_000, ebit: 270_000 },
    ratios: { "Gross Margin": 0.688, "Operating Margin": 0.189 },
  },
  healthScore: 72,
  cashRunwayWeeks: 4,
});
const snap = buildFinancialSnapshot({
  chips,
  cashRunwayWeeks: 4,
  financialsUpdatedAt: "2026-09-12T10:00:00.000Z",
  lastForecastAt: "2026-09-01T10:00:00.000Z",
  priorLabel: "Sep 2025",
  market: US,
});
const keys = snap.map((m) => m.key);
assert(keys.join(",") === "revenue,gm,om,runway,updated", `snapshot order: ${keys.join(",")}`);
assert(new Set(keys).size === keys.length, "no metric appears twice");
const rev = snap[0]!;
assert(rev.value === "$1.6m" || rev.value === "$1.5m", `revenue compact: ${rev.value}`);
assert(rev.delta?.direction === "up" && rev.delta.text === "8.4%", `revenue delta ${rev.delta?.text}`);
const gm = snap[1]!;
assert(gm.value === "70.9%" && gm.delta?.text === "2.1pp" && gm.delta.good, "GM in pp, good");
const om = snap[2]!;
assert(om.delta?.direction === "down" && om.delta.text === "1.4pp" && !om.delta.good, "OM down 1.4pp, bad");
assert(snap[3]!.value === "4 weeks", `runway once: ${snap[3]!.value}`);
assert(snap[4]!.label === "Last updated" && /Sep 12, 2026/.test(snap[4]!.value), "last updated = freshest stamp");
assert(!JSON.stringify(snap).includes("vs prior —"), "never renders a meaningless vs prior —");

// no prior → no deltas, still no "—"
const noPrior = buildFinancialSnapshot({
  chips: buildVarianceChips({
    currentFinancials: { revenue: 800_000, cogs: 500_000 },
    currentRatios: {},
    prior: null,
  }),
  cashRunwayWeeks: null,
});
assert(noPrior.every((m) => !m.delta), "no prior → no deltas");
assert(!noPrior.some((m) => m.key === "runway"), "no runway → no runway row");
assert(!noPrior.some((m) => m.key === "om"), "no ebit → no operating margin row");

// ── health headline ──────────────────────────────────────────────────────────
assert(healthHeadline(72, "Healthy") === "72 / 100 · Healthy", "health headline");
assert(healthHeadline(null, "Healthy") === "Not scored yet", "unscored");

// ── about ────────────────────────────────────────────────────────────────────
const about = describeBusiness(profile, "services")!;
assert(/business focused on growing sales and winning more work\./.test(about), `about: ${about}`);
assert(/payroll-heavy/i.test(about), "adds one or two colour facts");
assert(describeBusiness(null, "Retail") === "Retail business.", "no profile → type only");
assert(describeBusiness(null, null) === null, "nothing known → null");

// ── what matters ─────────────────────────────────────────────────────────────
const m1 = whatMatters({
  healthScore: 72,
  healthStatus: "healthy",
  chips,
  cashRunwayWeeks: 4,
  profile,
  hasFigures: true,
})!;
assert(/profitable with a strong gross margin/.test(m1) && /only 4 weeks/.test(m1), `tight cash: ${m1}`);
const m2 = whatMatters({
  healthScore: 80,
  healthStatus: "healthy",
  chips: buildVarianceChips({
    currentFinancials: { revenue: 1_000_000, cogs: 400_000, ebit: 200_000 },
    currentRatios: {},
    prior: {
      period_label: "p",
      period_date: "2025-09-30",
      financials: { revenue: 900_000, cogs: 380_000, ebit: 150_000 },
      ratios: {},
    },
  }),
  cashRunwayWeeks: 26,
  profile,
  hasFigures: true,
})!;
assert(/improving and there is no immediate cash-flow concern/.test(m2), `healthy growth: ${m2}`);
assert(
  whatMatters({ healthScore: null, healthStatus: null, chips: [], cashRunwayWeeks: null, profile, hasFigures: false }) ===
    null,
  "no figures → no interpretation",
);
const m3 = whatMatters({
  healthScore: 30,
  healthStatus: "critical",
  chips: buildVarianceChips({
    currentFinancials: { revenue: 500_000, cogs: 400_000, ebit: -40_000 },
    currentRatios: {},
    prior: null,
  }),
  cashRunwayWeeks: 6,
  profile,
  hasFigures: true,
})!;
assert(/operating loss/.test(m3) && /6 weeks/.test(m3), `loss + tight: ${m3}`);

// ── capability catalogue ─────────────────────────────────────────────────────
assert(MILON_CAPABILITIES.length >= 9, "catalogue covers the tabs");
const ctxText = milonCapabilityContext();
for (const must of ["13-week cash forecast", "Budget", "Reports", "Action plan", "Advisory", "sign-off"]) {
  assert(new RegExp(must, "i").test(ctxText), `catalogue mentions ${must}`);
}
assert(!/xero|quickbooks|payroll|tax return/i.test(ctxText), "catalogue does not promise integrations or tax work");

// ── workflow prompt / fallback / sanitiser ───────────────────────────────────
const ctx: WorkflowContext = {
  clientName: "New York Yankees",
  profile,
  businessType: "services",
  healthScore: 72,
  healthLabel: "Healthy",
  snapshot: snap,
  chips,
  cashRunwayWeeks: 4,
  whatMatters: m1,
  openQueries: 0,
};
const prompt = workflowPrompt(ctx);
assert(prompt.includes(ctxText), "prompt embeds the capability catalogue");
assert(/Only recommend actions Mil[oō]n can actually perform/.test(prompt), "prompt forbids invented capabilities");
assert(/Do not say "I", "AI", "model", "Claude", "Milonbot"/.test(prompt), "prompt forbids AI self-reference");
assert(/grow sales/i.test(prompt) && /Revenue: \$1\.[56]m/.test(prompt), "prompt carries profile + figures");

const fb = fallbackWorkflow(ctx);
assert(/13-Week Cash Forecast/.test(fb) && /4-week runway/.test(fb), `fallback follows the runway: ${fb}`);
const fbGrowth = fallbackWorkflow({ ...ctx, cashRunwayWeeks: 30, chips: [], snapshot: [] });
assert(/Budget tab/.test(fbGrowth), `fallback follows the owner goal: ${fbGrowth}`);

assert(
  sanitizeWorkflowText(
    '"This month\'s Milōn workflow: Use the 13-Week Cash Forecast to trace the runway. Then agree actions in the Action Plan. And a third sentence."',
  ) === "Use the 13-Week Cash Forecast to trace the runway. Then agree actions in the Action Plan.",
  "sanitiser strips heading/quotes and caps at two sentences",
);
assert(sanitizeWorkflowText("As an AI model I think you should…") === null, "sanitiser refuses AI self-reference");
assert(sanitizeWorkflowText("Consider the Pro subscription plan.") === null, "sanitiser refuses pricing talk");

// ── cache key + freshness ────────────────────────────────────────────────────
const h1 = workflowInputsHash(ctx);
assert(h1 === workflowInputsHash({ ...ctx, openQueries: 3 }), "open queries do not churn the cache");
assert(h1 !== workflowInputsHash({ ...ctx, cashRunwayWeeks: 12 }), "runway change → new key");
assert(
  h1 ===
    workflowInputsHash({
      ...ctx,
      snapshot: ctx.snapshot.map((m) => (m.key === "updated" ? { ...m, value: "Oct 1, 2026" } : m)),
    }),
  "last-updated date alone does not churn the cache",
);
const cached = parseBriefingWorkflow({ text: "x", source: "claude", generatedAt: new Date().toISOString(), inputsHash: h1 });
assert(cached && workflowCacheFresh(cached, h1), "fresh cache reused");
assert(!workflowCacheFresh(cached, "other"), "changed inputs → regenerate");
assert(
  !workflowCacheFresh({ ...cached!, generatedAt: "2026-01-01T00:00:00.000Z" }, h1, Date.parse("2026-03-01")),
  "stale after 35 days",
);
assert(!workflowCacheFresh({ ...cached!, source: "fallback" }, h1), "fallback never sticks");

// ── wiring ───────────────────────────────────────────────────────────────────
const route = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(route.includes("<ClientBriefing"), "route renders ClientBriefing");
assert(!route.includes("PeriodVarianceStrip") && !route.includes("AccountantOperatingProfile"), "old blocks removed");
assert(!route.includes("Reports issued</span>") && !route.includes("Last forecast</span>"), "old meta labels gone");
assert(!/overallHealth\.pillars\s*\n?\s*\.filter\(\(p\) => p\.score != null\)\s*\n?\s*\.map/.test(route), "pillar score chips removed from header");
const comp = read("src/components/client-briefing.tsx");
for (const must of ["Financial Health", "Financial snapshot", "About this business", "What matters", "Milōn workflow", "View full profile", "View breakdown", "No open queries", "Open movement report"]) {
  assert(comp.includes(must), `component has "${must}"`);
}
assert(!/CONCENTRATION|Concentration<|>Debt</.test(comp), "no concentration/debt tags");
const reports = read("src/routes/_authenticated/reports.index.tsx");
assert(!reports.includes("No period history yet — save at least one snapshot"), "movement report no longer throws without history");
const pdf = read("src/reports/ratio-movement.tsx");
assert(pdf.includes("hasHistory ? counts : { ...counts, total: 0 }"), "movement PDF has a first-period empty state");
const css = read("src/styles/accountant-portal.css");
assert(css.includes(".briefing-status") && css.includes(".briefing-brief"), "briefing styles present");
assert(read("supabase/migrations/20260913090000_clients_briefing_workflow.sql").includes("briefing_workflow JSONB"), "migration");
assert(read("src/integrations/supabase/types.ts").includes("briefing_workflow: Json | null"), "types");

console.log("client-briefing: all assertions passed");
