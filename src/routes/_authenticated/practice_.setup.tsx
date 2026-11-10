import { createFileRoute } from "@tanstack/react-router";
import { PracticeRail } from "@/components/practice-rail";
import { PracticeSetupPanel } from "@/components/practice-setup-panel";

export const Route = createFileRoute("/_authenticated/practice_/setup")({
  component: PracticeSetupPage,
  head: () => ({
    meta: [{ title: "Implementation Manager — Milōn" }],
  }),
});

function PracticeSetupPage() {
  return (
    <div className="accountant-portal premium-shell practice-home">
      <main className="shell">
        <div className="client-workspace">
          <PracticeRail />
          <div className="deliverable-main">
            <PracticeSetupPanel />
          </div>
        </div>
      </main>
    </div>
  );
}
