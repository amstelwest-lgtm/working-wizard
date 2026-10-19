import { createFileRoute } from "@tanstack/react-router";
import { PracticeBoard } from "@/components/practice-board";

export const Route = createFileRoute("/_authenticated/practice_/playbooks")({
  component: PlaybooksPage,
  head: () => ({
    meta: [{ title: "Playbooks — Milōn" }],
  }),
});

function PlaybooksPage() {
  return <PracticeBoard view="playbooks" />;
}
