/**
 * Workflow emails (P1.3) — deterministic planner, idempotency, templates,
 * link safety (plain routes, no tokens), SQL↔TS drift, engine wiring.
 * Run: pnpm test:workflow-emails
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  RESTART_NEWS_WINDOW_DAYS,
  WORKFLOW_EMAIL_KINDS,
  dropAlreadySent,
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
const CLIENT = "22222222-2222-4222-8222-222222222222";

function facts(over: Partial<WorkflowFacts> = {}): WorkflowFacts {
  return {
    clientId: CLIENT,
    clientName: "New Co",
    hasFirm: true,
    firmName: "Amstel & Co",
    pack: null,
    forecast: null,
    lastRestart: null,
    pastDataCollection: true,
    now: NOW,
    ...over,
  };
}
const pack = (
  over: Partial<NonNullable<WorkflowFacts["pack"]>> = {},
): NonNullable<WorkflowFacts["pack"]> => ({
  id: "p1",
  version: 2,
  status: "in_review",
  requiresReview: true,
  reviewedAt: null,
  reviewNote: null,
  deliveredAt: null,
  ...over,
});
const keys = (f: WorkflowFacts) => planWorkflowEmails(f).map((i) => `${i.kind}→${i.audience}`);

// ── 1. Planner ───────────────────────────────────────────────────────────────

{
  eq(keys(facts()).length, 0, "nothing due on a quiet client");
  eq(
    keys(
      facts({
        pastDataCollection: false,
        pack: pack(),
        forecast: { lastForecastAt: NOW, closings: [-1] },
      }),
    ).length,
    0,
    "pre-data: no workflow mail at all",
  );

  eq(
    keys(facts({ pack: pack() })).join(","),
    "pack_ready_for_review→accountant",
    "pack in review → accountant",
  );
  eq(
    keys(facts({ pack: pack(), hasFirm: false })).length,
    0,
    "no firm → nobody to review (owner-only packs are drafts)",
  );
  eq(
    keys(facts({ pack: pack({ status: "approved" }) })).join(","),
    "pack_signed_off→owner",
    "signed off → owner",
  );
  eq(
    keys(facts({ pack: pack({ status: "approved", deliveredAt: NOW }) })).length,
    0,
    "already read → no mail",
  );
  eq(
    keys(facts({ pack: pack({ status: "approved", requiresReview: false }), hasFirm: false }))
      .length,
    0,
    "owner accepted their own pack → no mail",
  );
  eq(
    keys(
      facts({
        pack: pack({ status: "changes_requested", reviewedAt: NOW, reviewNote: "Add creditors" }),
      }),
    ).join(","),
    "pack_changes_requested→owner",
    "changes requested → owner",
  );
  eq(keys(facts({ pack: pack({ status: "rejected" }) })).length, 0, "rejected pack is internal");
  eq(keys(facts({ pack: pack({ status: "draft" }) })).length, 0, "draft is not news");

  const brk = facts({
    forecast: { lastForecastAt: "2026-09-10T00:00:00Z", closings: [10, 5, -3, 2] },
  });
  eq(
    keys(brk).join(","),
    "forecast_break→owner,forecast_break→accountant",
    "cash break → both seats",
  );
  eq(keys({ ...brk, hasFirm: false }).join(","), "forecast_break→owner", "no firm → owner only");
  const bi = planWorkflowEmails(brk)[0];
  eq(bi.refKey, "2026-09-10T00:00:00Z", "forecast break keyed by publish time (once per forecast)");
  eq(bi.data.week, 3, "week of the low");
  eq(bi.data.lowest, -3, "lowest closing");
  eq(
    keys(facts({ forecast: { lastForecastAt: NOW, closings: [10, 5, 1] } })).length,
    0,
    "positive forecast → no mail",
  );
  eq(
    keys(facts({ forecast: { lastForecastAt: NOW, closings: [] } })).length,
    0,
    "empty closings → no mail",
  );

  eq(
    keys(facts({ lastRestart: { eventId: 77, at: "2026-09-15T00:00:00Z" } })).join(","),
    "cycle_restarted→owner",
    "recent restart → owner",
  );
  eq(
    planWorkflowEmails(facts({ lastRestart: { eventId: 77, at: "2026-09-15T00:00:00Z" } }))[0]
      .refKey,
    "77",
    "restart keyed by event id",
  );
  const old = new Date(Date.parse(NOW) - (RESTART_NEWS_WINDOW_DAYS + 1) * 86_400_000).toISOString();
  eq(keys(facts({ lastRestart: { eventId: 1, at: old } })).length, 0, "old restart is history");

  // Ordering: cash break first, then pack, then restart.
  const all = facts({
    pack: pack({ status: "approved" }),
    forecast: { lastForecastAt: NOW, closings: [-5] },
    lastRestart: { eventId: 9, at: NOW },
  });
  eq(
    keys(all).join(","),
    "forecast_break→owner,forecast_break→accountant,pack_signed_off→owner,cycle_restarted→owner",
    "stable priority order",
  );
  eq(
    JSON.stringify(planWorkflowEmails(all)),
    JSON.stringify(planWorkflowEmails(all)),
    "deterministic",
  );
  for (const i of planWorkflowEmails(all)) {
    assert((WORKFLOW_EMAIL_KINDS as readonly string[]).includes(i.kind), `kind ${i.kind} valid`);
    assert(i.refKey.length > 0, "ref key present");
  }
}

// ── 2. Idempotency ───────────────────────────────────────────────────────────

{
  const planned = [
    { kind: "forecast_break" as const, refKey: "t1", email: "Owner@X.test" },
    { kind: "forecast_break" as const, refKey: "t1", email: "acct@x.test" },
    { kind: "pack_signed_off" as const, refKey: "p1", email: "owner@x.test" },
  ];
  const log = [
    { kind: "forecast_break", ref_key: "t1", recipient_email: "owner@x.test", status: "sent" },
    { kind: "pack_signed_off", ref_key: "p1", recipient_email: "owner@x.test", status: "failed" },
  ];
  const due = dropAlreadySent(planned, log);
  eq(
    due.map((d) => `${d.kind}:${d.email}`).join(","),
    "forecast_break:acct@x.test,pack_signed_off:owner@x.test",
    "sent dropped (case-insensitive), failed retried, other recipient kept",
  );
  eq(dropAlreadySent(planned, []).length, 3, "empty log → all due");
  eq(
    dropAlreadySent(planned, [
      { kind: "forecast_break", ref_key: "t2", recipient_email: "owner@x.test", status: "sent" },
    ]).length,
    3,
    "different ref → still due",
  );
}

// ── 3. Templates + links ─────────────────────────────────────────────────────

{
  const site = "https://milon.co.za/";
  eq(
    workflowEmailHref("pack_signed_off", "owner", CLIENT, site),
    "https://milon.co.za/app?tab=next",
    "owner pack link",
  );
  eq(
    workflowEmailHref("forecast_break", "owner", CLIENT, site),
    "https://milon.co.za/app?tab=cash",
    "owner cash link",
  );
  eq(
    workflowEmailHref("cycle_restarted", "owner", CLIENT, site),
    "https://milon.co.za/app?tab=today",
    "owner restart link",
  );
  eq(
    workflowEmailHref("pack_ready_for_review", "accountant", CLIENT, site),
    `https://milon.co.za/clients/${CLIENT}?tab=advisory`,
    "accountant pack link",
  );
  eq(
    workflowEmailHref("forecast_break", "accountant", CLIENT, site),
    `https://milon.co.za/clients/${CLIENT}?tab=cash`,
    "accountant cash link",
  );

  const base = { clientId: CLIENT, clientName: "New Co", siteUrl: site };
  const all = planWorkflowEmails(
    facts({
      pack: pack({
        status: "changes_requested",
        reviewedAt: NOW,
        reviewNote: 'Add the <creditor> angle & "terms"',
      }),
      forecast: { lastForecastAt: NOW, closings: [-12000] },
      lastRestart: { eventId: 9, at: NOW },
    }),
  );
  for (const intent of all) {
    const m = renderWorkflowEmail({ ...base, intent, recipientName: "Thabo" });
    assert(m.subject.startsWith("New Co:"), `subject names the client: ${m.subject}`);
    assert(m.text.startsWith("Hi Thabo,"), "greets by name");
    assert(m.text.includes(m.href) && m.html.includes(`href="${m.href}"`), "link in both bodies");
    assert(!/\/t\/|token=|\/ack\//.test(m.href), `no tokenised link: ${m.href}`);
    assert(m.text.endsWith("— MILŌN"), "signed");
  }
  const cr = renderWorkflowEmail({
    ...base,
    intent: all.find((i) => i.kind === "pack_changes_requested")!,
    recipientName: null,
  });
  assert(cr.text.startsWith("Hi,"), "generic greeting");
  assert(
    cr.subject === "New Co: Amstel & Co asked for changes to the advisory pack",
    `changes subject: ${cr.subject}`,
  );
  assert(cr.text.includes('"Add the <creditor> angle & "terms""'), "note quoted in text");
  assert(
    cr.html.includes("&lt;creditor&gt; angle &amp; &quot;terms&quot;"),
    "note escaped in html",
  );

  const fb = renderWorkflowEmail({
    ...base,
    intent: all.find((i) => i.kind === "forecast_break" && i.audience === "owner")!,
    recipientName: null,
  });
  assert(
    fb.subject === "New Co: your cash forecast goes negative in week 1",
    `owner break subject: ${fb.subject}`,
  );
  assert(fb.text.includes("−R12 000 in week 1"), `money formatting: ${fb.text}`);
  assert(fb.text.includes("R50 000 comfort line"), "comfort line named");
  const fba = renderWorkflowEmail({
    ...base,
    intent: all.find((i) => i.kind === "forecast_break" && i.audience === "accountant")!,
    recipientName: null,
  });
  assert(
    fba.subject === "New Co: cash forecast goes negative in week 1",
    "accountant break subject",
  );
  assert(fba.text.includes("The owner has been told too"), "accountant told the owner knows");

  const so = renderWorkflowEmail({
    ...base,
    intent: planWorkflowEmails(facts({ pack: pack({ status: "approved" }) }))[0],
    recipientName: null,
  });
  assert(
    so.text.includes("Amstel & Co has reviewed and signed off advisory pack v2"),
    "firm named on sign-off",
  );
  const soNoFirm = renderWorkflowEmail({
    ...base,
    intent: {
      ...planWorkflowEmails(facts({ pack: pack({ status: "approved" }) }))[0],
      data: { version: 2, firmName: null },
    },
    recipientName: null,
  });
  assert(soNoFirm.text.includes("Your accountant has reviewed"), "falls back to 'Your accountant'");

  const rr = renderWorkflowEmail({
    ...base,
    intent: planWorkflowEmails(facts({ pack: pack() }))[0],
    recipientName: "Sipho",
  });
  assert(
    rr.subject.includes("ready for your review") &&
      rr.text.includes("Nothing reaches the owner until you sign it off"),
    "review email copy",
  );
}

// ── 4. SQL ↔ TS + wiring ─────────────────────────────────────────────────────

{
  const sql = readFileSync(
    resolve("supabase/migrations/20260918170000_workflow_emails.sql"),
    "utf8",
  );
  const m = sql.match(/kind\s+text NOT NULL CHECK \(kind IN \(([\s\S]*?)\)\)/);
  assert(Boolean(m), "kind CHECK present");
  eq(
    Array.from(m![1].matchAll(/'([a-z_]+)'/g), (x) => x[1])
      .sort()
      .join(","),
    [...WORKFLOW_EMAIL_KINDS].sort().join(","),
    "kinds match SQL",
  );
  assert(
    sql.includes("WHERE status = 'sent'") && sql.includes("workflow_email_log_sent_key"),
    "partial unique index guards idempotency",
  );
  assert(!/FOR (UPDATE|DELETE)/.test(sql), "log is immutable");
  assert(
    sql.includes("CREATE OR REPLACE FUNCTION public.workflow_recipients") &&
      sql.includes("SECURITY DEFINER"),
    "recipients via SECURITY DEFINER RPC",
  );
  assert(
    sql.includes("JOIN public.firm_memberships fm ON fm.firm_id = c.firm_id"),
    "firm members are accountant recipients",
  );
  assert(sql.includes("pr.email LIKE '%@%'"), "recipients need a real email");

  const fns = readFileSync(resolve("src/lib/workflow-emails.functions.ts"), "utf8");
  assert(fns.includes('rpc("workflow_recipients"'), "engine resolves recipients via RPC");
  assert(fns.includes("dropAlreadySent(fanned"), "engine dedupes against the log");
  assert(
    fns.includes("idempotencyKey: `workflow:${data.clientId}:${d.kind}:${d.refKey}:${d.email}`"),
    "Resend idempotency key per (client, kind, ref, recipient)",
  );
  assert(
    fns.includes("/duplicate key|unique/i.test(insErr.message"),
    "concurrent duplicate is tolerated, not thrown",
  );
  assert(
    fns.includes('status = "failed"') && fns.includes("error = res.error"),
    "failures are logged, not hidden",
  );
  assert(fns.includes("dryRun"), "dry run supported");
  assert(
    !/service_role|supabaseAdmin|SUPABASE_SERVICE_ROLE_KEY/.test(fns),
    "engine runs as the user, never as service role",
  );

  const card = readFileSync(resolve("src/components/next-step-card.tsx"), "utf8");
  assert(
    card.includes("void workflow({ data: { clientId } }).catch(() => null)"),
    "card triggers the engine fire-and-forget after resolving",
  );
  const cardOrder = card.indexOf("await fetchNextStep(") < card.indexOf("void workflow(");
  assert(cardOrder, "workflow runs after the step is fetched, never before");
}

console.log("workflow-emails: all checks passed");
