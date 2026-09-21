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
  buildAdvisoryPack,
  computeEditStats,
  diffPackSections,
  fmtRatio,
  isMissingPackRelation,
  packStatusLabel,
  parsePackContent,
  parsePackRow,
  type PackInputs,
} from "../src/lib/advisory-pack";
import { ADVISORY_EVENTS } from "../src/lib/advisory-state";
import { computeOverallHealth } from "../src/lib/health-score";
import { checkRootCauseClaims, type Recommendation } from "../src/lib/recommendations";
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
    fc.includes("R125 000") && fc.includes("−R12 000") && fc.includes("week 6"),
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
      .body.includes("stays above the R50 000 comfort line"),
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
  eq(
    list(/action\s+text NOT NULL CHECK \(action IN \(([\s\S]*?)\)\)/, "action").join(","),
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
  const rpcList = Array.from(rpcActions.matchAll(/'([a-z_]+)'/g), (x) => x[1]).sort();
  eq(
    rpcList.join(","),
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
}

console.log("advisory-pack: all checks passed");
