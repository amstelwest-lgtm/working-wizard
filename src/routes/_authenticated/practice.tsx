import { createFileRoute } from "@tanstack/react-router";
import { PracticeBoard } from "@/components/practice-board";

export const Route = createFileRoute("/_authenticated/practice")({
  component: PracticeOverviewPage,
  head: () => ({
    meta: [{ title: "Practice — Milōn" }],
  }),
});

function PracticeOverviewPage() {
  return <PracticeBoard view="practice" />;
}
