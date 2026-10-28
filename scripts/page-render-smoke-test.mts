/**
 * Page-render smoke test. A throw on the accountant client page or the
 * owner board fails CI (pnpm test:ci). Renders ClientView (/clients/$clientId,
 * home and health) and /app (OwnerShell and the board) with the client null,
 * still loading, and loaded. The owner board also covers a stored client id
 * the login can no longer open, and a workspace-list error with Retry.
 *
 * The null and loading paints run the homePresence memo before the client
 * row exists. Reading client.id there throws on main.
 *
 * Run: pnpm test:page-render-smoke
 */
import { Window } from "happy-dom";
import {
  resetSmokeRpcLog,
  setSmokeMode,
  smokeHedgeTiming,
  smokeInviteOpens,
  smokeRoleReads,
  smokeRpcLog,
  smokeWorkspaceListWaves,
  SMOKE_CLIENT_ID,
  SMOKE_USER_ID,
  STALE_CLIENT_ID,
  STALE_CLIENT_NAME,
  type SmokeMode,
} from "./page-smoke-supabase.ts";
import {
  resetBootReadForTests,
  setBootReadTimeoutMsForTests,
  setShellBackstopForTests,
} from "@/lib/boot-read";
import { ownerActiveClientStorageKey } from "../src/lib/owner-workspaces.ts";
import {
  ACCOUNTANT_CLIENT_EMPTY_TOUR_KEY,
  ACCOUNTANT_CLIENT_TOUR_KEY,
  OWNER_EMPTY_TOUR_KEY,
  OWNER_TOUR_KEY,
} from "../src/lib/onboarding.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function suppressTours() {
  for (const key of [
    ACCOUNTANT_CLIENT_TOUR_KEY,
    ACCOUNTANT_CLIENT_EMPTY_TOUR_KEY,
    OWNER_TOUR_KEY,
    OWNER_EMPTY_TOUR_KEY,
  ]) {
    localStorage.setItem(key, "1");
    localStorage.setItem(`${key}:${SMOKE_USER_ID}`, "1");
  }
}

function paneIsOpen(html: string, id: string): boolean {
  const tag = (html.match(/<div\b[^>]*>/g) ?? []).find((el) => el.includes(`id="${id}"`));
  return Boolean(tag && /\bon\b/.test(tag));
}

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;

const dom = new Window({
  url: "http://127.0.0.1:5000/",
  width: 1280,
  height: 800,
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
  "location",
  "history",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLInputElement",
  "SVGElement",
  "Element",
  "Node",
  "Document",
  "DocumentFragment",
  "KeyboardEvent",
  "MouseEvent",
  "Event",
  "CustomEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "MutationObserver",
  "localStorage",
  "sessionStorage",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: dom[key as keyof Window],
  });
}
if (!dom.HTMLElement.prototype.scrollIntoView) {
  dom.HTMLElement.prototype.scrollIntoView = () => {};
}
if (typeof dom.ResizeObserver !== "function") {
  dom.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  writable: true,
  value: dom.ResizeObserver,
});
if (typeof dom.IntersectionObserver !== "function") {
  dom.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}
Object.defineProperty(globalThis, "IntersectionObserver", {
  configurable: true,
  writable: true,
  value: dom.IntersectionObserver,
});
if (typeof dom.matchMedia !== "function") {
  dom.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }) as unknown as MediaQueryList;
}
Object.defineProperty(globalThis, "matchMedia", {
  configurable: true,
  writable: true,
  value: dom.matchMedia.bind(dom),
});
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
globalThis.fetch = async () =>
  new Response(JSON.stringify({ error: "smoke-offline" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });

const caught: string[] = [];
process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  caught.push(message);
});

