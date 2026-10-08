import { Outlet, RouterProvider, createBrowserHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { AccountantProfileProvider } from "@/contexts/accountant-profile";
import { MarketProvider } from "@/contexts/market";
import { AuthProvider } from "@/hooks/use-auth";
import { applyPortalTheme } from "@/lib/portal-theme";
import appCss from "@/styles.css?url";
import { authenticatedLayoutLinks, founderPortalLinks } from "@/styles/app-route-styles";
import { OwnerCashBoard, RailStudio } from "./studio";

// Portal :root tokens are dark. `class="dark"` makes Tailwind use the same
// palette, which is what a dark signed-in session does.
applyPortalTheme("dark");

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

const routeTree = rootRoute.addChildren([clientRoute, ownerRoute]);
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
        <RouterProvider router={router} />
        <Toaster />
      </AccountantProfileProvider>
    </AuthProvider>
  </StrictMode>,
);
