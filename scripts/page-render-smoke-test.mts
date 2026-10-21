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
  smokeRpcLog,
  SMOKE_CLIENT_ID,
  SMOKE_USER_ID,
  STALE_CLIENT_ID,
  STALE_CLIENT_NAME,
  type SmokeMode,
} from "./page-smoke-supabase.ts";
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
const {
  Outlet,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} = await import("@tanstack/react-router");
const { Route: ClientRouteImport } = await import("../src/routes/_authenticated/clients.$clientId.tsx");
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
};

function htmlHasStaleClient(html: string): boolean {
  return html.includes(STALE_CLIENT_NAME) || html.includes("Revoked &amp; Co") || html.includes(STALE_CLIENT_ID);
}

const clientHome = (mode: SmokeMode): PageCase => ({
  label: `accountant home ${mode}`,
  mode,
  url:
    mode === "loaded"
      ? `/clients/${SMOKE_CLIENT_ID}?tab=home`
      : `/clients/${SMOKE_CLIENT_ID}`,
  ready: (html) =>
    mode === "loading"
      ? html.includes("Checking this client.")
      : mode === "null"
        ? html.includes("Client not found")
        : (paneIsOpen(html, "pane-overview") || paneIsOpen(html, "pane-ask")) &&
          html.includes("Harbour Books"),
  expect: (html) => {
    if (mode === "loading") assert(html.includes("Checking this client."), "home loading shows the client shell");
    if (mode === "null") assert(html.includes("Client not found"), "home with no row says the client is missing");
    if (mode === "loaded") {
      assert(html.includes("Harbour Books"), "home shows the loaded client");
      assert(
        paneIsOpen(html, "pane-overview") || paneIsOpen(html, "pane-ask"),
        "home tab is the open pane",
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
    if (mode === "loading") assert(html.includes("Checking this client."), "health loading shows the client shell");
    if (mode === "null") assert(html.includes("Client not found"), "health with no row says the client is missing");
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
      assert(!smokeRpcLog().includes("ensure_own_client"), "list error does not provision a client");
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
      assert(stored === SMOKE_CLIENT_ID, "a revoked stored id is replaced by a workspace this login still has");
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
  const crash = caught.find((message) => /Cannot read properties of null|before initialization/i.test(message));
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

async function paint(page: PageCase) {
  caught.length = 0;
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
    const budget = page.url === "/app" ? 100 : 60;
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${page.label}: ${message}\n${html.replace(/\s+/g, " ").slice(0, 500)}`,
      );
    }
    console.log(`ok  ${page.label}`);
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
}

const cases: PageCase[] = [];
for (const mode of ["null", "loading", "loaded"] as const) {
  cases.push(clientHome(mode), clientHealth(mode), owner(mode));
}
cases.push(owner("revoked"), owner("error"));

try {
  for (const page of cases) {
    await paint(page);
  }
  console.log("page-render-smoke-test: ok");
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
}
