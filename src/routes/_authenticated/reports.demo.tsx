import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Legacy mock preview. The production Reports Studio at /reports is the only
 * report UI — keep this route as a redirect so old bookmarks don't 404.
 */
export const Route = createFileRoute("/_authenticated/reports/demo")({
  component: ReportsDemoRedirect,
  head: () => ({ meta: [{ title: "Reports — Milōn" }] }),
});

function ReportsDemoRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({
      to: "/reports",
      search: {
        client: undefined,
        clientId: undefined,
        report: undefined,
        action: undefined,
      },
      replace: true,
    });
  }, [navigate]);
  return null;
}
