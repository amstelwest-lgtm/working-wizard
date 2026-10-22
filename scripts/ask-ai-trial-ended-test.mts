/**
 * A cardless trial-ended block in Analyst chat, Bot, or ask-ai is the plan
 * card. Retry stays for a real failure, because retrying the block cannot succeed.
 * Run: pnpm test:ask-ai-trial-ended
 */
import { parseAskAiBody } from "../src/lib/ask-ai-response.ts";
import {
  STARTER_TRIAL_ENDED_CODE,
  STARTER_TRIAL_ENDED_MESSAGE,
} from "../src/lib/starter-trial-constants.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

type Handler = (event?: unknown) => void;

class FakeElement {
  tagName: string;
  className = "";
  type = "";
  role = "";
  disabled = false;
  placeholder = "";
  value = "";
  dataset: Record<string, string | undefined> = {};
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  private html = "";
  private handlers: Record<string, Handler[]> = {};

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(value: string) {
    this.html = value;
    if (value === "") this.children = [];
  }
  get textContent(): string {
    return this.html;
  }
  set textContent(value: string) {
    this.html = value;
  }
  addEventListener(event: string, fn: Handler) {
    (this.handlers[event] ??= []).push(fn);
  }
  removeEventListener() {}
  dispatchEvent(event: { type?: string }) {
    for (const fn of this.handlers[event?.type ?? ""] ?? []) fn(event);
  }
  click() {
    for (const fn of this.handlers.click ?? []) fn({});
  }
  input(value: string) {
    this.value = value;
    for (const fn of this.handlers.input ?? []) fn({ target: this });
  }
  focus() {}
  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }
  setAttribute() {}
  find(predicate: (el: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }
}

(globalThis as { document?: unknown }).document = {
  createElement: (tag: string) => new FakeElement(tag),
};
(globalThis as { requestAnimationFrame?: Handler }).requestAnimationFrame = (fn) => {
  fn();
};
(globalThis as { window?: unknown }).window = globalThis;
(globalThis as { location?: { search: string } }).location = { search: "" };

type Listener = (event: { type: string }) => void;
const listeners = new Map<string, Listener[]>();
const trialEvents: string[] = [];
(globalThis as { addEventListener?: (type: string, fn: Listener) => void }).addEventListener = (
  type,
  fn,
) => {
  const list = listeners.get(type) ?? [];
  list.push(fn);
  listeners.set(type, list);
};
(globalThis as { dispatchEvent?: (event: { type: string }) => boolean }).dispatchEvent = (event) => {
  trialEvents.push(event.type);
  for (const fn of listeners.get(event.type) ?? []) fn(event);
  return true;
};

const { mountAskAi } = await import("../src/lib/ask-ai.js");

function mount(clientId = "route-client") {
  const container = new FakeElement("div");
  container.dataset.clientId = clientId;
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    botEndpoint: "https://example.com/functions/v1/milon-bot",
    variant: "studio",
    audience: "accountant",
    getToken: async () => "test-token",
  });
  return container;
}

