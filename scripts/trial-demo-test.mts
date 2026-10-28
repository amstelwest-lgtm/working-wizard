/**
 * Public /try sample: gate, rate limits, no ledger calls, no ZA prices on the US page.
 * Run: pnpm test:trial-demo
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { ANALYST_READ_TOOLS } from "../src/lib/agent-analyst";
import { TrySampleBoards } from "../src/components/try-sample-boards";
import { TrySamplePack } from "../src/components/try-sample-pack";
import { TryScreen } from "../src/components/try-demo";
import { cashYDomainIncludingFloor } from "../src/lib/cash-forecast-view";
import { formatMoneyChartTick, formatMoneyCompact } from "../src/lib/market/format";
import { ZA_MARKET } from "../src/lib/market/resolve";
import { firmSignupHref } from "../src/lib/firm-signup-copy";
import { FIRM_BAND_CATALOG } from "../src/lib/stripe-plans";
import { SAMPLE_BUSINESS_NAME } from "../src/lib/sample-business";
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
  trialMarketForVisitor,
  validateTrialGate,
  verifyTurnstileToken,
} from "../src/lib/trial-demo";
import { trialCashSeries } from "../src/lib/trial-sample-view";
import {
  TRIAL_ANALYST_MAX_TOKENS,
  executeTrialAnalystGate,
  findingsFromAnalystContent,
  trialAnalystRequest,
  trialAnalystSystem,
  trialAnalystTools,
  trialAnalystUserMessage,
} from "../src/lib/trial-analyst";
import {
  TRIAL_CTA_LABEL,
  TRIAL_SIGNUP_HREF,
  TRIAL_SIGNUP_SENTENCE,
  trialSignupHref,
  TURNSTILE_TEST_SECRET_KEY,
  TURNSTILE_TEST_TOKEN,
  resetTurnstileUnsetWarning,
  turnstileEnabled,
  warnTurnstileUnsetOnce,
} from "../src/lib/trial-public";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** renderToStaticMarkup escapes text and attribute values. */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");
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
  "turnstile token required when the check is on",
);
const gateWithoutTurnstile = validateTrialGate({
  name: "Ada",
  email: "ada@example.com",
  consent: true,
  turnstileToken: "",
  turnstileRequired: false,
  honeypot: "",
});
assert(gateWithoutTurnstile.ok, "unset turnstile does not require a token");
const honeypot = validateTrialGate({
  name: "Ada",
  email: "ada@example.com",
  consent: true,
  turnstileToken: "",
  turnstileRequired: false,
  honeypot: "filled by a bot",
});
assert(
  !honeypot.ok && "silent" in honeypot && honeypot.silent,
  "a filled honeypot is a silent reject",
);
assert(!("error" in honeypot), "a silent reject has no visitor-facing error");
assert(
  !JSON.stringify(honeypot).toLowerCase().includes("honeypot"),
  "the reject does not name the honeypot",
);
assert(
  turnstileEnabled({ siteKey: "site-key", secret: "secret-key", dev: false }),
  "both keys enable turnstile in production",
);
assert(
  !turnstileEnabled({ siteKey: "", secret: "secret-key", dev: false }),
  "a missing site key disables turnstile in production",
);
assert(
  !turnstileEnabled({ siteKey: "site-key", secret: "  ", dev: false }),
  "a missing secret disables turnstile in production",
);
assert(
  !turnstileEnabled({ siteKey: undefined, secret: undefined, dev: false }),
  "unset keys disable turnstile in production",
);
assert(
  turnstileEnabled({ siteKey: undefined, secret: undefined, dev: true }),
  "dev keeps the test-key fallback",
);
resetTurnstileUnsetWarning();
const turnstileWarnings: string[] = [];
const warn = console.warn;
console.warn = (message?: unknown) => {
  turnstileWarnings.push(String(message));
};
warnTurnstileUnsetOnce(true, false);
warnTurnstileUnsetOnce(true, false);
warnTurnstileUnsetOnce(false, false);
warnTurnstileUnsetOnce(true, true);
console.warn = warn;
assert(turnstileWarnings.length === 1, "unset turnstile warns once");
assert(
  /ip limit/i.test(turnstileWarnings[0] ?? "") && /honeypot/i.test(turnstileWarnings[0] ?? ""),
  "the warning names the remaining checks",
);
resetTurnstileUnsetWarning();

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
  /13-week cash line opens at/.test(findingText) && /low point is/.test(findingText),
  "fallback quotes the cash line and its low point",
);
assert(!/no cash balance/i.test(findingText), "fallback does not say the sample has no cash");
assert(!/health score/i.test(findingText), "fallback does not restate the health score");
const withoutMoney = findingText.replace(/(?:\$|R)\s?[\d,]+(?:\.\d+)?/g, "");
assert(
  !new RegExp(`\\b${us.health.score}\\b`).test(withoutMoney),
  "fallback does not quote the score",
);
const reading = trialReading(us, new Date("2026-10-14T00:00:00Z"));
assert(
  reading.grossMargin === "60.0%" && reading.netMargin === "7.8%",
  "US margins come from the sample",
);
assert(
  reading.cashOpening.startsWith("$") &&
    reading.cashOpening !== "$0" &&
    reading.cashLow === reading.cashOpening &&
    reading.cashClose.startsWith("$"),
  "US cash opens at the sample bank balance, and the low point is that same line",
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
  analystMessage.includes("60.0%") && analystMessage.includes("cash_low"),
  "the analyst call gets margins and the cash line",
);
assert(
  !analystMessage.includes("no cash balance") && !analystMessage.includes("not measurable"),
  "the analyst call does not deny the sample bank balance",
);
const profit = buildTrialProfit("US");
assert(profit.steps[0]?.display === "$1,150,000", "US revenue uses dollars");
const cash = buildTrialCash("US", new Date("2026-10-14T00:00:00Z"));
assert(cash.weeks.length === 13, "cash line is 13 weeks");
assert(cash.openingDisplay === "$82,000", "US sample cash opens at the balance-sheet residual");
assert(
  cash.lowDisplay === cash.openingDisplay,
  "the quoted low point is the opening of this series",
);
assert(!cash.openingDisplay.includes("R"), "US cash display has no rand");

