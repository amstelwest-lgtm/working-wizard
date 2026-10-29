/**
 * Agent page layout and section copy: blocks on top, hero beside the chat,
 * then titled sections. Run: pnpm test:agent-page-layout
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentStage } from "../src/components/milon-team/agent-stage";
import { MilonTeamDesk } from "../src/components/milon-team/milon-team-desk";
import type { MilonTeamFeedApi } from "../src/hooks/use-milon-team-feed";
import { AGENT_SECTION_COPY, NOTICED_EMPTY, askAgentTitle } from "../src/lib/agent-section-copy";
import { clientAgentWork } from "../src/lib/agent-work";
import { activitySentence } from "../src/lib/milon-team-activity";
import type { MilonTeamFeed, TeamActivityEvent } from "../src/lib/milon-team-feed";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string) {
  if (actual !== expected) throw new Error(`${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
}

const NOW = new Date("2026-10-08T12:00:00.000Z");

eq(AGENT_SECTION_COPY.work.title, "Where I work", "work title");
eq(AGENT_SECTION_COPY.noticed.title, "What I noticed", "noticed title");
eq(AGENT_SECTION_COPY.offered.title, "Work I can do for you", "offered title");
eq(AGENT_SECTION_COPY.activity.title, "Recent activity", "activity title");
eq(NOTICED_EMPTY, "Nothing new since the last sync.", "noticed empty state");
eq(askAgentTitle("Analyst"), "Ask the Analyst", "chat title");
for (const [key, copy] of Object.entries(AGENT_SECTION_COPY)) {
  const sentences = copy.purpose.split(/(?<=[.!?])\s+/u).filter(Boolean);
  assert(sentences.length <= 2, `${key} purpose stays short`);
}

const details = (agent: "financial_manager" | "analyst" | "advisor") =>
  Object.fromEntries(clientAgentWork(agent, "c").map((row) => [row.title, row.detail]));
eq(details("advisor")["Next moves"], "Suggested actions for this client, ranked by impact.", "advisor next moves");
eq(details("advisor")["Action plan"], "Tasks already agreed, who owns them, and what is overdue.", "advisor plan");
eq(details("financial_manager")["13-week forecast"], "Expected cash in and out, week by week.", "fm forecast");
eq(details("financial_manager")["Who to chase"], "Customers who owe money, oldest first.", "fm chase");
eq(details("analyst")["Health score"], "The overall score, each pillar, and the PDF report.", "analyst score");
eq(details("analyst")["Profit waterfall"], "How revenue turns into profit, step by step.", "analyst waterfall");

const event = (kind: TeamActivityEvent["kind"], text: string) => ({ kind, text });
eq(activitySentence(event("sync", "Xero sync · Mar 2026")), "Read the Xero sync for Mar 2026.", "sync");
eq(activitySentence(event("upload", "Statement upload")), "Read the statement upload.", "upload");
eq(activitySentence(event("diagnosis", "Diagnosis reviewed")), "Reviewed the diagnosis.", "diagnosis");
eq(activitySentence(event("proposal", "Chase the two oldest debtors")), "Suggested: Chase the two oldest debtors.", "proposal");
eq(activitySentence(event("approved", "Approved · Board note")), "You approved: Board note.", "approved");
eq(
  activitySentence(event("dismissed", "Dismissed · Board note · Not now")),
  "You dismissed: Board note. Note: Not now.",
  "dismissed with a note",
);
eq(activitySentence(event("dismissed", "Advisory pack draft dismissed")), "You dismissed the Advisory pack draft.", "draft dismissed");
eq(activitySentence(event("draft_created", "Advisory pack draft saved")), "Saved the Advisory pack draft.", "draft saved");
eq(activitySentence(event("handoff", "Assigned: Review pricing")), "Picked up an assignment: Review pricing.", "handoff");
eq(activitySentence(event("query", "Why did rent go up?")), "Raised a query: Why did rent go up?", "query keeps its mark");

const stage = renderToStaticMarkup(
  createElement(
    AgentStage,
    {
      agent: "analyst",
      finding: "Debtor days are up.",
      onSelect: () => {},
      chat: createElement("div", { id: "ask-ai-accountant" }),
    },
    createElement("p", { id: "after" }, "sections"),
  ),
);
const at = (needle: string) => {
  const index = stage.indexOf(needle);
  assert(index >= 0, `stage renders ${needle}`);
  return index;
};
assert(at('role="tablist"') < at("agent-stage-hero"), "the agent blocks sit above the hero");
assert(at("agent-stage-hero") < at('id="ask-ai-accountant"'), "the chat follows the hero");
assert(at('id="ask-ai-accountant"') < at('id="after"'), "sections follow the chat");
assert(stage.includes(">Ask the Analyst<"), "the chat card is titled for the agent");
assert(stage.includes("agent-stage-top has-chat"), "the hero and chat share a row container");

function api(partial: Partial<MilonTeamFeed>): MilonTeamFeedApi {
  return {
    briefing: [],
    jobs: [],
    activity: [],
    agents: {
      financial_manager: { agent: "financial_manager", lastRunAt: null, lastRunKind: null },
      analyst: { agent: "analyst", lastRunAt: null, lastRunKind: null },
      advisor: { agent: "advisor", lastRunAt: null, lastRunKind: null },
    },
    signoffLine: null,
    precard: { capped: false, remaining: null, limit: null },
    loading: false,
    error: null,
    approveJob: async () => ({ ok: true, draftId: null }),
    dismissJob: async () => ({ ok: true }),
    refresh() {},
    ...partial,
  };
}

const quiet = renderToStaticMarkup(
  createElement(MilonTeamDesk, { feed: api({}), now: NOW, initialFilter: "analyst", presentation: "agent" }),
);
assert(quiet.includes(">What I noticed<"), "What I noticed is never hidden");
assert(quiet.includes(NOTICED_EMPTY), "an empty What I noticed says so");
assert(!quiet.includes(">Work I can do for you<"), "an empty offer list is hidden");
assert(!quiet.includes(">Recent activity<"), "an empty activity list is hidden");

const activity: TeamActivityEvent[] = Array.from({ length: 7 }, (_, index) => ({
  id: `a${index}`,
  agent: "analyst",
  kind: "diagnosis",
  text: "Diagnosis reviewed",
  at: new Date(NOW.getTime() - index * 3_600_000).toISOString(),
}));
const busy = renderToStaticMarkup(
  createElement(MilonTeamDesk, {
    feed: api({ activity }),
    now: NOW,
    initialFilter: "analyst",
    presentation: "agent",
  }),
);
assert(busy.includes(">Recent activity<"), "activity shows under its title");
eq((busy.match(/data-activity="/g) ?? []).length, 5, "activity shows the latest five");
assert(busy.includes('data-activity="a0"') && !busy.includes('data-activity="a5"'), "the newest rows come first");
assert(busy.includes(">Show all<"), "more than five rows offers Show all");
assert(busy.includes("Reviewed the diagnosis."), "activity reads as a past-tense sentence");

const team = renderToStaticMarkup(createElement(MilonTeamDesk, { feed: api({ activity }), now: NOW }));
assert(team.includes(">Activity<") && !team.includes(">Recent activity<"), "the team desk keeps its own cards");
eq((team.match(/data-activity="/g) ?? []).length, 7, "the team desk is not capped");

const css = readFileSync("src/components/milon-team/agent-stage.css", "utf8");
assert(/@media \(min-width: 1280px\)[\s\S]*grid-template-columns: minmax\(0, 2fr\) minmax\(0, 3fr\)/.test(css), "hero and chat sit side by side at 1280px");
assert(css.includes("width: 200px"), "the face is 200px on a laptop");
assert(/min-width: 861px\) and \(max-width: 1099px\)[\s\S]*?width: 160px/.test(css), "the face is 160px on a small laptop");
assert(/max-width: 860px\)[\s\S]*?width: 128px/.test(css), "the face is 128px on a phone");
assert(!/border-radius: 999px/.test(css), "agent blocks are not pills");
const deskCss = readFileSync("src/components/milon-team/milon-team-desk.css", "utf8");
assert(!deskCss.includes("min(112px, 28vw)"), "the 112px face override is gone");
const route = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
assert(/chat=\{<div id="ask-ai-accountant"/.test(route), "the route passes the chat into the pane");

console.log("agent-page-layout ok");
