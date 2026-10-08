/**
 * Ask AI — client-switch regression test
 *
 * Verifies that the ask-ai widget sends the *current* client's id in the POST
 * body even after the user navigates from one client to another.
 *
 * Two scenarios are covered:
 *
 *   1. Accountant portal — `dataset.clientId` on the mount container is
 *      refreshed by the useEffect in clients.$clientId.tsx every time the
 *      clientId route param changes.
 *
 *   2. Owner app (impersonation) — `window.__askAiClientId` is refreshed by
 *      the useEffect in app.tsx every time `effectiveClientId` changes.
 *
 * The ask-ai.js submit() reads container.dataset.clientId at request time
 * (not at mount time), so a stale dataset value would send the wrong client id.
 *
 * Run:
 *   pnpm run test:ask-ai-client-switch
 */

// ── Minimal DOM shim ──────────────────────────────────────────────────────────
// ask-ai.js uses: document.createElement, container.innerHTML="", appendChild,
// addEventListener, .dataset, requestAnimationFrame, window.location.search
// We provide just enough surface to drive the widget through open → type → send.

type Handler = (e?: unknown) => void;

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
  private _html = "";
  private _handlers: Record<string, Handler[]> = {};
  children: FakeElement[] = [];

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  // Clearing innerHTML is used by render() to wipe the tree before rebuilding.
  get innerHTML(): string { return this._html; }
  set innerHTML(val: string) {
    this._html = val;
    if (val === "") this.children = [];
  }

  get textContent(): string { return this._html; }
  set textContent(val: string) { this._html = val; }

  addEventListener(event: string, fn: Handler) {
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(fn);
  }

  /** Simulate a user click */
  click() {
    for (const fn of this._handlers["click"] ?? []) fn({});
  }

  /** Simulate typing into a textarea / input */
  input(value: string) {
    this.value = value;
    for (const fn of this._handlers["input"] ?? []) fn({ target: this });
  }

  /** Simulate Enter+Ctrl / Enter+Meta keydown */
  keydownSubmit() {
    for (const fn of this._handlers["keydown"] ?? []) fn({ key: "Enter", ctrlKey: true, preventDefault() {} });
  }

  /** Simulate Enter-to-send (Shift+Enter is a newline and must not send). */
  pressEnter() {
    for (const fn of this._handlers["keydown"] ?? []) {
      fn({ key: "Enter", shiftKey: false, keyCode: 13, preventDefault() {} });
    }
  }

  focus() { /* no-op in test */ }

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  /** BFS helper — finds first descendant matching predicate */
  find(predicate: (el: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }

  findAll(predicate: (el: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    for (const child of this.children) {
      if (predicate(child)) out.push(child);
      out.push(...child.findAll(predicate));
    }
    return out;
  }
}

// Patch Node.js globals to satisfy ask-ai.js at import time and at runtime.
(globalThis as Record<string, unknown>).document = {
  createElement: (tag: string) => new FakeElement(tag),
};
(globalThis as Record<string, unknown>).requestAnimationFrame = (fn: Handler) => {
  // Execute synchronously in test; the widget only uses rAF to focus the textarea.
  fn();
};
// Minimal window.location so URLSearchParams(window.location.search) doesn't throw.
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, { search: string }>).location = { search: "" };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fresh mount container and return it */
function makeContainer(clientId?: string): FakeElement {
  const el = new FakeElement("div");
  el.dataset.id = "ask-ai-container";
  if (clientId) el.dataset.clientId = clientId;
  return el;
}

/** Build a mock fetch that captures POST bodies and returns a canned answer */
function makeMockFetch() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  const mockFetch = async (url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    calls.push({ url, body });
    return {
      ok: true,
      status: 200,
      json: async () => ({ answer: "test answer", chips: [] }),
    };
  };

  return { mockFetch, calls };
}

