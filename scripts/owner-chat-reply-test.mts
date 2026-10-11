/**
 * Owner chat replies: no auto speech, safe layout, one thread per agent.
 * Run: pnpm test:owner-chat-reply
 */
import { readFileSync } from "node:fs";
import {
  createOwnerChatDesk,
  historyFromThread,
  memoryThreadStore,
  ownerLegacyThreadKey,
  ownerThreadKey,
  readOwnerThreads,
  type ThreadStore,
} from "../src/lib/owner-chat-thread.ts";
import { ownerAskPayload } from "../src/lib/owner-ask.ts";
import {
  OWNER_REPLY_BLOB,
  OWNER_REPLY_STRUCTURED_BOLD,
  OWNER_REPLY_STRUCTURED_PLAIN,
  formatOwnerReply,
  ownerReplyPlainText,
  runsText,
} from "../src/lib/owner-reply-format.ts";
import { createReplySpeech, type SpeechPort } from "../src/lib/owner-reply-speech.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function flatten(text: string) {
  return ownerReplyPlainText(formatOwnerReply(text));
}

const blob = formatOwnerReply(OWNER_REPLY_BLOB);
const blobText = ownerReplyPlainText(blob);
assert(runsText(blob.headline).startsWith("Overall, healthy:"), `blob headline (${runsText(blob.headline)})`);
assert(blob.headline.some((run) => run.bold && run.text === "80/100"), "80/100 is bold");
assert(blobText.includes("operating margin at 2.9%"), "the weak spot stays in the reply");
assert(blob.body.length >= 2, "the blob splits into short paragraphs");
assert(blob.actions.length === 2, `blob next actions are a list (${blob.actions.length})`);
assert(runsText(blob.actions[0]).startsWith("Look at why"), "the first action is a real item");
assert(!runsText(blob.actions[0]).startsWith("-"), "the action marker is not left in the text");
assert(runsText(blob.actions[1]).includes("8 Sep 2026"), `ISO date becomes 8 Sep 2026 (${runsText(blob.actions[1])})`);
assert(!blobText.includes("2026-09-08"), "the ISO date is not left in the blob");
assert(!blobText.includes("**"), "bold markers are not shown raw");
assert(!blobText.includes(" - "), "inline bullets are not left in the paragraph");

const bold = formatOwnerReply(OWNER_REPLY_STRUCTURED_BOLD);
assert(runsText(bold.headline) === "Overall, healthy: 80/100 for Sep 2026.", `bold headline (${runsText(bold.headline)})`);
assert(bold.headline.some((run) => run.bold && run.text === "80/100"), "structured score is bold");
assert(bold.stats.length === 5, `five key figures (${bold.stats.length})`);
assert(bold.stats.map((stat) => stat.label).join("|") === "Score|Revenue|Net profit|Gross margin|Operating margin", "stat labels stay in order");
assert(bold.stats[1].value.some((run) => run.text.includes("R4,200,000")), "revenue stays on the stat");
assert(bold.actions.length === 3, "bold next actions are three numbered items");
assert(runsText(bold.actions[1]).includes("8 Sep 2026"), "ISO date in a numbered item is rewritten");
assert(!ownerReplyPlainText(bold).includes("2026-09-08"), "structured ISO date is gone");
assert(!ownerReplyPlainText(bold).includes("**"), "the bold heading is not raw markdown");

const plain = formatOwnerReply(OWNER_REPLY_STRUCTURED_PLAIN);
assert(plain.stats.length === 3, "plain next-actions heading still yields the stat row");
assert(plain.actions.length === 2, "plain Next actions is the same list");
assert(ownerReplyPlainText(plain).includes("8 Sep 2026"), "a friendly date is kept");
assert((ownerReplyPlainText(plain).match(/8 Sep 2026/g) ?? []).length === 1, "a friendly date is not rewritten twice");
assert(!ownerReplyPlainText(plain).includes("2026-09-08"), "the plain fixture has no ISO date");

const capped = formatOwnerReply(`${OWNER_REPLY_STRUCTURED_BOLD}\n4. Ignore this extra action.`);
assert(capped.actions.length === 3, "next actions stop at three");
assert(!ownerReplyPlainText(capped).includes("Ignore this extra"), "a fourth action is not shown");

