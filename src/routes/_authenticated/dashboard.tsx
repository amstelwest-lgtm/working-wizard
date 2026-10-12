import { createFileRoute } from "@tanstack/react-router";
import { PracticeBoard } from "@/components/practice-board";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: PracticeHomePage,
  head: () => ({
    meta: [{ title: "Home — Milōn" }],
  }),
});

function PracticeHomePage() {
  return <PracticeBoard view="home" />;
}
