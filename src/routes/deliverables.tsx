import { createFileRoute, redirect } from "@tanstack/react-router";
import { ownerDeliverablesRedirectTarget } from "@/lib/owner-nav";

/** Old owner /deliverables URL. Accountant studio links are /clients/:id, not this path. */
export const Route = createFileRoute("/deliverables")({
  beforeLoad: ({ location }) => {
    const search =
      location.searchStr.startsWith("?") || location.searchStr === ""
        ? location.searchStr
        : `?${location.searchStr}`;
    const target =
      ownerDeliverablesRedirectTarget(`https://milonfinance.com${location.pathname}${search}`) ??
      "/app?screen=accountant&section=signed";
    throw redirect({ href: target, replace: true });
  },
});
