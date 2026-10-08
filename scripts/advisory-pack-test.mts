/**
 * Advisory pack (P1.1 / P1.2) — deterministic builder, statement-level
 * honesty, edit-rate maths, SQL↔TS vocabulary drift, and shell wiring.
 * Run: pnpm test:advisory-pack
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  HIGH_EDIT_RATE,
  PACK_APP_ACTIONS,
  PACK_GENERATORS,
  PACK_REVIEW_ACTIONS,
  PACK_SECTION_KEYS,
  PACK_STATUSES,
  alignPackFloorCopy,
  buildAdvisoryPack,
  computeEditStats,
  diffPackSections,
  fmtRatio,
  isMissingPackRelation,
  advisoryPackSignOffGate,
  livePackMetrics,
  overviewFiguresForPackDrift,
  packNarrativeRatios,
  packStatusLabel,
  parsePackContent,
  parsePackRow,
  type PackInputs,
} from "../src/lib/advisory-pack";
import { ADVISORY_EVENTS } from "../src/lib/advisory-state";
import { formatSnapshotRatio, groundAdvisoryNarrative } from "../src/lib/advisory-narrative";
import {
  computeOverallHealth,
  overviewRatioInputs,
  overviewRatios,
  PILLAR_LABELS,
  scorecardHealthFromFinancials,
} from "../src/lib/health-score";
import { computeRatios } from "../src/lib/ratios";
import { brainDraftSupersededByPack, checkRootCauseClaims, type Recommendation } from "../src/lib/recommendations";
import {
  creditorDaysReason,
  dataRequestDayRatios,
  debtorDaysReason,
  detectDataGaps,
  overviewRequestCardRows,
  presentLiveDataRequests,
} from "../src/lib/data-requests";
import {
  buildScorecardRatioResults,
  scorecardDownloadShouldRenderLive,
  scorecardRatiosFromFinancials,
} from "../src/lib/scorecard-rows";
import { ratiosStatementFigures } from "../src/lib/deliverable-input-config";
import { formatMoneyCompact, formatSignedOffDateTime } from "../src/lib/market/format";
import { resolveMarket, ZA_MARKET } from "../src/lib/market/resolve";
import { forecastRunwayHeadlineShared, forecastStatusSentence } from "../src/lib/cash-forecast-parity";
import { packDisplayedSignoffLine } from "../src/lib/review-signoff-stamp";
import type { DataRequest } from "../src/lib/data-requests";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = "2026-09-18T12:00:00.000Z";

const RATIOS: Record<string, number> = {
  "Net Margin": 0.04,
  "Operating Margin": 0.07,
  "Gross Margin": 0.31,
  "Debtor Days": 71,
  "Creditor Days": 28,
  "Inventory Days": 40,
  "Working Capital Days": 83,
  "Asset Turnover": 1.1,
  "Fixed Cost Ratio": 0.62,
};
const PRIOR: Record<string, number> = {
  ...RATIOS,
  "Debtor Days": 52,
  "Gross Margin": 0.34,
  "Net Margin": 0.04,
};

function rec(over: Partial<Recommendation> = {}): Recommendation {
  return {
    id: "r-" + (over.title ?? "x").toLowerCase().replace(/\W+/g, "-"),
    client_id: "c",
    cycle_id: null,
    title: "Tighten credit terms",
    rationale: "Debtor days 71 vs 45",
    problem: "Customers are paying later each month",
    evidence: [],
    priority: "high",
    confidence: 0.7,
    data_depth: "statement",
    expected_impact_metric: "cash",
    expected_impact_amount: 45000,
    expected_impact_horizon_days: 90,
    expected_impact_note: null,
    source: "ai",
    status: "proposed",
    assumptions: [],
    linked_action_item_id: null,
    superseded_by: null,
    decided_at: null,
    decided_by: null,
    signed_off_by_id: null,
    signed_off_by_name: null,
    signed_off_at: null,
    note: null,
    created_by: null,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  } as Recommendation;
}

function req(over: Partial<DataRequest> = {}): DataRequest {
  return {
    id: "d1",
    client_id: "c",
    cycle_id: null,
    kind: "aged_debtors",
    title: "Aged debtors report",
    reason: null,
    severity: "important",
    status: "open",
    source: "system",
    rule_key: "debtor_days_no_ageing",
    requested_by: null,
    requested_at: NOW,
    due_at: null,
    sent_at: null,
    sent_to: null,
    last_reminded_at: null,
    fulfilled_at: null,
    fulfilled_by: null,
    fulfilled_with: null,
    waived_reason: null,
    meta: {},
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

function inputs(over: Partial<PackInputs> = {}): PackInputs {
  return {
    clientName: "New Co",
    firmName: null,
    hasFirm: false,
    periodLabel: "Aug 2026",
    priorPeriodLabel: "Jul 2026",
    figuresAsOf: "2026-08-31",
    health: computeOverallHealth({ ratios: RATIOS, cashRunwayWeeks: 6 }),
    ratios: RATIOS,
    priorRatios: PRIOR,
    openingBalance: 125000,
    closings: [
      110000, 90000, 60000, 30000, 5000, -12000, -8000, 4000, 20000, 35000, 50000, 70000, 90000,
    ],
    cashRunwayWeeks: 4,
    recommendations: [
      rec(),
      rec({ title: "Renegotiate supplier terms", priority: "medium", status: "approved" }),
    ],
    dataRequests: [req()],
    openActions: 2,
    overdueActions: 1,
    now: NOW,
    ...over,
  };
}

// ── 1. Builder: shape, determinism, facts ────────────────────────────────────

{
  const a = buildAdvisoryPack(inputs());
  const b = buildAdvisoryPack(inputs());
  eq(JSON.stringify(a), JSON.stringify(b), "deterministic for identical inputs");

  eq(
    a.sections.map((s) => s.key).join(","),
    PACK_SECTION_KEYS.join(","),
    "every section present, fixed order",
  );
  for (const s of a.sections) assert(s.body.length > 20, `section ${s.key} has copy`);
  assert(a.sections.find((s) => s.key === "disclosure")!.locked === true, "disclosure is locked");
  eq(a.reviewer, "owner", "no firm → owner reviews");
  eq(
    buildAdvisoryPack(inputs({ hasFirm: true, firmName: "Firm" })).reviewer,
    "accountant",
    "firm → accountant reviews",
  );

  // Headline names the drag and the cash break.
  const head = a.sections[0].body;
  assert(
    /New Co is (at risk|watch|healthy) at \d+\/100/i.test(head),
    `headline has score: ${head}`,
  );
  assert(/cash goes negative in week 6/.test(head), `headline names the break week: ${head}`);

  // Forecast block
  eq(a.forecast?.lowestWeek, 6, "lowest week");
  eq(a.forecast?.lowestClosing, -12000, "lowest closing");
  eq(a.forecast?.breachesZero, true, "breaches zero");
  const fc = a.sections.find((s) => s.key === "forecast")!.body;
  assert(
    fc.includes("R125 000") && fc.includes("-R 12.0k") && fc.includes("week 6"),
    `forecast copy: ${fc}`,
  );

  // What changed: only ≥5% moves, direction + better/worse
  const changed = a.sections.find((s) => s.key === "what_changed")!;
  assert(
    changed.bullets!.some((x) =>
      x.startsWith("Debtor Days: 52 days → 71 days (up 19 days, worse)"),
    ),
    `debtor move: ${changed.bullets}`,
  );
  assert(
    changed.bullets!.some((x) => x.startsWith("Gross Margin: 34.0% → 31.0% (down 3.0pp, worse)")),
    `margin move: ${changed.bullets}`,
  );
  assert(!changed.bullets!.some((x) => x.startsWith("Net Margin")), "unchanged ratio not listed");

  // What matters: weakest pillar first, weak ratios cite score
  const matters = a.sections.find((s) => s.key === "what_matters")!;
  assert(matters.bullets![0].includes("weakest pillar"), "weakest pillar leads");
  assert(
    matters.bullets!.some((x) => /Cash runs out in week 6/.test(x)),
    "cash break in what matters",
  );
  assert(
    matters.bullets!.some((x) => /blocking data gap/.test(x)) === false,
    "important gap is not called blocking",
  );

  // Recommendations: strongest first, approved flagged
  const recs = a.sections.find((s) => s.key === "recommendations")!;
  eq(recs.bullets!.length, 2, "two recommendations");
  assert(
    recs.bullets![0].startsWith("High · Tighten credit terms"),
    `priority order: ${recs.bullets![0]}`,
  );
  assert(
    recs.bullets![0].includes("expected: +R45 000 cash over 90 days") ||
      recs.bullets![0].includes("expected: "),
    "impact shown",
  );
  assert(recs.bullets![1].endsWith("· approved"), "approved flagged");

  // Data gaps
  const gaps = a.sections.find((s) => s.key === "data_gaps")!;
  eq(gaps.bullets![0], "Needed · Aged debtors report", "gap bullet");

  // Next step copy differs by seat
  assert(
    a.sections.find((s) => s.key === "next_step")!.body.includes("invite an accountant"),
    "owner-only next step offers invite",
  );
  const withFirm = buildAdvisoryPack(inputs({ hasFirm: true, firmName: "Amstel & Co" }));
  assert(
    withFirm.sections
      .find((s) => s.key === "next_step")!
      .body.startsWith("Amstel & Co reviews this pack first"),
    "firm named in next step",
  );
  assert(
    withFirm.sections
      .find((s) => s.key === "disclosure")!
      .body.includes("Accountant review status"),
    "firm disclosure",
  );
  assert(
    a.sections
      .find((s) => s.key === "disclosure")!
      .body.includes("No accountant has reviewed this pack"),
    "no-firm disclosure",
  );
  assert(
    a.sections
      .find((s) => s.key === "disclosure")!
      .body.includes("not regulated financial, tax or legal advice"),
    "HITL framing",
  );
  assert(
    a.sections.find((s) => s.key === "disclosure")!.body.includes("31 Aug 2026"),
    "figures date in disclosure",
  );
}

// ── 2. Degraded inputs never crash and say so ─────────────────────────────────

{
  const bare = buildAdvisoryPack(
    inputs({
      health: null,
      ratios: null,
      priorRatios: null,
      closings: null,
      openingBalance: null,
      recommendations: [],
      dataRequests: [],
      openActions: 0,
      overdueActions: 0,
      periodLabel: null,
      priorPeriodLabel: null,
      figuresAsOf: null,
    }),
  );
  eq(bare.sections.length, PACK_SECTION_KEYS.length, "all sections even when empty");
  assert(bare.sections[0].body.includes("no health score yet"), "headline admits missing score");
  assert(
    bare.sections.find((s) => s.key === "what_changed")!.body.startsWith("First period on record"),
    "no prior → first period",
  );
  assert(
    bare.sections.find((s) => s.key === "forecast")!.body.startsWith("No 13-week cash forecast"),
    "no forecast → says so",
  );
  assert(
    bare.sections.find((s) => s.key === "recommendations")!.body.startsWith("No recommendations"),
    "no recs → says so",
  );
  assert(
    bare.sections.find((s) => s.key === "data_gaps")!.body.startsWith("Nothing outstanding"),
    "no gaps → says so",
  );
  assert(
    bare.sections.find((s) => s.key === "disclosure")!.body.includes("an unknown date"),
    "unknown date handled",
  );
  eq(bare.forecast, null, "forecast block null");
  eq(bare.health, null, "health block null");

  const flat = buildAdvisoryPack(inputs({ priorRatios: RATIOS }));
  assert(
    flat.sections
      .find((s) => s.key === "what_changed")!
      .body.startsWith("Nothing moved more than 5%"),
    "no moves copy",
  );

  const noOpening = buildAdvisoryPack(inputs({ openingBalance: 0 }));
  assert(
    noOpening.sections.find((s) => s.key === "forecast")!.body.includes("no opening bank balance"),
    "zero opening balance flagged",
  );

  const safe = buildAdvisoryPack(
    inputs({
      closings: [
        200000, 210000, 220000, 230000, 240000, 250000, 260000, 270000, 280000, 290000, 300000,
        310000, 320000,
      ],
    }),
  );
  assert(
    safe.sections
      .find((s) => s.key === "state_of_business")!
      .body.includes("stays above the R 50.0k floor"),
    "healthy forecast copy",
  );
  assert(!safe.sections[0].body.includes("cash goes negative"), "no break in headline");
}

// ── 3. Statement-level honesty: no section names invoices / customers ────────

{
  const p = buildAdvisoryPack(inputs());
  for (const s of p.sections) {
    const text = [s.title, s.body, ...(s.bullets ?? [])].join("\n");
    const check = checkRootCauseClaims({
      data_depth: "statement",
      title: s.title,
      rationale: text,
    });
    assert(
      check.ok,
      `section ${s.key} makes a transaction-level claim: ${JSON.stringify((check as { violations?: string[] }).violations)}`,
    );
  }
  const debtorWhy = p.sections
    .find((s) => s.key === "what_matters")!
    .bullets!.find((b) => b.startsWith("Debtor Days"))!;
  assert(
    debtorWhy.includes("not any one customer"),
    "debtor copy explicitly refuses to name a customer",
  );
}

// ── 4. Formatting ────────────────────────────────────────────────────────────

{
  eq(fmtRatio("Debtor Days", 71.4), "71 days", "days");
  eq(fmtRatio("Gross Margin", 0.3149), "31.5%", "percent");
  eq(fmtRatio("Asset Turnover", 1.1), "1.10×", "multiple");
  eq(fmtRatio("Sales-per-Employee Ratio", 1234567), "R1 234 567", "money");
  eq(fmtRatio("Net Margin", Number.NaN), "—", "nan");
}

// ── 5. Diff + edit rate ──────────────────────────────────────────────────────

{
  const draft = buildAdvisoryPack(inputs());
  const same = computeEditStats(draft, draft);
  eq(same.edit_rate, 0, "no edits → 0");
  eq(same.sections_changed, 0, "no sections changed");
  eq(same.sections_total, PACK_SECTION_KEYS.length, "sections total");

  const edited = parsePackContent(JSON.parse(JSON.stringify(draft)));
  edited.sections[0].body = "Completely different headline written by the accountant.";
  const stats = computeEditStats(draft, edited);
  eq(stats.sections_changed, 1, "one section changed");
  assert(
    stats.edit_rate > 0 && stats.edit_rate < 0.2,
    `small edit → small rate (${stats.edit_rate})`,
  );
  assert(stats.chars_changed > 0 && stats.chars_changed <= stats.chars_total, "chars sane");

  const rewrite = parsePackContent(JSON.parse(JSON.stringify(draft)));
  for (const s of rewrite.sections) {
    s.body = "Rewritten from scratch by a human who disagreed with everything in this section.";
    s.bullets = undefined;
  }
  const big = computeEditStats(draft, rewrite);
  assert(
    big.edit_rate >= HIGH_EDIT_RATE,
    `full rewrite crosses the high-edit threshold (${big.edit_rate})`,
  );
  assert(big.edit_rate <= 1, "capped at 1");

  const diffs = diffPackSections(draft, edited);
  eq(
    diffs
      .filter((d) => d.changed)
      .map((d) => d.key)
      .join(","),
    "headline",
    "diff names the changed section",
  );
  eq(diffs[0].before, [draft.sections[0].title, draft.sections[0].body].join("\n"), "before text");

  // A section removed in the final counts as changed, not as a crash.
  const shorter = parsePackContent({ ...draft, sections: draft.sections.slice(1) });
  eq(diffPackSections(draft, shorter)[0].changed, true, "missing section = changed");
}

// ── 6. Parsing + labels ──────────────────────────────────────────────────────

{
  const row = parsePackRow({
    id: "p",
    client_id: "c",
    version: "3",
    status: "weird",
    requires_review: true,
    generator: "?",
    ai_draft: { sections: [{ key: "headline", body: "x" }] },
    content: null,
    edit_stats: { edit_rate: 0.1 },
    generated_at: NOW,
    reviewed_by_kind: "nobody",
  });
  eq(row.version, 3, "version coerced");
  eq(row.status, "draft", "unknown status → draft");
  eq(row.generator, "rules", "unknown generator → rules");
  eq(row.ai_draft.sections[0].title, "headline", "section title falls back to key");
  eq(row.content.sections.length, 0, "null content → empty sections");
  eq(row.reviewed_by_kind, null, "unknown reviewer kind → null");

  eq(packStatusLabel("draft", false), "Ready for you", "owner-only draft label");
  eq(packStatusLabel("draft", true), "Draft", "firm draft label");
  eq(packStatusLabel("approved", true), "Signed off", "signed off");
  eq(packStatusLabel("approved", false), "Accepted", "accepted");
  for (const s of PACK_STATUSES) assert(packStatusLabel(s, true).length > 0, `label ${s}`);

  assert(
    isMissingPackRelation({ message: 'relation "public.advisory_packs" does not exist' }),
    "missing table",
  );
  assert(
    isMissingPackRelation({
      message: "Could not find the function public.advisory_pack_create in the schema cache",
    }),
    "missing rpc",
  );
  assert(
    !isMissingPackRelation({ message: "permission denied for table advisory_packs" }),
    "permission ≠ missing",
  );
}

// ── 7. SQL ↔ TS drift ────────────────────────────────────────────────────────

{
  const sql = readFileSync(
    resolve("supabase/migrations/20260918160000_advisory_packs.sql"),
    "utf8",
  );
  const list = (re: RegExp, label: string) => {
    const m = sql.match(re);
    if (!m) throw new Error(`${label} CHECK not found`);
    return Array.from(m[1].matchAll(/'([a-z_+]+)'/g), (x) => x[1]).sort();
  };
  eq(
    list(
      /status\s+text NOT NULL DEFAULT 'draft' CHECK \(status IN \(([\s\S]*?)\)\)/,
      "status",
    ).join(","),
    [...PACK_STATUSES].sort().join(","),
    "statuses match SQL",
  );
  const reviewActions = list(/action\s+text NOT NULL CHECK \(action IN \(([\s\S]*?)\)\)/, "action");
  const staleSql = readFileSync(
    resolve("supabase/migrations/20261007120000_advisory_pack_stale_signoff.sql"),
    "utf8",
  );
  assert(staleSql.includes("'invalidate'"), "stale sign-off migration records invalidate");
  assert(
    staleSql.includes("CASE WHEN v_pack.requires_review THEN 'in_review' ELSE 'draft' END"),
    "invalidate reverts a firm pack to review and an owner pack to draft",
  );
  assert(
    staleSql.includes("Figures have changed since this pack was generated, regenerate"),
    "invalidate audit note matches the regenerate banner",
  );
  assert(
    staleSql.includes("reviewed_at = NULL") && staleSql.includes("reviewed_by = NULL"),
    "invalidate clears the stored sign-off stamps",
  );
  eq(
    [...reviewActions, "invalidate"].sort().join(","),
    [...PACK_REVIEW_ACTIONS].sort().join(","),
    "review actions match SQL",
  );
  eq(
    list(
      /generator\s+text NOT NULL DEFAULT 'rules' CHECK \(generator IN \(([\s\S]*?)\)\)/,
      "generator",
    ).join(","),
    [...PACK_GENERATORS].sort().join(","),
    "generators match SQL",
  );
  const rpcActions = sql.match(/IF p_action NOT IN \(([\s\S]*?)\) THEN/)![1];
  const rpcList = Array.from(rpcActions.matchAll(/'([a-z_]+)'/g), (x) => x[1]);
  const staleAllow = staleSql.match(/IF p_action NOT IN \(([\s\S]*?)\) THEN/)![1];
  assert(staleAllow.includes("'invalidate'"), "review RPC allowlists invalidate");
  eq(
    [...rpcList, "invalidate"].sort().join(","),
    [...PACK_APP_ACTIONS].sort().join(","),
    "RPC action allowlist matches PACK_APP_ACTIONS",
  );

  for (const e of [
    "pack.generated",
    "pack.approved",
    "pack.changes_requested",
    "pack.rejected",
    "pack.delivered",
  ]) {
    assert((ADVISORY_EVENTS as readonly string[]).includes(e), `event ${e} in TS`);
    assert(sql.includes(`'${e}'`), `event ${e} in SQL`);
  }
  assert(
    sql.includes("(320, 'pack.approved', 'accountant_review', 'none', 'client_decision', false)"),
    "pack.approved rule seeded",
  );
  assert(
    !/CREATE POLICY[^;]*FOR (INSERT|UPDATE|DELETE)/.test(sql),
    "no direct write policies: RPC only",
  );
  assert(
    sql.includes("This pack needs the accountant''s sign-off"),
    "owner cannot approve a firm pack",
  );
  assert(sql.includes("An approved pack is final"), "approved pack cannot be edited");
  assert(
    sql.includes("ai_draft, content, generated_by") && sql.includes("p_content, p_content, v_uid"),
    "ai_draft frozen as a copy of content at creation",
  );
  assert(
    sql.includes("'supersede'") && sql.includes("Superseded by a newer version"),
    "new version supersedes the open pack with an audit row",
  );
  assert(
    /EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING 'advisory_trg_packs failed/.test(sql),
    "pack trigger never blocks a write",
  );
}

// ── 8. Wiring ────────────────────────────────────────────────────────────────

{
  const fns = readFileSync(resolve("src/lib/advisory-pack.functions.ts"), "utf8");
  assert(
    fns.includes('rpc("advisory_pack_create"') && fns.includes('rpc("advisory_pack_review"'),
    "server fns use the two RPCs",
  );
  assert(
    fns.includes("computeEditStats(pack.ai_draft, next)"),
    "edit stats computed against the frozen draft on edit",
  );
  assert(
    fns.includes("computeEditStats(pack.ai_draft, pack.content)"),
    "edit stats computed on decision",
  );
  assert(
    fns.includes('throw new Error("This section is fixed and cannot be edited")'),
    "locked sections refused server-side",
  );
  assert(fns.includes('p_generator: "rules"'), "generator is rules-first (no LLM required)");
  assert(!/anthropic|callClaude|ANTHROPIC_API_KEY/.test(fns), "pack generation makes no LLM call");

  const panel = readFileSync(resolve("src/components/advisory-pack-panel.tsx"), "utf8");
  assert(panel.includes('action: "read"'), "owner read is recorded (delivery)");
  assert(panel.includes("data-high-edit-rate"), "high edit rate surfaced to the accountant");
  assert(panel.includes("Show AI draft"), "AI draft vs final diff visible");
  assert(panel.includes('hasFirm ? "Sign off pack" : "Accept pack"'), "sign-off vs accept copy");
  assert(panel.includes("advisoryPackSignOffGate"), "panel gates sign-off on the baked snapshot");
  assert(
    !panel.includes('action: "invalidate"'),
    "opening a stale pack does not clear the stored sign-off",
  );
  assert(
    panel.includes("data-signoff-blocked={signOffBlocked ? \"true\" : \"false\"}"),
    "sign-off control is blocked while figures drift",
  );
  assert(
    panel.includes("packDisplayedSignoffLine") && panel.includes("figuresChanged: signOffGate.figuresChanged"),
    "a stale approval still names the signer",
  );
  assert(
    fns.includes("throw new Error(ADVISORY_PACK_STALE_NOTE)") &&
      fns.includes('data.action === "approve"'),
    "server rejects approve while the snapshot disagrees with Overview",
  );
  assert(
    fns.includes("loadLivePackFigures") && fns.includes("livePackMetrics"),
    "server recomputes live Overview figures before approve or invalidate",
  );
  assert(
    fns.includes("packNarrativeRatios"),
    "regen quotes Ratios days in recommendation sentences",
  );
  assert(
    !fns.includes("computeOverallHealth({ ratios: current.ratios"),
    "regen does not bake stored snapshot ratios",
  );
  assert(panel.includes("seq.current += 1"), "regen ignores an in-flight pack load");
  assert(
    fns.includes("data.liveFigures") && panel.includes("liveFigures:"),
    "the figures on screen count as drift even if the server recompute lags",
  );
  assert(
    fns.includes('data.action === "invalidate"') &&
      fns.includes("!figuresChanged || pack.status !== \"approved\""),
    "invalidate is a no-op when figures still match",
  );
  assert(!/navigate\(|useNavigate|window\.location/.test(panel), "panel never navigates");

  const nextStep = readFileSync(resolve("src/lib/next-step.ts"), "utf8");
  for (const k of ["generate_pack", "review_pack", "read_pack"])
    assert(nextStep.includes(`"${k}"`), `target ${k}`);
  const nextFns = readFileSync(resolve("src/lib/next-step.functions.ts"), "utf8");
  assert(
    nextFns.includes('.from("advisory_packs")') && nextFns.includes('.neq("status", "superseded")'),
    "Next Step reads the latest live pack",
  );

  const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
  const appPack = app.indexOf("<AdvisoryPackPanel");
  const appRecs = app.indexOf("<RecommendationsPanel");
  assert(appPack > 0 && appPack < appRecs, "owner board: pack frames the recommendations");
  assert(app.includes("hasFirm={Boolean(clientMeta?.firm_id)}"), "owner board passes firm fact");
  const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
  const sPack = studio.indexOf("<AdvisoryPackPanel");
  const sRecs = studio.indexOf("<RecommendationsPanel");
  assert(sPack > 0 && sPack < sRecs, "studio: pack above recommendations on the advisory tab");
  assert(
    studio.includes('audience="accountant"\n                    canGenerate={hasFigures}'),
    "studio pack panel is the accountant seat",
  );
  assert(
    studio.includes("overviewRatioInputs(financials"),
    "studio Ratios and Overview score the live statement, not a stored snapshot",
  );
  assert(
    app.includes("priorFinancials: ownerPrior?.financials"),
    "owner Overview uses the same prior snapshot as the pack",
  );

  assert(panel.includes('id="advisory-pack-export-pdf"'), "pack panel mounts Export PDF");
  assert(panel.includes("Export PDF"), "export control uses the shared Export PDF label");
  assert(
    panel.includes("downloadAdvisoryPackPdf"),
    "pack export reuses the advisory pack PDF path",
  );
  const pdfLib = readFileSync(resolve("src/lib/advisory-pack-pdf.ts"), "utf8");
  const pdfReport = readFileSync(resolve("src/reports/advisory-pack.tsx"), "utf8");
  assert(
    pdfLib.includes("Draft for accountant review. Not sent."),
    "draft packs carry the accountant-review disclosure",
  );
  assert(pdfReport.includes("reviewSignoff"), "signed packs use the report footer stamp");
  assert(pdfReport.includes("PDFDocument"), "pack PDF uses the shared report shell");
  assert(
    !/claude|anthropic/i.test(pdfLib + pdfReport + panel.slice(panel.indexOf("exportPdf"))),
    "no vendor name on the export path",
  );
}

// ── 9. Stale sign-off vs the baked snapshot ──────────────────────────────────

{
  // QA US: pack v1 stayed SIGNED OFF at health 69 while Overview health was 71.
  const qaContent = {
    health: { overall: 69 },
    forecast: { openingBalance: 100000 },
    sections: [{ key: "forecast", body: "Opening balance. Runway 8 weeks." }],
  };
  const qaLive = { runwayLabel: "8 weeks", cash: 100000, healthScore: 71 };
  const stale = advisoryPackSignOffGate("approved", true, qaContent, qaLive);
  assert(stale.figuresChanged, "health 69 vs live 71 is drift");
  assert(!stale.signOffHolds, "SIGNED OFF does not hold against Overview");
  assert(stale.signOffBlocked, "a new sign-off is blocked while stale");
  eq(stale.presentedStatus, "approved", "a stale approval stays approved");
  eq(
    packStatusLabel(stale.presentedStatus, true),
    "Signed off",
    "a stale firm pack is not relabelled Draft",
  );

  const owner = advisoryPackSignOffGate("approved", false, qaContent, qaLive);
  eq(owner.presentedStatus, "approved", "owner acceptance stays approved");
  eq(
    packStatusLabel(owner.presentedStatus, false),
    "Accepted",
    "a stale owner pack is not relabelled Draft",
  );

  const blockedDraft = advisoryPackSignOffGate("in_review", true, qaContent, qaLive);
  assert(
    blockedDraft.signOffBlocked && !blockedDraft.signOffHolds,
    "an unsigned stale pack cannot become SIGNED OFF",
  );
  eq(blockedDraft.presentedStatus, "in_review", "an open pack keeps its status");

  const matched = advisoryPackSignOffGate("approved", true, qaContent, {
    runwayLabel: "8 weeks",
    cash: 100000,
    healthScore: 69,
  });
  assert(
    !matched.figuresChanged && matched.signOffHolds && !matched.signOffBlocked,
    "matching figures keep SIGNED OFF",
  );
  eq(packStatusLabel(matched.presentedStatus, true), "Signed off", "matching pack still says Signed off");

  const penny = advisoryPackSignOffGate("approved", true, qaContent, {
    runwayLabel: "8 weeks",
    cash: 100000.4,
    healthScore: 69,
  });
  assert(!penny.figuresChanged, "cash within 1 is not drift");

  const noLive = advisoryPackSignOffGate("approved", true, qaContent, null);
  assert(noLive.signOffHolds && !noLive.signOffBlocked, "missing live figures are not a false drift");

  const rebuilt = {
    health: { overall: 71 },
    forecast: { openingBalance: 100000 },
    sections: [{ key: "forecast", body: "Opening balance. Runway 8 weeks." }],
  };
  const afterRegen = advisoryPackSignOffGate("in_review", true, rebuilt, qaLive);
  assert(!afterRegen.signOffBlocked && !afterRegen.figuresChanged, "regenerate clears the block");
  const resigned = advisoryPackSignOffGate("approved", true, rebuilt, qaLive);
  assert(resigned.signOffHolds, "sign-off can stick once the snapshot matches");

  const onFile = {
    revenue: "1000000",
    cogs: "600000",
    ebit: "150000",
    ebt: "140000",
    netIncome: "100000",
    ebitda: "180000",
    operatingCashflow: "160000",
    totalAssets: "800000",
    equity: "400000",
    receivables: "120000",
    inventory: "80000",
    payables: "60000",
    totalLiabilities: "400000",
    fixedCosts: "200000",
    variableCosts: "400000",
    top5Revenue: "400000",
    laborCost: "250000",
    employees: "10",
    founderHours: "40",
    cash: "80000",
  };
  const live = overviewFiguresForPackDrift({ financials: onFile, fyStartMonth: 1 });
  assert(live.healthScore != null, "overview health scored");
  const bakedFromOverview = {
    health: { overall: live.healthScore },
    forecast: { openingBalance: live.cash },
    sections: [{ key: "forecast", body: `Runway ${live.runwayLabel ?? ""}.` }],
  };
  const fresh = advisoryPackSignOffGate("approved", true, bakedFromOverview, live);
  assert(
    !fresh.figuresChanged && fresh.signOffHolds,
    "a snapshot baked from the same Overview figures is not stale",
  );

  // Slower collections and a heavier creditor book move the rounded health
  // the pack snapshot stores. Cash and runway stay put, so this is the same
  // health drift as pack 69 vs Overview 71.
  const moved = overviewFiguresForPackDrift({
    financials: { ...onFile, receivables: "400000", payables: "200000" },
    fyStartMonth: 1,
  });
  assert(
    moved.healthScore != null && moved.healthScore !== live.healthScore,
    "debtor and creditor days move the Overview health snapshot",
  );
  const drifted = advisoryPackSignOffGate("approved", true, bakedFromOverview, moved);
  assert(
    drifted.figuresChanged && drifted.signOffBlocked && !drifted.signOffHolds,
    "moved Overview figures cannot leave SIGNED OFF in place",
  );
  const regenerated = {
    health: { overall: moved.healthScore },
    forecast: { openingBalance: moved.cash },
    sections: [{ key: "forecast", body: `Runway ${moved.runwayLabel ?? ""}.` }],
  };
  const cleared = advisoryPackSignOffGate("approved", true, regenerated, moved);
  assert(
    cleared.signOffHolds && !cleared.signOffBlocked,
    "regenerating from the new Overview lets sign-off stick",
  );
}

{
  const ratios = {
    "Debtor Days": 25,
    "Creditor Days": 37,
    "Gross Margin": 0.6,
    "Operating Margin": 0.086,
  };
  const problem =
    "Debtor days 43.8 and creditor days 73 (healthy band 30–60), debtor/creditor 43.8 / 73, OM 0.16. Review within 90 days. Customers are paying later each month.";
  const grounded = groundAdvisoryNarrative(problem, ratios);
  assert(!grounded.includes("43.8") && !grounded.includes("0.16"), grounded);
  assert(grounded.includes("25 days") && grounded.includes("37 days"), grounded);
  assert(grounded.includes("25 / 37"), grounded);
  assert(grounded.includes("8.6%"), grounded);
  assert(grounded.includes("30–60") && grounded.includes("90 days"), grounded);
  assert(grounded.includes("Customers are paying later each month"), grounded);
  assert(
    groundAdvisoryNarrative("Debtor days 71 vs 45", { "Debtor Days": 71 }) === "Debtor days 71 vs 45",
    "a citation that already matches the snapshot stays",
  );
  assert(
    groundAdvisoryNarrative("Customers are paying later each month", ratios) ===
      "Customers are paying later each month",
    "narrative without figures stays verbatim",
  );
  assert(formatSnapshotRatio("Operating Margin", 0.086) === "8.6%", "OM formats as a percent");
  assert(formatSnapshotRatio("Debtor Days", 43.8) === "44 days", "days round");
  assert(formatSnapshotRatio("Gross Margin", 0.6) === "60.0%", "GM formats as a percent");
  const pack = buildAdvisoryPack(
    inputs({
      ratios,
      recommendations: [
        rec({
          title: "Collect faster",
          problem,
          rationale: "Debtor days 71 vs 45",
        }),
      ],
    }),
  );
  const bullet = pack.sections.find((s) => s.key === "recommendations")!.bullets![0];
  assert(bullet.includes("25 days") && bullet.includes("37 days") && bullet.includes("8.6%"), bullet);
  assert(!bullet.includes("43.8") && !bullet.includes("0.16"), bullet);
  assert(!bullet.includes("Debtor days 71 vs 45"), "rationale is not the shown problem");
  const propose = readFileSync(resolve("supabase/functions/brain-propose/index.ts"), "utf8");
  assert(propose.includes("formatSnapshotRatio"), "propose quotes formatted snapshot ratios");
}

{
  const us = { country: "US" as const, copyPack: "us" as const };
  // Unlocked periodMonths 12 with a July month-end. Margins use the 7-month
  // span. Debtor and creditor days use the stored cover, so this sparse file
  // scores the same 78 as the annual snapshot.
  const hand = {
    revenue: "50000",
    cogs: "20000",
    ebit: "8000",
    receivables: "6000",
    payables: "4000",
    periodMonths: "12",
    periodEnd: "2026-07-31",
    cash: "12000",
  };
  const storedHealth = computeOverallHealth({
    ratios: computeRatios({ ...overviewRatioInputs(hand, { fyStartMonth: 1 }), periodMonths: "12" }),
  });
  eq(storedHealth.overall, 78, "stored annual snapshot still scores 78");
  const live = livePackMetrics({ financials: hand, fyStartMonth: 1, market: us });
  eq(live.ratios["Debtor Days"], 44, "live debtor days use the stored cover");
  eq(live.ratios["Creditor Days"], 73, "live creditor days use the stored cover");
  eq(live.figures.healthScore, 78, "day inputs on the stored cover recompute to the same 78");
  eq(
    overviewFiguresForPackDrift({ financials: hand, fyStartMonth: 1, market: us }).healthScore,
    live.figures.healthScore,
    "drift check uses the same live health",
  );
  const rebuilt = buildAdvisoryPack(
    inputs({
      health: live.health,
      ratios: live.ratios,
      openingBalance: live.openingBalance,
      closings: live.closings,
      cashRunwayWeeks: live.cashRunwayWeeks,
      runwayLabel: live.runwayLabel,
    }),
  );
  const gate = advisoryPackSignOffGate("in_review", true, rebuilt, live.figures);
  assert(!gate.figuresChanged && !gate.signOffBlocked, "regen from live Overview clears sign-off");
  const staleGate = advisoryPackSignOffGate(
    "approved",
    true,
    {
      health: { overall: 71 },
      forecast: { openingBalance: live.figures.cash },
      sections: [{ key: "forecast", body: `Runway ${live.figures.runwayLabel ?? ""}.` }],
    },
    live.figures,
  );
  assert(staleGate.figuresChanged && staleGate.signOffBlocked, "health 71 vs live Overview blocks sign-off");

  const qa = {
    revenue: "700000",
    cogs: "280000",
    ebit: "60200",
    receivables: "82192",
    payables: "48658",
    periodMonths: "12",
    periodEnd: "2026-07-31",
    cash: "128450",
  };
  const qaLive = livePackMetrics({ financials: qa, fyStartMonth: 1, market: us });
  eq(qaLive.ratios["Debtor Days"], 43, "pack debtor days match the stored cover");
  eq(qaLive.ratios["Creditor Days"], 63, "pack creditor days match the stored cover");
  assert(Math.round(qaLive.ratios["Operating Margin"] * 1000) === 86, "pack OM is 8.6%");
  const qaPack = buildAdvisoryPack(
    inputs({
      health: qaLive.health,
      ratios: qaLive.ratios,
      openingBalance: qaLive.openingBalance,
      closings: qaLive.closings,
      cashRunwayWeeks: qaLive.cashRunwayWeeks,
      runwayLabel: qaLive.runwayLabel,
      recommendations: [
        rec({
          title: "Collect faster",
          problem: "Debtor days 43.8 and creditor days 73, OM 0.16.",
        }),
      ],
    }),
  );
  const qaBullet = qaPack.sections.find((s) => s.key === "recommendations")!.bullets![0];
  assert(qaBullet.includes("43 days") && qaBullet.includes("63 days") && qaBullet.includes("8.6%"), qaBullet);
  assert(!qaBullet.includes("43.8") && !qaBullet.includes("0.16"), qaBullet);
  const qaGate = advisoryPackSignOffGate("in_review", true, qaPack, qaLive.figures);
  assert(!qaGate.figuresChanged && !qaGate.signOffBlocked, "QA US regen matches Overview and can be signed off");
  const storedQa = overviewRatios({ ...qa, periodMonths: "12", periodEnd: undefined }, { fyStartMonth: 1 });
  assert(storedQa["Debtor Days"] !== 25, "dropping the year span is the stale snapshot");

  const yankees = {
    cash: "7430.22",
    revenue: "8633.6",
    cogs: "775.98",
    ebit: "2501.12",
    ebt: "2501.12",
    netIncome: "2501.12",
    ebitda: "2501.12",
    operatingCashflow: "0",
    totalAssets: "21323.01",
    equity: "8266.73",
    payables: "8386.76",
    receivables: "9194.51",
    fixedCosts: "5356.5",
    periodMonths: "1",
  };
  const yankeesLive = livePackMetrics({ financials: yankees, fyStartMonth: 1, market: us });
  eq(yankeesLive.figures.healthScore, 71, "Yankees pack health matches Overview 71");

  const withPrior = livePackMetrics({
    financials: { cash: "10000", netIncome: "5000", revenue: "8000", operatingCashflow: "1000" },
    priorFinancials: { cash: "50000" },
    fyStartMonth: 1,
  });
  const withoutPrior = livePackMetrics({
    financials: { cash: "10000", netIncome: "5000", revenue: "8000", operatingCashflow: "1000" },
    fyStartMonth: 1,
  });
  assert(
    withPrior.figures.runwayLabel !== withoutPrior.figures.runwayLabel,
    "prior cash changes the runway label the banner compares",
  );
}

{
  // Live QA US file. The year span used to annualise debtor/creditor days to
  // 19 / 28. Scorecard, pack, and Ratios now share the stored 12-month cover
  // (25 / 37). Recommendation sentences quote those days and the Overview
  // percent, including the shapes the stored draft actually uses.
  const qaUs = {
    revenue: "700000",
    cogs: "280000",
    ebit: "60000",
    receivables: "48500",
    payables: "28500",
    inventory: "62000",
    cash: "128450",
    periodMonths: "12",
    periodEnd: "2026-09-30",
  };
  const us = { country: "US" as const, copyPack: "us" as const };
  const live = livePackMetrics({ financials: qaUs, fyStartMonth: 1, market: us });
  eq(live.ratios["Debtor Days"], 25, "scorecard debtor days match Ratios");
  eq(live.ratios["Creditor Days"], 37, "scorecard creditor days match Ratios");
  assert(Math.round(live.ratios["Operating Margin"] * 1000) === 86, "live OM is 8.6%");
  const quoted = packNarrativeRatios(qaUs, live.ratios);
  eq(quoted?.["Debtor Days"], 25, "narrative debtor days match Ratios");
  eq(quoted?.["Creditor Days"], 37, "narrative creditor days match Ratios");
  assert(Math.round((quoted?.["Operating Margin"] ?? 0) * 1000) === 86, "narrative OM stays live");

  const debtorTitle =
    "Investigate and action the 43.8-day debtor days position for a retail business";
  const debtorProblem =
    "A debtor days ratio of 43.8 is elevated for retail, where cash or near-cash settlement is typical.";
  const creditorTitle =
    "Review creditor days of 73 against supplier terms to confirm sustainability and avoid supply risk";
  const creditorProblem =
    "At 73 creditor days the business is stretching payables significantly. With a 0.16 operating margin there is limited buffer if key suppliers tighten terms.";
  const debtorGrounded = `${groundAdvisoryNarrative(debtorTitle, quoted)} ${groundAdvisoryNarrative(debtorProblem, quoted)}`;
  const creditorGrounded = `${groundAdvisoryNarrative(creditorTitle, quoted)} ${groundAdvisoryNarrative(creditorProblem, quoted)}`;
  assert(!debtorGrounded.includes("43.8"), debtorGrounded);
  assert(debtorGrounded.includes("25-day") && debtorGrounded.includes("25 days"), debtorGrounded);
  assert(!creditorGrounded.includes("73") && !creditorGrounded.includes("0.16"), creditorGrounded);
  assert(creditorGrounded.includes("37 days") && creditorGrounded.includes("37 creditor"), creditorGrounded);
  assert(creditorGrounded.includes("8.6%"), creditorGrounded);
  assert(
    groundAdvisoryNarrative("Review creditor days of 28 days against supplier terms", quoted) ===
      "Review creditor days of 37 days against supplier terms",
    "a health-span 28 already written into the title is rewritten to Ratios",
  );
  assert(
    groundAdvisoryNarrative("−12 debtor days in 60 days", quoted) === "−12 debtor days in 60 days",
    "an impact delta is not the current debtor days",
  );
  assert(
    groundAdvisoryNarrative("Review within 90 days. Healthy band 30–60.", quoted) ===
      "Review within 90 days. Healthy band 30–60.",
    "horizons and bands stay",
  );

  const qaPack = buildAdvisoryPack(
    inputs({
      health: live.health,
      ratios: live.ratios,
      narrativeRatios: quoted,
      openingBalance: live.openingBalance,
      closings: live.closings,
      cashRunwayWeeks: live.cashRunwayWeeks,
      runwayLabel: live.runwayLabel,
      recommendations: [
        rec({ title: debtorTitle, problem: debtorProblem, rationale: "Debtor days 71 vs 45" }),
        rec({ title: creditorTitle, problem: creditorProblem }),
      ],
    }),
  );
  const bullets = qaPack.sections.find((s) => s.key === "recommendations")!.bullets!.join("\n");
  assert(!bullets.includes("43.8") && !bullets.includes("0.16") && !/\b73\b/.test(bullets), bullets);
  assert(bullets.includes("25") && bullets.includes("37") && bullets.includes("8.6%"), bullets);
  assert(!bullets.includes("Debtor days 71 vs 45"), "rationale is not the shown problem");
  const gate = advisoryPackSignOffGate("in_review", true, qaPack, live.figures);
  assert(!gate.figuresChanged && !gate.signOffBlocked, "narrative rewrite does not stale the health snapshot");
  const signed = advisoryPackSignOffGate("approved", true, qaPack, live.figures);
  assert(signed.signOffHolds && !signed.figuresChanged, "sign-off still holds when health matches");
  const packSrc = readFileSync(resolve("src/lib/advisory-pack.ts"), "utf8");
  assert(
    packSrc.includes("overviewRatios") && !packSrc.includes("healthFromRatioInputs"),
    "pack health is scored from the same ratio map as Overview",
  );
  const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
  assert(studio.includes("overviewRatios(financials"), "the Overview orb uses the canonical days");
  assert(
    studio.includes("scorecardRatiosFromFinancials") && studio.includes("market: clientMarket"),
    "Overview Export renders the shared scorecard in the client market",
  );
  assert(
    studio.includes("financials={financials}") && studio.includes("liveScorecard={renderOverviewScorecard}"),
    "Overview cards and history use the live figures, not a stored artifact",
  );
  const reports = readFileSync(resolve("src/routes/_authenticated/reports.index.tsx"), "utf8");
  assert(
    reports.includes("scorecardRatiosFromFinancials"),
    "the reports scorecard uses the same day cover as Overview Export",
  );
  const requestPanel = readFileSync(resolve("src/components/data-requests-panel.tsx"), "utf8");
  assert(
    requestPanel.includes("overviewRequestCardRows"),
    "Overview request cards recompute day quotes at render time",
  );
  const history = readFileSync(resolve("src/components/advisory-sent-history.tsx"), "utf8");
  assert(
    history.includes("scorecardDownloadShouldRenderLive"),
    "a stored scorecard download renders live",
  );
}

{
  // One fixture: scorecard ratios, request-card days, pack narrative, and Ratios.
  const parity = {
    revenue: "700000",
    cogs: "280000",
    ebit: "60000",
    receivables: "48500",
    payables: "28500",
    inventory: "62000",
    cash: "128450",
    periodMonths: "12",
    periodEnd: "2026-09-30",
  };
  const tiles = ratiosStatementFigures(parity);
  const scorecard = overviewRatios(parity, { fyStartMonth: 1 });
  const narrative = packNarrativeRatios(parity, scorecard);
  const cards = dataRequestDayRatios(parity);
  eq(tiles.debtorDays, 25, "Ratios DSO is 25");
  eq(tiles.creditorDays, 37, "Ratios DPO is 37");
  eq(scorecard["Debtor Days"], tiles.debtorDays, "scorecard DSO matches Ratios");
  eq(scorecard["Creditor Days"], tiles.creditorDays, "scorecard DPO matches Ratios");
  eq(narrative?.["Debtor Days"], tiles.debtorDays, "pack narrative DSO matches Ratios");
  eq(narrative?.["Creditor Days"], tiles.creditorDays, "pack narrative DPO matches Ratios");
  eq(cards?.["Debtor Days"], tiles.debtorDays, "request cards DSO matches Ratios");
  eq(cards?.["Creditor Days"], tiles.creditorDays, "request cards DPO matches Ratios");
  const staleCards = presentLiveDataRequests(
    [
      {
        source: "system",
        status: "open",
        rule_key: "debtor_days_no_ageing",
        reason: "Debtor days are 44 against a 45-day benchmark.",
      },
      {
        source: "system",
        status: "open",
        rule_key: "creditor_days_no_ageing",
        reason: "Creditor days are 73, above the 60-day mark.",
      },
    ],
    cards,
  );
  assert(
    !staleCards.some((row) => /44|73/.test(row.reason)),
    "stored 44 / 73 cards are not rendered once live days are inside the band",
  );
  const gaps = detectDataGaps({
    state: "recommendations",
    figuresAsOf: "2026-09-30",
    ratios: cards,
    hasForecast: true,
    forecastOpeningBalance: "128450",
    hasAgedDebtors: false,
    hasAgedCreditors: false,
    now: "2026-10-07T12:00:00.000Z",
  });
  assert(
    !gaps.some((gap) => /44|73|19|28/.test(gap.reason)),
    "the detector does not ask from the stale or health-span days",
  );
  const above = dataRequestDayRatios({
    revenue: "365000",
    cogs: "365000",
    receivables: "60000",
    payables: "90000",
    periodMonths: "12",
    periodEnd: "2026-09-30",
  });
  const shown = presentLiveDataRequests(
    [
      {
        source: "system",
        status: "open",
        rule_key: "debtor_days_no_ageing",
        reason: "Debtor days are 44 against a 40-day benchmark.",
      },
      {
        source: "system",
        status: "open",
        rule_key: "creditor_days_no_ageing",
        reason: "Creditor days are 73, above the 60-day mark.",
      },
    ],
    above,
  );
  assert(shown.length === 2, "cards stay when the live days are still outside the band");
  assert(
    shown[0].reason.includes(`Debtor days are ${above?.["Debtor Days"]}`),
    shown[0].reason,
  );
  assert(
    shown[1].reason.includes(`Creditor days are ${above?.["Creditor Days"]}`),
    shown[1].reason,
  );
  const tripled = overviewRequestCardRows(
    [
      {
        source: "system",
        status: "open",
        rule_key: "debtor_days_no_ageing",
        reason:
          "Debtor days are 55. Debtor days are 55. Debtor days are 55 against a 40-day benchmark.",
      },
      {
        source: "system",
        status: "open",
        rule_key: "creditor_days_no_ageing",
        reason: "Creditor days are 81. Creditor days are 81. Creditor days are 81, above the 60-day mark.",
      },
    ],
    {
      revenue: "365000",
      cogs: "365000",
      receivables: "55000",
      payables: "81000",
      periodMonths: "12",
      periodEnd: "2026-09-30",
    },
  );
  const liveDays = dataRequestDayRatios({
    revenue: "365000",
    cogs: "365000",
    receivables: "55000",
    payables: "81000",
    periodMonths: "12",
    periodEnd: "2026-09-30",
  });
  assert(tripled.length === 2, "stored text that already quotes the figure still shows one card each");
  eq(tripled[0].reason, debtorDaysReason(liveDays?.["Debtor Days"] ?? 0), tripled[0].reason ?? "");
  eq(tripled[1].reason, creditorDaysReason(liveDays?.["Creditor Days"] ?? 0), tripled[1].reason ?? "");
  assert(
    (tripled[0].reason?.match(/Debtor days are/g) ?? []).length === 1,
    "debtor sentence is not repeated",
  );
  assert(
    (tripled[1].reason?.match(/Creditor days are/g) ?? []).length === 1,
    "creditor sentence is not repeated",
  );
  const again = presentLiveDataRequests(tripled, liveDays);
  eq(again[0].reason, tripled[0].reason, "a second rewrite does not append the debtor sentence");
  eq(again[1].reason, tripled[1].reason, "a second rewrite does not append the creditor sentence");
  const storedOverviewCards = overviewRequestCardRows(
    [
      {
        source: "accountant",
        status: "open",
        rule_key: null,
        kind: "aged_debtors",
        reason: "Debtor days are 44 against a 40-day benchmark.",
      },
      {
        source: "system",
        status: "open",
        rule_key: null,
        kind: "aged_creditors",
        reason: "Creditor days are 73, above the 60-day mark.",
      },
    ],
    parity,
  );
  assert(
    storedOverviewCards.length === 0,
    "Overview request cards hide stored 44 / 73 once live days are inside the band",
  );
  const exportRows = buildScorecardRatioResults(
    scorecardRatiosFromFinancials(parity, { fyStartMonth: 1 }),
    { ...ZA_MARKET, locale: "en-US", timezone: "America/New_York" },
  );
  eq(
    exportRows.find((row) => row.ratio_name === "Debtor Days")?.formatted_value,
    "25d",
    "Overview export DSO is 25d",
  );
  eq(
    exportRows.find((row) => row.ratio_name === "Creditor Days")?.formatted_value,
    "37d",
    "Overview export DPO is 37d",
  );
  assert(
    scorecardDownloadShouldRenderLive({ kind: "report_pdf", report_key: "scorecard" }),
    "an archived scorecard is rebuilt",
  );
  assert(
    !scorecardDownloadShouldRenderLive({ kind: "report_pdf", report_key: "forecast" }),
    "other archived PDFs stay archived",
  );
  eq(above?.["Debtor Days"], overviewRatios({
    revenue: "365000",
    cogs: "365000",
    receivables: "60000",
    payables: "90000",
    periodMonths: "12",
    periodEnd: "2026-09-30",
  }, { fyStartMonth: 1 })["Debtor Days"], "card DSO matches the scorecard on the high-days file");
}

{
  const packAt = "2026-10-07T18:00:00.000Z";
  assert(
    brainDraftSupersededByPack(
      { status: "proposed", created_at: "2026-10-01T12:00:00.000Z" },
      packAt,
    ),
    "a pending draft from before the pack is superseded",
  );
  assert(
    !brainDraftSupersededByPack(
      { status: "approved", created_at: "2026-10-01T12:00:00.000Z" },
      packAt,
    ),
    "an approved draft is left in place",
  );
  assert(
    !brainDraftSupersededByPack(
      { status: "proposed", created_at: "2026-10-07T18:05:00.000Z" },
      packAt,
    ),
    "a draft created after the pack stays pending",
  );
  const fns = readFileSync(resolve("src/lib/advisory-pack.functions.ts"), "utf8");
  assert(
    fns.includes("supersedeBrainDraftsBeforePack") && fns.includes("brainDraftSupersededByPack"),
    "regenerate supersedes pending brain drafts from before the new pack",
  );
  const panel = readFileSync(resolve("src/components/recommendations-panel.tsx"), "utf8");
  assert(panel.includes("Propose from brain"), "Propose from brain stays the accountant primary");
  assert(
    (panel.match(/from-\[#f3d98a\]/g) ?? []).length >= 1,
    "the gold propose control is unchanged",
  );
}

{
  const signed = formatSignedOffDateTime("2026-10-07T18:34:00.000Z", ZA_MARKET, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  assert(signed.includes("20:34"), `Johannesburg sign-off is 20:34, got ${signed}`);
  assert(signed.includes("SAST") || signed.includes("UTC+2"), `zone label missing: ${signed}`);
  const firmWins = formatSignedOffDateTime(
    "2026-10-07T18:22:00.000Z",
    { locale: "en-US", timezone: "America/New_York" },
    {
      firmTimeZone: "Africa/Johannesburg",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  );
  assert(firmWins.includes("20:22") || firmWins.includes("8:22"), `firm zone wins, got ${firmWins}`);
  assert(/SAST|UTC\+2/.test(firmWins), `firm zone is labelled, got ${firmWins}`);
  const unlabeled = formatSignedOffDateTime("2026-10-07T18:22:00.000Z", {
    locale: "en-ZA",
    timezone: "Etc/GMT-2",
  });
  assert(/\b(?:UTC(?:[+-]\d{1,2}(?::\d{2})?)?|[A-Z]{2,5})\b/.test(unlabeled), unlabeled);
  assert(!/\bGMT\b/.test(unlabeled), `offset names use UTC, got ${unlabeled}`);
  const footer = readFileSync(resolve("src/components/pdf/report-footer.tsx"), "utf8");
  assert(footer.includes("formatReviewDateTime"), "every PDF footer uses the shared sign-off formatter");
  assert(!footer.includes("formatDateTime("), "the footer does not format an unlabeled clock");
  assert(!footer.includes('hour: "2-digit"'), "the footer clock does not pad the hour");
  assert(!footer.includes("profile.timeZone"), "PDF zone follows the client market, not the viewer profile");
  assert(footer.includes("Prepared"), "an unsigned footer still carries a zoned prepared time");
  const saClock = formatSignedOffDateTime("2026-10-06T16:29:00.000Z", ZA_MARKET, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  assert(saClock.includes("18:29"), `SA client is 18:29, got ${saClock}`);
  assert(saClock.includes("SAST") || saClock.includes("UTC+2"), `SA client zone is SAST, got ${saClock}`);
  assert(!saClock.includes("UTC-4"), `SA client is not a US offset, got ${saClock}`);
  const yankees = {
    revenue: "120000",
    cogs: "48000",
    ebit: "22000",
    ebt: "18000",
    netIncome: "14000",
    ebitda: "26000",
    totalAssets: "200000",
    equity: "77500",
    totalLiabilities: "122500",
    receivables: "9194.51",
    payables: "8386.76",
    inventory: "4000",
    periodMonths: "1",
    periodMonthsChosen: "1",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-21",
  };
  const usMarket = { country: "US" as const, copyPack: "us" as const };
  const sharedHealth = scorecardHealthFromFinancials({
    financials: yankees,
    fyStartMonth: 1,
    cashRunwayWeeks: 6,
    market: usMarket,
    shortfallWeek: null,
  });
  const overviewHealth = computeOverallHealth({
    ratios: overviewRatios(yankees, { fyStartMonth: 1 }),
    cashRunwayWeeks: 6,
    market: usMarket,
    shortfallWeek: null,
  });
  eq(sharedHealth.overall, overviewHealth.overall, "scorecard overall matches Ratios");
  for (const id of ["profit", "assets", "financing", "cash"] as const) {
    eq(
      sharedHealth.pillars.find((pillar) => pillar.id === id)?.score,
      overviewHealth.pillars.find((pillar) => pillar.id === id)?.score,
      `scorecard ${id} pillar matches Ratios`,
    );
  }
  assert(sharedHealth.overall != null, "Yankees-shaped fixture scores an overall");
  const pdfSrc = readFileSync(resolve("src/reports/health-scorecard.tsx"), "utf8");
  const overviewExport = readFileSync(
    resolve("src/routes/_authenticated/clients.$clientId.tsx"),
    "utf8",
  );
  assert(pdfSrc.includes("overallHealth ??"), "the PDF renders the shared health when it is passed");
  assert(
    overviewExport.includes("scorecardHealthFromFinancials"),
    "Overview scores with the shared helper",
  );
  assert(overviewExport.includes("overallHealth,"), "Overview export passes that health into the PDF");
  const inApp = formatSignedOffDateTime("2026-10-08T01:15:46.000Z", {
    locale: "en-US",
    timezone: "America/New_York",
  }, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  assert(/9:15:46/.test(inApp), `in-app sign-off keeps the clock, got ${inApp}`);
  assert(/EDT|UTC-4/.test(inApp), `in-app sign-off names the zone, got ${inApp}`);
  const packPanel = readFileSync(resolve("src/components/advisory-pack-panel.tsx"), "utf8");
  assert(packPanel.includes("formatReviewDateTime"), "the pack sign-off line uses the shared formatter");
  assert(!packPanel.includes("toLocaleString"), "the pack sign-off line is not an unlabeled local clock");
  assert(
    readFileSync(resolve("src/lib/market/format.ts"), "utf8").includes('timeZoneName: "short"'),
    "the sign-off formatter asks for a short zone name",
  );
}

{
  const line = packDisplayedSignoffLine({
    signedOff: true,
    figuresChanged: true,
    reviewedByKind: "accountant",
    reviewedAt: "2026-10-07T23:01:31.000Z",
    name: "James Fleming",
    firmName: "Ben Accountants",
    market: resolveMarket({ country: "US", regionCode: "NY" }),
  });
  eq(
    line,
    "Signed off by James Fleming · Ben Accountants · Oct 7, 2026, 7:01 PM EDT — figures have changed since; regenerate and re-review",
    line ?? "missing stale sign-off line",
  );
  const held = packDisplayedSignoffLine({
    signedOff: true,
    figuresChanged: false,
    reviewedByKind: "accountant",
    reviewedAt: "2026-10-07T23:01:31.000Z",
    name: "James Fleming",
    firmName: "Ben Accountants",
    market: resolveMarket({ country: "US", regionCode: "NY" }),
  });
  assert(held != null && !held.includes("figures have changed"), held ?? "");
}

{
  // Published QA US statement (revenue 700k, opex 351k, inventory 62k) plus a
  // bank forecast whose weekly payments are four-week floor $64.7k. Receipts
  // match, so the opening balance stays the low. Health is whatever the
  // scorecard scores from this file — the same number the pack stores.
  const qaUs = {
    revenue: "700000",
    cogs: "280000",
    fixedCosts: "351000",
    ebit: "60000",
    ebitda: "69000",
    ebt: "60000",
    netIncome: "60000",
    receivables: "48500",
    payables: "28500",
    inventory: "62000",
    cash: "128450",
    totalAssets: "230263",
    equity: "112323",
    periodMonths: "12",
    periodEnd: "2026-09-30",
  };
  const cashflow = {
    openingBalance: "128450",
    seededFromBanksAt: "2026-10-01T00:00:00.000Z",
    forecastLinesSource: "qbo-bank-activity",
    startDate: "2026-10-12",
    revenue: [{ id: "in", name: "Collections", amount: "16175", frequency: "recurring-weekly", startWeek: 1 }],
    expenses: [{ id: "out", name: "Payments", amount: "16175", frequency: "recurring-weekly", startWeek: 1 }],
  };
  const us = resolveMarket({ country: "US", regionCode: "NY" });
  const live = livePackMetrics({
    financials: qaUs,
    cashflow,
    fyStartMonth: 1,
    market: us,
    now: new Date("2026-10-08T12:00:00.000Z"),
  });
  eq(live.floor, 64700, `forecast floor ${live.floor}`);
  eq(live.openingBalance, 128450, "opening cash is the statement balance");
  const low = Math.min(live.openingBalance ?? Infinity, ...(live.closings ?? []));
  eq(low, 128450, `lowest point includes the opening, got ${low}`);
  eq(Math.round(live.ratios["Inventory Days"]), 81, `inventory days ${live.ratios["Inventory Days"]}`);
  const scorecard = scorecardHealthFromFinancials({
    financials: qaUs,
    fyStartMonth: 1,
    periodMonths: 12,
    cashRunwayWeeks: live.cashRunwayWeeks,
    market: us,
  });
  eq(live.health.overall, scorecard.overall, "regenerated pack health is the scorecard");
  const strongest = [...scorecard.pillars].filter((p) => p.score != null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  const weakest = scorecard.weakestPillar;
  const pack = buildAdvisoryPack(
    inputs({
      clientName: "QA US",
      currency: "USD",
      health: live.health,
      ratios: live.ratios,
      openingBalance: live.openingBalance,
      closings: live.closings,
      floor: live.floor,
      cashRunwayWeeks: live.cashRunwayWeeks,
      runwayLabel: live.runwayLabel,
      recommendations: [],
      dataRequests: [],
      openActions: 0,
      overdueActions: 0,
    }),
  );
  const state = pack.sections.find((s) => s.key === "state_of_business")!.body;
  const forecast = pack.sections.find((s) => s.key === "forecast")!.body;
  const floorText = formatMoneyCompact(live.floor, { currency: "USD", locale: "en-US" });
  eq(floorText, "$64.7k", floorText);
  const status = forecastStatusSentence({
    opening: live.openingBalance ?? 0,
    closings: live.closings ?? [],
    floor: live.floor,
    floorText,
    runwayLabel: live.runwayLabel,
  });
  const story = forecastRunwayHeadlineShared({
    opening: live.openingBalance ?? 0,
    closings: live.closings ?? [],
    floor: live.floor,
    runwayLabel: live.runwayLabel,
  });
  assert(state.includes(status), state);
  assert(forecast.includes(status), forecast);
  assert(forecast.includes(story.headline), forecast);
  assert(
    !forecast.includes("Profitable on the P&L"),
    `pack runway follows the cash strip (${story.headline}): ${forecast}`,
  );
  assert(forecast.includes("$128,450"), forecast);
  assert(forecast.includes("$128k"), forecast);
  assert(forecast.includes("the opening balance"), forecast);
  assert(!forecast.includes("R") && !state.includes("R"), forecast);
  assert(!state.includes("comfort line") && !forecast.includes("comfort line"), state);
  assert(state.includes(String(scorecard.overall)), state);
  assert(state.includes(strongest?.label ?? ""), state);
  assert(state.includes(weakest?.label ?? ""), state);
  for (const label of Object.values(PILLAR_LABELS)) {
    assert(
      pack.health?.pillars.some((pillar) => pillar.label === label),
      `pack pillar ${label}`,
    );
  }
  assert(!state.includes("Profitability") && !state.includes("Financing"), state);
  eq(pack.health?.overall, scorecard.overall, "stored pack health");
  eq(pack.health?.weakest, weakest?.label ?? null, "weakest pillar matches the scorecard");
  const inventory = pack.ratios.find((row) => row.name === "Inventory Days");
  eq(inventory ? Math.round(inventory.value) : null, 81, "regenerated pack stores inventory days 81");
}

assert(
  alignPackFloorCopy("Cash dips in week 4 (floor $50.0k). Action needed.", 64700, "USD") ===
    "Cash dips in week 4 (floor $64.7k). Action needed.",
  "a stored $50.0k floor becomes the live cash floor",
);
assert(
  alignPackFloorCopy("Well under the $50,000 comfort line.", 64700, "USD") ===
    "Well under the $64,700 comfort line.",
  "a stored $50,000 comfort line becomes the live cash floor",
);
assert(
  alignPackFloorCopy("Revenue was $50,000 this month.", 64700, "USD") ===
    "Revenue was $50,000 this month.",
  "an unrelated $50,000 is left alone",
);

console.log("advisory-pack: all checks passed");
