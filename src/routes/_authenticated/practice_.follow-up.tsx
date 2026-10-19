import { createFileRoute } from "@tanstack/react-router";
import { PracticeBoard } from "@/components/practice-board";

export const Route = createFileRoute("/_authenticated/practice_/follow-up")({
  component: FollowUpPage,
  head: () => ({
    meta: [{ title: "Follow up — Milōn" }],
  }),
});

function FollowUpPage() {
  return <PracticeBoard view="follow-up" />;
}
