/**
 * Active data requests (P0.6) — detector rules, suppression, email copy,
 * SQL/TS drift, and the shell wiring that makes a gap a tracked ask instead of
 * a silently weaker forecast.
 * Run: pnpm test:data-requests
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADVISORY_EVENTS, ADVISORY_STATES } from "../src/lib/advisory-state";
import {
  CREDITOR_DAYS_AGEING_THRESHOLD,
  DATA_REQUEST_KINDS,
  DATA_REQUEST_KIND_LABELS,
  DATA_REQUEST_SEVERITIES,
  DATA_REQUEST_SOURCES,
  DATA_REQUEST_STATUSES,
  DEBTOR_DAYS_AGEING_THRESHOLD,
  STALE_FIGURES_DAYS,
  dataRequestEmail,
  daysOld,
  detectDataGaps,
  isMissingDataRequestRelation,
  parseDataRequestRow,
  severityLabel,
  sortDataRequests,
  suppressRecentlyResolved,
  type DataGapFacts,
} from "../src/lib/data-requests";
import { resolveNextStep, type NextStepFacts } from "../src/lib/next-step";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = "2026-09-18T12:00:00.000Z";

function gap(over: Partial<DataGapFacts> = {}): DataGapFacts {
  return {
    state: "diagnosis",
    figuresAsOf: "2026-09-01",
    ratios: { "Debtor Days": 30, "Creditor Days": 40 },
    hasForecast: true,
    forecastOpeningBalance: "125000",
    hasAgedDebtors: false,
    hasAgedCreditors: false,
    now: NOW,
    ...over,
  };
}

// ── 1. Detector rules ────────────────────────────────────────────────────────

{
  eq(detectDataGaps(gap()).length, 0, "healthy client → no requests");

  for (const state of ["onboarding", "context_collection", "financial_data_collection"] as const) {
    eq(
      detectDataGaps(gap({ state, figuresAsOf: null, forecastOpeningBalance: null })).length,
      0,
      `pre-data state ${state} never opens requests (upload is already the Next Step)`,
    );
  }

  const stale = detectDataGaps(gap({ figuresAsOf: "2026-05-01" }));
  eq(stale.length, 1, "stale figures → one request");
  eq(stale[0].rule_key, "stale_figures", "stale rule key");
  eq(stale[0].kind, "management_accounts", "stale asks for latest figures");
  eq(stale[0].severity, "critical", "stale is blocking");
  assert(/140 days old/.test(stale[0].reason), `stale reason names the age: ${stale[0].reason}`);

  const boundary = daysOld("2026-09-01", NOW)!;
  assert(boundary <= STALE_FIGURES_DAYS, "fixture figures are fresh");
  const exactly = new Date(Date.parse(NOW) - STALE_FIGURES_DAYS * 86_400_000).toISOString();
  eq(detectDataGaps(gap({ figuresAsOf: exactly })).length, 0, "exactly at threshold is not stale");
  const justOver = new Date(Date.parse(NOW) - (STALE_FIGURES_DAYS + 1) * 86_400_000).toISOString();
  eq(
    detectDataGaps(gap({ figuresAsOf: justOver }))[0]?.rule_key,
    "stale_figures",
    "one day over is stale",
  );

  const noFigures = detectDataGaps(gap({ figuresAsOf: null }));
  eq(noFigures[0]?.rule_key, "stale_figures", "no dated figures past data collection → ask");
  assert(/no dated figures/.test(noFigures[0].reason), "no-figures copy");

  for (const v of [null, "", "0", 0, " 0 ", "0,00"] as const) {
    const r = detectDataGaps(gap({ state: "forecasting", forecastOpeningBalance: v }));
    eq(
      r[0]?.rule_key,
      "forecast_opening_balance",
      `blank opening balance ${JSON.stringify(v)} → bank balance ask`,
    );
    eq(r[0]?.kind, "bank_balance", "kind bank_balance");
    eq(r[0]?.severity, "critical", "forecast without opening balance is blocking");
  }
  eq(
    detectDataGaps(gap({ state: "forecasting", hasForecast: false, forecastOpeningBalance: null }))
      .length,
    0,
    "no forecast yet → nothing to ask (publishing it is the Next Step)",
  );
  eq(
    detectDataGaps(gap({ state: "diagnosis", forecastOpeningBalance: null })).length,
    0,
    "opening balance only matters once the forecast is live",
  );
  eq(
    detectDataGaps(gap({ state: "outcome_monitoring", forecastOpeningBalance: "" }))[0]?.rule_key,
    "forecast_opening_balance",
    "still asked while monitoring",
  );

  const debt = detectDataGaps(gap({ ratios: { "Debtor Days": 71 } }));
  eq(debt.length, 1, "high debtor days → one ask");
  eq(debt[0].kind, "aged_debtors", "asks for the ageing");
  eq(debt[0].severity, "important", "ageing is important, not blocking");
  assert(
    debt[0].reason.includes("71") && debt[0].reason.includes(String(DEBTOR_DAYS_AGEING_THRESHOLD)),
    "debtor reason cites the number and benchmark",
  );
  assert(!/invoice|customer who/i.test(debt[0].reason), "debtor copy stays statement-level");
  eq(
    detectDataGaps(gap({ ratios: { "Debtor Days": 71 }, hasAgedDebtors: true })).length,
    0,
    "ageing on file → no ask",
  );
  eq(
    detectDataGaps(gap({ ratios: { "Debtor Days": DEBTOR_DAYS_AGEING_THRESHOLD } })).length,
    0,
    "at benchmark → no ask",
  );

  const cred = detectDataGaps(
    gap({ ratios: { "Creditor Days": CREDITOR_DAYS_AGEING_THRESHOLD + 12 } }),
  );
  eq(cred[0]?.kind, "aged_creditors", "high creditor days → creditors ageing");
  eq(
    detectDataGaps(gap({ ratios: { "Creditor Days": 72 }, hasAgedCreditors: true })).length,
    0,
    "creditor ageing on file → no ask",
  );

  eq(detectDataGaps(gap({ ratios: null })).length, 0, "no ratios → no ageing asks (never invent)");
  eq(detectDataGaps(gap({ ratios: { "Debtor Days": Number.NaN } })).length, 0, "NaN ratio ignored");

  const all = detectDataGaps(
    gap({
      state: "action_execution",
      figuresAsOf: "2026-01-01",
      forecastOpeningBalance: "",
      ratios: { "Debtor Days": 90, "Creditor Days": 95 },
    }),
  );
  eq(
    all.map((d) => d.rule_key).join(","),
    "stale_figures,forecast_opening_balance,debtor_days_no_ageing,creditor_days_no_ageing",
    "all four rules, stable order",
  );
  eq(new Set(all.map((d) => d.rule_key)).size, all.length, "rule keys unique");
  for (const d of all) {
    assert((DATA_REQUEST_KINDS as readonly string[]).includes(d.kind), `kind ${d.kind} valid`);
    assert(
      (DATA_REQUEST_SEVERITIES as readonly string[]).includes(d.severity),
      `severity ${d.severity} valid`,
    );
    assert(d.title.length > 0 && d.reason.length > 20, `draft ${d.rule_key} has copy`);
  }
}

// ── 2. Suppression: hand-resolved rules are not re-asked; auto-closed ones are ─

{
  const drafts = detectDataGaps(gap({ ratios: { "Debtor Days": 71 }, figuresAsOf: "2026-01-01" }));
  eq(drafts.length, 2, "two drafts");
  const base = {
    rule_key: "debtor_days_no_ageing",
    status: "waived" as const,
    updated_at: NOW,
    fulfilled_with: null,
  };

  eq(
    suppressRecentlyResolved(drafts, [{ ...base, fulfilled_at: "2026-09-10T00:00:00Z" }], NOW)
      .map((d) => d.rule_key)
      .join(","),
    "stale_figures",
    "waived 8 days ago → debtor ask suppressed",
  );
  eq(
    suppressRecentlyResolved(
      drafts,
      [
        {
          ...base,
          status: "fulfilled",
          fulfilled_at: "2026-09-10T00:00:00Z",
          fulfilled_with: { manual: true },
        },
      ],
      NOW,
    ).length,
    1,
    "manually fulfilled → suppressed",
  );
  eq(
    suppressRecentlyResolved(
      drafts,
      [
        {
          ...base,
          status: "fulfilled",
          fulfilled_at: "2026-09-10T00:00:00Z",
          fulfilled_with: { auto: true },
        },
      ],
      NOW,
    ).length,
    2,
    "auto-fulfilled does not suppress (rule firing again is a new ask)",
  );
  eq(
    suppressRecentlyResolved(drafts, [{ ...base, fulfilled_at: "2026-05-01T00:00:00Z" }], NOW)
      .length,
    2,
    "waived 140 days ago → asked again",
  );
  eq(
    suppressRecentlyResolved(
      drafts,
      [{ ...base, status: "open" as never, fulfilled_at: null }],
      NOW,
    ).length,
    2,
    "open rows never suppress (the RPC upserts onto them)",
  );
  eq(
    suppressRecentlyResolved(
      drafts,
      [{ ...base, fulfilled_at: null, updated_at: "2026-09-15T00:00:00Z" }],
      NOW,
    ).length,
    1,
    "falls back to updated_at when fulfilled_at missing",
  );
}

// ── 3. Sorting, labels, parsing ───────────────────────────────────────────────

{
  const rows = sortDataRequests([
    { severity: "nice_to_have" as const, requested_at: "2026-01-01" },
    { severity: "critical" as const, requested_at: "2026-03-01" },
    { severity: "important" as const, requested_at: "2026-02-01" },
    { severity: "critical" as const, requested_at: "2026-01-01" },
  ]);
  eq(
    rows.map((r) => `${r.severity}@${r.requested_at.slice(5, 7)}`).join(" "),
    "critical@01 critical@03 important@02 nice_to_have@01",
    "critical first, then oldest",
  );

  for (const s of DATA_REQUEST_SEVERITIES)
    assert(severityLabel(s).length > 0, `severity label ${s}`);
  for (const k of DATA_REQUEST_KINDS) {
    assert(DATA_REQUEST_KIND_LABELS[k].label.length > 0, `kind label ${k}`);
    assert(
      DATA_REQUEST_KIND_LABELS[k].whatToSend.length > 10,
      `kind ${k} tells the owner what to send`,
    );
  }

  const parsed = parseDataRequestRow({
    id: "a",
    client_id: "c",
    kind: "nonsense",
    severity: "loud",
    status: "weird",
    source: "?",
    title: "x",
    created_at: "2026-09-01T00:00:00Z",
    fulfilled_with: { auto: true },
    meta: null,
  });
  eq(parsed.kind, "other", "unknown kind → other");
  eq(parsed.severity, "important", "unknown severity → important");
  eq(parsed.status, "open", "unknown status → open");
  eq(parsed.source, "system", "unknown source → system");
  eq(parsed.requested_at, "2026-09-01T00:00:00Z", "requested_at falls back to created_at");
  eq(JSON.stringify(parsed.meta), "{}", "null meta → {}");

  assert(
    isMissingDataRequestRelation({ message: 'relation "public.data_requests" does not exist' }),
    "missing table detected",
  );
  assert(
    isMissingDataRequestRelation({
      message: "Could not find the function public.data_requests_sync in the schema cache",
    }),
    "missing RPC detected",
  );
  assert(
    !isMissingDataRequestRelation({ message: "permission denied for table data_requests" }),
    "permission error is not 'missing'",
  );
  assert(
    !isMissingDataRequestRelation({ message: 'relation "public.clients" does not exist' }),
    "other missing relation not claimed",
  );
}

// ── 4. Email copy ─────────────────────────────────────────────────────────────

{
  const one = dataRequestEmail({
    clientName: "New Co",
    recipientName: "Thabo",
    requesterName: null,
    requests: [
      {
        kind: "bank_balance",
        title: "Current bank balance",
        reason: "Forecast starts from zero.",
        severity: "critical",
      },
    ],
    href: "https://milon.co.za/app?tab=today",
  });
  eq(one.subject, "New Co: MILŌN needs your current bank balance", "single-item subject");
  assert(one.text.startsWith("Hi Thabo,"), "greets by name");
  assert(one.text.includes("(blocking)"), "marks blocking in text");
  assert(
    one.text.includes("pauses on recommendations rather than guess"),
    "blocking consequence stated",
  );
  assert(one.text.includes("https://milon.co.za/app?tab=today"), "link in text");
  assert(one.html.includes('href="https://milon.co.za/app?tab=today"'), "link in html");
  assert(one.html.includes("BLOCKING"), "blocking badge in html");
  assert(!one.text.includes("has asked for"), "no requester line when MILŌN asks itself");

  const many = dataRequestEmail({
    clientName: "New Co",
    recipientName: null,
    requesterName: "Sipho <b>",
    requests: [
      { kind: "aged_debtors", title: "Aged debtors report", reason: null, severity: "important" },
      {
        kind: "management_accounts",
        title: "Latest month's figures",
        reason: "90 days old",
        severity: "critical",
      },
    ],
    href: "https://x/app",
  });
  eq(many.subject, "New Co: 2 things MILŌN needs before the next step", "multi-item subject");
  assert(many.text.startsWith("Hi,"), "generic greeting without a name");
  assert(many.text.includes("Sipho <b> has asked for"), "requester named in text");
  assert(many.html.includes("Sipho &lt;b&gt;"), "requester escaped in html");
  assert(
    many.text.indexOf("Latest month's figures") < many.text.indexOf("Aged debtors report"),
    "critical listed first",
  );
  assert(
    many.text.includes("What to send: The debtors age analysis"),
    "tells the owner what to send",
  );

  const soft = dataRequestEmail({
    clientName: "New Co",
    recipientName: null,
    requesterName: null,
    requests: [
      {
        kind: "aged_creditors",
        title: "Aged creditors report",
        reason: null,
        severity: "important",
      },
    ],
    href: "https://x/app",
  });
  assert(soft.text.includes("Nothing here blocks you today"), "non-blocking consequence copy");
}

// ── 5. Next Step integration: an open request is the blocking step ────────────

{
  const facts: NextStepFacts = {
    clientId: "22222222-2222-4222-8222-222222222222",
    state: "action_execution",
    stateSource: "persisted",
    hasFirm: false,
    hasProfile: true,
    hasFinancials: true,
    hasSnapshot: true,
    hasForecast: true,
    openQuestions: 0,
    proposedRecommendations: 0,
    approvedWithoutAction: 0,
    openActions: 4,
    overdueActions: 2,
    blockedActions: 1,
    actionedUnmeasured: 0,
    openDataRequests: 1,
    nextReviewAt: null,
    now: NOW,
  };
  const owner = resolveNextStep(facts, "owner");
  eq(owner.key, "data_request", "open data request outranks overdue + blocked actions");
  eq(owner.urgency, "blocking", "blocking urgency");
  eq(owner.cta.route.tab, "today", "owner lands on Today where the panel sits under the Next Step");
  const acct = resolveNextStep(facts, "accountant");
  eq(acct.cta.route.search.tab, "summary", "accountant lands on Summary");
  eq(
    resolveNextStep({ ...facts, openDataRequests: 0 }).key,
    "chase",
    "no request → falls through to overdue",
  );
  eq(
    resolveNextStep({ ...facts, state: "financial_data_collection" }).key,
    "upload",
    "pre-data: upload wins, request rules never fire there anyway",
  );
}

// ── 6. SQL ↔ TS drift + wiring ────────────────────────────────────────────────

{
  const sql = readFileSync(resolve("supabase/migrations/20260918140000_data_requests.sql"), "utf8");
  const inList = (name: string) => {
    const m = sql.match(
      new RegExp(`${name}\\s+text[^\\n]*\\n?[^(]*CHECK \\(${name} IN \\(([\\s\\S]*?)\\)\\)`),
    );
    if (!m) throw new Error(`no CHECK for ${name}`);
    return Array.from(m[1].matchAll(/'([a-z_]+)'/g))
      .map((x) => x[1])
      .sort();
  };
  eq(inList("kind").join(","), [...DATA_REQUEST_KINDS].sort().join(","), "kinds match SQL");
  eq(
    inList("severity").join(","),
    [...DATA_REQUEST_SEVERITIES].sort().join(","),
    "severities match SQL",
  );
  eq(inList("status").join(","), [...DATA_REQUEST_STATUSES].sort().join(","), "statuses match SQL");
  eq(inList("source").join(","), [...DATA_REQUEST_SOURCES].sort().join(","), "sources match SQL");

  assert(
    (ADVISORY_EVENTS as readonly string[]).includes("data.request_opened"),
    "event reserved in P0.1",
  );
  assert(
    (ADVISORY_EVENTS as readonly string[]).includes("data.request_fulfilled"),
    "fulfilled event reserved in P0.1",
  );
  assert(
    sql.includes("'data.request_opened'") && sql.includes("'data.request_fulfilled'"),
    "triggers emit both events",
  );
  assert(
    sql.includes("is_action_plan_writer(auth.uid(), client_id)"),
    "writes limited to owner or firm",
  );
  assert(sql.includes("has_client_access(auth.uid(), client_id)"), "reads by access");
  assert(!/FOR DELETE/.test(sql), "no delete policy: waive or expire instead");
  assert(sql.includes("data_requests_client_rule_open_key"), "one live request per rule");
  assert(
    sql.includes("AFTER INSERT ON public.client_financial_snapshots"),
    "snapshot auto-fulfils",
  );
  assert(
    sql.includes("AFTER UPDATE OF cashflow ON public.clients"),
    "opening balance auto-fulfils",
  );
  assert(
    sql.includes("d.source = 'system'") && sql.includes("NOT (d.rule_key = ANY (v_keys))"),
    "sync only closes system asks whose rule stopped firing",
  );
  assert(
    /EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/.test(sql),
    "triggers never block the user write",
  );
  assert((ADVISORY_STATES as readonly string[]).length > 0, "states import sane");

  const fns = readFileSync(resolve("src/lib/data-requests.functions.ts"), "utf8");
  assert(fns.includes('rpc("data_requests_sync"'), "sync goes through the RPC");
  assert(
    fns.includes("suppressRecentlyResolved(detectDataGaps(facts), existing.rows, now)"),
    "sync applies suppression",
  );
  assert(fns.includes('return { ok: false, reason: "self" }'), "owner cannot email themselves");
  assert(fns.includes("/app?tab=today"), "email deep-links to the owner board");
  assert(!/\/t\/|token/.test(fns), "no tokenised links: email GET never mutates");
  assert(fns.includes('status: "sent"'), "sending marks requests sent");

  const nextFns = readFileSync(resolve("src/lib/next-step.functions.ts"), "utf8");
  assert(
    nextFns.includes('count(sb, "data_requests", data.clientId'),
    "Next Step counts open requests",
  );
  assert(!nextFns.includes("openDataRequests: 0"), "hard-coded zero removed");

  const card = readFileSync(resolve("src/components/next-step-card.tsx"), "utf8");
  assert(
    card.includes("await syncRequests({ data: { clientId } }).catch(() => null)"),
    "card syncs before resolving, failure-tolerant",
  );

  const panel = readFileSync(resolve("src/components/data-requests-panel.tsx"), "utf8");
  assert(
    panel.includes('if (rows.length === 0 && audience === "owner") return null;'),
    "owner sees nothing when nothing is open",
  );
  assert(panel.includes("useServerFn(sendDataRequestEmail)"), "accountant can email");
  assert(panel.includes("What to send:"), "panel tells the owner what to send");
  assert(
    !/navigate\(|useNavigate|window\.location/.test(panel),
    "panel never navigates; host wires dialogs/tabs",
  );

  const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
  const appCard = app.indexOf("<NextStepCard");
  const appPanel = app.indexOf("<DataRequestsPanel");
  const appTabs = app.indexOf('id="owner-board-tabs"');
  assert(
    appCard > 0 && appPanel > appCard && appPanel < appTabs,
    "owner board: requests sit under the Next Step, above health",
  );
  assert(
    app.includes('onUpload={() => setFirstRunStep("first-data")}'),
    "owner Upload opens the first-data flow",
  );
  assert(
    app.includes('onOpenForecast={() => setActiveTab("cash")}'),
    "owner Enter balance opens the cash tab",
  );

  const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
  const sCard = studio.indexOf("<NextStepCard");
  const sPanel = studio.indexOf("<DataRequestsPanel");
  const sBrief = studio.indexOf("<ClientBriefing");
  assert(
    sCard > 0 && sPanel > sCard && sPanel < sBrief,
    "studio: requests under Next Step, above briefing",
  );
  assert(
    studio.includes('audience="accountant"\n              refreshKey'),
    "studio panel uses accountant audience",
  );
}

console.log("data-requests: all checks passed");