const { createElement, useState, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { Outlet, createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
  await import("@tanstack/react-router");
const { Route: ClientRouteImport } =
  await import("../src/routes/_authenticated/clients.$clientId.tsx");
const { Route: AppRouteImport } = await import("../src/routes/app.tsx");
const { AuthProvider } = await import("../src/hooks/use-auth.tsx");
const { AppChrome } = await import("../src/components/app-chrome.tsx");
const { FirmBillingAccessProvider } = await import("../src/contexts/firm-billing-access.tsx");

function PageError({ error }: { error: Error }) {
  return createElement(
    "div",
    { "data-page-error": "root" },
    createElement("h1", null, "This page didn't load"),
    createElement("p", null, error.message),
  );
}

function Shell() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return createElement(
    QueryClientProvider,
    { client: queryClient },
    createElement(
      AuthProvider,
      null,
      createElement(
        AppChrome,
        null,
        createElement(FirmBillingAccessProvider, { entitled: true }, createElement(Outlet, null)),
      ),
    ),
  );
}

const rootRoute = createRootRoute({
  component: Shell,
  errorComponent: PageError,
});

const clientRoute = ClientRouteImport.update({
  id: "/clients/$clientId",
  path: "/clients/$clientId",
  getParentRoute: () => rootRoute,
  errorComponent: PageError,
} as never);

const appRoute = AppRouteImport.update({
  id: "/app",
  path: "/app",
  getParentRoute: () => rootRoute,
  errorComponent: PageError,
  // ssr:false makes the router wrap the match in ClientOnly, which never
  // mounts here. The component itself is Route.options.component.
  ssr: undefined,
  pendingComponent: undefined,
  component: AppRouteImport.options.component,
} as never);

function stub(path: string) {
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    component: () => null,
  });
}

const routeTree = rootRoute.addChildren([
  clientRoute,
  appRoute,
  stub("/dashboard"),
  stub("/settings"),
  stub("/practice"),
  stub("/ops"),
  stub("/auth"),
  stub("/auth/callback"),
  stub("/clients"),
  stub("/billing/required"),
]);

type PageCase = {
  label: string;
  mode: SmokeMode;
  url: string;
  prepare?: () => void;
  ready: (html: string) => boolean;
  expect: (html: string) => void;
  /** Every paint while waiting, so a mid-flight name cannot hide in the last frame. */
  expectFrames?: (frames: string[]) => void;
  /** Runs while the page is still mounted, after `expect`. */
  after?: (host: HTMLElement) => Promise<void>;
  /** Runs after the root unmounts, so an aborted in-flight read can settle. */
  afterUnmount?: () => void | Promise<void>;
  /** Override the paint budget. The default /app budget is 4s. */
  waitMs?: number;
};

function htmlHasStaleClient(html: string): boolean {
  return (
    html.includes(STALE_CLIENT_NAME) ||
    html.includes("Revoked &amp; Co") ||
    html.includes(STALE_CLIENT_ID)
  );
}

const clientHome = (mode: SmokeMode): PageCase => ({
  label: `accountant home ${mode}`,
  mode,
  url: mode === "loaded" ? `/clients/${SMOKE_CLIENT_ID}?tab=home&view=books` : `/clients/${SMOKE_CLIENT_ID}`,
  ready: (html) =>
    mode === "loading"
      ? html.includes("Checking this client.")
      : mode === "null"
        ? html.includes("Client not found")
        : (paneIsOpen(html, "pane-overview") || paneIsOpen(html, "pane-ask")) &&
          html.includes("Harbour Books"),
  expect: (html) => {
    if (mode === "loading")
      assert(html.includes("Checking this client."), "home loading shows the client shell");
    if (mode === "null")
      assert(html.includes("Client not found"), "home with no row says the client is missing");
    if (mode === "loaded") {
      assert(html.includes("Harbour Books"), "home shows the loaded client");
      assert(
        paneIsOpen(html, "pane-overview") || paneIsOpen(html, "pane-ask"),
        "home tab is the open pane",
      );
      assert(
        html.includes('data-connect-books="home"'),
        "home with no ledger shows the connect card",
      );
      assert(
        html.includes("Connect this client&#x27;s books") || html.includes("Connect this client's books"),
        "connect card titles the action",
      );
      assert(
        html.includes("Nothing is posted without your approval."),
        "connect card keeps the approval line",
      );
    }
  },
});