const za = buildTrialBoard("ZA");
const zaFindings = deterministicTrialFindings(za, new Date("2026-10-14T00:00:00Z"));
const zaText = zaFindings.map((finding) => `${finding.title} ${finding.detail}`).join(" ");
assert(zaText.includes("R 6 400 000"), "ZA findings use the shared spaced rand format");
assert(!zaText.includes("R 6,400,000"), "ZA findings do not use comma grouping");
assert(zaText.includes("R 450 000"), "ZA findings open at the sample bank balance");
assert(!/no cash balance/i.test(zaText), "ZA findings do not deny the bank balance");
const zaCash = buildTrialCash("ZA", new Date("2026-10-14T00:00:00Z"));
assert(
  zaCash.openingDisplay === "R 450 000" && zaCash.lowDisplay === "R 450 000",
  "ZA low point matches the opening",
);
const zaSeries = trialCashSeries("ZA", new Date("2026-10-14T00:00:00Z"));
assert(
  zaSeries.floor === 433846,
  `ZA runway floor is four weeks of payments, got ${zaSeries.floor}`,
);
assert(zaSeries.opening > zaSeries.floor, "opening cash sits above the runway floor");
assert(zaSeries.low === zaSeries.opening, "the chart series low point is the opening");
assert(
  zaText.includes("Opens at the sample bank balance on file."),
  "findings name the sample opening balance",
);
assert(formatMoneyCompact(656_000, ZA_MARKET) === "R 656k", "ZA abbreviations keep a space");
assert(
  formatMoneyCompact(656_000, { currency: "USD", locale: "en-US" }) === "$656k",
  "US abbreviations stay unspaced",
);
assert(formatMoneyChartTick(656_000) === "R656k", "owner axis ticks stay unspaced");
assert(
  readFileSync(join(resolve("."), "src/components/try-sample-boards.tsx"), "utf8").includes(
    "spacedChartTicks",
  ),
  "the try chart keeps the rand gap on axis abbreviations",
);
const [belowLo, belowHi] = cashYDomainIncludingFloor(0, 200_000, zaSeries.floor);
assert(belowHi > zaSeries.floor, "a floor above the line stays inside the y-domain");
assert(belowLo < 0, "the domain still starts below a zero opening");
const [nearLo, nearHi] = cashYDomainIncludingFloor(
  zaSeries.opening,
  zaSeries.closing[12] ?? zaSeries.opening,
  zaSeries.floor,
);
assert(
  nearLo < zaSeries.floor && nearHi > zaSeries.opening,
  "the floor stays on the axis beside the opening",
);

