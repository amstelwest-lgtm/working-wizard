/**
 * Public /try sample: gate, rate limits, no ledger calls, no ZA prices on the US page.
 * Run: pnpm test:trial-demo
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ANALYST_READ_TOOLS } from "../src/lib/agent-analyst";
import { TryScreen } from "../src/components/try-demo";
import {
  buildTrialBoard,
  buildTrialCash,
  buildTrialProfit,
  deliverTrialFindings,
  deterministicTrialFindings,
  emailLeadAllowed,
  findingRestatesScore,
  trialReading,
  ipSessionAllowed,
  sessionRunAllowed,
  trialAnalystMode,
  validateTrialGate,
  verifyTurnstileToken,
} from "../src/lib/trial-demo";
import {
  TRIAL_ANALYST_MAX_TOKENS,
  executeTrialAnalystGate,
  findingsFromAnalystContent,
  trialAnalystRequest,
  trialAnalystSystem,
  trialAnalystTools,
  trialAnalystUserMessage,
} from "../src/lib/trial-analyst";
import { TURNSTILE_TEST_SECRET_KEY, TURNSTILE_TEST_TOKEN } from "../src/lib/trial-public";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const gateOk = validateTrialGate({
  name: "Ada Lovelace",
  email: "Ada@Example.com",
  consent: true,
  turnstileToken: "token",
});
assert(gateOk.ok && gateOk.email === "ada@example.com", "gate lowercases email");
assert(gateOk.ok && gateOk.name === "Ada Lovelace", "gate keeps the name");

assert(
  !validateTrialGate({ name: " ", email: "ada@example.com", consent: true, turnstileToken: "t" })
    .ok,
  "blank name",
);
assert(
  validateTrialGate({ name: "Ada", email: "ada@example.com", consent: true, turnstileToken: "t" })
    .ok === false ||
    !validateTrialGate({ name: "Ada", email: "not-an-email", consent: true, turnstileToken: "t" })
      .ok,
  "bad email",
);
assert(
  !validateTrialGate({ name: "Ada", email: "not-an-email", consent: true, turnstileToken: "t" }).ok,
  "email needs a domain",
);
assert(
  !validateTrialGate({ name: "Ada", email: "ada@example.com", consent: false, turnstileToken: "t" })
    .ok,
  "consent required",
);
assert(
  !validateTrialGate({ name: "Ada", email: "ada@example.com", consent: true, turnstileToken: "  " })
    .ok,
  "turnstile token required",
);

assert(
  ipSessionAllowed(0) && ipSessionAllowed(2) && !ipSessionAllowed(3),
  "3 sessions per IP per day",
);
assert(emailLeadAllowed(0) && emailLeadAllowed(1) && !emailLeadAllowed(2), "2 leads per email");
assert(sessionRunAllowed(9) && !sessionRunAllowed(10), "10 runs per session");
assert(
  trialAnalystMode({ runsToday: 0, cap: 100, aiConfigured: true }) === "model",
  "under the cap uses the model",
);
assert(
  trialAnalystMode({ runsToday: 100, cap: 100, aiConfigured: true }) === "paused",
  "global daily cap pauses the model call",
);
assert(
  trialAnalystMode({ runsToday: 0, cap: 100, aiConfigured: false }) === "deterministic",
  "missing model key is the only fallback",
);
assert(
  trialAnalystMode({ runsToday: 100, cap: 100, aiConfigured: false }) === "deterministic",
  "a missing key still falls back when the cap is also spent",
);

const passed = await verifyTurnstileToken({
  token: TURNSTILE_TEST_TOKEN,
  secret: TURNSTILE_TEST_SECRET_KEY,
  remoteIp: null,
  fetchImpl: async () => {
    throw new Error("offline");
  },
});
assert(passed, "test secret accepts the documented test token offline");
const blocked = await verifyTurnstileToken({
  token: TURNSTILE_TEST_TOKEN,
  secret: "real-secret",
  remoteIp: null,
  fetchImpl: async () => {
    throw new Error("offline");
  },
});
assert(!blocked, "a real secret does not skip siteverify");

for (const tool of ANALYST_READ_TOOLS) {
  const gate = executeTrialAnalystGate(tool);
  assert(!gate.allowed && gate.tool_blocked, `${tool} is not a trial tool`);
}
assert(executeTrialAnalystGate("record_finding").allowed, "record_finding stays");
assert(executeTrialAnalystGate("finish").allowed, "finish stays");
assert(
  !executeTrialAnalystGate("draft_deliverable").allowed,
  "write tools outside the analyst list stay blocked",
);

const tools = trialAnalystTools().map((tool) => tool.name);
assert(
  tools.length === 2 && tools.includes("record_finding") && tools.includes("finish"),
  "trial tools are record and finish",
);
assert(
  !tools.some((name) => (ANALYST_READ_TOOLS as readonly string[]).includes(name)),
  "no ledger read tool schema",
);

const request = trialAnalystRequest({
  model: "claude-sonnet-5-5",
  system: trialAnalystSystem(),
  user: "sample",
});
assert(request.max_tokens === TRIAL_ANALYST_MAX_TOKENS, "trial call sets the max token cap");
assert(TRIAL_ANALYST_MAX_TOKENS <= 2048, "the cap stays small");
assert(request.system.includes("You are the Milōn Analyst"), "trial reuses the analyst prompt");
assert(request.system.includes("not a client ledger"), "trial mode is named in the prompt");

const parsed = findingsFromAnalystContent([
  {
    type: "tool_use",
    name: "get_ratios",
    input: { kind: "other", severity: "info", title: "no", detail: "no" },
  },
  {
    type: "tool_use",
    name: "record_finding",
    input: {
      kind: "liquidity",
      severity: "watch",
      title: "Current ratio is 1.64.",
      detail: "Current assets cover current liabilities 1.64 times on the sample.",
    },
  },
]);
assert(parsed.length === 1 && parsed[0]?.kind === "liquidity", "only record_finding is kept");

const us = buildTrialBoard("US");
assert(us.market === "US" && us.sampleStamp === "SAMPLE", "US board is stamped SAMPLE");
assert(typeof us.health.score === "number", "US health score is deterministic");
const again = buildTrialBoard("US");
assert(us.health.score === again.health.score, "health score does not move between calls");
const findings = deterministicTrialFindings(us, new Date("2026-10-14T00:00:00Z"));
assert(findings.length === 3, "deterministic review returns three findings");
assert(
  JSON.stringify(findings) ===
    JSON.stringify(deterministicTrialFindings(us, new Date("2026-10-14T00:00:00Z"))),
  "deterministic findings are stable",
);
const findingText = findings.map((finding) => `${finding.title} ${finding.detail}`).join(" ");
assert(
  /gross margin/i.test(findingText) && /net margin/i.test(findingText),
  "fallback uses the margins",
);
assert(
  /45 days/.test(findingText) && /50 days/.test(findingText),
  "fallback uses debtor and creditor days",
);
assert(
  /cash runway/i.test(findingText) && /no cash balance/i.test(findingText),
  "fallback uses the cash runway",
);
assert(!/health score/i.test(findingText), "fallback does not restate the health score");
assert(!findingText.includes(String(us.health.score)), "fallback does not quote the score");
const reading = trialReading(us, new Date("2026-10-14T00:00:00Z"));
assert(
  reading.grossMargin === "60.0%" && reading.netMargin === "7.8%",
  "US margins come from the sample",
);
assert(
  reading.cashOpening === "$0" && reading.cashClose.startsWith("$"),
  "US cash line is in dollars",
);
assert(
  findingRestatesScore({
    kind: "other",
    severity: "info",
    title: "The sample health score is 75, Watch.",
    detail: "Overall health is 75.",
  }),
  "a score restatement is recognised",
);
assert(!findingRestatesScore(findings[0]!), "a margin finding is kept");
const modelReading = deliverTrialFindings({
  mode: "model",
  modelFindings: findings,
  fallback: [
    {
      kind: "other",
      severity: "info",
      title: "The sample health score is 75.",
      detail: "Overall health is 75.",
    },
  ],
});
assert(
  modelReading.ok && modelReading.delivered === "model",
  "a configured key keeps the analyst reading",
);
const dropped = deliverTrialFindings({
  mode: "model",
  modelFindings: [
    {
      kind: "other",
      severity: "info",
      title: "The sample health score is 75.",
      detail: "Overall health is 75.",
    },
  ],
  fallback: findings,
});
assert(
  !dropped.ok && dropped.reason === "empty",
  "score restatements do not fall back when the key exists",
);
const paused = deliverTrialFindings({ mode: "paused", modelFindings: [], fallback: findings });
assert(!paused.ok && paused.reason === "paused", "the cap does not deliver the fallback");
const missingKey = deliverTrialFindings({
  mode: "deterministic",
  modelFindings: [],
  fallback: findings,
});
assert(
  missingKey.ok && missingKey.delivered === "deterministic",
  "a missing key delivers the fallback",
);
const analystMessage = trialAnalystUserMessage(us);
assert(!analystMessage.includes("health score"), "the analyst call is not given the health score");
assert(
  analystMessage.includes("60.0%") && analystMessage.includes("not measurable"),
  "the analyst call gets margins and runway",
);
const profit = buildTrialProfit("US");
assert(profit.steps[0]?.display === "$1,150,000", "US revenue uses dollars");
const cash = buildTrialCash("US", new Date("2026-10-14T00:00:00Z"));
assert(cash.weeks.length === 13, "cash line is 13 weeks");
assert(cash.openingDisplay === "$0", "sample cash opens at zero");

const html = [
  renderToStaticMarkup(createElement(TryScreen, { phase: "start" })),
  renderToStaticMarkup(
    createElement(TryScreen, { phase: "gate", siteKey: "1x00000000000000000000AA" }),
  ),
  renderToStaticMarkup(createElement(TryScreen, { phase: "reveal", board: us })),
  renderToStaticMarkup(
    createElement(TryScreen, {
      phase: "findings",
      board: us,
      findingsPending: true,
    }),
  ),
  renderToStaticMarkup(
    createElement(TryScreen, {
      phase: "findings",
      board: us,
      findings,
      chip: "profit",
      profit,
    }),
  ),
  renderToStaticMarkup(
    createElement(TryScreen, {
      phase: "findings",
      board: us,
      findings,
      chip: "cash",
      cash,
    }),
  ),
].join("\n");

assert(!html.includes("R299"), "US /try HTML has no R299");
assert(!html.includes("R2,837"), "US /try HTML has no R2,837");
assert(html.includes("Use sample"), "start has Use sample");
assert(html.includes("try-ring"), "the reveal draws a health ring");
assert(
  html.includes("The ratios below are what the Analyst reads."),
  "the reveal points at the ratios",
);
assert(html.includes("SAMPLE"), "the board is SAMPLE-stamped");
assert(html.includes("$1,150,000"), "US profitability is in dollars");
assert(
  html.includes("AI-generated from sample figures, not reviewed by an accountant."),
  "findings carry the label",
);
assert(
  renderToStaticMarkup(
    createElement(TryScreen, {
      phase: "findings",
      board: us,
      findings,
      source: "deterministic",
    }),
  ).includes("Prepared from the sample ratios, margins, and cash line."),
  "a missing key is labelled as a prepared reading",
);
assert(html.includes("Coming soon"), "unfinished chips say coming soon");
assert(html.includes("The MILŌN Team"), "the page signs The MILŌN Team");
assert(html.includes("muted"), "avatar clips are muted");
assert(!/whatsapp/i.test(html), "no WhatsApp");
assert(
  !html.includes("/api/xero") && !html.includes("/api/qbo") && !html.includes("/api/sage"),
  "HTML does not call a ledger",
);

const root = resolve(".");
const seeds = [
  "src/routes/try.tsx",
  "src/components/try-demo.tsx",
  "src/lib/trial-demo.ts",
  "src/lib/trial-demo.functions.ts",
  "src/lib/trial-analyst.ts",
  "src/lib/trial-public.ts",
];

function specsIn(text: string): { spec: string; typeOnly: boolean }[] {
  const out: { spec: string; typeOnly: boolean }[] = [];
  const re = /(?:import|export)\s+(type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const spec = (match[2] ?? "").split("?")[0];
    if (spec) out.push({ spec, typeOnly: Boolean(match[1]) });
  }
  return out;
}

function resolveSpec(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;
  const base = spec.startsWith("@/")
    ? join(root, "src", spec.slice(2))
    : resolve(dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.css`, join(base, "index.ts")];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* next */
    }
  }
  return null;
}

