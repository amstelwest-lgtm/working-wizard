/**
 * In-app Milōn bot — worker bee on Client Brain.
 * Run: pnpm test:milon-bot
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOT_RATE_LIMIT,
  BOT_SYSTEM,
  BOT_TOOLS,
  buildBlockers,
  buildBrainAnswer,
  buildInviteStatus,
  compactBrainSummary,
  hashToolArgs,
  isBotToolName,
  numericRatios,
  summarizeToolArgs,
  toolResultStatus,
} from "../supabase/functions/milon-bot/logic.ts";
import {
  MILON_BOT_ACCOUNTANT_CHIPS,
  MILON_BOT_OWNER_CHIPS,
  MILON_BOT_SUBTITLE,
  MILON_BOT_TITLE,
  DRAFT_ADVISORY_PACK_COMMAND,
  DRAFT_ADVISORY_PACK_LABEL,
  deriveMilonBotEndpoint,
  isDeliverableRecommendationQuestion,
  isQuestionPrompt,
  persistedCreateIntent,
  routeMilonIntent,
} from "../src/lib/milon-bot-copy.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const migration = readFileSync(
  resolve("supabase/migrations/20260907180000_milon_bot_tool_calls.sql"),
  "utf8",
);
const fnSrc = readFileSync(resolve("supabase/functions/milon-bot/index.ts"), "utf8");
const claudeSrc = readFileSync(resolve("supabase/functions/milon-bot/claude.ts"), "utf8");
const configSrc = readFileSync(resolve("supabase/config.toml"), "utf8");
const typesSrc = readFileSync(resolve("src/integrations/supabase/types.ts"), "utf8");
const clientSrc = readFileSync(resolve("src/lib/milon-bot-client.ts"), "utf8");
const summarySrc = readFileSync(resolve("src/components/client-brain-summary.tsx"), "utf8");
const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
const studioSrc =
  readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8") +
  readFileSync(resolve("src/components/client-studio-chrome.tsx"), "utf8");
const widgetSrc = readFileSync(resolve("src/lib/ask-ai.js"), "utf8");
const copySrc = readFileSync(resolve("src/lib/milon-bot-copy.ts"), "utf8");
const askAiSrc = readFileSync(resolve("supabase/functions/ask-ai/anthropic.ts"), "utf8");
const extractSrc = readFileSync(resolve("supabase/functions/extract-financials/index.ts"), "utf8");

assert(migration.includes("CREATE TABLE IF NOT EXISTS public.bot_tool_calls"), "audit table");
assert(migration.includes("has_client_access"), "RLS via has_client_access");
assert(migration.includes("ENABLE ROW LEVEL SECURITY"), "RLS enabled");
assert(migration.includes("args_hash"), "args hash column");
assert(migration.includes("args_summary"), "args summary column");
assert(migration.includes("result_status"), "result status column");
assert(migration.includes("CHECK (result_status IN ('ok', 'empty', 'error'))"), "status enum");
assert(!/token text/i.test(migration), "audit table has no token column");

assert(typesSrc.includes("bot_tool_calls:"), "types include bot_tool_calls");
assert(configSrc.includes("[functions.milon-bot]"), "function registered");
assert(configSrc.includes("verify_jwt = true"), "jwt verified");

assert(fnSrc.includes("has_client_access"), "same access check as ask-ai");
assert(fnSrc.includes("ask_ai_record_request"), "reuses ask-ai rate limit");
assert(fnSrc.includes('p_tier: "milon_bot"'), "distinct rate-limit tier");
assert(fnSrc.includes("functions/v1/${name}"), "calls existing brain edge functions");
assert(fnSrc.includes('"brain-propose"'), "calls existing brain-propose");
assert(fnSrc.includes('"brain-deliverable-draft"'), "calls existing deliverable draft");
assert(fnSrc.includes("from(\"invite_tokens\")"), "invite status from existing tokens table");
assert(fnSrc.includes("client_brain_questions"), "lists outstanding questions");
assert(fnSrc.includes("context_facts"), "reads context_facts");
assert(fnSrc.includes("brain_summary"), "reads brain_summary");
assert(fnSrc.includes("loadOverviewBrief"), "loads the Overview brief for this client");
assert(fnSrc.includes("formatOverviewForPrompt"), "injects overview figures into the prompt");
assert(fnSrc.includes("buildMilonBotChatPayload"), "every turn is built by the redacting chat payload");
assert(fnSrc.includes("persistAdvisoryCreate"), "create intent writes a real deliverable");
assert(fnSrc.includes('mode === "create"') || fnSrc.includes("createIntent"), "create mode is handled");
assert(fnSrc.includes("client_financial_snapshots"), "reads financials summaries");
assert(fnSrc.includes("bot_tool_calls"), "writes tool-call audit");
assert(!fnSrc.includes("mint_owner_invite"), "does not mint invites");
assert(!fnSrc.toLowerCase().includes("stripe"), "no Stripe");
assert(!fnSrc.includes("lighthouse"), "does not touch Lighthouse");
assert(fnSrc.includes("../ask-ai/sanitizer.ts"), "reuses ask-ai sanitizer");
assert(!fnSrc.includes("../ask-ai/anthropic.ts"), "does not rewrite ask-ai Claude wrapper");

assert(claudeSrc.includes("tool_use"), "tool-use loop");
assert(claudeSrc.includes("ANTHROPIC_API_KEY"), "same Anthropic secret as ask-ai");
assert(askAiSrc.includes("export async function callClaude"), "ask-ai wrapper unchanged");
assert(extractSrc.includes("api.anthropic.com"), "extract pipeline still calls Anthropic directly");

assert(BOT_RATE_LIMIT === 30, "rate limit matches ask-ai");
assert(BOT_TOOLS.includes("get_invite_status"), "invite tool");
assert(BOT_TOOLS.includes("list_blockers"), "blockers tool");
assert(BOT_TOOLS.includes("propose_next_steps"), "propose tool");
assert(BOT_TOOLS.includes("draft_deliverable"), "draft tool");
assert(BOT_TOOLS.includes("answer_from_brain"), "brain answer tool");
assert(isBotToolName("list_blockers") && !isBotToolName("send_email"), "tool allowlist");
assert(BOT_SYSTEM.includes("Never invent"), "system forbids invention");
assert(BOT_SYSTEM.includes("not Lighthouse"), "not Lighthouse");
assert(!BOT_SYSTEM.includes("You are not Ask AI"), "unified product — not a separate Ask AI");
assert(!BOT_SYSTEM.includes("point them to Ask AI"), "does not send users to a separate Ask AI");
assert(BOT_SYSTEM.includes("Do not send the user to a separate product"), "stays on one surface");
assert(BOT_SYSTEM.includes("30–60 days"), "bot quotes the shared creditor band");
assert(BOT_SYSTEM.includes("40-day band"), "bot is told not to invent a 40-day band");
assert(
  BOT_SYSTEM.includes("Do not multiply a margin by revenue"),
  "bot quotes stored net profit instead of margin times revenue",
);

assert(summarizeToolArgs("answer_from_brain", { topic: "cash" }) === "answer_from_brain:cash", "args summary");
assert(summarizeToolArgs("list_blockers", {}) === "list_blockers", "empty args summary");
assert(toolResultStatus({ empty: true }) === "empty", "empty status");
assert(toolResultStatus({ error: "nope" }) === "error", "error status");
assert(toolResultStatus({ blockers: [1] }) === "ok", "ok status");

const hashA = await hashToolArgs({ topic: "cash" });
const hashB = await hashToolArgs({ topic: "cash" });
const hashC = await hashToolArgs({ topic: "gap" });
assert(hashA === hashB && hashA.length === 64, "stable sha-256");
assert(hashA !== hashC, "different args hash differently");

const invites = buildInviteStatus({
  ownerUserId: "owner-1",
  invites: [
    {
      purpose: "owner_handoff",
      created_at: "2026-09-01T00:00:00.000Z",
      expires_at: "2026-09-15T00:00:00.000Z",
      redeemed_at: null,
    },
  ],
  now: new Date("2026-09-07T12:00:00.000Z"),
});
assert(invites.owner_linked && !invites.empty && invites.invites[0].status === "pending", "pending invite");
assert(!("token" in invites.invites[0]), "invite status never includes token");
assert(
  buildInviteStatus({ ownerUserId: null, invites: [] }).empty,
  "no invites is empty — do not invent",
);
assert(
  buildInviteStatus({
    ownerUserId: null,
    invites: [
      {
        purpose: "owner_handoff",
        created_at: "2026-08-01T00:00:00.000Z",
        expires_at: "2026-08-15T00:00:00.000Z",
        redeemed_at: null,
      },
    ],
    now: new Date("2026-09-07T12:00:00.000Z"),
  }).invites[0].status === "expired",
  "expired invite",
);

assert(buildBlockers([]).empty, "no questions is empty");
assert(
  buildBlockers([{ question_key: "q1", prompt_text: "Cash?", audience: "owner", last_asked_at: null }])
    .blockers[0].prompt === "Cash?",
  "blocker prompt",
);

assert(compactBrainSummary(null) === null, "missing summary stays empty");
assert(compactBrainSummary({ headline: "", bullets: [] }) === null, "blank summary stays empty");
assert(compactBrainSummary({ headline: "Tight cash" })?.headline === "Tight cash", "keep filled headline");
assert(Object.keys(numericRatios({ gp: 0.32, note: "x" })).join(",") === "gp", "ratios skip non-numbers");

const emptyBrain = buildBrainAnswer({ facts: [], brainSummary: null, financials: null });
assert(emptyBrain.empty && emptyBrain.missing.includes("context_facts"), "empty brain facts");
assert(emptyBrain.missing.includes("brain_summary") && emptyBrain.missing.includes("financials"), "empty financials");
assert(
  !buildBrainAnswer({
    facts: [{ fact_text: "Pays weekly", category: "ops" }],
    brainSummary: { headline: "H" },
    financials: { period_label: "FY26", ratios: { gp: 0.4 }, cash_runway_weeks: 6 },
  }).empty,
  "filled brain is not empty",
);

assert(!summarySrc.includes("MilonBotPanel"), "summary no longer mounts a second bot");
assert(!summarySrc.includes("ask-ai"), "summary still does not generate via ask-ai chat");
assert(!appSrc.includes("MilonBotPanel"), "owner board no longer mounts a second bot");
assert(appSrc.includes('id="ask-ai-overview"'), "owner board keeps the unified widget mount");
assert(appSrc.includes("OwnerBrainDrip"), "owner drip unchanged");
assert(studioSrc.includes('id="ask-ai-accountant"'), "studio still mounts the widget");
assert(studioSrc.includes('{ id: "ask", label: "Milōn Bot"'), "studio rail is labeled Bot");
assert(studioSrc.includes("functions/v1/milon-bot"), "studio widget can call milon-bot");
assert(clientSrc.includes("/functions/v1/milon-bot"), "client posts to milon-bot");
assert(!appSrc.toLowerCase().includes("agent api"), "no public Agent API");

assert(widgetSrc.includes("routeMilonIntent"), "widget routes by intent");
assert(widgetSrc.includes("persistedCreateIntent"), "widget routes create requests to persistence");
assert(widgetSrc.includes('mode: "create"'), "create posts mode create");
assert(widgetSrc.includes("e.shiftKey"), "Shift+Enter keeps a newline");
assert(widgetSrc.includes('e.key !== "Enter"'), "Enter sends");
assert(!widgetSrc.includes("e.metaKey || e.ctrlKey"), "Enter no longer needs a modifier");
assert(widgetSrc.includes("botEndpoint"), "widget accepts milon-bot endpoint");
assert(copySrc.includes(MILON_BOT_TITLE), "shared title copy");
assert(copySrc.includes(MILON_BOT_SUBTITLE), "powered by Claude subtitle");
assert(MILON_BOT_ACCOUNTANT_CHIPS.length === 6, "accountant example chips");
assert(MILON_BOT_OWNER_CHIPS.length === 6, "owner example chips");
assert(routeMilonIntent("What's the biggest drag on this client's score vs peers?") === "ask-ai", "score chip → ask-ai");
assert(routeMilonIntent("Am I healthy overall, or should I worry?") === "ask-ai", "health chip → ask-ai");
assert(routeMilonIntent("Can I afford a hire based on what's on the board?") === "ask-ai", "hire chip → ask-ai");
assert(
  routeMilonIntent("What's still outstanding on the brain, and is the invite redeemed?") === "milon-bot",
  "invite/outstanding chip → milon-bot",
);
assert(routeMilonIntent("Propose next steps from what's on file.") === "milon-bot", "propose chip → milon-bot");
assert(
  routeMilonIntent("Draft an advisory pack from the brain — don't send it.") === "milon-bot",
  "draft chip → milon-bot",
);
assert(
  routeMilonIntent("What's still outstanding that my accountant needs from me?") === "milon-bot",
  "owner outstanding chip → milon-bot",
);
assert(
  deriveMilonBotEndpoint("https://x.supabase.co/functions/v1/ask-ai") ===
    "https://x.supabase.co/functions/v1/milon-bot",
  "derive milon-bot URL from ask-ai",
);
const created = persistedCreateIntent(
  "create an advisory deliverable / action plan PDF",
);
assert(created?.draft === true && created.actions === true && created.pdf === true, "create deliverable and action plan PDF");
assert(persistedCreateIntent("What's the health score?") === null, "health questions stay on the grounded Q&A path");
assert(persistedCreateIntent("Draft an advisory pack from the brain — don't send it.")?.draft === true, "draft chip persists a pack");
assert(persistedCreateIntent("Draft an advisory pack from the brain — don't send it.")?.actions === false, "draft chip does not invent action items");
assert(
  persistedCreateIntent("which deliverable should I prepare first?") === null,
  "which deliverable should I prepare first? does not create",
);
assert(
  persistedCreateIntent("Which deliverable should I prepare for them first, and why?") === null,
  "the QA read question does not create a pack",
);
assert(isQuestionPrompt("Which deliverable should I prepare for them first, and why?"), "QA prompt is a question");
assert(
  isDeliverableRecommendationQuestion("Which deliverable should I prepare for them first, and why?"),
  "QA prompt asks for a recommendation",
);
assert(
  routeMilonIntent("Which deliverable should I prepare for them first, and why?") === "ask-ai",
  "the recommendation stays on the numbers path",
);
const drafted = persistedCreateIntent("draft the advisory pack");
assert(drafted?.draft === true && drafted.actions === false, "draft the advisory pack creates a pack only");
const draftedNow = persistedCreateIntent(DRAFT_ADVISORY_PACK_COMMAND);
assert(draftedNow?.draft === true && draftedNow.actions === false, "the draft button command creates a pack");
assert(DRAFT_ADVISORY_PACK_LABEL === "Draft the Advisory Pack", "button label");
assert(widgetSrc.includes("DRAFT_ADVISORY_PACK_COMMAND"), "the reply button sends the explicit draft command");
assert(widgetSrc.includes("ask-ai-thread"), "the widget keeps the session thread on screen");
assert(widgetSrc.includes("dataset.draftPack"), "the draft control is a button in the reply");
assert(!fnSrc.includes("parsedCreate ??"), "mode create cannot invent a write from a question");

console.log("milon-bot-test: all assertions passed");
