import { Outlet, RouterProvider, createBrowserHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { AccountantProfileProvider } from "@/contexts/accountant-profile";
import { MarketProvider } from "@/contexts/market";
import { AuthProvider } from "@/hooks/use-auth";
import "@/styles.css";
import "@/styles/accountant-portal.css";
import "@/styles/feature-finder.css";
import { RailStudio } from "./studio";

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

const routeTree = rootRoute.addChildren([clientRoute]);
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
