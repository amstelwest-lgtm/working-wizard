/**
 * A new move's first reload, while writeAssignment has not stored the note.
 * The blank action row must not settle on a clickable Hand to.
 * Run: pnpm test:handoff-first-reload
 *
 * Pending marker: sessionStorage key milon-handoff-awaiting-note.
 * A hard reload keeps it. moveAssignmentCache and optimisticHandoffs do not.
 * Owner and accountant Hand to share MoveHandTo, HandToMenu, and the plan row.
 */
import { Window } from "happy-dom";
import { createElement, Fragment } from "react";
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
  url: "https://app.example.test/app",
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
  "crypto",
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
window.WebSocket = class {
  readyState = 1;
  close() {}
  send() {}
  addEventListener() {}
  removeEventListener() {}
} as unknown as typeof WebSocket;

const CLIENT = "24844299-1aec-449c-ab45-66ca1b97c3ef";
const ACTION = "0079314c-5bfb-49ac-adf2-3aae4a4a4c3d";
const TITLE = "Automate repeat tasks to free people for higher-value work";
const MOVE = "gpToLabor";

type Note = { note: string; created_at: string; actor_label: string };
const notes: Note[] = [];
let inserted = false;
let releaseHandoff: ((response: Response) => void) | null = null;
const handoffGate = new Promise<Response>((resolve) => {
  releaseHandoff = resolve;
});

const successes: string[] = [];
const errors: string[] = [];
toast.success = ((message: unknown) => {
  successes.push(String(message));
  return 1;
}) as typeof toast.success;
toast.error = ((message: unknown) => {
  errors.push(String(message));
  return 1;
}) as typeof toast.error;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function wantsObject(input: RequestInfo | URL, init?: RequestInit): boolean {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  return (headers.get("accept") ?? "").includes("application/vnd.pgrst.object");
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

const planRow = {
  id: "plan-1",
  client_id: CLIENT,
  period_label: "Q4 2026",
  outcome_goal: "Set your outcome goal for this quarter",
  why_statement: null,
  metric_name: null,
  metric_start: null,
  metric_target: null,
  metric_current: null,
  target_date: "2026-12-31",
  created_at: "2026-10-01T00:00:00.000Z",
  is_active: true,
};

function actionRow() {
  return {
    id: ACTION,
    plan_id: "plan-1",
    client_id: CLIENT,
    seq: 1,
    title: TITLE,
    outcome_why: "Free people for higher-value work",
    owner_id: null,
    owner_name: null,
    owner_email: null,
    due_date: null,
    status: "not_started",
    progress_pct: 0,
    blocker_note: null,
    source: "strategic_move",
    source_move_key: MOVE,
    driver_key: MOVE,
    sent_at: null,
    completed_at: null,
    created_at: "2026-10-29T08:16:15.448Z",
    updated_at: "2026-10-29T08:16:15.448Z",
  };
}

function noteRows() {
  return notes.map((row) => ({
    action_item_id: ACTION,
    note: row.note,
    created_at: row.created_at,
    actor_label: row.actor_label,
    actor_type: "owner_app",
  }));
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = requestUrl(input);
  const method = requestMethod(input, init);
  const one = wantsObject(input, init);
  if (url.includes("/functions/v1/owner-handoff")) return handoffGate;
  if (url.includes("/auth/v1")) {
    return json({
      access_token: "test-token",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: 4_000_000_000,
      refresh_token: "refresh",
      user: {
        id: "user-1",
        email: "zanele.owner@example.com",
        user_metadata: { full_name: "Zanele Owner" },
      },
    });
  }
  if (url.includes("/rest/v1/action_plans")) {
    if (method === "POST") return json(one ? planRow : [planRow]);
    return json(one ? planRow : [planRow]);
  }
  if (url.includes("/rest/v1/action_items")) {
    if (method === "POST") {
      inserted = true;
      return json(one ? { id: ACTION } : [actionRow()]);
    }
    const rows = inserted ? [actionRow()] : [];
    return json(one ? (rows[0] ?? null) : rows);
  }
  if (url.includes("/rest/v1/action_updates")) return json(noteRows());
  if (url.includes("/rest/v1/profiles"))
    return json(one ? { full_name: "Zanele Owner" } : [{ full_name: "Zanele Owner" }]);
  if (url.includes("/rest/v1/clients")) return json(one ? { market: "ZA" } : [{ market: "ZA" }]);
  if (url.includes("/rest/v1/rpc/") || url.includes("/rpc/")) return json([]);
  return json(one ? null : []);
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
    email: "zanele.owner@example.com",
    app_metadata: { provider: "email" },
    user_metadata: { full_name: "Zanele Owner" },
    created_at: "2026-01-01T00:00:00.000Z",
  },
};
const storageKey = "sb-example-auth-token";
window.localStorage.setItem(storageKey, JSON.stringify(session));
window.sessionStorage.setItem(storageKey, JSON.stringify(session));

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function waitFor(label: string, pred: () => boolean) {
  for (let i = 0; i < 40; i += 1) {
    if (pred()) return;
    await tick();
  }
  throw new Error(`${label}\n${document.body.textContent?.replace(/\s+/g, " ").slice(0, 700)}`);
}

