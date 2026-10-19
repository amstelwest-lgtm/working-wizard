import { createFileRoute } from "@tanstack/react-router";
import { PracticeBoard } from "@/components/practice-board";

export const Route = createFileRoute("/_authenticated/clients_/queries")({
  component: OpenQueriesPage,
  head: () => ({
    meta: [{ title: "Open queries — Milōn" }],
  }),
});

function OpenQueriesPage() {
  return <PracticeBoard view="queries" />;
}
