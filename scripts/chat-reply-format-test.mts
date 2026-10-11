/**
 * Agent chat reply shape + per-agent thread scoping.
 * Run: pnpm test:chat-reply-format
 */
import { readFileSync } from "node:fs";
import {
  chatCacheScope,
  chatReplyFormatRules,
  humanDate,
  normalizeChatReply,
  parseChatAgent,
  scopeHistoryToAgent,
} from "../supabase/functions/_shared/chat-reply.ts";
import { buildPrompt } from "../supabase/functions/ask-ai/prompt.ts";
import { buildMilonBotChatPayload } from "../supabase/functions/milon-bot/prompt.ts";
import { BOT_SYSTEM } from "../supabase/functions/milon-bot/logic.ts";
import type { AskAiContext } from "../supabase/functions/ask-ai/types.ts";

let n = 0;
function assert(cond: unknown, msg: string) {
  n += 1;
  if (!cond) throw new Error(`FAIL: ${msg}`);
}
function eq(actual: string, expected: string, msg: string) {
  if (actual !== expected) {
    throw new Error(`FAIL: ${msg}\n--- expected ---\n${expected}\n--- actual ---\n${actual}`);
  }
  n += 1;
}

// ── Dates ────────────────────────────────────────────────────────────────
eq(humanDate("2026-09-08") ?? "", "8 Sep 2026", "ISO date becomes D Mon YYYY");
assert(humanDate("2026-02-30") === null, "an impossible date stays null");
eq(normalizeChatReply("Due 2026-09-08."), "Due 8 Sep 2026.", "ISO date in prose is rewritten");
eq(
  normalizeChatReply("Runs 2026-09-08T10:00Z."),
  "Runs 2026-09-08T10:00Z.",
  "timestamps stay as written",
);
eq(
  normalizeChatReply("Code `2026-09-08` stays."),
  "Code `2026-09-08` stays.",
  "inline code is untouched",
);
eq(normalizeChatReply("Bad 2026-13-40 stays."), "Bad 2026-13-40 stays.", "a non-date stays");

// ── Numbers are never touched ────────────────────────────────────────────
const numbers = "Revenue R4,200,000, margin 12.9%, range R5 - R6, years 2025 - 2026, loss -R5,000.";
eq(normalizeChatReply(numbers), numbers, "numbers, ranges and negatives are untouched");

// ── The screenshot reply ────────────────────────────────────────────────
const wall =
  "Overall, healthy: **80/100** for Sep 2026, with revenue of R4,200,000 and net profit of R540,000 (net margin 12.9%). " +
  "Debtor days are 33 (peer median 40). Next actions: - Look at why operating costs and interest are squeezing operating margin. " +
  "- Get the action plan moving: the capex benchmark task is due 2026-09-08.";
eq(
  normalizeChatReply(wall),
  [
    "Overall, healthy: **80/100** for Sep 2026, with revenue of R4,200,000 and net profit of R540,000 (net margin 12.9%). Debtor days are 33 (peer median 40).",
    "",
    "**Next actions**",
    "1. Look at why operating costs and interest are squeezing operating margin.",
    "2. Get the action plan moving: the capex benchmark task is due 8 Sep 2026.",
  ].join("\n"),
  "inline bullets split onto their own lines under the Next actions heading",
);

// ── Agreed shape ─────────────────────────────────────────────────────────
const messy = [
  "## Cash is fine for the next 13 weeks.",
  "* Cash: R1,200,000",
  "• Runway: 13+ weeks",
  "Next actions:",
  "- Chase the two oldest invoices by 2026-10-15.",
  "- Pay VAT on time.",
].join("\n");
eq(
  normalizeChatReply(messy),
  [
    "Cash is fine for the next 13 weeks.",
    "",
    "- Cash: R1,200,000",
    "- Runway: 13+ weeks",
    "",
    "**Next actions**",
    "1. Chase the two oldest invoices by 15 Oct 2026.",
    "2. Pay VAT on time.",
  ].join("\n"),
  "headline, figures and numbered Next actions in the agreed shape",
);
const good = [
  "Profit is healthy, but interest is eating the operating margin.",
  "",
  "- Revenue: $4,200,000",
  "- Net margin: 12.9%",
  "- Operating margin: 2.9%",
  "",
  "**Next actions**",
  "1. Review the high-interest loan.",
].join("\n");
eq(normalizeChatReply(good), good, "a reply already in shape is unchanged");
eq(
  normalizeChatReply(normalizeChatReply(messy)),
  normalizeChatReply(messy),
  "normalising twice is stable",
);
eq(normalizeChatReply("Hi! Happy to help."), "Hi! Happy to help.", "small talk has no sections");
eq(
  normalizeChatReply("Here is the split:\n- Cash: R10\n- Debt: R5"),
  "Here is the split:\n\n- Cash: R10\n- Debt: R5",
  "a blank line goes before a list",
);
const fenced = "See:\n```\n2026-09-08 - a - b\n```";
assert(
  normalizeChatReply(fenced).includes("```\n2026-09-08 - a - b\n```"),
  "fenced code is untouched",
);