/** Open the widget panel by finding and clicking the trigger button */
function openWidget(container: FakeElement): FakeElement {
  // The widget child is container.children[0], inside it the trigger button
  const widget = container.children[0];
  const trigger = widget?.find((el) => el.className.includes("ask-ai-trigger"));
  if (!trigger) throw new Error("trigger button not found in rendered widget");
  trigger.click();
  return container;
}

/** Fill the textarea and click Send */
function fillAndSend(container: FakeElement, question: string) {
  const widget = container.children[0];
  const ta = widget?.find((el) => el.className.includes("ask-ai-textarea"));
  if (!ta) throw new Error("textarea not found — is the panel open?");
  ta.input(question);

  const send = widget?.find((el) => el.className.includes("ask-ai-send"));
  if (!send) throw new Error("send button not found");
  send.click();
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅  ${name}`);
    passed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌  ${name}`);
    console.error(`      ${msg}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("\n🔍  Ask AI — client-switch regression tests\n");

// Dynamically import ask-ai.js (uses ES-module `export`)
const { mountAskAi } = await import("../src/lib/ask-ai.js");

// ── Scenario 1: Accountant portal — dataset.clientId path ─────────────────────
//
// Simulates: accountant visits /clients/client-a, then navigates to
// /clients/client-b. The React effect sets container.dataset.clientId = clientId
// each time the route param changes. submit() must read the *current* value.

await test("Scenario 1a: fresh mount sends correct clientId", async () => {
  const { mockFetch, calls } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  const container = makeContainer("client-a-id");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => "test-token",
  });

  openWidget(container);
  fillAndSend(container, "What is my gross margin?");
  // allow microtasks (submit is async)
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 1, `expected 1 fetch call, got ${calls.length}`);
  assert(
    calls[0].body.clientId === "client-a-id",
    `expected clientId "client-a-id", got "${calls[0].body.clientId}"`
  );
});

await test("Scenario 1b: after switching to client B, submit sends client B id", async () => {
  const { mockFetch, calls } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  // Mount widget while viewing client A
  const container = makeContainer("client-a-id");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => "test-token",
  });

  // --- simulate navigating to client B ---
  // The React useEffect sets dataset.clientId on the *already-mounted* container.
  // This is the exact pattern in clients.$clientId.tsx:
  //   el.dataset.clientId = clientId;   // always refresh first
  //   if (el.dataset.askAiMounted) return;  // don't re-mount
  container.dataset.clientId = "client-b-id";

  openWidget(container);
  fillAndSend(container, "Can I afford a new hire?");
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 1, `expected 1 fetch call, got ${calls.length}`);
  assert(
    calls[0].body.clientId === "client-b-id",
    `stale clientId sent! expected "client-b-id" but got "${calls[0].body.clientId}"`
  );
});

await test("Scenario 1c: question text is preserved faithfully in POST body", async () => {
  const { mockFetch, calls } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  const container = makeContainer("client-x-id");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => "test-token",
  });

  openWidget(container);
  const q = "What is my biggest cash risk right now?";
  fillAndSend(container, q);
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 1, `expected 1 fetch call, got ${calls.length}`);
  assert(
    calls[0].body.question === q,
    `wrong question in body: "${calls[0].body.question}"`
  );
});

// ── Scenario 2: Owner app — window.__askAiClientId fallback path ───────────────
//
// Simulates: accountant impersonates client A, then switches to client B.
// The React effect in app.tsx sets window.__askAiClientId = effectiveClientId
// on every effectiveClientId change. The container may not have dataset.clientId
// set (it depends on tab/render order), so the fallback must also use the fresh value.

await test("Scenario 2a: window.__askAiClientId used when dataset.clientId absent", async () => {
  const { mockFetch, calls } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  // Container has no clientId — relies on window.__askAiClientId fallback
  const container = makeContainer();
  (globalThis as Record<string, unknown>).__askAiClientId = "owner-client-a";

  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => "test-token",
  });

  openWidget(container);
  fillAndSend(container, "What is my runway?");
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 1, `expected 1 fetch call, got ${calls.length}`);
  assert(
    calls[0].body.clientId === "owner-client-a",
    `expected "owner-client-a", got "${calls[0].body.clientId}"`
  );
});

await test("Scenario 2b: after impersonation switch, submit sends new client id via window global", async () => {
  const { mockFetch, calls } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  const container = makeContainer();
  (globalThis as Record<string, unknown>).__askAiClientId = "owner-client-a";

  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => "test-token",
  });

  // --- simulate impersonation switch to client B ---
  // The React effect in app.tsx does:
  //   window.__askAiClientId = effectiveClientId;
  //   for (const el of allContainers) el.dataset.clientId = effectiveClientId;
  // We test the window global path (container has no dataset.clientId):
  (globalThis as Record<string, unknown>).__askAiClientId = "owner-client-b";

  openWidget(container);
  fillAndSend(container, "Show me my cashflow trends");
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 1, `expected 1 fetch call, got ${calls.length}`);
  assert(
    calls[0].body.clientId === "owner-client-b",
    `stale clientId sent! expected "owner-client-b" but got "${calls[0].body.clientId}"`
  );
});

await test("Scenario 2c: dataset.clientId takes priority over window.__askAiClientId", async () => {
  const { mockFetch, calls } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  // Both are set; dataset.clientId wins (first in the OR chain)
  const container = makeContainer("dataset-client");
  (globalThis as Record<string, unknown>).__askAiClientId = "global-client";

  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => "test-token",
  });

  openWidget(container);
  fillAndSend(container, "Which ratio is weakest?");
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 1, `expected 1 fetch call, got ${calls.length}`);
  assert(
    calls[0].body.clientId === "dataset-client",
    `expected "dataset-client" to win, got "${calls[0].body.clientId}"`
  );
});

await test("Scenario 2d: missing token throws — no fetch called", async () => {
  const { mockFetch, calls } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  const container = makeContainer("some-client");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => null, // signed out
  });

  openWidget(container);
  fillAndSend(container, "Any question");
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 0, `fetch should not be called when token is missing; got ${calls.length} call(s)`);
});

await test("Scenario 3: studio accountant variant starts open and sends audience", async () => {
  const { mockFetch, calls } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  const container = makeContainer("studio-client");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    variant: "studio",
    audience: "accountant",
    getToken: async () => "test-token",
  });

  const widget = container.find((el) => el.className.includes("ask-ai-studio"));
  assert(!!widget, "studio class is on the widget");
  const ta = container.find((el) => el.className.includes("ask-ai-textarea"));
  assert(!!ta, "studio variant is open without clicking the trigger");

  fillAndSend(container, "What's the biggest risk for this client?");
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 1, `expected 1 fetch call, got ${calls.length}`);
  assert(calls[0].body.clientId === "studio-client", "studio still scopes to the current client");
  assert(calls[0].body.audience === "accountant", "studio POST marks accountant audience");
});

await test("Scenario 4a: numbers questions still POST to ask-ai", async () => {
  const { mockFetch, calls } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  const container = makeContainer("route-client");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    botEndpoint: "https://example.com/functions/v1/milon-bot",
    getToken: async () => "test-token",
  });

  openWidget(container);
  fillAndSend(container, "Am I healthy overall, or should I worry?");
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 1, `expected 1 fetch call, got ${calls.length}`);
  assert(String(calls[0].url).includes("/ask-ai"), `numbers Q&A should hit ask-ai, got ${calls[0].url}`);
  assert(calls[0].body.question === "Am I healthy overall, or should I worry?", "ask-ai still uses question");
});

await test("Scenario 4b: brain-tool chips POST to milon-bot with message + history", async () => {
  const { mockFetch, calls } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  const container = makeContainer("route-client");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    botEndpoint: "https://example.com/functions/v1/milon-bot",
    audience: "accountant",
    variant: "studio",
    getToken: async () => "test-token",
  });

  fillAndSend(container, "What's still outstanding on the brain, and is the invite redeemed?");
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 1, `expected 1 fetch call, got ${calls.length}`);
  assert(String(calls[0].url).includes("/milon-bot"), `brain tools should hit milon-bot, got ${calls[0].url}`);
  assert(
    calls[0].body.message === "What's still outstanding on the brain, and is the invite redeemed?",
    "bot uses message",
  );
  assert(calls[0].body.audience === "accountant", "bot POST keeps accountant audience");
  assert(Array.isArray(calls[0].body.history), "bot POST includes history");
  assert(calls[0].body.mode !== "create", "a brain question is not a create");
});

await test("Scenario 4c: draft chip persists instead of chatting", async () => {
  const { mockFetch, calls } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  const container = makeContainer("route-client");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    botEndpoint: "https://example.com/functions/v1/milon-bot",
    audience: "accountant",
    variant: "studio",
    getToken: async () => "test-token",
  });

  fillAndSend(container, "Draft an advisory pack from the brain — don't send it.");
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 1, `expected 1 fetch call, got ${calls.length}`);
  assert(String(calls[0].url).includes("/milon-bot"), `create should hit milon-bot, got ${calls[0].url}`);
  assert(calls[0].body.mode === "create", "draft chip posts mode create");
  assert(
    calls[0].body.message === "Draft an advisory pack from the brain — don't send it.",
    "create still sends the question",
  );
  assert(calls[0].body.audience === "accountant", "create keeps accountant audience");
});

await test("Scenario 5: composer clears after a successful send", async () => {
  const { mockFetch } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  const container = makeContainer("route-client");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    getToken: async () => "test-token",
  });

  openWidget(container);
  fillAndSend(container, "What is my runway?");
  await new Promise((r) => setTimeout(r, 0));

  const ta = container.find((el) => el.className.includes("ask-ai-textarea"));
  assert(ta?.value === "", `composer should be empty after send, got "${ta?.value}"`);
});

await test("Scenario 5b: Enter-to-send clears the composer", async () => {
  const { mockFetch, calls } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  const container = makeContainer("route-client");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    variant: "studio",
    getToken: async () => "test-token",
  });

  const before = container.find((el) => el.className.includes("ask-ai-textarea"));
  if (!before) throw new Error("textarea missing");
  before.input("Enter should send this");
  before.pressEnter();
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 1, "Enter sends");
  assert(calls[0].body.question === "Enter should send this", "Enter posts the typed text");
  const after = container.find((el) => el.className.includes("ask-ai-textarea"));
  assert(after?.value === "", "Enter-to-send clears the composer");
});

await test("Scenario 5c: a failed send keeps the draft", async () => {
  (globalThis as Record<string, unknown>).fetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: "nope" }),
  });

  const container = makeContainer("route-client");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    variant: "studio",
    getToken: async () => "test-token",
  });

  fillAndSend(container, "Keep this if it fails");
  await new Promise((r) => setTimeout(r, 0));

  const ta = container.find((el) => el.className.includes("ask-ai-textarea"));
  assert(ta?.value === "Keep this if it fails", "a failed send leaves the draft in the box");
  const err = container.find((el) => el.className.includes("ask-ai-error"));
  assert(err?.textContent === "nope", "a failed send shows the error in the thread");
  assert(err?.role === "alert", "the error is an alert");
});

await test("Scenario 6: a suggested chip then Ask shows a reply", async () => {
  const { mockFetch } = makeMockFetch();
  (globalThis as Record<string, unknown>).fetch = mockFetch;

  const container = makeContainer("route-client");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    variant: "studio",
    audience: "accountant",
    getToken: async () => "test-token",
  });

  const chip = container.find(
    (el) => el.className.includes("ask-ai-chip") && (el.textContent ?? "").includes("biggest drag"),
  );
  if (!chip) throw new Error("suggestion chip missing");
  chip.click();
  const send = container.find((el) => el.className.includes("ask-ai-send"));
  if (!send) throw new Error("send button missing");
  send.click();
  await new Promise((r) => setTimeout(r, 0));

  const ta = container.find((el) => el.className.includes("ask-ai-textarea"));
  const answer = container.find((el) => el.className.includes("ask-ai-answer"));
  assert(ta?.value === "", "a successful chip send clears the composer");
  assert((answer?.innerHTML ?? "").includes("test answer"), "the chip send shows the reply");
  assert(container.children[0]?.dataset.askState === "answer", "the thread is in the answer state");
});

await test("Scenario 6b: Thinking keeps the chip draft until the reply arrives", async () => {
  let release: (value: unknown) => void = () => {};
  (globalThis as Record<string, unknown>).fetch = () =>
    new Promise((resolve) => {
      release = resolve;
    });

  const container = makeContainer("route-client");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    variant: "studio",
    audience: "accountant",
    getToken: async () => "test-token",
  });

  const chipText = "What's the biggest drag on this client's score vs peers?";
  const chip = container.find(
    (el) => el.className.includes("ask-ai-chip") && el.textContent === chipText,
  );
  if (!chip) throw new Error("suggestion chip missing");
  chip.click();
  container.find((el) => el.className.includes("ask-ai-send"))?.click();
  await new Promise((r) => setTimeout(r, 0));

  const during = container.find((el) => el.className.includes("ask-ai-textarea"));
  const send = container.find((el) => el.className.includes("ask-ai-send"));
  assert(during?.value === chipText, "Thinking does not wipe the draft");
  assert((send?.innerHTML ?? "").includes("Thinking"), "the send control shows Thinking");
  assert(container.children[0]?.dataset.askState === "thinking", "state is thinking");

  release({
    ok: true,
    status: 200,
    json: async () => ({ answer: "Debtor days.", chips: [] }),
  });
  await new Promise((r) => setTimeout(r, 0));

  const after = container.find((el) => el.className.includes("ask-ai-textarea"));
  const answer = container.find((el) => el.className.includes("ask-ai-answer"));
  assert(after?.value === "", "the draft clears once the reply is in");
  assert((answer?.innerHTML ?? "").includes("Debtor days."), "the reply is in the thread");
});

await test("Scenario 7: empty, non-JSON, and network failures stay visible", async () => {
  const chipText = "What's the biggest drag on this client's score vs peers?";

  async function ask(fetchImpl: unknown) {
    (globalThis as Record<string, unknown>).fetch = fetchImpl;
    const container = makeContainer("route-client");
    mountAskAi(container, {
      endpoint: "https://example.com/functions/v1/ask-ai",
      botEndpoint: "https://example.com/functions/v1/milon-bot",
      variant: "studio",
      audience: "accountant",
      getToken: async () => "test-token",
    });
    const chip = container.find(
      (el) => el.className.includes("ask-ai-chip") && el.textContent === chipText,
    );
    if (!chip) throw new Error("suggestion chip missing");
    chip.click();
    container.find((el) => el.className.includes("ask-ai-send"))?.click();
    await new Promise((r) => setTimeout(r, 0));
    return container;
  }

  const empty = await ask(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ answer: "  ", chips: [] }),
  }));
  assert(
    empty.find((el) => el.className.includes("ask-ai-textarea"))?.value === chipText,
    "an empty reply keeps the draft",
  );
  assert(
    (empty.find((el) => el.className.includes("ask-ai-error"))?.textContent ?? "").includes(
      "didn't return an answer",
    ),
    "an empty reply shows an error",
  );
  assert(
    empty.find((el) => el.className.includes("ask-ai-answer")) == null,
    "an empty reply does not paint a blank answer",
  );

  const html = await ask(async () => ({
    ok: false,
    status: 502,
    text: async () => "<!doctype html><html>bad gateway</html>",
  }));
  assert(
    html.find((el) => el.className.includes("ask-ai-textarea"))?.value === chipText,
    "a non-JSON edge error keeps the draft",
  );
  assert(
    (html.find((el) => el.className.includes("ask-ai-error"))?.textContent ?? "").includes(
      "Couldn't read Milōn's reply",
    ),
    "a non-JSON edge error is visible",
  );

  const offline = await ask(async () => {
    throw new TypeError("Failed to fetch");
  });
  assert(
    offline.find((el) => el.className.includes("ask-ai-textarea"))?.value === chipText,
    "a network failure keeps the draft",
  );
  assert(
    (offline.find((el) => el.className.includes("ask-ai-error"))?.textContent ?? "").includes(
      "Couldn't reach Milōn",
    ),
    "a network failure is visible",
  );
  assert(offline.children[0]?.dataset.askState === "error", "state is error, not a silent reset");
});

await test("Scenario 8: a drafted recommendation offers Review Action Plan", async () => {
  const opened: Array<{ tab?: string; coach?: string; why?: string }> = [];
  (globalThis as Record<string, unknown>).fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      answer: "Drafted three moves. They are not approved.",
      chips: [],
      tools: [{ name: "propose_next_steps", status: "ok" }],
    }),
  });

  const container = makeContainer("client-signoff");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    botEndpoint: "https://example.com/functions/v1/milon-bot",
    variant: "studio",
    audience: "accountant",
    getToken: async () => "test-token",
    onOpenDeliverable: (dest: { tab?: string; coach?: string; why?: string }) => {
      opened.push(dest);
    },
  });

  const chipText = "Propose next steps from what's on file.";
  const chip = container.find((el) => el.className.includes("ask-ai-chip") && el.textContent === chipText);
  if (!chip) throw new Error("propose chip missing");
  chip.click();
  container.find((el) => el.className.includes("ask-ai-send"))?.click();
  await new Promise((r) => setTimeout(r, 0));

  const go = container.find((el) => el.dataset.signoff === "actions");
  assert(go?.textContent === "Review Action Plan", `expected Review Action Plan, got ${go?.textContent}`);
  assert(go?.dataset.tab === "plan", "the button targets the Action Plan tab");
  assert(
    (container.find((el) => el.dataset.signoffState === "1")?.textContent ?? "").includes("approval"),
    "the thread says the work is waiting",
  );
  go?.click();
  assert(opened.length === 1, "one click opens the existing deliverable");
  assert(opened[0].tab === "plan" && opened[0].coach === "actions", "deep link is this client's Action Plan");
  assert((opened[0].why ?? "").includes("Propose next steps"), "the route keeps the question");
});

await test("Scenario 9: a prepare question recommends, and the button creates", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let n = 0;
  (globalThis as Record<string, unknown>).fetch = async (url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    calls.push({ url, body });
    n += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        answer: n === 1 ? "Prepare the advisory pack first. Profitability is the weak pillar." : "Saved an advisory draft.",
        chips: [],
        ...(n === 2 ? { created: { packId: "pack-1" } } : {}),
      }),
    };
  };

  const container = makeContainer("qa-us");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    variant: "studio",
    audience: "accountant",
    getToken: async () => "test-token",
  });

  const question = "Which deliverable should I prepare for them first, and why?";
  const ta = container.find((el) => el.className.includes("ask-ai-textarea"));
  if (!ta) throw new Error("textarea missing");
  ta.input(question);
  container.find((el) => el.className.includes("ask-ai-send"))?.click();
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 1, "one request for the question");
  assert(!calls[0].url.includes("milon-bot"), "the question stays on ask-ai");
  assert(calls[0].body.question === question, "the question is sent as a question");
  assert(calls[0].body.mode == null, "the question does not post mode create");
  const draft = container.find((el) => el.dataset.draftPack === "1");
  assert(draft?.textContent === "Draft the Advisory Pack", `draft button missing, got ${draft?.textContent}`);
  draft?.click();
  await new Promise((r) => setTimeout(r, 0));

  assert(calls.length === 2, "the button sends a second request");
  assert(calls[1].url.includes("milon-bot"), "the button uses the create path");
  assert(calls[1].body.mode === "create", "the button posts mode create");
  assert(calls[1].body.message === "Draft the advisory pack now", "the button sends the explicit command");
});

await test("Scenario 10: earlier questions stay visible", async () => {
  let n = 0;
  (globalThis as Record<string, unknown>).fetch = async () => {
    n += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ answer: n === 1 ? "First reply about cash." : "Second reply about margin.", chips: [] }),
    };
  };

  const container = makeContainer("qa-history");
  mountAskAi(container, {
    endpoint: "https://example.com/functions/v1/ask-ai",
    variant: "studio",
    getToken: async () => "test-token",
  });

  const ta = container.find((el) => el.className.includes("ask-ai-textarea"));
  if (!ta) throw new Error("textarea missing");
  ta.input("How is cash?");
  container.find((el) => el.className.includes("ask-ai-send"))?.click();
  await new Promise((r) => setTimeout(r, 0));
  const box = container.find((el) => el.className.includes("ask-ai-textarea"));
  box?.input("How is margin?");
  container.find((el) => el.className.includes("ask-ai-send"))?.click();
  await new Promise((r) => setTimeout(r, 0));

  const thread = container.find((el) => el.className.includes("ask-ai-thread"));
  assert(thread != null, "the session renders a scrolling thread");
  const answers = container.findAll((el) => el.className.includes("ask-ai-answer"));
  const users = container.findAll((el) => el.className.includes("ask-ai-turn-user"));
  assert(answers.length === 2, `both replies stay visible, got ${answers.length}`);
  assert(users.length === 2, `both questions stay visible, got ${users.length}`);
  assert((answers[0].innerHTML ?? "").includes("First reply"), "the first reply is still in the thread");
  assert((answers[1].innerHTML ?? "").includes("Second reply"), "the latest reply is in the thread");
});

await test("Scenario 11: a remount in this tab restores the thread", async () => {
  const store = new Map<string, string>();
  const previous = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };

  try {
    (globalThis as Record<string, unknown>).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ answer: "Cash is on file.", chips: [] }),
    });
    const first = makeContainer("qa-persist");
    mountAskAi(first, {
      endpoint: "https://example.com/functions/v1/ask-ai",
      variant: "studio",
      getToken: async () => "test-token",
    });
    const ta = first.find((el) => el.className.includes("ask-ai-textarea"));
    ta?.input("How is cash?");
    first.find((el) => el.className.includes("ask-ai-send"))?.click();
    await new Promise((r) => setTimeout(r, 0));
    assert(store.size === 1, "the page session stores the thread");

    const second = makeContainer("qa-persist");
    mountAskAi(second, {
      endpoint: "https://example.com/functions/v1/ask-ai",
      variant: "studio",
      getToken: async () => "test-token",
    });
    const answers = second.findAll((el) => el.className.includes("ask-ai-answer"));
    const users = second.findAll((el) => el.className.includes("ask-ai-turn-user"));
    assert(users.length === 1 && (users[0].textContent ?? "").includes("How is cash?"), "the question survives remount");
    assert(answers.length === 1 && (answers[0].innerHTML ?? "").includes("Cash is on file."), "the reply survives remount");
  } finally {
    if (previous) (globalThis as { sessionStorage?: Storage }).sessionStorage = previous;
    else delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────────────`);
console.log(`  ${passed}/${passed + failed} passed${failed ? `  (${failed} FAILED)` : ""}`);
console.log(`─────────────────────────────────────\n`);

if (failed > 0) process.exit(1);