const sampleNow = new Date("2026-10-14T15:00:00Z");
const boardsRoute = createRootRoute({
  component: () =>
    createElement(TrySampleBoards, {
      market: "US",
      profit: true,
      cash: true,
      now: sampleNow,
    }),
});
const boardsRouter = createRouter({
  routeTree: boardsRoute,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
await boardsRouter.load();
const boardsHtml = renderToStaticMarkup(createElement(RouterProvider, { router: boardsRouter }));

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
    }),
  ),
  boardsHtml,
].join("\n");

assert(!html.includes("R299"), "US /try HTML has no R299");
assert(!html.includes("R2,837"), "US /try HTML has no R2,837");
assert(html.includes("Use sample"), "start has Use sample");
assert(html.includes("try-turnstile"), "a configured gate renders the turnstile widget");
const openGate = renderToStaticMarkup(
  createElement(TryScreen, { phase: "gate", siteKey: null, turnstile: false }),
);
assert(!openGate.includes("try-turnstile"), "unset turnstile does not render the widget");
assert(!openGate.includes("cf-turnstile"), "unset turnstile does not load the widget script");
assert(!openGate.includes("disabled"), "the gate button stays enabled without turnstile");
assert(openGate.includes('name="milon_leave_blank"'), "the gate includes the honeypot");
assert(openGate.includes('tabindex="-1"'), "the honeypot is skipped by keyboard");
assert(openGate.includes("Show the score"), "the gate still submits");
assert(openGate.includes('id="try-gate-name"'), "the name field has a stable id");
assert(openGate.includes('id="try-gate-email"'), "the email field has a stable id");
assert(openGate.includes("section-try-gate name"), "the name field is its own autofill section");
assert(openGate.includes("section-try-gate email"), "the email field is its own autofill section");
assert(!/autoFocus|autofocus/.test(openGate), "the gate does not autofocus a field");
assert(html.includes("try-ring"), "the reveal draws a health ring");
assert(
  html.includes("The ratios below are what the Analyst reads."),
  "the reveal points at the ratios",
);
assert(html.includes("SAMPLE"), "the board is SAMPLE-stamped");
assert(boardsHtml.includes("$1,150,000"), "US profitability is in dollars");
assert(boardsHtml.includes("Profitability waterfall"), "profit chip renders the waterfall");
assert(
  boardsHtml.includes("Amount") && boardsHtml.includes("Percentage"),
  "profit chip has the amount and percentage toggle",
);
assert(
  boardsHtml.includes("Show figures as amounts or as percentages of revenue"),
  "the toggle is the owner profit control",
);
assert(
  boardsHtml.includes("Enlarge cash flow graph"),
  "chart lens keeps the graph enlarge control",
);
assert(
  boardsHtml.includes('aria-label="Enlarge cash flow graph"'),
  "the shared forecast still has its graph enlarge control",
);
assert(
  !boardsHtml.includes('aria-label="Enlarge cash flow table"'),
  "chart lens does not also show the table enlarge",
);
const tryStyles = readFileSync(join(resolve("."), "src/styles/try.css"), "utf8");
assert(
  tryStyles.includes('[aria-label="Enlarge cash flow table"]') &&
    tryStyles.includes("display: none"),
  "the sample hides the stray Enlarge row above the forecast table",
);
assert(
  !tryStyles.includes("Enlarge cash flow graph"),
  "the sample does not hide the graph enlarge control",
);
assert(boardsHtml.includes("13-week cash model"), "cash chip renders the 13-week table");
assert(
  boardsHtml.includes("Opens at the sample bank balance on file."),
  "cash chip says the forecast opens at the sample bank balance",
);
assert(!boardsHtml.includes("Export PDF"), "sample chips have no export control");
assert(!boardsHtml.includes("Upload bank statements"), "sample chips have no upload control");
assert(!boardsHtml.includes("Forecast Setup"), "sample chips have no forecast setup");
assert(
  !boardsHtml.includes("R 1,150,000") && !boardsHtml.includes("R1,150,000"),
  "US chips are not in rand",
);
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
assert(html.includes("The MILŌN Team"), "the page signs The MILŌN Team");
assert(html.includes("muted"), "avatar clips are muted");
assert(!html.includes("<audio"), "the page has no audio element");

