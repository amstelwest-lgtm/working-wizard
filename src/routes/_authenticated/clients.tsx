import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old /clients links land on the practice client list. */
export const Route = createFileRoute("/_authenticated/clients")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard", hash: "clients-table" });
  },
});
