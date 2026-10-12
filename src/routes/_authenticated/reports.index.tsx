import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * There is no practice report builder. A link that names a client opens that
 * client's Reports page. Anything else goes to practice Home.
 */
export const Route = createFileRoute("/_authenticated/reports/")({
  validateSearch: (search: Record<string, unknown>) => ({
    client: typeof search.client === "string" ? search.client : undefined,
    clientId: typeof search.clientId === "string" ? search.clientId : undefined,
    report: typeof search.report === "string" ? search.report : undefined,
    action:
      search.action === "download" || search.action === "preview"
        ? (search.action as "download" | "preview")
        : undefined,
  }),
  beforeLoad: ({ search }) => {
    const clientId = search.clientId || search.client;
    if (clientId) {
      throw redirect({
        to: "/clients/$clientId",
        params: { clientId },
        search: {
          tab: "reports",
          report: search.report,
          action: search.action,
        },
      });
    }
    throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [{ title: "Reports — Milōn" }],
  }),
});
