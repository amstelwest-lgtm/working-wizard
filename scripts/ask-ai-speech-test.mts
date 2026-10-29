/**
 * Accountant Ask: Speak fills the draft and does not send.
 * Run: pnpm test:ask-ai-speech
 */
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const window = new Window({
  url: "http://127.0.0.1:5000/clients/client-1?tab=home",
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});

for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLTextAreaElement",
  "Element",
  "Node",
  "Document",
  "Event",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "sessionStorage",
  "localStorage",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: window[key],
  });
}

type SpeechEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };

class FakeRecognition {
  static latest: FakeRecognition | null = null;
  lang = "";
  interimResults = false;
  onresult: ((event: SpeechEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  start() {
    FakeRecognition.latest = this;
  }
  stop() {
    this.onend?.();
  }
}

type SpeechHost = {
  SpeechRecognition?: typeof FakeRecognition;
  webkitSpeechRecognition?: typeof FakeRecognition;
};

const speechHost = window as unknown as SpeechHost;

let fetches = 0;
globalThis.fetch = async () => {
  fetches += 1;
  return new Response(JSON.stringify({ answer: "should not run from speech" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const { mountAskAi } = await import("../src/lib/ask-ai.js");
const { startBrowserSpeech } = await import("../src/lib/browser-speech.ts");

function mountAccountant() {
  const host = document.createElement("div");
  host.dataset.clientId = "client-1";
  document.body.appendChild(host);
  mountAskAi(host, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    variant: "studio",
    audience: "accountant",
    getToken: async () => "token",
  });
  return host;
}

function micOf(host: HTMLElement) {
  const mic = host.querySelector<HTMLButtonElement>(".ask-ai-mic");
  if (!mic) throw new Error("Speak button missing");
  return mic;
}

function draftOf(host: HTMLElement) {
  const ta = host.querySelector<HTMLTextAreaElement>(".ask-ai-textarea");
  if (!ta) throw new Error("draft textarea missing");
  return ta;
}

speechHost.SpeechRecognition = FakeRecognition;
delete speechHost.webkitSpeechRecognition;

{
  const heard: string[] = [];
  const session = startBrowserSpeech({
    lang: "en",
    onTranscript: (text) => heard.push(text),
    onMissed: () => heard.push("missed"),
    onEnd: () => heard.push("end"),
  });
  assert(session, "SpeechRecognition starts a session");
  const rec = FakeRecognition.latest;
  assert(rec, "start() ran");
  const late = rec.onresult;
  rec.onresult?.({ results: [[{ transcript: "  cash drag  " }]] });
  assert(heard.join(",") === "cash drag", "helper trims the transcript and does not send");
  session.stop();
  late?.({ results: [[{ transcript: "sent anyway" }]] });
  rec.onend?.();
  assert(heard.join(",") === "cash drag", "stop drops a late transcript");
  assert(fetches === 0, "helper never calls send");
}

{
  delete speechHost.SpeechRecognition;
  delete speechHost.webkitSpeechRecognition;
  const missing = startBrowserSpeech({
    onTranscript: () => assert(false, "no transcript without an API"),
    onMissed: () => assert(false, "missing API is not a miss"),
    onEnd: () => assert(false, "missing API does not end a session"),
  });
  assert(missing === null, "missing speech API returns null");
}

{
  delete speechHost.SpeechRecognition;
  speechHost.webkitSpeechRecognition = FakeRecognition;
  const host = mountAccountant();
  const mic = micOf(host);
  assert(mic.getAttribute("aria-label") === "Speak", "mic is labeled Speak");
  assert(mic.getAttribute("aria-pressed") === "false", "mic starts unpressed");
  mic.click();
  const listening = micOf(host);
  assert(listening.getAttribute("aria-label") === "Stop listening", "toggle labels Stop listening");
  assert(listening.getAttribute("aria-pressed") === "true", "listening sets aria-pressed");
  assert(listening.classList.contains("is-on"), "listening uses the on state");
  assert(draftOf(host).placeholder === "Listening.", "placeholder says Listening.");
  const rec = FakeRecognition.latest;
  if (!rec) throw new Error("webkit recognition did not start");
  rec.onresult?.({ results: [[{ transcript: "  Where is the cash drag?  " }]] });
  assert(draftOf(host).value === "Where is the cash drag?", "transcript lands in the draft before send");
  assert(fetches === 0, "speech does not send");
  rec.onend?.();
  const settled = draftOf(host);
  assert(settled.value === "Where is the cash drag?", "draft keeps the transcript after recognition ends");
  assert(settled.placeholder !== "Listening.", "placeholder leaves Listening. when recognition ends");
  const send = host.querySelector<HTMLButtonElement>(".ask-ai-send");
  assert(send && !send.disabled, "Send stays available for the person to press");
  assert(micOf(host).getAttribute("aria-label") === "Speak", "mic returns to Speak");
  assert(fetches === 0, "ending recognition still does not send");
  host.remove();
}

{
  speechHost.SpeechRecognition = FakeRecognition;
  const host = mountAccountant();
  micOf(host).click();
  const rec = FakeRecognition.latest;
  if (!rec) throw new Error("recognition did not start");
  const late = rec.onresult;
  micOf(host).click();
  assert(micOf(host).getAttribute("aria-label") === "Speak", "second press stops listening");
  assert(draftOf(host).placeholder !== "Listening.", "stop restores the draft placeholder");
  late?.({ results: [[{ transcript: "ignore this" }]] });
  assert(draftOf(host).value === "", "a transcript after Stop does not fill the draft");
  assert(fetches === 0, "stop does not send");
  host.remove();
}

{
  delete speechHost.SpeechRecognition;
  delete speechHost.webkitSpeechRecognition;
  const host = mountAccountant();
  micOf(host).click();
  const err = host.querySelector(".ask-ai-error");
  assert(err?.textContent === "Voice is not available in this browser.", "missing API explains itself");
  assert(draftOf(host).value === "", "missing API leaves the draft empty");
  assert(fetches === 0, "missing API does not send");
  host.remove();
}

{
  speechHost.SpeechRecognition = FakeRecognition;
  const host = mountAccountant();
  micOf(host).click();
  const rec = FakeRecognition.latest;
  if (!rec) throw new Error("recognition did not start");
  rec.onerror?.();
  rec.onend?.();
  assert(host.querySelector(".ask-ai-error")?.textContent === "Voice did not catch that.", "a miss stays in the draft area");
  assert(draftOf(host).value === "", "a miss does not invent a draft");
  assert(fetches === 0, "a miss does not send");
  host.remove();
}

{
  const host = document.createElement("div");
  host.dataset.clientId = "client-1";
  document.body.appendChild(host);
  mountAskAi(host, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => "token",
  });
  host.querySelector<HTMLButtonElement>(".ask-ai-trigger")?.click();
  assert(!host.querySelector(".ask-ai-mic"), "owner Ask keeps its own composer mic");
  host.remove();
}

const ownerSrc = readFileSync(new URL("../src/components/owner-door/owner-door.tsx", import.meta.url), "utf8");
assert(ownerSrc.includes("startBrowserSpeech"), "owner Speak uses the shared browser speech helper");
assert(!ownerSrc.includes("function speechRecognition"), "owner Speak does not keep a second recognizer");

console.log("ask-ai-speech: ok");
