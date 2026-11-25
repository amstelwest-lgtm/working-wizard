/**
 * Next undone step on the Implementation Manager checklist.
 * Run: pnpm test:im-next-steps
 */
import { readFileSync } from "node:fs";
import {
  COMPOSER_PROMPT_MAX,
  composerPromptPrefill,
  composerPromptText,
} from "../src/lib/composer-prompt.ts";
import {
  agentHref,
  buildImNextSteps,
  markStepDone,
  nextUndoneStep,
} from "../src/lib/im-next-steps.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const steps = [{ id: "monthly-client-update" }, { id: "document-collection" }, { id: "cash-flow" }];

assert(
  nextUndoneStep(steps, [])?.id === "monthly-client-update",
  "the first step is next when none are done",
);
assert(
  nextUndoneStep(steps, ["monthly-client-update"])?.id === "document-collection",
  "a done step is skipped",
);
assert(
  nextUndoneStep(steps, ["cash-flow", "monthly-client-update"])?.id === "document-collection",
  "order is the list order",
);
assert(
  nextUndoneStep(
    steps,
    steps.map((step) => step.id),
  ) === null,
  "every step done has no next step",
);
assert(nextUndoneStep([], []) === null, "an empty list has no next step");
assert(
  markStepDone(["cash-flow"], "cash-flow").join(",") === "cash-flow",
  "marking a done step does not duplicate it",
);

const client = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const rows = [
  {
    playId: "cash-flow",
    section: "lead" as const,
    actionHref: `/clients/${client}?report=forecast&action=preview`,
  },
  {
    playId: "monthly-client-update",
    section: "lead" as const,
    actionHref: `/clients/${client}?tab=portal&section=routines`,
  },
  {
    playId: "budget",
    section: "already_covered" as const,
    actionHref: `/clients/${client}?tab=budget`,
  },
];
const before = buildImNextSteps({ rows, integrationStarted: false, sendAgentAllowed: true });
assert(
  before.map((step) => step.id).join(",") ===
    "monthly-client-update,cash-flow,connect-books,needs-attention",
  "lead steps follow the gap order, then books and Needs attention",
);
assert(before[0]?.kind === "start", "the month-end update waits for Start integration");
assert(!before.some((step) => step.id === "budget"), "already covered work is not a next step");
assert(
  before.find((step) => step.id === "connect-books")?.href ===
    `/clients/${client}?tab=portal&section=connections`,
  "Connect books opens the client's connections",
);
assert(
  before.find((step) => step.id === "connect-books")?.title === "Connect this client's books",
  "Connect books says this client until a name is known",
);
assert(
  before.find((step) => step.id === "needs-attention")?.href === "/practice/needs-attention",
  "Needs attention opens the practice list",
);
assert(
  nextUndoneStep(before, ["monthly-client-update", "cash-flow"])?.id === "connect-books",
  "books is next after the lead steps",
);
assert(
  nextUndoneStep(before, ["monthly-client-update", "cash-flow", "connect-books"])?.id ===
    "needs-attention",
  "Needs attention is next after books",
);
assert(
  nextUndoneStep(
    before,
    before.map((step) => step.id),
  ) === null,
  "the new steps can be marked done",
);
const after = buildImNextSteps({ rows, integrationStarted: true, sendAgentAllowed: true });
assert(
  after[0]?.href?.includes("section=routines"),
  "after Start integration the update opens Routines",
);
const blocked = buildImNextSteps({
  rows: [
    {
      playId: "document-collection",
      section: "lead",
      actionHref: `/clients/${client}?tab=portal&section=send-agent`,
    },
  ],
  integrationStarted: true,
  sendAgentAllowed: false,
});
assert(
  blocked[0]?.href?.includes("agent=financial_manager"),
  "a firm off the send list asks the Financial Manager",
);
assert(!/whatsapp/i.test(JSON.stringify(before)), "the steps do not name a chat app");