const clientHealth = (mode: SmokeMode): PageCase => ({
  label: `accountant health ${mode}`,
  mode,
  url: `/clients/${SMOKE_CLIENT_ID}?tab=health`,
  ready: (html) =>
    mode === "loading"
      ? html.includes("Checking this client.")
      : mode === "null"
        ? html.includes("Client not found")
        : paneIsOpen(html, "pane-ratios") && html.includes("Harbour Books"),
  expect: (html) => {
    if (mode === "loading")
      assert(html.includes("Checking this client."), "health loading shows the client shell");
    if (mode === "null")
      assert(html.includes("Client not found"), "health with no row says the client is missing");
    if (mode === "loaded") {
      assert(html.includes("Harbour Books"), "health shows the loaded client");
      assert(paneIsOpen(html, "pane-ratios"), "health tab is the open pane");
    }
  },
});

const owner = (mode: SmokeMode): PageCase => ({
  label: `owner board ${mode}`,
  mode,
  url: "/app",
  prepare: () => {
    resetSmokeRpcLog();
    const key = ownerActiveClientStorageKey(SMOKE_USER_ID);
    if (mode === "revoked" || mode === "error") {
      localStorage.setItem(key, STALE_CLIENT_ID);
      localStorage.setItem(`${key}:name`, STALE_CLIENT_NAME);
      return;
    }
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}:name`);
  },
  ready: (html) => {
    if (mode === "error") {
      return html.includes("Couldn't load your workspace") && html.includes("Retry");
    }
    if (!html.includes('data-owner-ready="true"')) return false;
    if (mode === "loading") return html.includes("Loading panel");
    if (mode === "null") return html.includes('id="board-pack"') && html.includes("Your business");
    return html.includes('id="board-pack"') && html.includes("Harbour Books");
  },
  expect: (html) => {
    if (mode === "error") {
      assert(html.includes('data-owner-boot="load-error"'), "list error is the retry screen");
      assert(html.includes("Couldn't load your workspace"), "list error names the failure");
      assert(html.includes("Retry"), "list error offers Retry");
      assert(!html.includes('id="board-pack"'), "list error does not open the empty board");
      assert(!html.includes("Couldn't open your workspace"), "list error is not the boot timeout");
      assert(
        !smokeRpcLog().includes("ensure_own_client"),
        "list error does not provision a client",
      );
      return;
    }
    assert(html.includes('data-owner-ready="true"'), "owner paint includes OwnerShell");
    if (mode === "loading") {
      assert(html.includes("Loading panel"), "owner loading keeps the shell and a skeleton");
      assert(!html.includes('id="board-pack"'), "owner loading has not opened the board yet");
    }
    if (mode === "null") {
      assert(html.includes('id="board-pack"'), "owner with no client still opens the board");
      assert(html.includes("Your business"), "a missing workspace uses the empty business name");
    }
    if (mode === "loaded" || mode === "revoked") {
      assert(html.includes('id="board-pack"'), "loaded owner opens the board");
      assert(html.includes("Harbour Books"), "loaded owner shows the workspace name");
    }
    if (mode === "revoked") {
      assert(!htmlHasStaleClient(html), "a revoked stored id is not the business on screen");
      const stored = localStorage.getItem(ownerActiveClientStorageKey(SMOKE_USER_ID));
      assert(
        stored === SMOKE_CLIENT_ID,
        "a revoked stored id is replaced by a workspace this login still has",
      );
    }
  },
  expectFrames:
    mode === "revoked" || mode === "error"
      ? (frames) => {
          const flashed = frames.some(htmlHasStaleClient);
          assert(!flashed, `${mode} never paints the stored client the login can no longer open`);
        }
      : undefined,
});

function boundaryHit(html: string): string | null {
  if (html.includes("This page didn't load") || html.includes('data-page-error="root"')) {
    return "root error boundary";
  }
  if (html.includes("hit an error.")) return "tab error boundary";
  const crash = caught.find((message) =>
    /Cannot read properties of null|before initialization/i.test(message),
  );
  if (crash) return crash;
  return null;
}

const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
  defaultErrorComponent: PageError,
  isServer: false,
} as never);
(router as { isServer?: boolean }).isServer = false;
(router as { _rendered?: unknown[] })._rendered = [];
await router.load();

function spyReload(): { reloaded: () => boolean; restore: () => void } {
  let calls = 0;
  const loc = window.location as Location & { reload?: () => void };
  const prior = loc.reload;
  const wrapped = () => {
    calls += 1;
  };
  try {
    loc.reload = wrapped;
  } catch {
    try {
      Object.defineProperty(loc, "reload", { configurable: true, writable: true, value: wrapped });
    } catch {
      /* A real reload would drop this document. The spy records it when the host allows it. */
    }
  }
  return {
    reloaded: () => calls > 0,
    restore: () => {
      try {
        if (prior) loc.reload = prior;
      } catch {
        /* The page stayed mounted either way. */
      }
    },
  };
}

async function clickRetry(host: HTMLElement, ready: (html: string) => boolean): Promise<string> {
  const before = window.location.href;
  const spy = spyReload();
  const button = [...host.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === "Retry",
  );
  assert(Boolean(button), "Retry is on the load screen");
  await act(async () => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  let html = host.innerHTML;
  for (let i = 0; i < 100 && !ready(html); i++) {
    assert(!html.includes("Couldn't open your workspace"), "recovery does not show the hard fail");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    html = host.innerHTML;
  }
  assert(ready(html), `Retry did not finish the read\n${html.replace(/\s+/g, " ").slice(0, 500)}`);
  assert(!html.includes("Couldn't open your workspace"), "Retry does not land on the hard fail");
  assert(window.location.href === before, "Retry does not navigate away");
  assert(!spy.reloaded(), "Retry does not reload the page");
  assert(host.isConnected, "Retry keeps the same document");
  spy.restore();
  return html;
}

async function paint(page: PageCase) {
  caught.length = 0;
  resetBootReadForTests();
  setBootReadTimeoutMsForTests(null);
  setSmokeMode(page.mode);
  suppressTours();
  page.prepare?.();
  // A second createRouter cannot rematch this tree, and navigate() no-ops
  // while the router origin is the vite-node default. Push the memory entry.
  router.history.replace(page.url);
  await router.load();
  // Search-only updates were leaving the previous match search in place
  // (`?tab=home` stayed selected on `?tab=health`). The location is right.
  const nextSearch = router.state.location.search;
  for (const match of router.state.matches) {
    const row = match as { search?: unknown; _strictSearch?: unknown };
    row.search = nextSearch;
    row._strictSearch = nextSearch;
  }
  (router as { isServer?: boolean }).isServer = false;
  (router as { _rendered?: unknown[] })._rendered = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host, {
    onCaughtError(error) {
      caught.push(error instanceof Error ? error.message : String(error));
    },
    onUncaughtError(error) {
      caught.push(error instanceof Error ? error.message : String(error));
    },
  });
  try {
    await act(async () => {
      root.render(createElement(RouterProvider, { router }));
    });
    const frames: string[] = [];
    const note = (next: string) => {
      if (page.expectFrames) frames.push(next);
    };
    let html = host.innerHTML;
    note(html);
    const budget = page.waitMs ? Math.ceil(page.waitMs / 40) : page.url === "/app" ? 100 : 60;
    for (let i = 0; i < budget && !page.ready(html); i++) {
      const crashed = boundaryHit(html);
      if (crashed) break;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      html = host.innerHTML;
      note(html);
    }
    const crashed = boundaryHit(html);
    if (crashed) {
      throw new Error(`${page.label} hit ${crashed}\n${html.replace(/\s+/g, " ").slice(0, 700)}`);
    }
    try {
      page.expect(html);
      page.expectFrames?.(frames);
      if (page.after) await page.after(host);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${page.label}: ${message}\n${html.replace(/\s+/g, " ").slice(0, 500)}`);
    }
    console.log(`ok  ${page.label}`);
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
    if (page.afterUnmount) await page.afterUnmount();
  }
}