const seen = new Set<string>();
const queue = seeds.map((file) => join(root, file));
const forbidden = ["/api/xero", "/api/qbo", "/api/sage"];
const priceNeedles = ["R299", "R2,837"];
const hits: string[] = [];
const priceHits: string[] = [];

while (queue.length) {
  const file = queue.pop();
  if (!file || seen.has(file)) continue;
  seen.add(file);
  const text = readFileSync(file, "utf8");
  for (const needle of forbidden) {
    if (text.includes(needle)) hits.push(`${file} contains ${needle}`);
  }
  for (const needle of priceNeedles) {
    if (text.includes(needle)) priceHits.push(`${file} contains ${needle}`);
  }
  if (file.includes("/routes/api/")) hits.push(`${file} is a ledger route`);
  for (const found of specsIn(text)) {
    if (found.typeOnly) continue;
    const next = resolveSpec(file, found.spec);
    if (next && !seen.has(next)) queue.push(next);
  }
}

assert(hits.length === 0, `try path calls a ledger:\n${hits.join("\n")}`);
assert(priceHits.length === 0, `try JS contains a ZA price:\n${priceHits.join("\n")}`);
assert(seen.size > 5, "the try graph was walked");

const sql = readFileSync(join(root, "supabase/migrations/20261016120000_trial_demo.sql"), "utf8");
assert(sql.includes("trial_sessions") && sql.includes("token_hash"), "sessions store a token hash");
assert(
  sql.includes("trial_leads") && sql.includes("consent_at") && sql.includes("utm"),
  "leads keep consent and utm",
);
assert(sql.includes("trial_usage"), "usage stores runs");
assert(sql.includes("ENABLE ROW LEVEL SECURITY"), "RLS is on");
assert(!/create\s+policy/i.test(sql), "no policies, including no anon policy");
assert(
  /revoke all on table public\.trial_sessions from public, anon, authenticated/i.test(sql),
  "anon cannot read sessions",
);
assert(sql.includes("cleanup_expired_trial_rows"), "cleanup function exists");
assert(/delete from public\.trial_usage/i.test(sql), "cleanup deletes usage");
assert(/delete from public\.trial_sessions/i.test(sql), "cleanup deletes sessions");
assert(!/delete from public\.trial_leads/i.test(sql), "cleanup keeps leads");
assert(sql.includes("trial-demo-cleanup"), "cron job is named");
assert(sql.includes("interval '7 days'"), "retention is 7 days");

console.log(`trial-demo: ok (${seen.size} files in the try graph)`);
