/**
 * Client briefing header: one snapshot, no duplicated metrics, grounded
 * interpretation, Milōn-only workflow recommendation.
 * Run: pnpm test:client-briefing
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MILON_CAPABILITIES,
  SNAPSHOT_HINT_DISPLAY_MAX,
  SNAPSHOT_HINT_SCHEMA_MAX,
  SNAPSHOT_METRIC_KEYS,
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
import {
  parseBriefingWorkflow,
  parseWorkflowSnapshot,
  workflowCacheFresh,
} from "../src/lib/client-briefing.functions";
import { buildVarianceChips } from "../src/lib/prior-period";
import type { ClientOperatingProfile } from "../src/lib/client-profile";
import { resolveMarket } from "../src/lib/market";
import {
  alignBrainFigureCopy,
  formatStatementMargin,
  visibleStatementFigures,
} from "../src/lib/statement-margin";

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
assert(formatStatementMargin(0.6) === "60.0%", "fraction 0.6 prints as 60.0%");
assert(formatStatementMargin(0.086) === "8.6%", "fraction 0.086 prints as 8.6%");
assert(formatStatementMargin(60) === "60.0%", "an already-percent margin is not scaled again");
assert(formatStatementMargin(91) === "91.0%", "an already-percent 91 is not scaled to 9100%");
assert(formatStatementMargin(29) === "29.0%", "an already-percent 29 is not scaled again");
// Yankees Sep 2026 Xero snapshot (e9dc0c5a). These are fractions on the live
// ratio path. 60.0% / 8.6% is QA US Test LLC (3cc31b6a), a different file.
const yankeesGross = 0.9101209229058562;
const yankeesOperating = 0.28969607116382506;
assert(formatStatementMargin(yankeesGross) === "91.0%", "Yankees gross fraction prints as 91.0%");
assert(
  formatStatementMargin(yankeesOperating) === "29.0%",
  "Yankees operating fraction prints as 29.0%",
);
const yankeesLines = visibleStatementFigures({
  grossMargin: yankeesGross,
  operatingMargin: yankeesOperating,
  netMargin: yankeesOperating,
  periodLabel: "1 Sep 2026 – 21 Sep 2026",
});
assert(
  yankeesLines.map((line) => `${line.label} ${line.value}`).join(" | ") ===
    "Gross margin 91.0% | Operating margin 29.0% | Net margin 29.0%",
  `summary lines match Overview scale: ${yankeesLines.map((line) => line.value).join(",")}`,
);
const yankeesSnap = buildFinancialSnapshot({
  chips: buildVarianceChips({
    currentFinancials: { revenue: 8633.6, cogs: 775.98, ebit: 2501.12 },
    currentRatios: { "Gross Margin": yankeesGross, "Operating Margin": yankeesOperating },
    prior: null,
  }),
  cashRunwayWeeks: null,
  periodLabel: "1 Sep 2026 – 21 Sep 2026",
  market: US,
});
assert(
  yankeesSnap.find((row) => row.key === "gm")?.value === "91.0%",
  "Overview GM for the Yankees fraction is 91.0%",
);
assert(
  yankeesSnap.find((row) => row.key === "om")?.value === "29.0%",
  "Overview OM for the Yankees fraction is 29.0%",
);
assert(
  yankeesSnap.find((row) => row.key === "gm")?.value ===
    yankeesLines.find((line) => line.key === "gross")?.value &&
    yankeesSnap.find((row) => row.key === "om")?.value ===
      yankeesLines.find((line) => line.key === "operating")?.value,
  "Overview GM/OM equal the Client Brain summary lines",
);
assert(
  alignBrainFigureCopy(
    "Gross margin of **0.6** and operating margin of **0.16**. Period not dated",
    { grossMargin: 0.6, operatingMargin: 0.086, periodLabel: "Sep 2026" },
  ) === "Gross margin of **60.0%** and operating margin of **8.6%**. Sep 2026",
  "brain gap copy matches the overview percent scale and period",
);
const snapshotPeriod = buildFinancialSnapshot({
  chips,
  datedPeriod: false,
  periodLabel: "Sep 2026",
  market: US,
});
assert(
  snapshotPeriod.find((row) => row.key === "revenue")?.hint === "Sep 2026",
  "briefing dates revenue from the snapshot when the statement is undated",
);
assert(
  !snapshotPeriod.find((row) => row.key === "gm")?.delta,
  "an undated statement does not show a margin movement",
);
const om = snap[2]!;
assert(om.delta?.direction === "down" && om.delta.text === "1.4pp" && !om.delta.good, "OM down 1.4pp, bad");
assert(snap[3]!.value === "4 weeks", `runway once: ${snap[3]!.value}`);
assert(snap[4]!.label === "Last updated" && /Sep 12, 2026/.test(snap[4]!.value), "last updated = freshest stamp");
assert(!JSON.stringify(snap).includes("vs prior —"), "never renders a meaningless vs prior —");

// Cash is the fifth snapshot row when every metric exists. The anchor note is
// longer than the old 80-character hint cap and used to 400 draft/propose.
const anchorNote =
  "400 days sit between 2025-01-01 and this week (2026-02-05). Opening cash is still the balance on 2025-01-01.";
assert(anchorNote.length > 80 && anchorNote.length <= SNAPSHOT_HINT_SCHEMA_MAX, `anchor note length ${anchorNote.length}`);
const withCash = buildFinancialSnapshot({
  chips,
  cashRunwayWeeks: 4,
  financialsUpdatedAt: "2026-09-12T10:00:00.000Z",
  lastForecastAt: "2026-09-01T10:00:00.000Z",
  priorLabel: "Sep 2025",
  market: US,
  cash: { amount: 1_200_000, floor: 250_000, dipsBelowFloorWeek: 4, note: anchorNote },
});
assert(
  withCash.map((m) => m.key).join(",") === "revenue,gm,om,runway,cash,updated",
  `cash sits at snapshot[4]: ${withCash.map((m) => m.key).join(",")}`,
);
assert(withCash[4]!.key === "cash" && withCash[4]!.hint === anchorNote, "short-enough cash note is kept");
const parsedCash = parseWorkflowSnapshot(withCash);
assert(
  parsedCash[4]?.key === "cash" && parsedCash[4]?.hint === anchorNote,
  "MetricSchema accepts cash and a hint over 80 characters",
);
const overflowNote = `${anchorNote} ${"The statement line is older than the forecast start.".repeat(8)}`;
assert(overflowNote.length > SNAPSHOT_HINT_SCHEMA_MAX, "fixture exceeds the schema cap");
const clipped = buildFinancialSnapshot({
  chips: [],
  cashRunwayWeeks: null,
  cash: { amount: 1_200_000, floor: 250_000, dipsBelowFloorWeek: null, note: overflowNote },
});
assert(clipped[0]?.key === "cash", "cash row still built from a long note");
assert((clipped[0]!.hint?.length ?? 0) <= SNAPSHOT_HINT_DISPLAY_MAX, `display hint clipped: ${clipped[0]?.hint?.length}`);
assert(clipped[0]!.hint?.endsWith("…"), "clipped hint is marked");
const parsedOverflow = parseWorkflowSnapshot([
  { key: "cash", label: "Cash", value: "R 1.2m", hint: overflowNote },
]);
assert(
  (parsedOverflow[0]?.hint?.length ?? 0) <= SNAPSHOT_HINT_SCHEMA_MAX,
  "hint overflow is clipped at parse instead of throwing",
);
assert(
  parseWorkflowSnapshot([{ key: "cash", label: "Cash", value: "R 1.2m" }])[0]?.key === "cash",
  "cash without a hint still parses",
);
assert(SNAPSHOT_METRIC_KEYS.includes("cash"), "shared key list includes cash");

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

const quiet = whatMatters({
  healthScore: 78,
  healthStatus: "healthy",
  chips: buildVarianceChips({
    currentFinancials: { revenue: 50_000, cogs: 20_000, ebit: 8_000 },
    currentRatios: { "Creditor Days": 73, "Debtor Days": 39 },
    prior: null,
  }),
  cashRunwayWeeks: null,
  profile,
  hasFigures: true,
  ratios: { "Creditor Days": 73, "Debtor Days": 39, "Gross Margin": 0.6 },
})!;
assert(!/no single metric demanding attention/.test(quiet), `must not dismiss the card: ${quiet}`);
assert(/Creditor days are 73/.test(quiet) && /60-day mark/.test(quiet), `names the card signal: ${quiet}`);
assert(!/Debtor days are 39/.test(quiet), "39 debtor days is under the 40-day peer median");

const cashOut = whatMatters({
  healthScore: 84,
  healthStatus: "healthy",
  chips: [],
  cashRunwayWeeks: 21,
  profile,
  hasFigures: true,
  ratios: {},
  forecastNet: -15200,
})!;
assert(!/no single metric demanding attention/.test(cashOut), `forecast net out is a cash point: ${cashOut}`);
assert(/nets cash out/.test(cashOut), `names the forecast: ${cashOut}`);

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
assert(route.includes("onOpenQueries={() => openArchive"), "queries stay a clickable archive control");
assert(route.includes("onOpenReports={() => revealTab(\"reports\")}"), "Create report opens Reports and scrolls to the pane");
assert(route.includes("onUpload={() => setUploadOpen(true)}"), "briefing Upload opens the statement dialog");
assert(!/Claude|Anthropic/i.test(route), "client page copy has no vendor wording");
assert(!/overallHealth\.pillars\s*\n?\s*\.filter\(\(p\) => p\.score != null\)\s*\n?\s*\.map/.test(route), "pillar score chips removed from header");
const comp = read("src/components/client-briefing.tsx");
assert(comp.includes('id="client-upload-cta"'), "Upload sits in the client briefing");
assert(comp.includes('brand="xero"'), "briefing offers Connect to Xero");
assert(comp.includes('brand="quickbooks"'), "briefing offers Connect to QuickBooks");
assert(comp.includes('id="client-connect-xero"'), "briefing keeps the Xero connect id");
assert(comp.includes('id="client-connect-qbo"'), "briefing keeps the QuickBooks connect id");
const connectSlice = comp.slice(comp.indexOf('id="client-connect-qbo"'), comp.indexOf('id="wizard-open-queries"'));
assert(!connectSlice.includes("ghost") && !connectSlice.includes("gold"), "connect CTAs are not Milōn gold or ghost buttons");
const brandBtn = read("src/components/brand-connect-button.tsx");
assert(brandBtn.includes("Connect to Xero"), "Xero label matches the brand button");
assert(brandBtn.includes("Connect to QuickBooks"), "QuickBooks label matches the brand button");
const qboCard = read("src/components/qbo-connect.tsx");
const xeroCard = read("src/components/xero-connect.tsx");
assert(qboCard.includes('brand="quickbooks"'), "Health & Ratios QuickBooks card uses the brand button");
assert(xeroCard.includes('brand="xero"'), "Health & Ratios Xero card uses the brand button");
assert(qboCard.includes("ledger-connect__disconnect"), "QuickBooks disconnect stays a secondary action");
assert(xeroCard.includes("ledger-connect__sync"), "Xero sync stays a secondary action");
assert(!qboCard.includes("Connect QuickBooks"), "QuickBooks card drops the short generic label");
assert(!xeroCard.includes(">Connect Xero<"), "Xero card drops the short generic label");
const primitives = read("src/styles/primitives.css");
assert(primitives.includes("#2CA01C"), "QuickBooks button uses Intuit green");
assert(primitives.includes("#13B5EA"), "Xero button uses Xero blue");
assert(primitives.includes(".ledger-connect__disconnect"), "disconnect styling is unchanged");
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
assert(css.includes(".briefing-actions"), "actions sit in a button row, not underline links");
assert(css.includes("Cormorant Garamond"), "client name keeps the serif");
const briefingFirstPaint = comp.slice(0, comp.indexOf("<Dialog"));
assert(!briefingFirstPaint.includes("btn gold"), "briefing first paint has no competing gold CTA");
assert(
  briefingFirstPaint.includes('portalButtonClass("secondary")'),
  "briefing actions stay reachable as secondary",
);
assert(
  !briefingFirstPaint.includes('portalButtonClass("primary")'),
  "the briefing does not mint its own primary",
);
assert(comp.includes("btn gold mini"), "the profile dialog keeps a single edit action");
assert(!comp.includes("briefing-link"), "underline-style briefing links are gone");
assert(comp.includes("Create report") || comp.includes("Open Reports"), "reports CTA stays reachable");
assert(read("supabase/migrations/20260913090000_clients_briefing_workflow.sql").includes("briefing_workflow JSONB"), "migration");
assert(read("src/integrations/supabase/types.ts").includes("briefing_workflow: Json | null"), "types");

console.log("client-briefing: all assertions passed");