const cases: PageCase[] = [];
for (const mode of ["null", "loading", "loaded"] as const) {
  cases.push(clientHome(mode), clientHealth(mode), owner(mode));
}
cases.push(owner("revoked"), owner("error"));

function bootCase(mode: "hang-once" | "critical-down" | "section-down"): PageCase {
  return {
    label: `owner board ${mode}`,
    mode,
    url: mode === "section-down" ? "/app?screen=accountant" : "/app",
    prepare: () => {
      resetSmokeRpcLog();
      setBootReadTimeoutMsForTests(mode === "hang-once" ? 40 : null);
      const key = ownerActiveClientStorageKey(SMOKE_USER_ID);
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}:name`);
    },
    ready: (html) => {
      if (mode === "critical-down") {
        return html.includes("Couldn't load your workspace") && html.includes("Retry");
      }
      if (!html.includes('data-owner-ready="true"')) return false;
      if (!html.includes('id="board-pack"') || !html.includes("Harbour Books")) return false;
      if (mode === "section-down") return html.includes('data-section-retry="deliverables"');
      return !html.includes("Couldn't open your workspace");
    },
    expect: (html) => {
      if (mode === "hang-once") {
        assert(
          html.includes('id="board-pack"'),
          "a fetch that hangs once still opens the workspace",
        );
        assert(html.includes("Harbour Books"), "the recovered workspace keeps its name");
        assert(!html.includes("Couldn't open your workspace"), "one hang is not the boot error");
        assert(!html.includes("Couldn't load your workspace"), "one hang is not the list error");
        assert(!smokeRpcLog().includes("ensure_own_client"), "a recovered list does not provision");
        return;
      }
      if (mode === "critical-down") {
        assert(
          html.includes('data-owner-boot="load-error"'),
          "two critical failures use the recoverable screen",
        );
        assert(
          html.includes("Couldn't load your workspace"),
          "two critical failures say Couldn't load",
        );
        assert(html.includes("Retry"), "two critical failures offer Retry");
        assert(
          !html.includes("Couldn't open your workspace"),
          "two critical failures are not the hard fail",
        );
        assert(
          !html.includes('data-owner-boot="timeout"'),
          "two critical failures do not trip the backstop",
        );
        assert(!html.includes('id="board-pack"'), "two critical failures do not open the board");
        assert(
          !smokeRpcLog().includes("ensure_own_client"),
          "a failed list does not provision a client",
        );
        return;
      }
      assert(
        html.includes('id="board-pack"'),
        "a failed deliverable read still opens the workspace",
      );
      assert(html.includes("Harbour Books"), "the workspace name stays on screen");
      assert(
        html.includes('data-section-retry="deliverables"'),
        "deliverables reject with Failed to fetch and offer Retry",
      );
      assert(
        !html.includes("Couldn't open your workspace"),
        "a non-critical failure is not the boot error",
      );
      assert(
        !html.includes("Couldn't load your workspace"),
        "a non-critical failure is not the list error",
      );
    },
  };
}

cases.push(bootCase("hang-once"), bootCase("critical-down"), bootCase("section-down"));

cases.push({
  label: "owner board hang-twice",
  mode: "hang-twice",
  url: "/app",
  prepare: () => {
    resetSmokeRpcLog();
    setBootReadTimeoutMsForTests(40);
    const key = ownerActiveClientStorageKey(SMOKE_USER_ID);
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}:name`);
  },
  ready: (html) =>
    html.includes('data-owner-boot="load-error"') &&
    html.includes("Couldn't load your workspace") &&
    html.includes("Retry"),
  expect: (html) => {
    assert(html.includes("Couldn't load your workspace"), "a hung retry says Couldn't load");
    assert(html.includes("Retry"), "a hung retry offers Retry");
    assert(html.includes('data-owner-boot="load-error"'), "a hung retry is the recoverable screen");
    assert(!html.includes("Couldn't open your workspace"), "a hung retry is not the hard fail");
    assert(
      !html.includes('data-owner-boot="timeout"'),
      "the backstop does not take a failed retry",
    );
    assert(!html.includes('id="board-pack"'), "a hung retry does not open the board");
  },
  expectFrames: (frames) => {
    assert(
      frames.every((frame) => !frame.includes("Couldn't open your workspace")),
      "the hard fail never paints while the retry is failing",
    );
  },
  after: async (host) => {
    const html = await clickRetry(
      host,
      (next) =>
        next.includes('data-owner-ready="true"') &&
        next.includes('id="board-pack"') &&
        next.includes("Harbour Books"),
    );
    assert(html.includes("Harbour Books"), "Retry opens the workspace that loaded");
    assert(!html.includes('data-owner-boot="load-error"'), "Retry leaves the load screen");
  },
});