// ── The Financial Manager conversation after the reveal ────────────────
assert(TRIAL_SIGNUP_HREF === firmSignupHref("starter"), "the trial CTA opens Starter monthly");
assert(!TRIAL_SIGNUP_HREF.includes("plan=solo"), "the trial CTA is not Solo");
assert(
  TRIAL_SIGNUP_SENTENCE ===
    `14-day free trial · up to ${FIRM_BAND_CATALOG.starter.clientLimit} clients`,
  "the trial sentence uses Starter's catalog client limit",
);
assert(
  trialSignupHref("?utm_source=email&utm_campaign=qa&plan=solo") ===
    "/auth?signup=true&plan=starter&interval=month&utm_source=email&utm_campaign=qa",
  "the trial CTA keeps utm params and stays on Starter",
);
assert(trialMarketForVisitor("US", "ZA") === "US", "a US visitor stays on the dollar sample");
assert(trialMarketForVisitor("US", "us") === "US", "a US visitor with ?market=us stays on dollars");
assert(trialMarketForVisitor("ZA", null) === "ZA", "a ZA visitor without ?market= stays on rand");
assert(
  trialMarketForVisitor("ZA", "us") === "US",
  "?market=us opens the US sample for a ZA visitor",
);
assert(
  trialMarketForVisitor("ZA", "US") === "US",
  "?market=US opens the US sample for a ZA visitor",
);
assert(
  trialMarketForVisitor("ZA", "country") === "ZA",
  "?country= and ?region= are not a market override",
);

const talk = renderToStaticMarkup(
  createElement(TryScreen, { phase: "findings", board: us, findings, picks: [] }),
);
assert(talk.includes(esc(SAMPLE_BUSINESS_NAME)), "the FM names the sample business");
assert(talk.includes("sign-off"), "the FM bubble offers the work for sign-off");
assert(
  talk.includes("Profit report") &&
    talk.includes("Cash forecast") &&
    talk.includes("Advisory pack"),
  "the FM offers all three replies",
);
assert(talk.includes("fm-idle"), "the FM portrait uses the idle clip");
assert(!talk.includes("<audio"), "the FM stays silent — no audio element");
assert(
  talk.includes("Financial Manager") && talk.includes("Analyst") && talk.includes("Advisor"),
  "the three-agent team is named",
);
assert(talk.includes(TRIAL_CTA_LABEL), "the trial CTA is on the page");
assert(talk.includes(esc(TRIAL_SIGNUP_HREF)), "the trial CTA links to the signup route");
assert(talk.includes(esc(TRIAL_SIGNUP_SENTENCE)), "the trial terms are stated");
assert(talk.includes("try-ctabar"), "the trial CTA bar is persistent");
assert(
  renderToStaticMarkup(createElement(TryScreen, { phase: "start" })).includes("try-ctabar"),
  "the trial bar is on the start screen too",
);
const goldCtas = talk.match(/class="try-cta[ "]/g) ?? [];
assert(goldCtas.length === 2, "gold is only the two trial CTAs (bar and conversation)");

const profitTalk = renderToStaticMarkup(
  createElement(TryScreen, { phase: "findings", board: us, findings, picks: ["profit"] }),
);
assert(profitTalk.includes("Show me the profit report."), "the pick becomes a user message");
assert(profitTalk.includes("profit bridge"), "the FM answers the profit pick");
assert(
  profitTalk.includes("Cash forecast") && profitTalk.includes("Advisory pack"),
  "the remaining options are offered again",
);
assert(
  profitTalk.includes("Want the cash forecast or the advisory pack next?"),
  "the FM offers the remaining options by name",
);

