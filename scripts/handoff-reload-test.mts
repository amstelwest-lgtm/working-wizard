/**
 * A reload while the hand-off request is still open reads the note that is
 * already committed. The success toast waits for noted:true.
 * Run: pnpm test:handoff-reload
 */
import { Window } from "happy-dom";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;

const window = new Window({
  url: "https://app.example.test/clients/us-1020e",
  width: 1280,
  height: 900,
  settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true },
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "DocumentFragment",
  "MouseEvent",
  "KeyboardEvent",
  "Event",
  "CustomEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "sessionStorage",
  "localStorage",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, configurable: true });
window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const CLIENT = "353f1dbf-a7ba-4092-878d-792223ba3536";
const ACTION = "327b822c-cf07-4b70-9327-ac94b40842bc";
const TITLE = "Set a quarterly revenue target and track weekly progress";
const FM = "2026-10-20T18:00:00.000Z";
const ANALYST = "2026-10-20T18:05:00.000Z";

type Note = { note: string; created_at: string };
const notes: Note[] = [{ note: "Handed to Milōn Financial Manager.", created_at: FM }];
let releaseHandoff: ((response: Response) => void) | null = null;
const handoffGate = new Promise<Response>((resolve) => {
  releaseHandoff = resolve;
});

const successes: string[] = [];
const errors: string[] = [];
const originalSuccess = toast.success.bind(toast);
const originalError = toast.error.bind(toast);
toast.success = ((message: unknown, data?: unknown) => {
  successes.push(String(message));
  return originalSuccess(message as string, data as never);
}) as typeof toast.success;
toast.error = ((message: unknown, data?: unknown) => {
  errors.push(String(message));
  return originalError(message as string, data as never);
}) as typeof toast.error;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let releaseReads: (() => void) | null = null;
const readGate = new Promise<void>((resolve) => {
  releaseReads = resolve;
});

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/rest/")) await readGate;
  if (url.includes("/functions/v1/owner-handoff")) return handoffGate;
  if (url.includes("/rest/v1/action_plans")) return json([{ id: "plan-1" }]);
  if (url.includes("/rest/v1/action_items")) {
    return json([
      {
        id: ACTION,
        title: TITLE,
        source_move_key: "revenueGrowth",
        driver_key: "revenueGrowth",
        seq: 2,
      },
    ]);
  }
  if (url.includes("/rest/v1/action_updates")) {
    return json(
      notes.map((row) => ({
        action_item_id: ACTION,
        note: row.note,
        created_at: row.created_at,
        actor_label: "qa",
        actor_type: "owner_app",
      })),
    );
  }
  if (url.includes("/rest/v1/agent_runs") || url.includes("/rest/v1/agent_findings")) return json([]);
  if (url.includes("/rest/v1/client_employees") || url.includes("/rpc/")) return json([]);
  if (url.includes("/auth/v1")) {
    return json({
      access_token: "test-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: 4_000_000_000,
      refresh_token: "refresh",
      user: { id: "user-1", email: "qa@example.com" },
    });
  }
  return realFetch(input, init);
};

const session = {
  access_token: "test-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4_000_000_000,
  refresh_token: "refresh",
  user: {
    id: "11111111-1111-1111-1111-111111111111",
    aud: "authenticated",
    role: "authenticated",
    email: "qa@example.com",
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  },
};
window.sessionStorage.setItem("sb-example-auth-token", JSON.stringify(session));

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function mount(node: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  await tick();
  await tick();
  return async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  };
}

function triggerLabel(): string {
  const button = document.querySelector("[data-hand-to-trigger]");
  assert(button instanceof HTMLButtonElement, "the Hand to button is on the page");
  return button.getAttribute("aria-label") ?? "";
}

function assertChecking(where: string) {
  assert(!document.querySelector("[data-hand-to-trigger]"), `${where}: Hand to is rendered before the read resolves`);
  const pending = document.querySelector("[data-hand-to-pending]");
  assert(pending instanceof HTMLElement, `${where}: the row has no checking state`);
  assert(pending.getAttribute("aria-disabled") === "true" || pending.querySelector("[aria-disabled='true']"), `${where}: checking can be clicked`);
  assert(!(pending instanceof HTMLButtonElement), `${where}: checking is a button`);
  assert((pending.textContent ?? "").includes("Checking"), `${where}: label was ${pending.textContent}`);
}

const { MoveHandTo: ColdMove } = await import("../src/components/hand-to-menu.tsx?reload=cold");
const cold = await mount(
  createElement(ColdMove, {
    clientId: CLIENT,
    moveKey: "revenueGrowth",
    title: TITLE,
  }),
);
await tick();
assertChecking("cold load");
await cold();

const { MoveHandTo: ColdAgain } = await import("../src/components/hand-to-menu.tsx?reload=cold-2");
const coldAgain = await mount(
  createElement(ColdAgain, {
    clientId: CLIENT,
    moveKey: "revenueGrowth",
    title: TITLE,
  }),
);
await tick();
assertChecking("remount while the read is held");
assert(releaseReads, "the assignment read is held");
releaseReads();
await tick();
await tick();
assert(triggerLabel() === "Assigned to Milōn Financial Manager", `after the read, the label was ${triggerLabel()}`);
await coldAgain();

const { MoveHandTo: FirstMove } = await import("../src/components/hand-to-menu.tsx?reload=1");

const first = await mount(
  createElement(FirstMove, {
    clientId: CLIENT,
    moveKey: "revenueGrowth",
    title: TITLE,
  }),
);
await tick();
assert(triggerLabel() === "Assigned to Milōn Financial Manager", `seed label was ${triggerLabel()}`);

const trigger = document.querySelector("[data-hand-to-trigger]");
assert(trigger instanceof HTMLButtonElement, "the trigger is a button");
await act(async () => {
  trigger.click();
});
await tick();
const analyst = document.querySelector('[data-handoff-agent="analyst"]');
assert(analyst instanceof HTMLButtonElement, "Analyst is in the menu");
await act(async () => {
  analyst.click();
});
await tick();
assert(
  triggerLabel() === "Assigning to Analyst…",
  `pending label was ${triggerLabel()} (errors: ${errors.join(" | ") || "none"})`,
);
assert(successes.length === 0, "the success toast does not fire while the request is open");

await first();
const { MoveHandTo: SecondMove } = await import("../src/components/hand-to-menu.tsx?reload=2");
const second = await mount(
  createElement(SecondMove, {
    clientId: CLIENT,
    moveKey: "revenueGrowth",
    title: TITLE,
  }),
);
await tick();
assert(
  triggerLabel() === "Assigned to Milōn Financial Manager",
  `a fresh module while the insert is held showed ${triggerLabel()}`,
);
assert(successes.length === 0, "a remount while the insert is held does not toast success");

notes.push({ note: "Handed to Milōn Analyst.", created_at: ANALYST });
assert(releaseHandoff, "the hand-off request is held");
releaseHandoff(
  json({ ok: true, noted: true, runId: "run-analyst", status: "queued", runner: "agent-analyst" }),
);
await tick();
await tick();

await second();
const { MoveHandTo: ThirdMove } = await import("../src/components/hand-to-menu.tsx?reload=3");
await mount(
  createElement(ThirdMove, {
    clientId: CLIENT,
    moveKey: "revenueGrowth",
    title: TITLE,
  }),
);
await tick();
assert(triggerLabel() === "Assigned to Milōn Analyst", `after the note is stored the reload showed ${triggerLabel()}`);
assert(successes.includes("Assigned to Analyst. It is working on this now."), "the success toast fires once noted is true");

console.log("handoff reload ok");
