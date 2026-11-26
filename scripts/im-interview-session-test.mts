/**
 * Practice interview: thinking, session JSON, one interview per session, proposals.
 * Run: pnpm test:im-interview-session
 */
import { readFileSync } from "node:fs";
import {
  groupInterviewSessions,
  interviewDraftFromRuleText,
  interviewDraftRuleText,
  interviewDraftWithQuestion,
} from "../src/lib/firm-interview-draft.ts";
import {
  INTERVIEW_MAP_MIN_ANSWERS,
  INTERVIEW_MAP_OFFER_ANSWERS,
  interviewAnswerCount,
  shouldBuildInterviewMap,
} from "../src/lib/setup-partner.ts";
import { isImSampleClient, parseImSetupHold, queuedRunningLines } from "../src/lib/im-setup-hold.ts";
import { tourHiddenOnPath } from "../src/components/walkthrough-wizard.tsx";
import { approvalDraftTitles } from "../src/lib/setup-partner-plan.ts";
import {
  PRACTICE_SETUP_INTERVIEW_MS,
  implementationManagerStep,
} from "../src/components/practice-setup-panel.tsx";
import { IMPLEMENTATION_MANAGER_THINKING, PastInterviews } from "../src/components/interview-exchange.tsx";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const question = "What kinds of clients make up your practice book?";
const answer = "Mostly owner-managed restaurants.";
const savedAt = "2026-11-13T08:00:00.000Z";
const sessionId = "sess-prod-1";

const stored = interviewDraftRuleText(
  interviewDraftWithQuestion(
    [
      { role: "assistant", content: question },
      { role: "user", content: answer },
    ],
    question,
    1,
    { sessionId, savedAt },
  ),
);
const parsed = JSON.parse(stored) as {
  messages: { role: string; content: string }[];
  question: string;
  modelTurns: number;
  sessionId: string;
  savedAt: string;
};
assert(parsed.messages[0]?.role === "assistant" && parsed.messages.some((message) => message.content === answer), "the row is messages, question, modelTurns");
assert(parsed.question === question && parsed.modelTurns === 1, "question and modelTurns stay");
assert(parsed.sessionId === sessionId && parsed.savedAt === savedAt, "session_id and savedAt sit in the JSON");
const reloaded = interviewDraftFromRuleText(stored);
assert(reloaded?.sessionId === sessionId && reloaded.messages[1]?.content === answer, "reload resumes the same session");

const legacy = interviewDraftFromRuleText(
  JSON.stringify({
    messages: [{ role: "assistant", content: question }],
    question,
    modelTurns: 1,
  }),
);
assert(legacy?.sessionId == null, "a legacy row has no session");

const sessions = groupInterviewSessions([
  interviewDraftWithQuestion([{ role: "assistant", content: "Old ask" }, { role: "user", content: "Old answer" }], "Old ask", 1),
  interviewDraftWithQuestion(
    [{ role: "assistant", content: "Other ask" }, { role: "user", content: "Other answer" }],
    "Other ask",
    1,
  ),
  interviewDraftWithQuestion(
    [{ role: "assistant", content: question }, { role: "user", content: answer }],
    question,
    1,
    { sessionId, savedAt },
  ),
  interviewDraftWithQuestion(
    [{ role: "assistant", content: "Follow up" }, { role: "user", content: "Still the same session" }],
    "Follow up",
    2,
    { sessionId, savedAt: "2026-11-13T09:00:00.000Z" },
  ),
]);
assert(sessions.length === 3, `legacy rows stay separate and one session stays one: ${sessions.length}`);

const html = renderToStaticMarkup(
  createElement(PastInterviews, {
    question: "",
    thinking: false,
    sessions: sessions.slice(0, 1),
  }),
);
assert(html.includes("1 interview"), html);
assert(html.includes("Old answer"), "the interview expands to the answer");
assert(!html.includes("<details open"), "the interview starts collapsed");
assert(!html.includes("{"), "the log does not print JSON");

assert(PRACTICE_SETUP_INTERVIEW_MS >= 25_000 + 5_000, "the client waits past the 25s edge timeout");
const panel = readFileSync("src/components/practice-setup-panel.tsx", "utf8");
assert(panel.includes("thinkingNow"), "boot and turns share the thinking state");
assert(IMPLEMENTATION_MANAGER_THINKING.startsWith("Implementation Manager is thinking"), "the bubble names Implementation Manager");
assert(!panel.includes("Loading your practice."), "boot does not say the practice is loading");
const edge = readFileSync("supabase/functions/setup-partner/index.ts", "utf8");
assert(edge.includes("retireFirmInterviewDraft"), "confirm retires the interview");
assert(!edge.includes(".delete()"), "the interview row is not deleted");
assert(edge.includes("sessionId"), "each turn stores the session");
assert(edge.includes("insertApprovalDrafts"), "confirm creates approval drafts");

