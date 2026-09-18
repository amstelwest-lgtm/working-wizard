/**
 * Accountant marketplace (P3) — match score parity with SQL, invite moments,
 * request statuses, workflow mail for requests, SQL rules, wiring.
 * Run: pnpm test:marketplace
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  REQUEST_STATUSES,
  inviteMoment,
  isMissingMarketplaceRelation,
  normaliseTags,
  requestStatusLabel,
  scoreFirm,
} from "../src/lib/marketplace";
import {
  planWorkflowEmails,
  renderWorkflowEmail,
  workflowEmailHref,
  type WorkflowFacts,
} from "../src/lib/workflow-emails";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = "2026-09-18T12:00:00.000Z";

// ── 1. Matching mirrors SQL ──────────────────────────────────────────────────

{
  const retailZa = { businessType: "Retail", country: "ZA", regionCode: null };
  const firm = { industries: ["retail", "hospitality"], regions: ["za"], accepting: true };
  const m = scoreFirm(retailZa, firm);
  eq(m.score, 6, "industry 3 + region 2 + accepting 1 (same fixture as the SQL flow)");
  eq(
    m.reasons.join("|"),
    "Works with retail businesses|Serves your region|Taking new clients",
    "reasons match SQL text",
  );
  eq(
    scoreFirm(retailZa, { industries: ["manufacturing"], regions: ["us"], accepting: false }).score,
    0,
    "no match → 0",
  );
  eq(
    scoreFirm(
      { businessType: null, country: "US", regionCode: "TX" },
      { industries: [], regions: ["tx"], accepting: false },
    ).score,
    2,
    "region code matches state tag",
  );
  eq(
    scoreFirm(
      { businessType: "", country: null, regionCode: null },
      { industries: [""], regions: [], accepting: true },
    ).score,
    1,
    "empty type never matches an empty tag",
  );

  eq(
    normaliseTags("Retail, Hospitality,, trades \n RETAIL").join(","),
    "retail,hospitality,trades",
    "tags lower-cased, trimmed, deduped",
  );
  eq(normaliseTags(["ZA", " za "]).join(","), "za", "array input");
}

// ── 2. Copy + statuses ───────────────────────────────────────────────────────

{
  eq(
    inviteMoment({ packStatus: null, hasFirm: true, openRequests: 0 }).show,
    false,
    "never shown with a firm",
  );
  eq(
    inviteMoment({ packStatus: "approved", hasFirm: false, openRequests: 0 }).title,
    "Have an accountant check this pack",
    "pack moment",
  );
  eq(
    inviteMoment({ packStatus: null, hasFirm: false, openRequests: 1 }).title,
    "Your request is with the firm",
    "pending moment",
  );
  assert(
    inviteMoment({ packStatus: null, hasFirm: false, openRequests: 0 }).reason.includes(
      "MILŌN works without one",
    ),
    "default copy keeps the no-accountant promise",
  );
  for (const s of REQUEST_STATUSES) {
    assert(
      requestStatusLabel(s, "owner").length > 0 && requestStatusLabel(s, "accountant").length > 0,
      `labels for ${s}`,
    );
  }
  eq(
    requestStatusLabel("expired", "accountant"),
    "Taken by another firm",
    "expired reads honestly for the firm",
  );
  assert(
    isMissingMarketplaceRelation({
      message: 'relation "public.accountant_requests" does not exist',
    }),
    "missing table",
  );
  assert(
    !isMissingMarketplaceRelation({ message: "You already have an open request with this firm" }),
    "business error ≠ missing",
  );
}

// ── 3. Workflow mail for requests ────────────────────────────────────────────

{
  const base: WorkflowFacts = {
    clientId: "c",
    clientName: "New Co",
    hasFirm: false,
    firmName: null,
    pack: null,
    forecast: null,
    lastRestart: null,
    pastDataCollection: true,
    now: NOW,
  };
  const open = planWorkflowEmails({
    ...base,
    accountantRequests: [
      {
        id: "rq1",
        firmId: "f1",
        firmName: "Firm",
        status: "open",
        createdAt: NOW,
        respondedAt: null,
        responseNote: null,
      },
    ],
  });
  eq(
    open.map((i) => `${i.kind}→${i.audience}`).join(","),
    "accountant_request_received→requested_firm",
    "open request → requested firm",
  );
  eq(open[0].requestId, "rq1", "intent carries the request id for recipient lookup");
  eq(open[0].refKey, "rq1", "keyed by request (sent once)");

  const accepted = planWorkflowEmails({
    ...base,
    hasFirm: true,
    accountantRequests: [
      {
        id: "rq1",
        firmId: "f1",
        firmName: "Firm",
        status: "accepted",
        createdAt: NOW,
        respondedAt: "2026-09-17T00:00:00Z",
        responseNote: null,
      },
    ],
  });
  eq(accepted.map((i) => i.kind).join(","), "accountant_attached", "accepted → owner told");
  const declined = planWorkflowEmails({
    ...base,
    accountantRequests: [
      {
        id: "rq2",
        firmId: "f2",
        firmName: "Beta",
        status: "declined",
        createdAt: NOW,
        respondedAt: "2026-09-17T00:00:00Z",
        responseNote: "Full book",
      },
    ],
  });
  eq(declined[0]?.kind, "accountant_request_declined", "declined → owner told");
  const old = planWorkflowEmails({
    ...base,
    accountantRequests: [
      {
        id: "rq3",
        firmId: "f2",
        firmName: "Beta",
        status: "declined",
        createdAt: NOW,
        respondedAt: "2026-06-01T00:00:00Z",
        responseNote: null,
      },
    ],
  });
  eq(old.length, 0, "old decisions are history");
  eq(
    planWorkflowEmails({
      ...base,
      accountantRequests: [
        {
          id: "x",
          firmId: "f",
          firmName: null,
          status: "withdrawn",
          createdAt: NOW,
          respondedAt: NOW,
          responseNote: null,
        },
      ],
    }).length,
    0,
    "withdrawn is silent",
  );

  const site = "https://milon.co.za";
  eq(
    workflowEmailHref("accountant_request_received", "requested_firm", "c", site),
    "https://milon.co.za/dashboard#accountant-inbox",
    "firm link lands on the inbox",
  );
  const r = renderWorkflowEmail({
    intent: open[0],
    clientId: "c",
    clientName: "New Co",
    recipientName: "Sipho",
    siteUrl: site,
  });
  eq(r.subject, "New Co has asked your firm to review their advisory pack", "request subject");
  assert(r.text.includes("not raw statements"), "firm told they judge the pack");
  const a = renderWorkflowEmail({
    intent: accepted[0],
    clientId: "c",
    clientName: "New Co",
    recipientName: null,
    siteUrl: site,
  });
  eq(a.subject, "New Co: Firm has accepted your request", "attached subject");
  const d = renderWorkflowEmail({
    intent: declined[0],
    clientId: "c",
    clientName: "New Co",
    recipientName: null,
    siteUrl: site,
  });
  assert(
    d.text.includes('"Full book"') &&
      d.text.includes("keeps working for you without an accountant"),
    "decline copy quotes the note and reassures",
  );
  for (const m of [r, a, d]) assert(!/\/t\/|token=/.test(m.href), "no tokenised links");
}

// ── 4. SQL rules ─────────────────────────────────────────────────────────────

{
  const sql = readFileSync(resolve("supabase/migrations/20260918180000_marketplace.sql"), "utf8");
  const m = sql.match(/status\s+text NOT NULL DEFAULT 'open' CHECK \(status IN \(([\s\S]*?)\)\)/);
  assert(Boolean(m), "status CHECK present");
  eq(
    Array.from(m![1].matchAll(/'([a-z_]+)'/g), (x) => x[1])
      .sort()
      .join(","),
    [...REQUEST_STATUSES].sort().join(","),
    "statuses match SQL",
  );
  assert(
    sql.includes("Only the business owner can look for an accountant"),
    "matching is owner-only",
  );
  assert(sql.includes("This business already has a firm attached"), "no shopping once attached");
  assert(sql.includes("That firm is not taking requests"), "unlisted firms cannot be asked");
  assert(
    sql.includes("accountant_requests_open_key") && sql.includes("WHERE status = 'open'"),
    "one open request per (client, firm)",
  );
  assert(
    sql.includes("Only a member of the requested firm can respond"),
    "only the target firm responds",
  );
  assert(
    sql.includes("UPDATE public.clients SET firm_id = v_req.firm_id"),
    "accept attaches the firm",
  );
  assert(sql.includes("'Another firm accepted'"), "other open requests expire on accept");
  assert(
    sql.includes("This business has since attached a different firm"),
    "race with another firm handled",
  );
  assert(
    sql.includes("THEN 3 ELSE 0 END") &&
      sql.includes("THEN 2 ELSE 0 END") &&
      sql.includes("THEN 1 ELSE 0 END"),
    "SQL score weights 3/2/1 match scoreFirm",
  );
  assert(
    !/CREATE POLICY "accountant_requests[^"]*" ON public\.accountant_requests FOR (INSERT|UPDATE|DELETE)/.test(
      sql,
    ),
    "requests have no direct write policies",
  );
  assert(
    sql.includes("SELECT p.id INTO v_pack FROM public.advisory_packs p"),
    "latest pack attached to the request",
  );
  assert(
    sql.includes(
      "'accountant_request_received', 'accountant_attached', 'accountant_request_declined'",
    ),
    "workflow kinds extended",
  );
}

// ── 5. Wiring ────────────────────────────────────────────────────────────────

{
  const fns = readFileSync(resolve("src/lib/marketplace.functions.ts"), "utf8");
  for (const rpc of [
    "marketplace_match_firms",
    "accountant_request_create",
    "accountant_request_withdraw",
    "accountant_request_respond",
  ]) {
    assert(fns.includes(`rpc("${rpc}"`), `server fns call ${rpc}`);
  }
  assert(fns.includes("normaliseTags(data.industries"), "listing tags normalised on save");
  const engine = readFileSync(resolve("src/lib/workflow-emails.functions.ts"), "utf8");
  assert(
    engine.includes('rpc("accountant_request_recipients"'),
    "engine resolves requested-firm recipients via RPC",
  );
  assert(
    engine.includes('recipient_role: d.audience === "requested_firm" ? "accountant" : d.audience'),
    "log role stays within the CHECK",
  );
  const owner = readFileSync(resolve("src/components/find-accountant-panel.tsx"), "utf8");
  assert(
    owner.includes("if (!clientId || hasFirm ||"),
    "owner panel hides once a firm is attached",
  );
  assert(/not your\s+statements/.test(owner), "owner told what the firm sees");
  assert(!/navigate\(|useNavigate|window\.location/.test(owner), "owner panel never navigates");
  const inbox = readFileSync(resolve("src/components/accountant-inbox.tsx"), "utf8");
  assert(
    inbox.includes("useServerFn(respondToAccountantRequest)") &&
      inbox.includes("useServerFn(upsertFirmListing)"),
    "inbox responds and manages the listing",
  );
  assert(inbox.includes('id="accountant-inbox"'), "inbox anchor matches the email link");
  const app = readFileSync(resolve("src/routes/app.tsx"), "utf8");
  assert(
    app.includes("!clientMeta?.firm_id ? (\n                  <FindAccountantPanel"),
    "owner board mounts the panel only without a firm",
  );
  const dash = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
  assert(
    dash.indexOf("<AccountantInbox") > dash.indexOf("<PortfolioExceptions") &&
      dash.indexOf("<AccountantInbox") < dash.indexOf('id="clients-table"'),
    "inbox sits under the portfolio, above the clients table",
  );
}

console.log("marketplace: all checks passed");