cases.push({
  label: "accountant client hang-twice",
  mode: "client-hang-twice",
  url: `/clients/${SMOKE_CLIENT_ID}`,
  prepare: () => {
    setBootReadTimeoutMsForTests(40);
  },
  ready: (html) =>
    html.includes('data-client-boot="load-error"') &&
    html.includes("Couldn't load this client") &&
    html.includes("Retry"),
  expect: (html) => {
    assert(html.includes("Couldn't load this client"), "a hung client retry says Couldn't load");
    assert(html.includes("Retry"), "a hung client retry offers Retry");
    assert(
      !html.includes("Couldn't open your workspace"),
      "the client page does not use the hard fail",
    );
    assert(!html.includes("Harbour Books"), "the client name waits until Retry");
  },
  after: async (host) => {
    const html = await clickRetry(
      host,
      (next) => next.includes("Harbour Books") && !next.includes('data-client-boot="load-error"'),
    );
    assert(html.includes("Harbour Books"), "Retry opens the client that loaded");
  },
});

const roleWarns: string[] = [];
let priorWarn: typeof console.warn = console.warn;

cases.push({
  label: "invite owner hung user_roles",
  mode: "invite-roles-hang",
  url: "/app",
  prepare: () => {
    resetSmokeRpcLog();
    const key = ownerActiveClientStorageKey(SMOKE_USER_ID);
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}:name`);
    roleWarns.length = 0;
    priorWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      roleWarns.push(args.map((value) => String(value)).join(" "));
      priorWarn(...args);
    };
  },
  ready: (html) => html.includes('data-owner-ready="true"') && html.includes('id="board-pack"'),
  expect: (html) => {
    assert(html.includes('id="board-pack"'), "a hung role list still opens the invited workspace");
    assert(html.includes("Harbour Books"), "the invited workspace keeps its name");
    assert(
      !html.includes("Couldn't open your workspace"),
      "a hung role list is not the 8s hard fail",
    );
    assert(
      !html.includes("Couldn't load your workspace"),
      "a hung role list is not the load error",
    );
    const listed = smokeRoleReads().filter((row) => row.stack?.includes("listAppRoles"));
    assert(listed.length > 0, "listAppRoles reads user_roles");
    assert(
      listed.every((row) => row.signal),
      "listAppRoles passes an abort signal",
    );
  },
  afterUnmount: async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    console.warn = priorWarn;
    assert(
      !roleWarns.some((line) => line.includes("[user-roles] list failed")),
      "a role list rejected after unmount is not logged",
    );
  },
});

cases.push({
  label: "invite owner slow chain",
  mode: "invite-slow-chain",
  url: "/app",
  waitMs: 12_000,
  prepare: () => {
    resetSmokeRpcLog();
    const key = ownerActiveClientStorageKey(SMOKE_USER_ID);
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}:name`);
  },
  ready: (html) => html.includes('data-owner-ready="true"') && html.includes('id="board-pack"'),
  expect: (html) => {
    assert(html.includes('id="board-pack"'), "a chain of sub-4s invite reads opens the board");
    assert(html.includes("Harbour Books"), "the invited workspace keeps its name");
    assert(
      !html.includes("Couldn't open your workspace"),
      "invite reads under 4s must not reach the 8s backstop",
    );
    assert(
      !html.includes('data-owner-boot="timeout"'),
      "a progressing invite chain is not the shell backstop",
    );
    assert(!html.includes("Couldn't load your workspace"), "a progressing chain is not a failed retry");
    assert(!html.includes('data-owner-boot="load-error"'), "a progressing chain is not the load error");
    assert(smokeInviteOpens() === 0, "a known client_owner skips openInvitedClient");
  },
});

