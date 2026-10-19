import { createFileRoute } from "@tanstack/react-router";
import { PracticeBoard } from "@/components/practice-board";

export const Route = createFileRoute("/_authenticated/practice_/insights")({
  component: InsightsPage,
  head: () => ({
    meta: [{ title: "Insights — Milōn" }],
  }),
});

function InsightsPage() {
  return <PracticeBoard view="insights" />;
}
