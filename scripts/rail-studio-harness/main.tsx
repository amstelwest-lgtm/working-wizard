import {
  Outlet,
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { canonicalizeAccountantSearch } from "@/lib/client-route-search";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { toast, Toaster } from "sonner";
import { AccountantProfileProvider } from "@/contexts/accountant-profile";
import { NotesProvider } from "@/contexts/notes";
import { MarketProvider } from "@/contexts/market";
import { AuthProvider } from "@/hooks/use-auth";
import { applyPortalTheme } from "@/lib/portal-theme";
import appCss from "@/styles.css?url";
import { authenticatedLayoutLinks, founderPortalLinks } from "@/styles/app-route-styles";
import { ShareButton } from "@/components/share";
import type { ClientNote } from "@/lib/notes.functions";
import { StaffInvitePreview } from "./invite-preview";
import { ImportLowsPreview } from "./import-lows-preview";
import { MilonTeamDeskPage } from "./milon-team-desk-page";
import { OwnerMockupPage } from "./owner-mockup-page";
import { OwnerCashBoard, RailStudio } from "./studio";

const HARNESS_PREVIEW_NOTES: ClientNote[] = [
  {
    id: "harness-note-1",
    clientId: "harness-client",
    tab: "overview",
    x: 48,
    y: 220,
    ratioKey: null,
    text: "Check the health figure before the next review.",
    authorId: "harness",
    author: "Harbour & Co",
    authorEmail: null,
    timestamp: "2026-10-08T08:00:00.000Z",
    resolved: false,
    taggedMilonIt: false,
    mentions: [],
    replies: [],
  },
];

// Portal :root tokens are dark. `class="dark"` makes Tailwind use the same
// palette, which is what a dark signed-in session does.
applyPortalTheme("dark");

// The local stub rejects server calls with "harness-local". Keep those out of
// the screenshots. App toast code is unchanged.
const hideHarnessToast = (message: unknown) => String(message ?? "").includes("harness-local");
const toastError = toast.error.bind(toast);
toast.error = ((message, data) => {
  if (hideHarnessToast(message)) return "";
  return toastError(message, data);
}) as typeof toast.error;

// Same sheets as `__root` (styles.css) plus `/_authenticated` head links.
// The client route itself adds none; #370 moved those onto the layout.
const sheetHrefs = [
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,500;1,600&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=Noto+Sans:wght@300;400;500;600;700;800&display=swap",
  appCss,
  ...authenticatedLayoutLinks.flatMap((link) => (link.rel === "stylesheet" ? [link.href] : [])),
  ...founderPortalLinks.map((link) => link.href),
];
for (const href of sheetHrefs) {
  const el = document.createElement("link");
  el.rel = "stylesheet";
  el.href = href;
  document.head.appendChild(el);
}

const rootRoute = createRootRoute({
  component: function HarnessRoot() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    // The owner mockup is static. The signed-in providers loop in this
    // harness (notes refresh) and are not part of the mock.
    if (pathname === "/owner-mockup") return <Outlet />;
    return (
      <AuthProvider>
        <AccountantProfileProvider>
          <NotesProvider previewNotes={HARNESS_PREVIEW_NOTES}>
            <Outlet />
            <ShareButton />
            <Toaster />
          </NotesProvider>
        </AccountantProfileProvider>
      </AuthProvider>
    );
  },
});
const clientRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clients/$clientId",
  validateSearch: (search: Record<string, unknown>) => {
    const rawTab = typeof search.tab === "string" ? search.tab : undefined;
    const rawSection = typeof search.section === "string" ? search.section : undefined;
    const rawFocus = typeof search.focus === "string" ? search.focus : undefined;
    const canonical =
      rawTab || rawSection
        ? canonicalizeAccountantSearch({ tab: rawTab, section: rawSection, focus: rawFocus })
        : null;
    return {
      tab: canonical?.tab,
      section: canonical?.section,
      focus: canonical?.focus,
      aged: search.aged === 1 || search.aged === "1" ? 1 : undefined,
      packView:
        search.packView === "draft" ||
        search.packView === "ready" ||
        search.packView === "stale" ||
        search.packView === "cycle"
          ? search.packView
          : undefined,
      planView:
        search.planView === "empty" || search.planView === "signed" ? search.planView : undefined,
      drafterView: search.drafterView === "sent" ? "sent" : undefined,
      view:
        search.view === "table" || search.view === "13week" || search.view === "chart"
          ? search.view
          : undefined,
    };
  },
  component: function ClientHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <RailStudio />
      </MarketProvider>
    );
  },
});

const ownerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  component: function OwnerHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <OwnerCashBoard clientId="harness-client" />
      </MarketProvider>
    );
  },
});

const teamDeskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/milon-team-desk",
  validateSearch: (search: Record<string, unknown>) => ({
    fixture: search.fixture === "empty" ? "empty" : "populated",
  }),
  component: MilonTeamDeskPage,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite",
  validateSearch: (search: Record<string, unknown>) => ({
    view:
      search.view === "create" || search.view === "revoked" || search.view === "workspace"
        ? search.view
        : "landing",
  }),
  component: function InviteHarness() {
    const search = useSearch({ strict: false }) as {
      view?: "landing" | "create" | "revoked" | "workspace";
    };
    return <StaffInvitePreview view={search.view ?? "landing"} />;
  },
});

const importLowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import-lows",
  component: function ImportLowsHarness() {
    return (
      <MarketProvider selection={{ country: "US", regionCode: "NY" }}>
        <ImportLowsPreview />
      </MarketProvider>
    );
  },
});

const ownerMockupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/owner-mockup",
  validateSearch: (search: Record<string, unknown>) => ({
    screen:
      search.screen === "bot" ||
      search.screen === "actions" ||
      search.screen === "accountant" ||
      search.screen === "first" ||
      search.screen === "plan"
        ? search.screen
        : "home",
    bot:
      search.bot === "financial_manager" || search.bot === "advisor" || search.bot === "analyst"
        ? search.bot
        : "analyst",
  }),
  component: OwnerMockupPage,
});

const routeTree = rootRoute.addChildren([
  clientRoute,
  ownerRoute,
  teamDeskRoute,
  inviteRoute,
  importLowsRoute,
  ownerMockupRoute,
]);
const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