cases.push({
  label: "no-membership invite still opens",
  mode: "invite-fresh",
  url: "/app",
  prepare: () => {
    resetSmokeRpcLog();
    const key = ownerActiveClientStorageKey(SMOKE_USER_ID);
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}:name`);
  },
  ready: (html) => html.includes('data-owner-ready="true"') && html.includes('id="board-pack"'),
  expect: (html) => {
    assert(html.includes('id="board-pack"'), "an invite with no membership yet opens the board");
    assert(html.includes("Harbour Books"), "the invited workspace keeps its name");
    assert(smokeInviteOpens() > 0, "no membership yet still calls openInvitedClient");
    assert(!html.includes("Couldn't open your workspace"), "a fresh invite is not the hard fail");
    assert(!html.includes("Couldn't load your workspace"), "a fresh invite is not the load error");
  },
});

cases.push({
  label: "progressing chain beyond 12s hits the ceiling",
  mode: "progress-ceiling",
  url: "/app",
  waitMs: 3_000,
  prepare: () => {
    resetSmokeRpcLog();
    setBootReadTimeoutMsForTests(2_000);
    setShellBackstopForTests({ idleMs: 30_000, ceilingMs: 350 });
    const key = ownerActiveClientStorageKey(SMOKE_USER_ID);
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}:name`);
  },
  ready: (html) => html.includes('data-owner-boot="load-error"'),
  expect: (html) => {
    assert(html.includes('data-owner-boot="load-error"'), "the ceiling paints Couldn't load");
    assert(html.includes("Couldn't load your workspace"), "the ceiling says Couldn't load");
    assert(html.includes("Retry"), "the ceiling offers Retry");
    assert(!html.includes('data-owner-boot="timeout"'), "the ceiling is not the idle backstop");
    assert(!html.includes("Couldn't open your workspace"), "the ceiling is not Couldn't open");
  },
});

