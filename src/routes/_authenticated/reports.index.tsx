import { createFileRoute, redirect } from "@tanstack/react-router";
import { reportsIndexRedirect, reportsIndexSearch } from "@/lib/reports-index-redirect";

/**
 * There is no practice report builder. A link that names a client opens that
 * client's Reports page. Anything else goes to practice Home.
 *
 * The component is intentionally empty. A redirect-only route with no
 * component never settles, so opening /reports from Home times out.
 */
export const Route = createFileRoute("/_authenticated/reports/")({
  validateSearch: reportsIndexSearch,
  beforeLoad: ({ search }) => {
    const dest = reportsIndexRedirect(search);
    if (dest.to === "/dashboard") {
      throw redirect({ to: "/dashboard", replace: true });
    }
    throw redirect({
      to: dest.to,
      params: dest.params,
      search: dest.search,
      replace: true,
    });
  },
  component: ReportsIndexRedirect,
  head: () => ({
    meta: [{ title: "Reports — Milōn" }],
  }),
});

function ReportsIndexRedirect() {
  return null;
}
