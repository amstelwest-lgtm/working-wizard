/**
 * Implementation Manager interview: one live question, a thinking line,
 * and a compact prior Q/A log.
 * Run: pnpm test:interview-exchange
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  IMPLEMENTATION_MANAGER_THINKING,
  InterviewExchange,
  interviewPairs,
} from "../src/components/interview-exchange.tsx";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const prior = [
  { role: "assistant" as const, content: "Walk me through month end." },
  { role: "user" as const, content: "The bookkeeper posts the supplier bill the same day." },
  { role: "assistant" as const, content: "Who reviews the pack?" },
];

const live = interviewPairs(prior, "Who reviews the pack?", false);
assert(live.length === 1, "the live question stays out of the log");
assert(live[0]?.answer === "The bookkeeper posts the supplier bill the same day.", "the answer stays with its question");

const whileThinking = interviewPairs(prior, "Who reviews the pack?", true);
assert(whileThinking.length === 2, "a thinking turn files the question that was just answered");
assert(whileThinking[1]?.answer == null, "the unanswered live question is not given a blank answer");

const html = renderToStaticMarkup(
  createElement(InterviewExchange, {
    question: "Who reviews the pack?",
    thinking: false,
    messages: prior,
  }),
);
assert(html.includes('class="setup-partner__question"'), "one heading for the live question");
assert(html.includes("Who reviews the pack?"), "the heading is the live question");
assert(html.includes("setup-partner__log-a"), "answers are marked apart from questions");
assert(html.includes("Earlier answers (1)"), "the log is a single collapsible");
assert(!html.includes("<details open"), "the log starts collapsed");

const thinking = renderToStaticMarkup(
  createElement(InterviewExchange, {
    question: "Who reviews the pack?",
    thinking: true,
    messages: prior,
  }),
);
assert(thinking.includes(IMPLEMENTATION_MANAGER_THINKING), "the thinking line is the model wait");
assert(!thinking.includes('class="setup-partner__question"'), "thinking replaces the live heading");

console.log("interview-exchange ok");
