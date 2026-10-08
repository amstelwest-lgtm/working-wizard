import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { initMonitoring } from "./lib/monitoring";

let monitoringScheduled = false;

/**
 * Load Sentry after the page is idle so the chunk is off the critical path.
 * `reportClientError` still calls `initMonitoring` on the first error.
 * No-op during SSR.
 */
function scheduleMonitoring(): void {
  if (monitoringScheduled || typeof window === "undefined") return;
  monitoringScheduled = true;

  const start = () => {
    const run = () => {
      void initMonitoring();
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 6000 });
    } else {
      window.setTimeout(run, 6000);
    }
  };

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

export const getRouter = () => {
  scheduleMonitoring();
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