const evil = [
  "Fine. <script>alert(1)</script>",
  "",
  "- Score: 80<img src=x onerror=alert(1)>",
  "- Revenue: R1",
  "- Margin: 10%",
  "",
  "**Next actions**",
  '1. <a href="javascript:alert(1)">Click</a> the books',
].join("\n");
const evilText = flatten(evil);
assert(!evilText.includes("<"), `no raw tags (${evilText})`);
assert(!/script/i.test(evilText), "script contents are dropped");
assert(!/onerror/i.test(evilText), "event handlers are dropped");
assert(!/javascript:/i.test(evilText), "javascript urls are dropped");
assert(evilText.includes("Click"), "link text stays as text");
assert(evilText.includes("Fine."), "the headline stays");

const free = formatOwnerReply("Hello **there**. This is a second sentence.");
assert(runsText(free.headline).startsWith("Hello "), "free text still has a headline");
assert(free.headline.some((run) => run.bold && run.text === "there"), "free text keeps bold");
assert(free.stats.length === 0, "free text does not invent a stat row");

const calls: string[] = [];
let finish = () => {};
const port: SpeechPort = {
  cancel() {
    calls.push("cancel");
  },
  speak(utterance) {
    calls.push(`speak:${utterance.text}`);
    finish = utterance.onend;
  },
};
const speech = createReplySpeech(port);
speech.noteReply();
speech.noteVoiceInput();
assert(!calls.some((call) => call.startsWith("speak")), "a reply and voice input do not start speech");
assert(speech.tap("m1", "Hello", { onPlay() {}, onStop() {} }) === "playing", "an explicit tap plays");
assert(calls.includes("speak:Hello"), "the tapped message is the one spoken");
assert(speech.tap("m1", "Hello", { onPlay() {}, onStop() {} }) === "stopped", "a second tap stops");
assert(calls.includes("cancel"), "stop cancels speech");
assert(calls.filter((call) => call.startsWith("speak")).length === 1, "stopping does not speak again");
finish();
assert(speech.tap("m2", "   ", { onPlay() {}, onStop() {} }) === "unavailable", "blank text does not speak");