cases.push({
  label: "US owner single read unchanged",
  mode: "loaded",
  url: "/app",
  prepare: () => {
    resetSmokeRpcLog();
    const key = ownerActiveClientStorageKey(SMOKE_USER_ID);
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}:name`);
  },
  ready: (html) => html.includes('data-owner-ready="true"') && html.includes('id="board-pack"'),
  expect: (html) => {
    assert(html.includes("Harbour Books"), "the US owner still opens the workspace");
    assert(smokeWorkspaceListWaves() === 1, "the US owner lists workspaces once");
    assert(smokeInviteOpens() === 0, "the US owner does not open an invite");
    assert(!html.includes("Couldn't open your workspace"), "the US owner is not the hard fail");
    assert(!html.includes("Couldn't load your workspace"), "the US owner is not the load error");
  },
});

cases.push({
  label: "first attempt hangs past 4s and the retry returns at 5s",
  mode: "hedge-slow-read",
  url: "/app",
  waitMs: 9_000,
  prepare: () => {
    resetSmokeRpcLog();
    const key = ownerActiveClientStorageKey(SMOKE_USER_ID);
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}:name`);
  },
  ready: (html) =>
    html.includes('data-owner-ready="true"') &&
    html.includes('id="board-pack"') &&
    html.includes("Harbour Books"),
  expect: (html) => {
    const timing = smokeHedgeTiming();
    const span = timing.retryResolvedAt - timing.firstAt;
    assert(html.includes('id="board-pack"'), "a slow first attempt still opens the board");
    assert(html.includes("Harbour Books"), "the hedged retry keeps the workspace name");
    assert(!html.includes("Couldn't load your workspace"), "a retry that returns at 5s is not an error");
    assert(!html.includes('data-owner-boot="load-error"'), "a retry that returns at 5s has no load error");
    assert(!html.includes("Couldn't open your workspace"), "a retry that returns at 5s is not the hard fail");
    assert(timing.firstAt > 0 && timing.retryResolvedAt > 0, "the hedge issued a second select");
    assert(span >= 4_800, `the retry returns at about 5s, saw ${span}ms`);
    assert(span < 5_800, `the second select overlaps the first, saw ${span}ms`);
  },
});

try {
  for (const page of cases) {
    await paint(page);
  }
  console.log("page-render-smoke-test: ok");
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
}