const named = "North & Co";
const docPrompt = `Draft a document request for ${named}'s statements.`;
const doc = buildImNextSteps({
  rows: [
    {
      playId: "document-collection",
      section: "lead",
      actionHref: `/clients/${client}?tab=portal&section=send-agent`,
      actionPrompt: docPrompt,
      clientName: named,
    },
  ],
  integrationStarted: true,
  sendAgentAllowed: false,
});
const docHref = doc[0]?.href ?? "";
assert(
  docHref.includes("agent=financial_manager"),
  "the document request opens the Financial Manager",
);
assert(
  docHref.includes(`prompt=${encodeURIComponent(docPrompt)}`),
  "the document request encodes the prompt",
);
assert(!docHref.includes(named), "the client name is not left raw in the document-request link");
assert(
  new URL(docHref, "https://milon.invalid").searchParams.get("prompt") === docPrompt,
  "the document request decodes back to the prompt",
);

const allowedDoc = buildImNextSteps({
  rows: [
    {
      playId: "document-collection",
      section: "lead",
      actionHref: `/clients/${client}?tab=portal&section=send-agent`,
      actionPrompt: docPrompt,
      clientName: named,
    },
  ],
  integrationStarted: true,
  sendAgentAllowed: true,
});
assert(
  allowedDoc[0]?.promptButton === "Ask the Financial Manager",
  "a firm on the send list can still ask for a draft",
);
assert(
  allowedDoc[0]?.promptHref?.includes(`prompt=${encodeURIComponent(docPrompt)}`),
  "that document-request button encodes the prompt",
);

const advisorPrompt = `Draft this month's update for ${named}. Leave it unsent.`;
const advisor = buildImNextSteps({
  rows: [
    {
      playId: "monthly-client-update",
      section: "lead",
      actionHref: `/clients/${client}?tab=portal&section=routines`,
      actionPrompt: advisorPrompt,
      clientName: named,
    },
  ],
  integrationStarted: true,
  sendAgentAllowed: true,
});
const month = advisor.find((step) => step.id === "monthly-client-update");
assert(month?.href?.includes("section=routines"), "the month-end step still opens Routines");
assert(month?.promptButton === "Ask the Advisor", "Ask the Advisor sits on the month-end step");
assert(
  month?.promptHref?.includes(`prompt=${encodeURIComponent(advisorPrompt)}`),
  "Ask the Advisor encodes the prompt",
);
assert(!month?.promptHref?.includes(named), "the client name is encoded on Ask the Advisor");
assert(
  advisor.find((step) => step.id === "connect-books")?.title === `Connect ${named}'s books`,
  "Connect books uses the client name",
);

const href = agentHref(client, "advisor", advisorPrompt);
assert(href.includes("tab=home&agent=advisor"), "agentHref opens that agent's Home chat");
assert(
  href.includes(`prompt=${encodeURIComponent(advisorPrompt)}`),
  "agentHref includes an encoded prompt",
);
assert(
  agentHref(client, "nope", advisorPrompt) === "/clients",
  "an unknown agent does not build a chat link",
);
assert(composerPromptPrefill(advisorPrompt).send === false, "a prefilled prompt is not sent");

const encoded = encodeURIComponent(`  ${advisorPrompt}  `);
assert(composerPromptText(encoded) === advisorPrompt, "the prompt is decoded and trimmed");
assert(
  composerPromptText("x".repeat(COMPOSER_PROMPT_MAX + 40)).length === COMPOSER_PROMPT_MAX,
  "the prompt is capped",
);
assert(composerPromptText("<b>hi</b>") === "<b>hi</b>", "markup stays plain text");
assert(
  composerPromptPrefill(" \n ").text === "" && composerPromptPrefill(" \n ").send === false,
  "a blank prompt does not send",
);

const ask = readFileSync("src/lib/ask-ai.js", "utf8");
const seedAt = ask.indexOf("composerPromptText(initialQuestion)");
assert(seedAt > 0, "the composer seeds from the prompt helper");
assert(!ask.slice(seedAt, seedAt + 80).includes("submit("), "seeding the box does not send");
const route = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
assert(
  route.includes("initialQuestion: promptText"),
  "the client page passes the prompt into the composer",
);
assert(route.includes("fillAskComposer"), "an open composer receives the prompt as text");
assert(!route.includes("ask-ai-send"), "the client page does not press Send");
const link = readFileSync("src/components/im-plan-link.tsx", "utf8");
assert(link.includes('to="/practice/needs-attention"'), "Needs attention uses the router link");

console.log("im-next-steps-test: ok");
