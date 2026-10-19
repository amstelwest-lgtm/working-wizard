import { createFileRoute } from "@tanstack/react-router";
import { PracticeBoard } from "@/components/practice-board";

export const Route = createFileRoute("/_authenticated/practice_/needs-attention")({
  component: NeedsAttentionPage,
  head: () => ({
    meta: [{ title: "Needs attention — Milōn" }],
  }),
});

function NeedsAttentionPage() {
  return <PracticeBoard view="needs-attention" />;
}