const door = readFileSync("src/components/owner-door/owner-door.tsx", "utf8");
const chat = readFileSync("src/components/owner-door/owner-chat.tsx", "utf8");
const speechSrc = readFileSync("src/lib/owner-reply-speech.ts", "utf8");
const replySrc = readFileSync("src/components/owner-door/owner-reply.tsx", "utf8");
assert(!door.includes("speechSynthesis"), "the door does not touch speechSynthesis");
assert(!door.includes("synth.speak"), "the door does not speak a reply");
assert(!/speak\(result/.test(door), "send does not auto-speak");
assert(!door.includes("localStorage") || door.includes("browserThreadStore"), "speech is not switched on from storage");
assert(!door.includes("readAloud") && !door.includes("autoSpeak"), "there is no default-on speech flag");
assert(door.includes("historyFromThread"), "ask history comes from one agent thread");
assert(door.includes("stopRecording"), "switching agents stops the recording");
assert(door.includes("focusAgent"), "opening another agent focuses that thread");
assert(chat.includes('"Listen"') && chat.includes('"Stop"'), "each reply has Listen and Stop");
assert(chat.includes("noteReply()"), "an arriving reply is noted and not spoken");
assert(chat.includes(".tap("), "speech starts from the Listen tap");
assert(!chat.includes("speechSynthesis"), "the chat view does not speak on its own");
assert(!chat.includes("autoplay"), "no audio autoplay");
assert(!speechSrc.includes("localStorage"), "speech has no stored default");
assert(!speechSrc.includes("autoplay"), "the speech module does not autoplay");
assert(!replySrc.includes("dangerouslySetInnerHTML") && !replySrc.includes("innerHTML"), "replies are not raw HTML");

const store = memoryThreadStore();
const desk = createOwnerChatDesk(store, "client-1");
const sent = desk.send("How is cash?");
assert(sent?.agent === "financial_manager", "the send is for the financial manager");
assert(sent?.history.length === 0, "the first question is not its own history");
desk.receive("financial_manager", "Cash is fine.");
desk.setDraft("fm note");
desk.startRecording();
desk.switchTo("analyst");
assert(desk.recording() === null, "switching cancels the recording");
assert(desk.applyTranscript("heard on the financial manager") === false, "a late transcript does not land");
assert(desk.messages().length === 0, "the analyst thread starts empty");
assert(desk.draft() === "", "the financial manager draft does not leak");
desk.setDraft("analyst note");
const analystPayload = ownerAskPayload({
  clientId: "client-1",
  agent: desk.agent(),
  question: "What changed?",
  history: historyFromThread(desk.messages()),
  route: "ask-ai",
});
assert(analystPayload.agent === "analyst", "the ask body names the analyst");
const analystBody = JSON.stringify(analystPayload);
assert(!analystBody.includes("How is cash?"), "analyst history does not include the financial manager");
assert(!analystBody.includes("Cash is fine."), "analyst history does not include the other reply");
desk.switchTo("financial_manager");
assert(desk.messages().map((turn) => turn.text).join("|") === "How is cash?|Cash is fine.", "the financial manager thread is intact");
assert(desk.draft() === "fm note", "the financial manager draft is still its own");

const reloaded = createOwnerChatDesk(store, "client-1");
assert(reloaded.messages().map((turn) => turn.text).join("|") === "How is cash?|Cash is fine.", "the financial manager thread is stored");
reloaded.switchTo("analyst");
assert(reloaded.draft() === "analyst note", "the analyst draft is stored on its own");
assert(reloaded.messages().length === 0, "reloading does not mix the threads");

const fmPayload = ownerAskPayload({
  clientId: "client-1",
  agent: "financial_manager",
  question: "And next month?",
  history: historyFromThread(reloaded.agent() === "analyst" ? [] : reloaded.messages()),
  route: "milon-bot",
});
const fmHistory = historyFromThread(
  readOwnerThreads(store, "client-1").financial_manager.messages,
);
const fmBody = ownerAskPayload({
  clientId: "client-1",
  agent: "financial_manager",
  question: "And next month?",
  history: fmHistory,
  route: "ask-ai",
});
assert(fmBody.agent === "financial_manager", "the financial manager body names that agent");
assert(JSON.stringify(fmBody.history).includes("How is cash?"), "financial manager history is only that thread");
assert(JSON.stringify(fmBody.history).includes("Cash is fine."), "the stored reply is in that history");
assert(!JSON.stringify(fmBody.history).includes("analyst note"), "a draft is not sent as history");
assert(fmPayload.agent === "financial_manager", "milon-bot gets the same agent");
assert(Array.isArray(fmPayload.history), "milon-bot gets the filtered history");

function legacy(agent: string | undefined, text: string, draft = ""): ThreadStore {
  const raw = JSON.stringify(
    agent === undefined
      ? [{ role: "owner", text }]
      : { agent, messages: [{ role: "owner", text }], draft },
  );
  return memoryThreadStore({ [ownerLegacyThreadKey("client-9")]: raw });
}

const moved = readOwnerThreads(legacy("advisor", "Plan the week", "and the hire"), "client-9");
assert(moved.advisor.messages[0]?.text === "Plan the week", "a legacy thread follows the agent that wrote it");
assert(moved.advisor.draft === "and the hire", "the legacy draft follows that agent");
assert(moved.financial_manager.messages.length === 0, "the financial manager does not receive the advisor thread");
assert(moved.analyst.messages.length === 0, "the analyst does not receive it either");

const unknown = readOwnerThreads(legacy("coach", "Old shared chat"), "client-9");
assert(unknown.financial_manager.messages[0]?.text === "Old shared chat", "an unknown legacy agent lands on the financial manager");
assert(unknown.advisor.messages.length === 0, "an unknown agent is not copied to the advisor");

const bare = readOwnerThreads(legacy(undefined, "Shared before agents"), "client-9");
assert(bare.financial_manager.messages[0]?.text === "Shared before agents", "a legacy list with no agent lands on the financial manager");

const kept = memoryThreadStore();
kept.setItem(
  ownerThreadKey("client-9", "advisor"),
  JSON.stringify({ agent: "advisor", messages: [{ role: "owner", text: "Keep me" }], draft: "" }),
);
kept.setItem(
  ownerLegacyThreadKey("client-9"),
  JSON.stringify({ agent: "advisor", messages: [{ role: "owner", text: "Replace me" }], draft: "nope" }),
);
const merged = readOwnerThreads(kept, "client-9");
assert(merged.advisor.messages[0]?.text === "Keep me", "an existing agent thread wins over the legacy key");
assert(merged.advisor.draft === "", "the legacy draft does not overwrite it");
assert(kept.getItem(ownerLegacyThreadKey("client-9")) === null, "the legacy key is removed after migration");

console.log("owner-chat reply tests passed");
