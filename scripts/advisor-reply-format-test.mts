/**
 * Advisor reply parsing, month-end PDF hold, and the way back to the plan.
 * Run: pnpm test:advisor-reply-format
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";
import { advisorReplyBlocks, parseAdvisorReply } from "../src/lib/advisor-reply-format.ts";
import { agentReplyPlainText, structureAgentReply } from "../src/lib/agent-reply.ts";
import { isMonthEndUpdateAsk, MONTH_END_HELD_LINE } from "../src/lib/month-end-update.ts";
import { accountantClientRouteSearch } from "../src/lib/client-route-search.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const jammed =
  "Health78RevenueR 1 760 000Gross margin40.0%Explain this ratio in plain termsWhat's the industry benchmark?";
const parts = parseAdvisorReply(jammed);
assert(parts.figures.map((figure) => figure.label).join("|") === "Health|Revenue|Gross margin", parts.figures.map((f) => f.label).join("|"));
assert(parts.figures[0]?.value === "78", parts.figures[0]?.value ?? "");
assert(parts.figures[1]?.value === "R 1 760 000", parts.figures[1]?.value ?? "");
assert(parts.figures[2]?.value === "40.0%", parts.figures[2]?.value ?? "");
assert(
  parts.suggestions.join("|") === "Explain this ratio in plain terms|What's the industry benchmark?",
  parts.suggestions.join("|"),
);
assert(!parts.prose.includes("Health78"), "jammed health leaves the prose");
assert(!parts.prose.includes("termsWhat"), "the follow-ups leave the prose");
const camel = parseAdvisorReply("When a partner signs off by WhatsApp voice note, what happens next?");
assert(camel.suggestions.length === 0, "a capital inside a word is not a new question");
assert(camel.prose.includes("WhatsApp"), "the word stays whole");

const spaced = parseAdvisorReply("Health: 78\n\nRevenue is on file.");
assert(spaced.figures.length === 0, "a spaced label stays in the prose");
assert(spaced.prose.includes("Health: 78"), "spaced health is kept");

const card = structureAgentReply(jammed, { agent: "advisor" });
assert(card.figures.length === 0, "a text-only reply with numbers produces zero chips");
assert(card.kpis.some((kpi) => kpi.label === "Health" && kpi.value === "78"), "jammed health is spaced in the layout");
assert(card.suggestions.length === 2, "follow-ups are separate");
assert(!card.headline.includes("Explain"), "the headline is not the follow-up");
assert(!agentReplyPlainText(card).includes("termsWhat"), "spoken text does not glue the follow-ups");
assert(!agentReplyPlainText(card).includes("Health78"), "spoken text does not glue health to its number");
for (const agent of ["financial_manager", "analyst", "advisor", "tax_specialist"] as const) {
  const shared = structureAgentReply(jammed, { agent });
  assert(shared.agent === agent, `${agent} keeps its name on the shared card`);
  assert(shared.figures.length === 0, `${agent} does not chip numbers from the reply`);
  assert(shared.suggestions.length === 2, `${agent} gets the same follow-up chips`);
}
const firm = structureAgentReply(jammed, {});
assert(firm.figures.length === 0 && firm.suggestions.length === 2, "a firm reply with no agent still uses the shared split");
const grounded = structureAgentReply(jammed, {
  agent: "advisor",
  figures: [{ label: "Health", value: "80", source: "health" }],
});
assert(grounded.figures.length === 1, "reply text does not add a second health chip");
assert(
  grounded.figures[0]?.value === "80" && grounded.figures[0]?.source === "health",
  "the tool value stays when the reply repeats the label",
);
assert(!grounded.figures.some((chip) => chip.source === "reply"), "reply text is not a chip source");

const markdown = structureAgentReply(
  "Cash is fine.\n\n**Margin** is thin.\n\n- Revenue: R 1 760 000\n\n**Next actions**\n1. Collect the oldest invoice.",
  { agent: "advisor" },
);
assert(markdown.headline.startsWith("Cash is fine"), markdown.headline);
assert(markdown.detail.includes("**Margin**"), "the next line keeps its bold marks");
assert(markdown.kpis[0]?.label === "Revenue" && markdown.kpis[0]?.value === "R 1 760 000", "the figure line stays a key figure");
assert(markdown.bullets[0] === "Collect the oldest invoice.", markdown.bullets.join("|"));
const blocks = advisorReplyBlocks(markdown.detail);
assert(blocks[0]?.kind === "p" && blocks[0].text.includes("**Margin**"), "a line break becomes its own paragraph");

assert(
  isMonthEndUpdateAsk("Draft the month-end client update for Woodwork. Leave it unsent for me to approve."),
  "the implementation step is a month-end update",
);
assert(
  isMonthEndUpdateAsk("Draft this month's update for North. Leave it unsent."),
  "an unsent monthly update is the same ask",
);
assert(!isMonthEndUpdateAsk("What is gross margin?"), "an ordinary question is not a month-end PDF");
assert(MONTH_END_HELD_LINE.includes("held for your approval"), "the reply says it is held");
assert(!MONTH_END_HELD_LINE.toLowerCase().includes("whatsapp"), "the held line does not name a chat app");

const kept = accountantClientRouteSearch({
  tab: "home",
  agent: "advisor",
  from: "im",
  prompt: "Draft the month-end client update. Leave it unsent.",
});
assert(kept.from === "im" && kept.agent === "advisor", "home keeps the plan return");
const dropped = accountantClientRouteSearch({ tab: "health", from: "im" });
assert(dropped.from == null, "leaving the agent page drops the plan return");

const ask = readFileSync("src/lib/ask-ai.js", "utf8");
const monthAt = ask.indexOf("isMonthEndUpdateAsk(q)");
const fetchAt = ask.indexOf("return fetch(url,", monthAt);
assert(monthAt > 0 && fetchAt > monthAt, "the month-end ask is handled before the model call");
assert(ask.includes("client-subpage-back"), "the plan return uses the existing back link");
assert(ask.includes("Back to implementation plan"), "the agent page links back to the plan");
assert(ask.includes('dataset.monthEndPdf = "held"'), "the reply carries a held PDF card");
assert(ask.includes("Open PDF") && ask.includes("Download PDF"), "the card can open or download");
assert(!ask.slice(monthAt, fetchAt).includes("advisory_pack_create"), "that path does not write a pack");

const preview = readFileSync("src/lib/advisory-pack.functions.ts", "utf8");
const previewBody = preview.slice(
  preview.indexOf("export const previewMonthEndPack"),
  preview.indexOf("export type GeneratePackResult"),
);
assert(previewBody.includes("gatherPackInputs"), "a missing pack is built with the pack generator");
assert(previewBody.includes("unsavedDraftPack"), "the built pack stays in memory");
assert(!previewBody.includes("advisory_pack_create"), "preview does not store a pack");
assert(!previewBody.includes(".insert(") && !previewBody.includes(".update("), "preview does not write");
assert(!previewBody.toLowerCase().includes("whatsapp"), "preview copy does not name a chat app");

const pdf = readFileSync("src/lib/month-end-pdf.ts", "utf8");
assert(pdf.includes("renderAdvisoryPackPdfBlob"), "the chat reuses the pack PDF");
assert(pdf.includes("MonthEndFallbackPdf"), "a failed pack falls back to a month-end PDF");
assert(!pdf.includes(".insert(") && !pdf.includes(".update(") && !pdf.includes("advisory_pack_create"), "the chat PDF does not write");
assert(!/South Africa/.test(pdf + readFileSync("src/reports/month-end-fallback-pdf.tsx", "utf8")), "the fallback does not name a country");
assert(!/whatsapp/i.test(pdf), "the PDF path does not name a chat app");

const rail = readFileSync("src/components/client-studio-chrome.tsx", "utf8");
assert(
  rail.includes('label: "Implementation Manager"') && rail.includes('to: "/practice/setup"'),
  "the client rail opens the plan in one click",
);

const window = new Window({ url: "http://127.0.0.1:5000/clients/demo?tab=home&agent=advisor&from=im" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node"] as const) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentReplyShell } = await import("../src/components/agent-reply/agent-reply-shell.tsx");
const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
let picked = "";
await act(async () => {
  root.render(
    createElement(AgentReplyShell, {
      reply: card,
      onSuggest: (suggestion: string) => {
        picked = suggestion;
      },
    }),
  );
});
const buttons = [...host.querySelectorAll("[data-agent-suggestion]")];
assert(buttons.length === 2, "follow-ups render as separate controls");
assert(buttons[0]?.textContent === "Explain this ratio in plain terms", buttons[0]?.textContent ?? "");
assert(buttons[1]?.textContent === "What's the industry benchmark?", buttons[1]?.textContent ?? "");
const headline = host.querySelector("[data-agent-headline]")?.textContent ?? "";
assert(!headline.includes("Explain") && !headline.includes("termsWhat"), headline);
assert(!headline.includes("Health78"), "the headline does not glue health to its number");
assert(host.querySelector("[data-figure-source]") == null, "a text-only reply renders no figure chips");
const health = host.querySelector("[data-agent-kpi=Health]");
assert(
  health?.textContent?.includes("Health") &&
    health.textContent.includes("78") &&
    !health.textContent.includes("Health78"),
  health?.textContent ?? "",
);
(buttons[1] as HTMLButtonElement).click();
assert(picked === "What's the industry benchmark?", "a follow-up chip is clickable");

console.log("advisor-reply-format-test: ok");