const advisoryTalk = renderToStaticMarkup(
  createElement(TryScreen, { phase: "findings", board: us, findings, picks: ["advisory"] }),
);
assert(
  advisoryTalk.includes("SAMPLE") && advisoryTalk.includes(esc(SAMPLE_BUSINESS_NAME)),
  "the advisory pack names the sample company",
);
assert(advisoryTalk.includes("Advisory pack"), "the advisory pack has its title");
assert(advisoryTalk.includes("Download PDF"), "the advisory pack offers a PDF download");
assert(
  advisoryTalk.includes('aria-label="Download sample advisory pack"'),
  "the download names the sample pack",
);
assert(!advisoryTalk.includes("Coming soon"), "the advisory pack does not say coming soon");
assert(advisoryTalk.includes("Sign off"), "the advisory pack has a Sign off button");
assert(advisoryTalk.includes("try-signoff-arrow"), "a hand-drawn arrow points at Sign off");
assert(
  !advisoryTalk.includes("Preparing your advisory pack"),
  "the sample pack replaces the preparing state",
);
assert(
  !advisoryTalk.includes("Profitability waterfall") && !advisoryTalk.includes("13-week cash model"),
  "the sample pack does not fake the other reports",
);
assert(!advisoryTalk.includes("ZAR") && !/rand /.test(advisoryTalk), "the US pack has no rand");
assert(
  advisoryTalk.includes("Want the profit report or the cash forecast next?"),
  "advisory still re-offers the real reports",
);
assert(
  advisoryTalk.includes("sample supply and distribution business"),
  "the pack describes a supply business",
);
assert(
  !advisoryTalk.includes("sample services business"),
  "the pack does not call it a services business",
);
assert(advisoryTalk.includes("Cut or reprice one operating cost"), "the margin move is an action");
assert(
  !advisoryTalk.includes("The gap is the cost of running the business."),
  "the margin line is no longer only an observation",
);
assert(
  advisoryTalk.includes("try-cta-quiet"),
  "the in-conversation trial link is not the gold primary",
);
assert(advisoryTalk.includes("try-ctabar-btn"), "the sticky trial link stays");
assert(
  advisoryTalk.includes("Not reviewed by an accountant") &&
    !advisoryTalk.includes("Signed off by you"),
  "an unsigned pack does not claim a sign-off",
);
const signedPack = renderToStaticMarkup(createElement(TrySamplePack, { board: us, signed: true }));
assert(
  signedPack.includes("Signed off by you · sample, not reviewed by an accountant"),
  "a signed pack says who signed and that an accountant has not",
);
assert(!signedPack.includes("Approved by you"), "a signed pack has no approval stamp");
const cashTalk = renderToStaticMarkup(
  createElement(TryScreen, { phase: "findings", board: us, findings, picks: ["cash"] }),
);
assert(
  cashTalk.includes("Opens at the sample bank balance on file."),
  "the cash copy names the sample bank balance",
);
assert(
  !cashTalk.includes("Opening cash stays the balance on file"),
  "the cash copy does not use the old opening line",
);
assert(
  !cashTalk.includes("opens at zero") && !cashTalk.includes("no bank balance"),
  "cash copy does not open at zero",
);
const tryCss = readFileSync(join(resolve("."), "src/styles/try.css"), "utf8");
assert(!tryCss.includes("min(1100px"), "opening a report does not widen the column");
assert(tryCss.includes("#0b5fff") && tryCss.includes(".try-signoff-btn"), "Sign off is cobalt");
const signoffRule = tryCss.slice(
  tryCss.indexOf(".try-signoff-btn {"),
  tryCss.indexOf(".try-signoff-btn:disabled"),
);
assert(
  !signoffRule.includes("#d4af37") && signoffRule.includes("#0b5fff"),
  "the Sign off button is not gold",
);