function send(container: FakeElement, question: string) {
  const ta = container.find((el) => el.className.includes("ask-ai-textarea"));
  if (!ta) throw new Error("textarea missing");
  ta.input(question);
  const button = container.find((el) => el.className.includes("ask-ai-send"));
  if (!button) throw new Error("send missing");
  button.click();
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function planBlock(container: FakeElement) {
  return container.find((el) => el.className.includes("trial-ended-block"));
}

function planTitle(container: FakeElement) {
  return container.find((el) => el.className.includes("trial-ended-title"));
}

function retryButton(container: FakeElement) {
  return container.find((el) => el.className.includes("ask-ai-retry"));
}

function errorRow(container: FakeElement) {
  return container.find((el) => el.className.includes("ask-ai-error"));
}

function assertPlan(container: FakeElement, where: string) {
  assert(retryButton(container) == null, `${where} has no Retry`);
  assert(errorRow(container) == null, `${where} is not a red error`);
  assert(planBlock(container) != null, `${where} shows the plan block`);
  assert(
    planTitle(container)?.textContent === STARTER_TRIAL_ENDED_MESSAGE,
    `${where} uses the trial-ended message`,
  );
  assert(container.children[0]?.dataset.askState === "trial-ended", `${where} is not the error state`);
}

const calls: string[] = [];
(globalThis as { fetch?: unknown }).fetch = async (url: string) => {
  calls.push(String(url));
  const bot = String(url).includes("/milon-bot");
  const question = bot ? "bot" : "ask";
  if (question === "bot") {
    return {
      ok: false,
      status: 403,
      json: async () => ({ error: STARTER_TRIAL_ENDED_MESSAGE, code: STARTER_TRIAL_ENDED_CODE }),
    };
  }
  return {
    ok: false,
    status: 403,
    json: async () => ({ error: STARTER_TRIAL_ENDED_MESSAGE, code: STARTER_TRIAL_ENDED_CODE }),
  };
};

const ask = mount();
send(ask, "What is this client's health score?");
await flush();
assert(calls.some((url) => url.includes("/ask-ai")), "a health question goes to ask-ai");
assertPlan(ask, "ask-ai trial-ended");
assert(
  ask.find((el) => el.className.includes("ask-ai-turn-user"))?.textContent ===
    "What is this client's health score?",
  "the question stays in the thread",
);
assert(trialEvents.includes("milon-starter-trial-ended"), "ask-ai still tells the page the trial ended");

calls.length = 0;
const bot = mount("bot-client");
send(bot, "What's still outstanding for this client?");
await flush();
assert(calls.some((url) => url.includes("/milon-bot")), "an outstanding question goes to milon-bot");
assertPlan(bot, "Bot trial-ended");

(globalThis as { fetch?: unknown }).fetch = async () => ({
  ok: false,
  status: 403,
  json: async () => ({ error: "Draft was not saved.", code: STARTER_TRIAL_ENDED_CODE }),
});
const coded = mount("code-client");
send(coded, "What is cash on file?");
await flush();
assertPlan(coded, "a structured trial-ended code");

(globalThis as { fetch?: unknown }).fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({ answer: STARTER_TRIAL_ENDED_MESSAGE, chips: ["Try again"] }),
});
const beforeEvents = trialEvents.length;
const answered = mount("answer-client");
send(answered, "Draft the advisory pack now");
await flush();
assertPlan(answered, "a trial-ended answer");
assert(
  answered.find((el) => el.className.includes("ask-ai-chip")) == null,
  "a trial-ended answer does not offer reply chips",
);
assert(trialEvents.length > beforeEvents, "a trial-ended answer still opens the page plan card");

const memory = new Map<string, string>();
(globalThis as { sessionStorage?: Storage }).sessionStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
  key: () => null,
  get length() {
    return memory.size;
  },
};
memory.set(
  "milon-bot-thread:restored-client",
  JSON.stringify({
    key: "",
    turns: [
      {
        role: "user",
        content: "What is this client's health score?",
        turnId: "turn-1",
        error: STARTER_TRIAL_ENDED_MESSAGE,
        trialEnded: true,
      },
    ],
  }),
);
const restored = mount("restored-client");
assertPlan(restored, "a restored trial-ended turn");

(globalThis as { fetch?: unknown }).fetch = async () => ({
  ok: false,
  status: 500,
  json: async () => ({ error: "Could not check the plan. Nothing was generated." }),
});
const failed = mount("error-client");
send(failed, "What is this client's health score?");
await flush();
assert(planBlock(failed) == null, "a real failure does not show the plan block");
assert(errorRow(failed) != null, "a real failure stays a red error");
assert(retryButton(failed)?.textContent === "Retry", "a real failure still offers Retry");
assert(
  (errorRow(failed)?.textContent ?? "").includes("Could not check the plan"),
  "a real failure shows its message",
);
assert(failed.children[0]?.dataset.askState === "error", "a real failure stays the error state");

const blocked = parseAskAiBody(
  403,
  { error: STARTER_TRIAL_ENDED_MESSAGE, code: STARTER_TRIAL_ENDED_CODE },
  false,
);
assert(!blocked.ok, "a trial-ended 403 is not a reply");
if (!blocked.ok) {
  assert(blocked.error === STARTER_TRIAL_ENDED_MESSAGE, "the trial-ended message is kept");
  assert(blocked.code === STARTER_TRIAL_ENDED_CODE, "the trial-ended code is kept");
}

const generic = parseAskAiBody(500, { error: "Could not check the plan. Nothing was generated." }, false);
assert(
  !generic.ok && generic.error === "Could not check the plan. Nothing was generated.",
  "a real failure stays an error",
);
assert(!generic.ok && generic.code == null, "a real failure has no trial code");

console.log("ask-ai-trial-ended-test: ok");
