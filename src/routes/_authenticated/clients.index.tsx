import { createFileRoute } from "@tanstack/react-router";
import { PracticeBoard } from "@/components/practice-board";

/**
 * Exact /clients only. This must stay an index route.
 * A clients.tsx layout would run for /clients/:id as well,
 * and the client bundle rebuilds that parent link from the file name.
 */
export const Route = createFileRoute("/_authenticated/clients/")({
  component: PracticeClientsPage,
  head: () => ({
    meta: [{ title: "Clients — Milōn" }],
  }),
});

function PracticeClientsPage() {
  return <PracticeBoard view="clients" />;
}
