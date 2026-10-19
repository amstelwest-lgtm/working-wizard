/**
 * Plan and trial facts are in every agent chat, on both sides.
 * Run: pnpm test:product-facts-prompt
 */
import { ownerPlanFreeLine } from "../src/lib/owner-plan.ts";
import {
  FIRM_TRIAL_CARD_LINE,
  FIRM_TRIAL_CLIENT_LIMIT,
  FIRM_TRIAL_DAYS,
  FIRM_TRIAL_SENTENCE,
} from "../src/lib/starter-trial-constants.ts";
import { buildPrompt } from "../supabase/functions/ask-ai/prompt.ts";
import { milonBotChatSystem } from "../supabase/functions/milon-bot/prompt.ts";
import { BOT_SYSTEM } from "../supabase/functions/milon-bot/logic.ts";
import type { AskAiContext } from "../supabase/functions/ask-ai/types.ts";

const AGENTS = ["financial_manager", "analyst", "advisor"] as const;
const AUDIENCES = ["owner", "accountant"] as const;

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertFacts(system: string, audience: "owner" | "accountant", label: string) {
  assert(system.includes("PRODUCT FACTS"), `${label} names the facts block`);
  assert(system.includes("Starter plan."), `${label} names Starter`);
  assert(system.includes(`${FIRM_TRIAL_DAYS}-day free trial.`), `${label} names the trial length`);
  assert(system.includes(`Up to ${FIRM_TRIAL_CLIENT_LIMIT} clients.`), `${label} names the client cap`);
  assert(system.includes(FIRM_TRIAL_SENTENCE), `${label} quotes the trial sentence`);
  assert(system.includes(FIRM_TRIAL_CARD_LINE), `${label} quotes the card line`);
  assert(
    system.includes("Never say the plan or the trial is not on file."),
    `${label} forbids a not-on-file plan answer`,
  );
  assert(system.includes("accountant firm's plan"), `${label} names the accountant firm's plan`);
  assert(!/\$\d/.test(system.slice(system.indexOf("PRODUCT FACTS"))), `${label} facts have no dollar amount`);
  assert(!/\bZAR\b/.test(system), `${label} never says ZAR`);
  assert(!/R\s?\d/.test(system.slice(system.indexOf("PRODUCT FACTS"))), `${label} facts have no rand amount`);
  if (audience === "owner") {
    assert(system.includes("not this owner's plan"), `${label} keeps firm facts off the owner plan`);
    assert(system.includes(ownerPlanFreeLine()), `${label} uses the owner plan constant`);
    assert(system.includes("Do not invent an owner price."), `${label} does not invent an owner price`);
  } else {
    assert(system.includes("This is the accountant firm's plan."), `${label} speaks as the firm`);
    assert(!system.includes(ownerPlanFreeLine()), `${label} does not put the owner price line on the firm chat`);
  }
}

const ctx = { copyPack: "us" as const, ratios: [] } as unknown as AskAiContext;
const zaCtx = { copyPack: "za" as const, ratios: [] } as unknown as AskAiContext;

for (const audience of AUDIENCES) {
  for (const agent of AGENTS) {
    const asked = buildPrompt("What plan am I on?", ctx, "none", audience, agent);
    assertFacts(asked.system, audience, `ask-ai ${audience} ${agent}`);
    assert(
      asked.system.includes(agent === "financial_manager" ? "financial manager" : agent),
      `ask-ai ${audience} ${agent} keeps its persona`,
    );
    const za = buildPrompt("What is the trial?", zaCtx, "none", audience, agent);
    assert(!/\bZAR\b|R\s?\d|\$\d/.test(za.system.slice(za.system.indexOf("PRODUCT FACTS"))), `ask-ai ZA ${audience} ${agent} facts stay currency-free`);

    const bot = milonBotChatSystem(BOT_SYSTEM, agent, audience);
    assertFacts(bot, audience, `milon-bot ${audience} ${agent}`);
    assert(
      bot.includes(agent === "financial_manager" ? "financial manager" : agent),
      `milon-bot ${audience} ${agent} keeps its persona`,
    );
  }
}

const plain = milonBotChatSystem(BOT_SYSTEM, null, "owner");
assertFacts(plain, "owner", "milon-bot owner without an agent");
assert(!plain.includes("This chat:"), "a chat with no agent does not invent a persona");

console.log("product-facts-prompt: ok");
