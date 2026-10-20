import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Nothing links here on purpose. The practice rail's Clients item is /clients,
 * and TanStack preloads registered routes only. A cold tab still requests
 * /practice/clients (the practice section plus the clients slug). That 404s.
 * Send it to the real clients list.
 *
 * The component is empty on purpose: a redirect-only route with no component
 * never settles.
 */
export const Route = createFileRoute("/_authenticated/practice_/clients")({
  beforeLoad: () => {
    throw redirect({ to: "/clients", replace: true });
  },
  component: PracticeClientsRedirect,
  head: () => ({
    meta: [{ title: "Clients — Milōn" }],
  }),
});

function PracticeClientsRedirect() {
  return null;
}
