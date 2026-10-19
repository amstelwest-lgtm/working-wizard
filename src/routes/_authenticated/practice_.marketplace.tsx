import { createFileRoute } from "@tanstack/react-router";
import { PracticeBoard } from "@/components/practice-board";

export const Route = createFileRoute("/_authenticated/practice_/marketplace")({
  component: MarketplacePage,
  head: () => ({
    meta: [{ title: "Marketplace — Milōn" }],
  }),
});

function MarketplacePage() {
  return <PracticeBoard view="marketplace" />;
}
