import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Exact /clients only. This must stay an index route.
 * A clients.tsx layout would run this redirect for /clients/:id as well,
 * and the client bundle rebuilds that parent link from the file name.
 */
export const Route = createFileRoute("/_authenticated/clients/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", hash: "clients-table" });
  },
});
