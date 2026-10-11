import { createFileRoute, redirect } from "@tanstack/react-router";
import { ownerDeliverablesRedirectTarget } from "@/lib/owner-nav";

/** Old owner /app/deliverables URL. The accountant Deliverables tab is unchanged. */
export const Route = createFileRoute("/app_/deliverables")({
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
