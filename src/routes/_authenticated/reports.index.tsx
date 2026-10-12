import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "./reports-studio";

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
  component: ReportsPage,
  head: () => ({
    meta: [{ title: "Reports — Milōn" }],
  }),
});