const doneTalk = renderToStaticMarkup(
  createElement(TryScreen, {
    phase: "findings",
    board: us,
    findings,
    picks: ["profit", "cash", "advisory"],
  }),
);
assert(!doneTalk.includes("try-reply"), "no replies remain once all three are picked");
assert(doneTalk.includes(TRIAL_CTA_LABEL), "the conversation ends on the trial CTA");
assert(!/whatsapp/i.test(html), "no WhatsApp");
assert(
  !html.includes("/api/xero") && !html.includes("/api/qbo") && !html.includes("/api/sage"),
  "HTML does not call a ledger",
);

const root = resolve(".");
const seeds = [
  "src/routes/try.tsx",
  "src/components/try-demo.tsx",
  "src/components/try-sample-boards.tsx",
  "src/lib/trial-demo.ts",
  "src/lib/trial-demo.functions.ts",
  "src/lib/trial-analyst.ts",
  "src/lib/trial-public.ts",
];

const demoSource = readFileSync(join(root, "src/components/try-demo.tsx"), "utf8");
assert(
  demoSource.includes('import("@/components/try-sample-boards")'),
  "chips load the real sample boards",
);
assert(
  !/from\s+["']@\/components\/cash-forecast["']/.test(demoSource),
  "try-demo does not statically import the cash forecast",
);
assert(
  !/from\s+["']@\/components\/profitability-waterfall["']/.test(demoSource),
  "try-demo does not statically import the waterfall",
);
assert(
  demoSource.includes("readRequestedMarket"),
  "the page sends ?market= when the sample starts",
);
assert(
  readFileSync(join(root, "src/lib/trial-demo.functions.ts"), "utf8").includes(
    "trialMarketForVisitor",
  ),
  "starting the sample uses the landing market override",
);

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

const gateSource = readFileSync(join(root, "src/components/try-demo.tsx"), "utf8");
const scheduleSource = readFileSync(join(root, "src/components/try-schedule.tsx"), "utf8");
assert(
  gateSource.indexOf("function SampleGateForm") !== -1 &&
    gateSource.indexOf("function SampleGateForm") < gateSource.indexOf("export function TryScreen"),
  "the sample gate form is a stable component, not declared inside render",
);
assert(
  !gateSource.includes("autoFocus") && !gateSource.includes(".focus("),
  "the sample gate does not move focus",
);
assert(
  !scheduleSource.includes("autoFocus") && !scheduleSource.includes(".focus("),
  "the call form does not move focus",
);

const { Window } = await import("happy-dom");
const view = new Window({
  url: "http://127.0.0.1:5000/try?market=us",
  width: 1280,
  height: 800,
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "Element",
  "Node",
  "Document",
  "Event",
  "InputEvent",
  "MouseEvent",
  "FocusEvent",
  "KeyboardEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "MutationObserver",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: view[key],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

const { useState: useGateState, useLayoutEffect, createElement: h } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { TryScreen: GateScreen } = await import("../src/components/try-demo");

let flipGate: () => void = () => {};
function GateHost() {
  const [error, setError] = useGateState<string | null>(null);
  const [siteKey, setSiteKey] = useGateState<string | null>(null);
  useLayoutEffect(() => {
    document.getElementById("try-gate-name")?.focus();
  }, []);
  flipGate = () => {
    setError("Try again.");
    setSiteKey("site-key");
  };
  return h(GateScreen, {
    phase: "gate",
    error,
    siteKey,
    turnstile: true,
    onSubmitGate: () => {},
  });
}

const mount = document.createElement("div");
document.body.appendChild(mount);
const gateRoot = createRoot(mount);
await act(async () => {
  gateRoot.render(h(GateHost));
});

const gateName = document.getElementById("try-gate-name") as HTMLInputElement | null;
const gateEmail = document.getElementById("try-gate-email") as HTMLInputElement | null;
assert(
  gateName instanceof HTMLInputElement && gateEmail instanceof HTMLInputElement,
  "gate fields mounted",
);
assert(document.activeElement === gateName, "mounting the call slots left the name field focused");

const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
assert(typeof valueSetter === "function", "input value setter exists");
let typed = "";
for (const ch of "Sam QAAMste") {
  assert(
    document.activeElement === gateName,
    `focus left the name field before ${JSON.stringify(ch)}`,
  );
  typed += ch;
  await act(async () => {
    valueSetter!.call(gateName, typed);
    gateName!.dispatchEvent(
      new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }),
    );
  });
  if (typed === "Sam ") {
    await act(async () => {
      flipGate();
    });
    assert(
      document.body.textContent?.includes("Try again."),
      "a parent update re-rendered the gate",
    );
    assert(
      document.querySelector(".try-turnstile"),
      "the turnstile slot can mount without taking the field",
    );
  }
  assert(document.activeElement === gateName, `focus left the name field on ${JSON.stringify(ch)}`);
  assert(gateName!.value === typed, `name field is ${JSON.stringify(gateName!.value)}`);
  assert(gateEmail!.value === "", `email field received ${JSON.stringify(gateEmail!.value)}`);
}

await act(async () => {
  gateRoot.unmount();
});

const chipSrc = readFileSync(resolve("src/lib/trial-demo.functions.ts"), "utf8");
assert(!chipSrc.includes("Coming soon"), "the sample chip handler does not say coming soon");
assert(chipSrc.includes('chip === "advisory"'), "the advisory chip is a real sample pack");

const packNow = new Date("2026-10-14T00:00:00Z");
const { trialSamplePackPdfInput } = await import("../src/lib/trial-sample-pack-pdf");
const pdfInput = trialSamplePackPdfInput(us, { now: packNow });
const packReading = trialReading(us, packNow);
assert(pdfInput.filename.endsWith(".pdf"), "the sample pack downloads as a pdf");
assert(pdfInput.clientName.includes("Harbor"), "the pdf names the sample company");
assert(
  pdfInput.sections.some((section) => section.title === "Cash"),
  "the pdf includes cash",
);
assert(
  pdfInput.sections.some((section) => section.body.includes(packReading.cashOpening)),
  "cash opening matches the demo",
);
assert(
  pdfInput.sections.some((section) =>
    (section.bullets ?? []).some((bullet) => bullet.includes(packReading.grossMargin)),
  ),
  "gross margin matches the demo",
);
assert(
  pdfInput.sections.some((section) => section.title === "Moves"),
  "the pdf includes the next moves",
);
assert(
  !pdfInput.disclosure.toLowerCase().includes("coming soon"),
  "the disclosure is a real sentence",
);
assert(
  pdfInput.period.includes(String(Math.round(us.health.score!))),
  "the pdf period carries the health score",
);

const { renderToBuffer } = await import("@react-pdf/renderer");
const { AdvisoryPackPDF } = await import("../src/reports/advisory-pack");
const { extractText, getDocumentProxy } = await import("unpdf");
const pdfBuf = await renderToBuffer(
  createElement(AdvisoryPackPDF, {
    smeData: { name: pdfInput.clientName, period: pdfInput.period },
    accountantProfile: pdfInput.profile,
    sections: pdfInput.sections,
    draftDisclosure: pdfInput.disclosure,
    sample: true,
    market: pdfInput.market,
  }),
);
assert(pdfBuf.length > 1000, "the sample advisory pdf rendered");
const pdfDoc = await getDocumentProxy(new Uint8Array(pdfBuf));
let pdfText = "";
try {
  const extracted = await extractText(pdfDoc, { mergePages: true });
  pdfText = Array.isArray(extracted.text)
    ? extracted.text.join("\n")
    : String(extracted.text ?? "");
} finally {
  await pdfDoc.destroy();
}
assert(pdfText.includes("Harbor"), "the pdf bytes name the sample company");
assert(pdfText.includes(packReading.cashOpening), "the pdf bytes include opening cash");
assert(pdfText.includes(packReading.cashLow), "the pdf bytes include the cash low");
assert(pdfText.includes(packReading.grossMargin), "the pdf bytes include gross margin");
assert(/cut or reprice one operating cost/i.test(pdfText), "the pdf bytes include a next move");
assert(pdfText.includes("SAMPLE"), "the pdf is stamped SAMPLE");
assert(!/coming soon/i.test(pdfText), "the pdf does not say coming soon");
assert(
  !pdfText.includes("Draft for accountant review"),
  "the sample pdf is not an accountant draft",
);

console.log(`trial-demo: ok (${seen.size} files in the try graph)`);
