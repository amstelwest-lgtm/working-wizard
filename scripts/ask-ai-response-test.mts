/**
 * Milōn Bot / ask-ai response handling — empty, error, and non-JSON bodies
 * must become a visible failure, never a successful empty turn.
 * Run: pnpm test:ask-ai-response
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ASK_EMPTY_REPLY,
  ASK_UNREADABLE_REPLY,
  parseAskAiBody,
  parseAskAiPayload,
} from "../src/lib/ask-ai-response.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const ok = parseAskAiBody(200, {
  answer: "Cash is tight.",
  chips: ["Next?", "", 4],
  tools: [{ name: "answer_from_brain", status: "ok" }, { name: "" }, null, "nope"],
  run: { objective: "see cash", trace: [] },
  created: { packId: "p1" },
});
assert(ok.ok, "a real answer is a success");
if (ok.ok) {
  assert(ok.answer === "Cash is tight.", "answer text kept");
  assert(ok.chips.length === 1 && ok.chips[0] === "Next?", "chips stay strings");
  assert(ok.tools.length === 1 && ok.tools[0].name === "answer_from_brain", "tools drop junk");
  assert(ok.run?.objective === "see cash", "agent run is kept");
  assert(ok.created && typeof ok.created === "object", "created payload is kept");
}

const blank = parseAskAiBody(200, { answer: "   ", chips: ["ignored"] });
assert(!blank.ok && blank.error === ASK_EMPTY_REPLY, "whitespace answer is a failure");

const missing = parseAskAiBody(200, { tools: [] });
assert(!missing.ok && missing.error === ASK_EMPTY_REPLY, "missing answer is a failure");

const edged = parseAskAiBody(200, { error: "Client not accessible" });
assert(!edged.ok && edged.error === "Client not accessible", "200 with error and no answer shows the error");

const denied = parseAskAiBody(403, { error: "Client not accessible" }, false);
assert(!denied.ok && denied.error === "Client not accessible", "403 shows the edge error");

const rate = parseAskAiBody(429, {}, false);
assert(!rate.ok && /rate limit/i.test(rate.error), "429 without a body still says rate limit");

const crashed = parseAskAiPayload(500, "", false);
assert(!crashed.ok && crashed.error === "Error 500", "empty 500 is an error, not a reply");

const html = parseAskAiPayload(502, "<!doctype html><html><body>bad gateway</body></html>", false);
assert(!html.ok && html.error.includes("Couldn't read Milōn's reply"), "HTML error page is not silent");
assert(html.ok === false && html.error.includes("502"), "HTML failure keeps the status");

const garbage = parseAskAiPayload(200, "not-json{{", true);
assert(!garbage.ok && garbage.error === ASK_UNREADABLE_REPLY, "non-JSON 200 is a failure");

const emptyOk = parseAskAiPayload(200, "   ", true);
assert(!emptyOk.ok && emptyOk.error === ASK_EMPTY_REPLY, "empty 200 body is a failure");

const parsed = parseAskAiPayload(200, JSON.stringify({ answer: "On file." }), true);
assert(parsed.ok && parsed.answer === "On file.", "JSON text becomes a reply");

const widget = readFileSync(resolve("src/lib/ask-ai.js"), "utf8");
const submit = widget.slice(widget.indexOf("async function submit"));
assert(submit.includes("parseAskAiPayload") || widget.includes("parseAskAiPayload"), "widget parses the raw body");
assert(submit.includes("readTurn"), "submit reads a turn instead of assuming JSON");
assert(!submit.includes("data.answer ||"), "a missing answer is not replaced with a fake success");
assert(
  submit.indexOf("await fetch") < submit.indexOf('question = ""'),
  "composer clear stays after the request",
);
assert(submit.includes("question = q"), "a failed send restores the draft");
assert(submit.includes("safeRender"), "a paint failure cannot end the turn with an empty box");
assert(widget.includes('err.role = "alert"'), "the failure is an alert in the thread");

console.log("ask-ai-response-test: ok");