assert(interviewAnswerCount([{ role: "user" }, { role: "assistant" }, { role: "user" }]) === 2, "answers are user turns");
assert(
  !shouldBuildInterviewMap({ answers: INTERVIEW_MAP_MIN_ANSWERS - 1, modelDone: true, forced: false }),
  "three answers do not map yet",
);
assert(
  shouldBuildInterviewMap({ answers: INTERVIEW_MAP_MIN_ANSWERS, modelDone: true, forced: false }),
  "four answers and a finished model map",
);
assert(shouldBuildInterviewMap({ answers: 0, modelDone: false, forced: true }), "That's enough maps immediately");
assert(
  !shouldBuildInterviewMap({ answers: INTERVIEW_MAP_OFFER_ANSWERS - 1, modelDone: false, forced: false }),
  "five answers still wait for the model",
);
assert(
  shouldBuildInterviewMap({ answers: INTERVIEW_MAP_OFFER_ANSWERS, modelDone: false, forced: false }),
  "six answers offer the map without another numeric question",
);
assert(
  implementationManagerStep({ phase: "map", interviewing: false }) === "plan",
  "the stepper lands on the integration plan",
);
assert(
  implementationManagerStep({
    phase: "interview",
    interviewing: true,
    integrationStarted: true,
    firmRunCount: 0,
  }) === "access",
  "start unlocks the checklist while the interview is still open",
);
assert(tourHiddenOnPath("/practice/setup"), "the first-run tour stays off Implementation Manager");
assert(!tourHiddenOnPath("/practice"), "the practice tour still runs on the book");
assert(isImSampleClient({ name: "New York Yankees", isDemo: false }), "Yankees is not a pilot");
assert(!isImSampleClient({ name: "Karoo Woodwork", isDemo: false }), "a real client name can be the pilot");
assert(isImSampleClient({ name: "Harbour Glass", isDemo: true }), "a demo flag is not a pilot");
const held = parseImSetupHold(
  JSON.stringify({
    pendingMap: {
      todaysFlow: ["Partner reviews the pack"],
      milonCoverage: [{ agent: "Analyst", owns: "the management report" }],
      gaps: [],
      checklist: [],
    },
    rows: [
      {
        playId: "management-pack",
        problem: "What do you hand the client at month end?",
        milon: "Advisory PDF pack",
        routine: "Every month, after the close",
        clientSees: "A signed-off PDF.",
        approve: "You review it.",
        bot: "Analyst",
        section: "lead",
        status: "Waiting",
        actionLabel: "Open the Management Report",
        actionHref: "/clients/abc",
        actionPrompt: "",
        actionApprove: "You sign off the PDF.",
        clientName: "Harbour Glass",
      },
    ],
    started: true,
    lines: queuedRunningLines({
      pilot: { id: "abc", name: "Harbour Glass" },
      routines: [{ routine: "monthly_pack", bot: "Analyst" }],
    }),
  }),
);
assert(held?.pendingMap?.todaysFlow[0] === "Partner reviews the pack", "the map reloads from the hold");
assert(held?.rows[0]?.clientName === "Harbour Glass", "the stored plan keeps its pilot");
assert(held?.started === true && held.lines[0]?.href.includes("/clients/abc"), "start reloads with an openable draft");
assert(held.lines[0]?.status === "Draft queued", "a start without a live run still reads as queued");
assert(
  implementationManagerStep({ phase: "done", interviewing: false, firmRunCount: 0 }) === "plan",
  "no agent runs means the stepper is not on what's running",
);
assert(
  implementationManagerStep({ phase: "done", interviewing: false, firmRunCount: 1 }) === "running",
  "agent runs move the stepper to what's running now",
);

const titles = approvalDraftTitles({
  todaysFlow: ["Partner reviews the pack", "Call the extract_workflow tool"],
  checklist: ["Send the management pack for approval", "{not a draft}"],
  milonCoverage: [],
  gaps: [],
});
assert(titles.includes("Partner reviews the pack"), "the plan step is a draft");
assert(titles.includes("Send the management pack for approval"), "the checklist step is a draft");
assert(!titles.some((title) => title.includes("{") || /tool/i.test(title)), `no internals: ${titles.join("|")}`);

console.log("im-interview-session ok");
