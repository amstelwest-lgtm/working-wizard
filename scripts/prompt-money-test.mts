/**
 * Stored firm country ZA prints `R 187 444`. Null and every other country print `$187,444`.
 * Run: pnpm test:prompt-money
 */
import { formatMoney } from "../src/lib/market/format.ts";
import { moneyMarketFromClient } from "../src/lib/agent-bus.ts";
import {
  formatPromptMoney,
  promptMoneyPack,
  ZA_PROMPT_MONEY_LINE,
  zaPromptMoneyLine,
} from "../src/lib/prompt-money.ts";
import { chatReplyFormatRules } from "../supabase/functions/_shared/chat-reply.ts";
import { buildOverviewBrief, overviewFactLines } from "../supabase/functions/ask-ai/overview-brief.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const SPACE = "\u0020";
const za = formatPromptMoney(187444, { country: "ZA" });
assert(za === `R${SPACE}187${SPACE}444`, `ZA amount ${JSON.stringify(za)}`);
assert(!za.includes("\u00a0") && !za.includes("\u202f"), "thousands separator is a normal space");
assert(!za.includes("ZAR"), "ZA amount does not print the currency code");

const cents = formatPromptMoney(187444.5, { country: "za" }, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
assert(cents === `R${SPACE}187${SPACE}444,50`, `ZA cents ${JSON.stringify(cents)}`);

for (const raw of [null, undefined, { country: "US" }, { country: "nope" }, { country: null }]) {
  const text = formatPromptMoney(187444, raw);
  assert(text === "$187,444", `${JSON.stringify(raw)} -> ${JSON.stringify(text)}`);
  assert(!text.includes("ZAR") && !text.includes("R "), text);
}

assert(promptMoneyPack({ country: "ZA" }) === "za", "ZA pack");
assert(promptMoneyPack(null) === "us", "null pack");
assert(zaPromptMoneyLine({ country: "ZA" }) === `\n${ZA_PROMPT_MONEY_LINE}`, "ZA prompt line");
assert(zaPromptMoneyLine(null) === "" && zaPromptMoneyLine({ country: "US" }) === "", "no line outside ZA");
assert(!ZA_PROMPT_MONEY_LINE.includes("ZAR"), "the prompt line does not print ZAR");

assert(chatReplyFormatRules("za").includes(ZA_PROMPT_MONEY_LINE), "ZA chat rules carry the line");
const usRules = chatReplyFormatRules("us");
assert(usRules.includes("$187,444") && !usRules.includes("ZAR") && !usRules.includes("R 187"), "US chat rules stay in dollars");

const zaFacts = overviewFactLines(
  buildOverviewBrief({
    financials: { equity: 187444 },
    copyPack: "us",
    storedMarket: { country: "ZA" },
  }),
).join("\n");
assert(zaFacts.includes("Total equity: R 187 444"), zaFacts);

const nullFacts = overviewFactLines(
  buildOverviewBrief({
    financials: { equity: 187444 },
    copyPack: "za",
    storedMarket: null,
  }),
).join("\n");
assert(nullFacts.includes("Total equity: $187,444"), nullFacts);
assert(!nullFacts.includes("ZAR") && !nullFacts.includes("R "), nullFacts);

assert(formatMoney(187444, moneyMarketFromClient({ country: "ZA" })) === "R 187 444", "agent ZA money");
assert(formatMoney(187444, moneyMarketFromClient(null)) === "$187,444", "agent null money");
assert(moneyMarketFromClient(null).currency === "USD", "null market is dollars");
assert(!formatMoney(187444, moneyMarketFromClient({ country: "US" })).includes("ZAR"), "US agent money has no ZAR");

console.log("prompt-money ok");
