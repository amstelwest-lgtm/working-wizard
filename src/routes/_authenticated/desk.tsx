import { createFileRoute, redirect } from "@tanstack/react-router";

/** Practice Desk is gone. Agents live on practice Home. */
export const Route = createFileRoute("/_authenticated/desk")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