function triggers(): HTMLButtonElement[] {
  return [...document.querySelectorAll("[data-hand-to-trigger]")].filter(
    (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
  );
}

function planRowNode(): HTMLElement {
  const node = document.querySelector("[data-row-id]");
  assert(node instanceof HTMLElement, "the owner plan row is on the page");
  return node;
}

const moves = [
  {
    key: MOVE,
    title: TITLE,
    ratioName: "Labour",
    impactLine: "Free people for higher-value work",
    health: 40,
  },
];

const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");

async function loadScreen(label: "open" | "reload-1" | "reload-2") {
  if (label === "open") {
    const [planMod, menuMod] = await Promise.all([
      import("../src/components/action-plan.tsx?reload=open"),
      import("../src/components/hand-to-menu.tsx?reload=open"),
    ]);
    return { Panel: planMod.default, MoveHandTo: menuMod.MoveHandTo };
  }
  if (label === "reload-1") {
    const [planMod, menuMod] = await Promise.all([
      import("../src/components/action-plan.tsx?reload=reload-1"),
      import("../src/components/hand-to-menu.tsx?reload=reload-1"),
    ]);
    return { Panel: planMod.default, MoveHandTo: menuMod.MoveHandTo };
  }
  const [planMod, menuMod] = await Promise.all([
    import("../src/components/action-plan.tsx?reload=reload-2"),
    import("../src/components/hand-to-menu.tsx?reload=reload-2"),
  ]);
  return { Panel: planMod.default, MoveHandTo: menuMod.MoveHandTo };
}

async function mountScreen(label: "open" | "reload-1" | "reload-2", withMove: boolean) {
  const loaded = await loadScreen(label);
  const Panel = loaded.Panel as (props: {
    clientId: string;
    clientName: string;
    isOwner: boolean;
    ownerView: boolean;
    moves: typeof moves;
  }) => ReturnType<typeof createElement>;
  const MoveHandTo = loaded.MoveHandTo as (props: {
    clientId: string;
    moveKey: string;
    title: string;
  }) => ReturnType<typeof createElement>;
  const rootRoute = createRootRoute({
    component: () =>
      createElement(
        Fragment,
        null,
        createElement(Panel, {
          clientId: CLIENT,
          clientName: "AQA J2 ZA 1020F",
          isOwner: true,
          ownerView: true,
          moves,
        }),
        withMove
          ? createElement(MoveHandTo, { clientId: CLIENT, moveKey: MOVE, title: TITLE })
          : null,
      ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    isServer: false,
  } as never);
  await router.load();
  (router as { isServer?: boolean }).isServer = false;
  (router as { _rendered?: unknown[] })._rendered = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(createElement(RouterProvider, { router }));
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

async function dropModuleMaps() {
  const handoff = await import("../src/lib/owner-handoff-client.ts");
  handoff.resetHandoffOptimistic();
  handoff.invalidateMoveAssignments(CLIENT);
}

const first = await mountScreen("open", false);
await waitFor("suggestion is Assign to before the click", () => {
  const scope = document.querySelector("[data-owner-suggestions]");
  return scope?.querySelector("[data-hand-to-trigger]")?.getAttribute("aria-label") === "Assign to";
});
assert(notes.length === 0, "no hand-off note is seeded");
assert(!inserted, "the move has no action_items row yet");

const trigger = document.querySelector("[data-owner-suggestions] [data-hand-to-trigger]");
assert(trigger instanceof HTMLButtonElement, "MoveHandTo is on the suggestion");
await act(async () => {
  trigger.click();
});
await tick();
const analyst = document.querySelector('[data-handoff-agent="analyst"]');
assert(analyst instanceof HTMLButtonElement, "Analyst is in the menu");
await act(async () => {
  analyst.click();
});
await waitFor("the blank row is on the plan", () =>
  Boolean(document.querySelector("[data-row-id]")),
);
await tick();
const during = planRowNode();
assert(
  !during.textContent?.includes("Assigned to"),
  `the plan claimed settled Handed to before the note existed: ${during.textContent?.replace(/\s+/g, " ")}`,
);
assert(
  !during.querySelector("[data-assignment-note]")?.textContent?.includes("Assigned to"),
  "the byline painted Handed to from the optimistic note alone",
);
const pendingNow = during.querySelector("[data-hand-to-pending]");
const handingNow = during.querySelector("[data-hand-to-trigger]")?.getAttribute("aria-label") ?? "";
assert(
  pendingNow instanceof HTMLElement || handingNow.startsWith("Assigning to "),
  `the plan row was not Handing or Checking while the note was absent: ${during.textContent?.replace(/\s+/g, " ")}`,
);
assert(inserted, "ensure inserted the action row");
assert(releaseHandoff, "requestOwnerHandoff is still held");

await first();
await dropModuleMaps();

const second = await mountScreen("reload-1", true);
await waitFor(
  "the reloaded plan read has settled",
  () => planRowNode().textContent?.includes("Not started") === true,
);
for (let i = 0; i < 6; i += 1) await tick();
const settledHandTo = triggers().filter(
  (button) => (button.getAttribute("aria-label") ?? "") === "Assign to",
);
assert(
  settledHandTo.length === 0,
  "reload 1 painted a settled Hand to for the blank mid-handoff row",
);
const checking = [...document.querySelectorAll("[data-hand-to-pending]")];
assert(checking.length > 0, "reload 1 has no Checking or Handing pending marker");
for (const node of checking) {
  assert((node.textContent ?? "").includes("Checking"), `pending label was ${node.textContent}`);
  assert(!(node instanceof HTMLButtonElement), "Checking is a button");
}
assert(
  !planRowNode().textContent?.includes("Assigned to"),
  "reload 1 claimed Handed to without an assignment note",
);
assert(
  !document.body.textContent?.includes("Assigned to Milōn Analyst"),
  "the durable Handed to line is on the reloaded page",
);

await second();
notes.push({
  note: "Handed to Milōn Analyst.",
  created_at: "2026-10-29T08:16:19.954Z",
  actor_label: "Zanele Owner",
});
releaseHandoff(json({ ok: true, noted: true, runId: "run-analyst", status: "queued" }));
await tick();
await tick();
await dropModuleMaps();

const third = await mountScreen("reload-2", true);
await waitFor("reload 2 shows the stored analyst note", () => {
  const buttons = triggers();
  return (
    buttons.length > 0 &&
    document.querySelector("[data-hand-to-pending]") == null &&
    buttons.every((button) => button.getAttribute("aria-label") === "Assigned to Milōn Analyst")
  );
});
assert(
  planRowNode().textContent?.includes("Assigned to Milōn Analyst") === true,
  "the plan row did not show Handed to Milōn Analyst after the note",
);
await third();

console.log("handoff first reload: blank row stays Checking until the assignment note exists");
