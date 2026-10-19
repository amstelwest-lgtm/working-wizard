/**
 * The ask-ai widget sends the current agent, and retries one auth blip
 * before it shows Retry.
 * Run: pnpm test:ask-ai-agent-body
 */
import { mountAskAi } from "../src/lib/ask-ai.js";

type Handler = (event?: unknown) => void;

class FakeElement {
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
  click() {
    for (const fn of this.handlers.click ?? []) fn({});
  }
  input(value: string) {
    this.value = value;
    for (const fn of this.handlers.input ?? []) fn({ target: this });
  }
  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }
  focus() {}
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
  createElement: () => new FakeElement(),
};
(globalThis as { requestAnimationFrame?: (fn: () => void) => void }).requestAnimationFrame = (fn) => fn();
(globalThis as { window?: unknown }).window = globalThis;
(globalThis as { location?: { search: string } }).location = { search: "" };

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function openAndSend(container: FakeElement, question: string) {
  const trigger = container.children[0]?.find((el) => el.className.includes("ask-ai-trigger"));
  if (!trigger) throw new Error("trigger missing");
  trigger.click();
  const widget = container.children[0];
  const ta = widget?.find((el) => el.className.includes("ask-ai-textarea"));
  if (!ta) throw new Error("textarea missing");
  ta.input(question);
  const send = widget?.find((el) => el.className.includes("ask-ai-send"));
  if (!send) throw new Error("send missing");
  send.click();
}

type Call = { url: string; body: Record<string, unknown>; token: string };

function jsonResponse(status: number, body: unknown) {
  const payload = { ok: status >= 200 && status < 300, status, body };
  return {
    ok: payload.ok,
    status,
    clone() {
      return { json: async () => body };
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const agents = ["financial_manager", "analyst", "advisor"] as const;

for (const agent of agents) {
  const calls: Call[] = [];
  (globalThis as { fetch?: unknown }).fetch = async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init?.body ?? "{}")),
      token: String((init?.headers as Record<string, string>)?.Authorization ?? ""),
    });
    return jsonResponse(200, { answer: "On the Starter plan.", chips: [] });
  };
  const container = new FakeElement();
  container.dataset.clientId = "client-1";
  container.dataset.agent = agent;
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => "token-1",
    audience: "accountant",
  });
  openAndSend(container, "What plan is this firm on?");
  await flush();
  assert(calls.length === 1, `${agent} sends one ask-ai request`);
  assert(calls[0].url.endsWith("/ask-ai"), `${agent} posts to ask-ai`);
  assert(calls[0].body.agent === agent, `${agent} body includes agent, got ${String(calls[0].body.agent)}`);
  assert(calls[0].body.audience === "accountant", `${agent} body keeps the accountant audience`);
  assert(calls[0].body.clientId === "client-1", `${agent} body keeps the client`);
}

{
  const calls: Call[] = [];
  let refreshes = 0;
  (globalThis as { fetch?: unknown }).fetch = async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init?.body ?? "{}")),
      token: String((init?.headers as Record<string, string>)?.Authorization ?? ""),
    });
    if (calls.length === 1) return jsonResponse(401, { error: "Unauthorised" });
    return jsonResponse(200, { answer: "Retried.", chips: [] });
  };
  const container = new FakeElement();
  container.dataset.clientId = "client-1";
  container.dataset.agent = "advisor";
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => "stale",
    audience: "owner",
    refreshSession: async () => {
      refreshes += 1;
      return "fresh";
    },
  });
  openAndSend(container, "How is cash?");
  await flush();
  assert(refreshes === 1, "a 401 refreshes the session once");
  assert(calls.length === 2, "a 401 retries the request once");
  assert(calls[1].token === "Bearer fresh", "the retry uses the refreshed token");
  assert(calls[1].body.agent === "advisor", "the retry still sends the agent");
  const retry = container.children[0]?.find((el) => el.className.includes("ask-ai-retry"));
  assert(!retry, "a successful auth retry does not show Retry");
}

{
  const calls: Call[] = [];
  let refreshes = 0;
  (globalThis as { fetch?: unknown }).fetch = async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      body: JSON.parse(String(init?.body ?? "{}")),
      token: String((init?.headers as Record<string, string>)?.Authorization ?? ""),
    });
    if (calls.length === 1) {
      return jsonResponse(503, { error: "Auth is temporarily unavailable. Try again.", code: "auth_unavailable" });
    }
    return jsonResponse(200, { answer: "Back.", chips: [] });
  };
  const container = new FakeElement();
  container.dataset.clientId = "client-1";
  container.dataset.agent = "analyst";
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => "token-1",
    refreshSession: async () => {
      refreshes += 1;
      return "should-not-refresh";
    },
  });
  openAndSend(container, "What is the trial?");
  await flush();
  assert(refreshes === 0, "auth_unavailable does not refresh the session");
  assert(calls.length === 2, "auth_unavailable retries once");
  assert(calls[1].token === "Bearer token-1", "the unavailable retry keeps the same token");
}

console.log("ask-ai-agent-body: ok");