// ── Prompts carry the rules ──────────────────────────────────────────────
const rules = chatReplyFormatRules("za");
assert(
  rules.includes("**Next actions**") && rules.includes("8 Sep 2026") && rules.includes("120 words"),
  "rules name the shape",
);
assert(
  rules.includes("R4,200,000") && chatReplyFormatRules("us").includes("$4,200,000"),
  "rules use the market currency",
);
assert(BOT_SYSTEM.includes("**Next actions**"), "milon-bot carries the reply format");
assert(!BOT_SYSTEM.includes("3–8 sentences"), "milon-bot drops the old sentence count");

const ctx = { copyPack: "us", ratios: [] } as unknown as AskAiContext;
for (const audience of ["owner", "accountant"] as const) {
  for (const agent of ["financial_manager", "analyst", "advisor"] as const) {
    const p = buildPrompt("How are we doing?", ctx, "none", audience, agent);
    assert(p.system.includes("**Next actions**"), `ask-ai ${audience} ${agent} carries the format`);
    assert(
      p.system.includes(agent === "financial_manager" ? "financial manager" : agent),
      `ask-ai ${audience} ${agent} carries its persona`,
    );
    assert(!p.system.includes("3–6 short sentences"), "ask-ai drops the old sentence count");
  }
}
assert(
  buildPrompt("q", ctx, "none", "accountant", "analyst").system.includes("this client's analyst"),
  "accountant persona is framed for the accountant",
);

// ── Per-agent threads ────────────────────────────────────────────────────
assert(
  parseChatAgent("analyst") === "analyst" && parseChatAgent("cfo") === null,
  "only the three agents parse",
);
const FM_SECRET = "FM-ONLY: approve the payroll run on Friday";
const mixed = [
  { role: "user" as const, content: FM_SECRET, agent: "financial_manager" },
  { role: "assistant" as const, content: "FM reply about payroll", agent: "financial_manager" },
  { role: "user" as const, content: "Why did margin drop?", agent: "analyst" },
  { role: "assistant" as const, content: "Interest rose.", agent: "analyst" },
];
const scoped = scopeHistoryToAgent(mixed, "analyst");
assert(
  scoped.length === 2 && scoped.every((t) => t.agent === "analyst"),
  "only analyst turns survive",
);
assert(scopeHistoryToAgent(mixed, null).length === 0, "no agent drops every agent-tagged turn");
const analystChat = buildMilonBotChatPayload({
  system: BOT_SYSTEM,
  history: mixed,
  message: "And debtors?",
  audience: "owner",
  agent: "analyst",
});
const analystPrompt = [analystChat.system, ...analystChat.messages.map((m) => m.content)].join(
  "\n",
);
assert(!analystPrompt.includes(FM_SECRET), "FM history never appears in an Analyst prompt");
assert(
  !analystPrompt.includes("FM reply about payroll"),
  "FM replies never appear in an Analyst prompt",
);
assert(analystPrompt.includes("Why did margin drop?"), "the analyst's own history is kept");
assert(analystChat.system.includes("analyst"), "the analyst prompt carries the analyst persona");
assert(
  !analystChat.system.includes("financial manager. You look after"),
  "the analyst prompt has no FM persona",
);
assert(
  chatCacheScope("owner", "financial_manager") !== chatCacheScope("owner", "analyst") &&
    chatCacheScope("owner", "analyst") !== chatCacheScope("accountant", "analyst"),
  "cached answers are scoped per audience and agent",
);
const askIndex = readFileSync("supabase/functions/ask-ai/index.ts", "utf8");
assert(
  !askIndex.includes("sha256(canonical)"),
  "ask-ai never keys the cache on the question alone",
);
assert(
  (askIndex.match(/chatCacheScope\(audience, agent\)/g) ?? []).length === 2,
  "cache read and write use the same agent scope",
);
const botIndex = readFileSync("supabase/functions/milon-bot/index.ts", "utf8");
assert(
  botIndex.includes("scopeHistoryToAgent(body.history, agent)"),
  "milon-bot scopes client history to body.agent",
);
assert(botIndex.includes("normalizeChatReply("), "milon-bot normalises chat replies");
assert(askIndex.includes("normalizeChatReply("), "ask-ai normalises chat replies");

// ── No server-side read-aloud ────────────────────────────────────────────
for (const [name, src] of [
  ["ask-ai", askIndex],
  ["milon-bot", botIndex],
] as const) {
  assert(!/\b(autoplay|speak|tts|audio)\b\s*:/i.test(src), `${name} sends no read-aloud flag`);
}

console.log(`chat-reply-format: ${n} checks passed`);
