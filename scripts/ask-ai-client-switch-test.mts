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
    for (const fn of this._handlers["keydown"] ?? []) fn({ key: "Enter", ctrlKey: true });
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

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n─────────────────────────────────────`);
console.log(`  ${passed}/${passed + failed} passed${failed ? `  (${failed} FAILED)` : ""}`);
console.log(`─────────────────────────────────────\n`);

if (failed > 0) process.exit(1);
