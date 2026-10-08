import { Outlet, RouterProvider, createBrowserHistory, createRootRoute, createRoute, createRouter, useSearch } from "@tanstack/react-router";
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
import { StaffInvitePreview } from "./invite-preview";
import { OwnerCashBoard, RailStudio } from "./studio";

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
  component: () => <Outlet />,
});
const clientRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clients/$clientId",
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
    section: typeof search.section === "string" ? search.section : undefined,
    focus: search.focus === "health" || search.focus === "pillars" ? search.focus : undefined,
    aged: search.aged === 1 || search.aged === "1" ? 1 : undefined,
    packView:
      search.packView === "draft" || search.packView === "ready" || search.packView === "stale"
        ? search.packView
        : undefined,
    planView:
      search.planView === "empty" || search.planView === "signed" ? search.planView : undefined,
    drafterView: search.drafterView === "sent" ? "sent" : undefined,
    view: search.view === "table" ? "table" : undefined,
  }),
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
    const search = useSearch({ strict: false }) as { view?: "landing" | "create" | "revoked" | "workspace" };
    return <StaffInvitePreview view={search.view ?? "landing"} />;
  },
});

const routeTree = rootRoute.addChildren([clientRoute, ownerRoute, inviteRoute]);
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
    <AuthProvider>
      <AccountantProfileProvider>
        <NotesProvider>
          <RouterProvider router={router} />
          <Toaster />
        </NotesProvider>
      </AccountantProfileProvider>
    </AuthProvider>
  </StrictMode>,
);
