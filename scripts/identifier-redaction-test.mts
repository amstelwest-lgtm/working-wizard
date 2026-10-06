/**
 * Identifiers are stripped from every model prompt, and the client name is
 * put back into model output.
 * Run: pnpm test:identifier-redaction
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildAdvisoryModelPayload } from "../src/lib/advisory-draft-prompt";
import { workflowPrompt, type WorkflowContext } from "../src/lib/client-briefing";
import { inviteDraftPrompt } from "../src/lib/market/prompt";
import { ZA_MARKET } from "../src/lib/market";
import {
  sealedCacheAnswer,
  cacheHitIsDisplaySafe,
  redactForModel,
  redactStatementText,
  redactStructured,
  redactTextParts,
  rehydrateClientName,
  rehydrateForUi,
  rehydrateModelOutput,
} from "../src/lib/redact-identifiers";
import {
  buildOverviewBrief,
  formatOverviewForPrompt,
  overviewFactLines,
} from "../supabase/functions/ask-ai/overview-brief.ts";
import { classify } from "../supabase/functions/ask-ai/classifier.ts";
import { buildPrompt, sealAskAiPrompt } from "../supabase/functions/ask-ai/prompt.ts";
import type { AskAiContext } from "../supabase/functions/ask-ai/types.ts";
import { systemPromptFor } from "../supabase/functions/brain-propose/logic.ts";
import { buildBrainProposePayload } from "../supabase/functions/brain-propose/prompt.ts";
import { buildDeliverableDraftPayload } from "../supabase/functions/brain-deliverable-draft/prompt.ts";
import { buildTextExtractionPayload } from "../supabase/functions/extract-financials/prompt.ts";
import {
  buildAgentTurnPayload,
  buildMilonBotChatPayload,
  redactToolResult,
} from "../supabase/functions/milon-bot/prompt.ts";
import { createRedactionSession } from "../supabase/functions/_shared/redact-identifiers.ts";
import { BOT_SYSTEM } from "../supabase/functions/milon-bot/logic.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const CLIENT = "Harbour & Co (Pty) Ltd";
const EMAIL = "owner@harbour.example";
const TAX = "4123456789";
const EIN = "12-3456789";
const PERSON = "Jane Molefe";
const AMOUNT = "184320.50";
const GROUPED = "1,250,000.00";
const PHONE = "+27 82 555 0199";

function leaked(payload: string, label: string) {
  assert(!payload.includes("Harbour"), `${label} still has the client name`);
  assert(!payload.includes(EMAIL), `${label} still has the email`);
  assert(!payload.includes(TAX), `${label} still has the VAT number`);
  assert(!payload.includes(EIN), `${label} still has the EIN`);
  assert(!payload.includes(PERSON), `${label} still has the contact name`);
  assert(!payload.includes("555 0199"), `${label} still has the phone`);
  assert(payload.includes(AMOUNT), `${label} dropped the amount`);
  assert(payload.includes(GROUPED), `${label} dropped the grouped amount`);
  assert(payload.includes("Trade receivables"), `${label} dropped the account category`);
  assert(payload.includes("Debtor Days: 45"), `${label} dropped the ratio`);
  assert(payload.includes("2024-03-31"), `${label} dropped the date`);
  assert(payload.includes("[CLIENT]"), `${label} did not mark the client`);
}

const fixture = [
  `Client: ${CLIENT}`,
  `Owner ${PERSON} <${EMAIL}> phone ${PHONE}`,
  `VAT ${TAX} EIN ${EIN}`,
  `Account number: 123456789012`,
  `Trade receivables ${AMOUNT}`,
  `Revenue ${GROUPED}`,
  `Debtor Days: 45`,
  `Period end 2024-03-31`,
  `${CLIENT}'s debtor book and Harbour & Co Pty Ltd`,
].join("\n");

const subject = {
  clientName: CLIENT,
  partyNames: [PERSON, "West & Co"],
  emails: [EMAIL],
  taxIds: [TAX, EIN],
  phones: [PHONE],
  accountNumbers: ["123456789012"],
};

// ── helper ──────────────────────────────────────────────────────────────────
const sealed = redactForModel(fixture, subject);
leaked(sealed.text, "helper");
assert(sealed.text.includes("team@trymilon.com") === false, "fixture had no product mailbox");
assert(
  redactForModel("From team@trymilon.com and hello@milonfinance.com", subject).text.includes(
    "team@trymilon.com",
  ),
  "product mailboxes stay in the prompt",
);
assert(
  rehydrateClientName("Review [CLIENT] before send.", CLIENT) === `Review ${CLIENT} before send.`,
  "client token is replaced with the real name",
);
const restored = rehydrateModelOutput('{"body":"Review [CLIENT] with [PERSON_1]."}', sealed.session);
assert(restored.includes(CLIENT), "JSON output puts the client name back");
assert(restored.includes(PERSON), "JSON output puts the contact name back");
assert(!restored.includes("[CLIENT]"), "JSON output does not leave the client token");

const parts = redactTextParts(
  [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: "UE9G" } },
    { type: "text", text: fixture },
  ],
  subject,
);
assert(parts.parts[0]?.source?.data === "UE9G", "PDF bytes are not rewritten");
leaked(parts.parts[1]?.text ?? "", "text part");

// ── ask-ai ──────────────────────────────────────────────────────────────────
const askCtx = {
  clientName: CLIENT,
  profile: null,
  profileQuestions: [],
  scores: null,
  ratios: [],
  playbook: [],
  copyPack: "za",
  waterfall: null,
  cashForecast: null,
  productLines: [],
  nextSteps: [],
  actionPlan: null,
  deliverables: [],
} satisfies AskAiContext;
const askBuilt = buildPrompt(
  `How is ${CLIENT} doing? ${EMAIL} VAT ${TAX} revenue ${AMOUNT}`,
  askCtx,
  "summary",
  "accountant",
);
const askSealed = sealAskAiPrompt(askBuilt, { clientName: CLIENT, emails: [EMAIL], taxIds: [TAX] });
assert(!askSealed.user.includes("Harbour"), "ask-ai user prompt still has the client");
assert(!askSealed.user.includes(EMAIL), "ask-ai user prompt still has the email");
assert(!askSealed.user.includes(TAX), "ask-ai user prompt still has the VAT number");
assert(askSealed.user.includes(AMOUNT), "ask-ai user prompt dropped the amount");
assert(/Do NOT reference company names/.test(askSealed.system), "ask-ai system rules survived");
assert(
  rehydrateClientName(askSealed.user, CLIENT).includes(CLIENT) === false ||
    rehydrateModelOutput("Draft for [CLIENT]", askSealed.session).includes(CLIENT),
  "ask-ai output rehydration works",
);

const overview = buildOverviewBrief({
  financials: {
    equity: 90000,
    totalAssets: 250000,
    totalLiabilities: 160000,
    revenue: 200000,
    cogs: 80000,
  },
  copyPack: "us",
  clientName: CLIENT,
  brainSummary: {
    headline: `${CLIENT} contact ${PERSON} <${EMAIL}> VAT ${TAX}. Equity is not a name.`,
  },
});
const overviewText = formatOverviewForPrompt(overview, "accountant");
assert(overviewText.includes("Total equity: $90,000"), "overview emits total equity");
assert(overviewText.includes("Total assets: $250,000"), "overview emits total assets");
assert(overviewText.includes("Total liabilities: $160,000"), "overview emits total liabilities");
assert(overviewText.includes(CLIENT), "brain headline still names the client before sealing");
const askOverview = sealAskAiPrompt(
  buildPrompt(
    "How healthy is this client?",
    { ...askCtx, overview, copyPack: "us" },
    "summary",
    "accountant",
  ),
  { clientName: CLIENT, partyNames: [PERSON], emails: [EMAIL], taxIds: [TAX] },
);
const overviewPayload = `${askOverview.system}\n${askOverview.user}`;
assert(!overviewPayload.includes("Harbour"), "overview prompt still has the client");
assert(!overviewPayload.includes(EMAIL), "overview prompt still has the email");
assert(!overviewPayload.includes(TAX), "overview prompt still has the VAT number");
assert(!overviewPayload.includes(PERSON), "overview prompt still has the contact");
assert(overviewPayload.includes("Total equity: $90,000"), "redaction dropped total equity");
assert(overviewPayload.includes("Total assets: $250,000"), "redaction dropped total assets");
assert(overviewPayload.includes("Total liabilities: $160,000"), "redaction dropped total liabilities");
assert(overviewPayload.includes("[CLIENT]"), "overview prompt did not mark the client");

const zaOverview = buildOverviewBrief({
  financials: { equity: 90000, totalAssets: 1250000, totalLiabilities: 184320 },
  copyPack: "za",
  clientName: CLIENT,
  brainSummary: { headline: `${CLIENT}'s balance sheet` },
});
const zaSealed = redactForModel(formatOverviewForPrompt(zaOverview, "owner"), {
  clientName: CLIENT,
});
assert(!zaSealed.text.includes("Harbour"), "ZA overview still has the client");
assert(zaSealed.text.includes("Total equity: R90,000"), "redaction dropped the rand equity");
assert(zaSealed.text.includes("Total assets: R1,250,000"), "redaction dropped the rand assets");
assert(zaSealed.text.includes("Total liabilities: R184,320"), "redaction dropped the rand liabilities");

const botOverview = buildMilonBotChatPayload({
  system: "You help with this client. Debtor Days stay numeric.",
  overviewBlock: overviewText,
  history: [],
  message: `What is total equity? Debtor Days: 45. Trade receivables ${AMOUNT}. Period 2024-03-31.`,
  audience: "accountant",
  subject: { clientName: CLIENT, partyNames: [PERSON], emails: [EMAIL], taxIds: [TAX] },
});
const botOverviewPayload = `${botOverview.system}\n${botOverview.messages.map((turn) => turn.content).join("\n")}`;
assert(!botOverviewPayload.includes("Harbour"), "milon-bot overview still has the client");
assert(!botOverviewPayload.includes(EMAIL), "milon-bot overview still has the email");
assert(botOverviewPayload.includes("Total equity: $90,000"), "milon-bot overview dropped total equity");
assert(botOverviewPayload.includes("Total assets: $250,000"), "milon-bot overview dropped total assets");
assert(botOverviewPayload.includes("Total liabilities: $160,000"), "milon-bot overview dropped total liabilities");
assert(botOverviewPayload.includes(AMOUNT), "milon-bot overview dropped the amount");

const overviewTool = redactToolResult(
  { overview_lines: overviewFactLines(overview), name: CLIENT },
  createRedactionSession({ clientName: CLIENT }),
);
assert(!overviewTool.includes("Harbour"), "overview tool result still has the client");
assert(overviewTool.includes("Total equity: $90,000"), "overview tool result dropped total equity");
assert(overviewTool.includes("Total assets: $250,000"), "overview tool result dropped total assets");
assert(overviewTool.includes("Total liabilities: $160,000"), "overview tool result dropped total liabilities");

// ── brain-propose ───────────────────────────────────────────────────────────
const propose = buildBrainProposePayload({
  system: systemPromptFor("accountant"),
  contextLines: [fixture, "Open step: chase debtors"],
  subject,
});
leaked(`${propose.system}\n${propose.user}`, "brain-propose");
assert(/valid JSON/i.test(propose.system), "brain-propose system prompt survived");
assert(
  rehydrateModelOutput('{"next_steps":[{"title":"Call [CLIENT]"}]}', propose.session).includes(CLIENT),
  "brain-propose output rehydration works",
);

// ── brain-deliverable-draft ─────────────────────────────────────────────────
const draft = buildDeliverableDraftPayload({
  system: "Return ONLY valid JSON. Draft for accountant review.",
  contextLines: [fixture],
  subject,
});
leaked(draft.user, "brain-deliverable-draft");
assert(
  rehydrateModelOutput('{"body":"Note for [CLIENT]"}', draft.session).includes(CLIENT),
  "deliverable output rehydration works",
);

// ── extract-financials text/CSV ─────────────────────────────────────────────
const extracted = buildTextExtractionPayload({
  instructions: "Extract revenue. Keep Trade receivables. Return JSON only.",
  fileName: `${CLIENT} - TB.csv`,
  text: fixture,
  subject,
});
leaked(extracted.text, "extract-financials text");
assert(!extracted.text.includes("TB.csv") || !extracted.text.includes("Harbour"), "file name was redacted");
assert(
  rehydrateClientName('{"entity_name":"[CLIENT]"}', CLIENT).includes(CLIENT),
  "extraction output rehydration works",
);

// ── milon-bot chat, history, tool results ───────────────────────────────────
const bot = buildMilonBotChatPayload({
  system: "You help with this client. Debtor Days stay numeric.",
  overviewBlock: `Brain headline: ${CLIENT} owes ${AMOUNT}`,
  history: [
    { role: "user", content: `Email ${EMAIL} about ${CLIENT}` },
    { role: "assistant", content: `VAT on file is ${TAX}` },
  ],
  message: `Call ${PERSON} on ${PHONE}. Revenue ${GROUPED}. Debtor Days: 45. Trade receivables ${AMOUNT}. Period 2024-03-31. EIN ${EIN}`,
  audience: "accountant",
  subject,
});
leaked(`${bot.system}\n${bot.messages.map((turn) => turn.content).join("\n")}`, "milon-bot chat");
const toolSession = createRedactionSession(subject);
const toolPayload = redactToolResult(
  {
    name: CLIENT,
    email: EMAIL,
    revenue: 184320.5,
    people: [{ name: PERSON, role: "owner" }],
    ratios: { "Debtor Days": 45 },
    note: `Trade receivables ${AMOUNT} on 2024-03-31`,
  },
  toolSession,
);
assert(!toolPayload.includes("Harbour"), "tool result still has the client");
assert(!toolPayload.includes(EMAIL), "tool result still has the email");
assert(!toolPayload.includes(PERSON), "tool result still has the contact");
assert(toolPayload.includes("184320.5"), "tool result dropped the numeric amount");
assert(toolPayload.includes(AMOUNT), "tool result dropped the amount in the note");
const agent = buildAgentTurnPayload({
  system: "Read the client. Do not invent figures.",
  overviewBlock: fixture,
  user: `Objective: email ${EMAIL} at ${CLIENT} about Debtor Days: 45 and ${AMOUNT}`,
  subject,
});
leaked(`${agent.system}\n${agent.user}`, "milon-bot agent turn");

// ── advisory + briefing + invite + statement text ───────────────────────────
const advisory = buildAdvisoryModelPayload({
  kind: "client_email",
  accountantName: PERSON,
  firmName: "West & Co",
  clientName: CLIENT,
  businessType: "retail",
  operatingContext: "Customers pay in 30 days",
  periodLabel: "Mar 2026",
  hasPrior: true,
  priorPeriodLabel: "Feb 2026",
  runwayLabel: "8 weeks",
  movementLines: [`Cash · Debtor Days: 45 → 50`, `Profit · revenue ${AMOUNT}`],
  signoffLines: [`Debtor Days (signed off by ${PERSON})`],
  partyNames: [PERSON],
});
assert(!`${advisory.system}\n${advisory.user}`.includes("Harbour"), "advisory prompt still has the client");
assert(!advisory.user.includes(PERSON), "advisory prompt still has the accountant");
assert(advisory.user.includes(AMOUNT), "advisory prompt dropped the amount");
assert(advisory.user.includes("Debtor Days"), "advisory prompt dropped the ratio name");
assert(
  rehydrateModelOutput("SUBJECT: [CLIENT] update", advisory.session).includes(CLIENT),
  "advisory output rehydration works",
);

const briefing = workflowPrompt({
  clientName: CLIENT,
  profile: null,
  businessType: "retail",
  healthScore: 72,
  healthLabel: "Healthy",
  snapshot: [
    { key: "revenue", label: "Revenue", value: `R ${GROUPED}` },
    { key: "gm", label: "Gross margin", value: "62.5%" },
  ],
  chips: [],
  cashRunwayWeeks: 8,
  whatMatters: `${CLIENT} revenue ${AMOUNT}. Email ${EMAIL}. VAT ${TAX}. Debtor Days: 45. Trade receivables.`,
} satisfies WorkflowContext);
assert(!briefing.includes("Harbour"), "briefing prompt still has the client");
assert(!briefing.includes(EMAIL), "briefing prompt still has the email");
assert(!briefing.includes(TAX), "briefing prompt still has the VAT number");
assert(briefing.includes(AMOUNT), "briefing prompt dropped the amount");
assert(briefing.includes("62.5%"), "briefing prompt dropped the margin");
assert(
  rehydrateClientName(briefing, CLIENT).includes(CLIENT),
  "briefing output rehydration works",
);

const invite = redactForModel(
  inviteDraftPrompt(ZA_MARKET, {
    clientName: CLIENT,
    clientCode: "MLN-AB12CD",
    inviteUrl: "https://milon.co.za/?invite=abc123",
    firmName: "West & Co",
    accountantName: PERSON,
  }),
  { clientName: CLIENT, partyNames: ["West & Co", PERSON], emails: [EMAIL] },
);
assert(!invite.text.includes("Harbour"), "invite prompt still has the client");
assert(!invite.text.includes(PERSON), "invite prompt still has the accountant");
assert(invite.text.includes("https://milon.co.za/?invite=abc123"), "invite URL stays exact");
assert(invite.text.includes("MLN-AB12CD"), "client code stays");
assert(
  rehydrateModelOutput('{"subject":"[CLIENT]","body":"Hi"}', invite.session).includes(CLIENT),
  "invite output rehydration works",
);

const statement = redactStatementText({
  preamble: "Parse this CSV. Keep category names.",
  fileName: `${CLIENT}.csv`,
  accountLabel: "Cheque",
  body: fixture,
  subject,
});
leaked(statement.text, "statement text");
assert(statement.text.includes("Cheque"), "account label stays");

const structured = redactStructured(
  { company_name: CLIENT, category: "Trade receivables", amount: 184320.5 },
  createRedactionSession({ clientName: CLIENT }),
);
assert(structured.company_name === "[CLIENT]", "structured company name is a placeholder");
assert(structured.category === "Trade receivables", "structured category stays");
assert(structured.amount === 184320.5, "structured amount stays a number");

const extractSrc = readFileSync(resolve("supabase/functions/extract-financials/index.ts"), "utf8");
const layerSrc = readFileSync(resolve("src/lib/statement-text-layer.ts"), "utf8");
assert(extractSrc.includes("statementModelParts"), "extract-financials chooses text or the original PDF");
assert(extractSrc.includes("buildTextExtractionPayload"), "text extraction goes through the redactor");
assert(layerSrc.includes('type: "document"'), "a weak text layer still sends the original document");
assert(layerSrc.includes("data: document.base64"), "document fallback keeps the original bytes");

// ── client name comes back in the UI, not in the outbound prompt ───────────
const QA_NAMES = ["QA US Test LLC", "QA US Test LLC (delete me)", "New York Yankees"] as const;
const qaQuestion = "What is this client's name and total equity?";

assert(classify("What is a gross margin?") === "none", "definitional questions stay uncached-client");
assert(classify("What is the client's name?") !== "none", "client-name questions are not shared-cache tier");
assert(classify(qaQuestion) !== "none", "name-and-equity question is not tier none");
assert(classify("What is this client's name?") !== "none", "this client's name is not tier none");

for (const qaName of QA_NAMES) {
  const qaBrief = buildOverviewBrief({
    financials: { equity: 150000, totalAssets: 400000, totalLiabilities: 250000 },
    copyPack: "us",
    clientName: qaName,
  });
  const workingOverview = formatOverviewForPrompt(qaBrief, "accountant");
  assert(workingOverview.includes(qaName), `${qaName} is in the working overview`);
  assert(workingOverview.includes("Total equity: $150,000"), `${qaName} overview dropped equity`);
  assert(workingOverview.includes("Total assets: $400,000"), `${qaName} overview dropped assets`);
  assert(workingOverview.includes("Total liabilities: $250,000"), `${qaName} overview dropped liabilities`);

  const qaBot = buildMilonBotChatPayload({
    system: BOT_SYSTEM,
    overviewBlock: workingOverview,
    history: [{ role: "assistant", content: `The client is ${qaName}.` }],
    message: qaQuestion,
    audience: "accountant",
    subject: { clientName: qaName },
  });
  const outbound = `${qaBot.system}\n${qaBot.messages.map((turn) => turn.content).join("\n")}`;
  assert(!outbound.includes(qaName), `milon-bot outbound still has ${qaName}`);
  assert(outbound.includes("[CLIENT]"), `milon-bot outbound did not mark ${qaName}`);
  assert(outbound.includes("CLIENT IDENTITY"), `milon-bot outbound did not label ${qaName}`);
  assert(outbound.includes("Total equity: $150,000"), `milon-bot outbound dropped equity for ${qaName}`);
  assert(outbound.includes("Total assets: $400,000"), `milon-bot outbound dropped assets for ${qaName}`);
  assert(outbound.includes("Total liabilities: $250,000"), `milon-bot outbound dropped liabilities for ${qaName}`);
  assert(qaBot.workingContext.includes(qaName), `working context lost ${qaName}`);
  assert(!qaBot.workingContext.includes("[CLIENT]"), `working context still has the client token for ${qaName}`);

  const echoed = rehydrateForUi(
    "The client's name is [CLIENT]. Total equity is $150,000.",
    qaBot.session,
    qaQuestion,
  );
  assert(echoed.includes(qaName), `echoed answer did not restore ${qaName}`);
  assert(!echoed.includes("[CLIENT]"), `echoed answer leaked [CLIENT] for ${qaName}`);
  assert(!echoed.includes("[PERSON_1]"), `echoed answer leaked [PERSON_1] for ${qaName}`);
  assert(!echoed.includes("[EMAIL]"), `echoed answer leaked [EMAIL] for ${qaName}`);
  assert(echoed.includes("$150,000"), `echoed answer dropped equity for ${qaName}`);

  const denied = rehydrateForUi(
    "The client's name is not on file. Total equity is $150,000.",
    qaBot.session,
    qaQuestion,
  );
  assert(denied.includes(qaName), `denial answer did not restore ${qaName}`);
  assert(!denied.includes("[CLIENT]"), `denial answer leaked [CLIENT] for ${qaName}`);
  assert(!/not on file/i.test(denied), `denial answer still says the name is missing for ${qaName}`);
  assert(denied.includes("$150,000"), `denial answer dropped equity for ${qaName}`);

  const yankeesDenial = rehydrateForUi(
    "No business name has been provided in the context. Total equity is $150,000.",
    qaBot.session,
    "What is this client's name?",
  );
  assert(yankeesDenial.includes(qaName), `context denial did not restore ${qaName}`);
  assert(!yankeesDenial.includes("[CLIENT]"), `context denial leaked [CLIENT] for ${qaName}`);
  assert(yankeesDenial.includes("$150,000"), `context denial dropped equity for ${qaName}`);

  const equityOnly = rehydrateForUi("Total equity is $150,000.", qaBot.session, "What is total equity?");
  assert(equityOnly === "Total equity is $150,000.", `equity-only answer was rewritten for ${qaName}`);

  const qaAsk = sealAskAiPrompt(
    buildPrompt(
      qaQuestion,
      { ...askCtx, clientName: qaName, overview: qaBrief, copyPack: "us" },
      "focused",
      "accountant",
    ),
    { clientName: qaName },
  );
  const askOutbound = `${qaAsk.system}\n${qaAsk.user}`;
  assert(!askOutbound.includes(qaName), `ask-ai outbound still has ${qaName}`);
  assert(askOutbound.includes("[CLIENT]"), `ask-ai outbound did not mark ${qaName}`);
  assert(askOutbound.includes("CLIENT IDENTITY"), `ask-ai outbound did not label ${qaName}`);
  assert(askOutbound.includes("Total equity: $150,000"), `ask-ai outbound dropped equity for ${qaName}`);
  assert(qaAsk.workingContext.includes(qaName), `ask-ai working context lost ${qaName}`);
  assert(!qaAsk.workingContext.includes("[CLIENT]"), `ask-ai working context kept [CLIENT] for ${qaName}`);

  const cacheFromRaw = sealedCacheAnswer(
    `The client's name is ${qaName}. Total equity is $150,000.`,
    qaAsk.session,
  );
  assert(cacheFromRaw.includes("[CLIENT]"), `cache did not placeholder ${qaName}`);
  assert(!cacheFromRaw.includes(qaName), `cache stored the raw name ${qaName}`);
  assert(cacheFromRaw.includes("$150,000"), `cache dropped equity for ${qaName}`);
  assert(!cacheHitIsDisplaySafe(cacheFromRaw), `placeholder cache row would render for ${qaName}`);

  const cacheFromLower = sealedCacheAnswer(
    `Name: ${qaName.toLowerCase()}. Total equity is $150,000.`,
    qaAsk.session,
  );
  assert(!cacheFromLower.toLowerCase().includes(qaName.toLowerCase()), `cache stored a case variant of ${qaName}`);
  assert(cacheFromLower.includes("[CLIENT]"), `cache missed a case variant of ${qaName}`);
  assert(cacheFromLower.includes("$150,000"), `case-variant cache dropped equity for ${qaName}`);

  const cacheFromToken = sealedCacheAnswer(
    "The client's name is [CLIENT]. Total equity is $150,000.",
    qaAsk.session,
  );
  assert(cacheFromToken.includes("[CLIENT]"), `token cache lost the placeholder for ${qaName}`);
  assert(!cacheFromToken.includes(qaName), `token cache stored ${qaName}`);

  const shown = rehydrateForUi(cacheFromToken, qaAsk.session, qaQuestion);
  assert(shown.includes(qaName), `UI did not rehydrate the cached placeholder for ${qaName}`);
  assert(!shown.includes("[CLIENT]"), `UI showed [CLIENT] for ${qaName}`);
}

const definitional = sealAskAiPrompt(
  buildPrompt("What is a gross margin?", { ...askCtx, clientName: "New York Yankees" }, "none", "owner"),
  { clientName: "New York Yankees" },
);
assert(!definitional.system.includes("CLIENT IDENTITY"), "definitional prompts stay out of client identity");
assert(!`${definitional.system}\n${definitional.user}`.includes("New York Yankees"), "definitional prompt leaked the name");
const genericCache = sealedCacheAnswer(
  "Gross margin is revenue minus the cost of goods, divided by revenue.",
  definitional.session,
);
assert(!genericCache.includes("[CLIENT]"), "generic cache answer grew a client token");
assert(!genericCache.includes("New York Yankees"), "generic cache answer grew a client name");
assert(cacheHitIsDisplaySafe(genericCache), "generic cache answer is safe to show");

const botIndex = readFileSync(resolve("supabase/functions/milon-bot/index.ts"), "utf8");
const askIndex = readFileSync(resolve("supabase/functions/ask-ai/index.ts"), "utf8");
assert(
  botIndex.includes("callClaudeRound(sealedChat.system, messages, TOOLS)"),
  "bot calls Anthropic with the sealed system prompt",
);
assert(!botIndex.includes("sealedChat.workingContext"), "bot does not send the working context to Anthropic");
assert(botIndex.includes("rehydrateForUi"), "bot rehydrates the answer for the UI");
assert(askIndex.includes("sealedCacheAnswer(claudeResult.text, sealed.session)"), "ask-ai cache stores placeholders");
assert(askIndex.includes("rehydrateForUi(claudeResult.text, sealed.session, question)"), "ask-ai rehydrates the UI answer");
assert(askIndex.includes("cacheHitIsDisplaySafe"), "ask-ai does not render a placeholder cache hit");
assert(!askIndex.includes("workingContext"), "ask-ai does not send the working context to Anthropic");

console.log("identifier redaction tests passed");
