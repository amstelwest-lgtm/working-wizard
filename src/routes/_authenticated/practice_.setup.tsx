import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { PracticeRail } from "@/components/practice-rail";
import { PRACTICE_SETUP_TOASTER_ID, PracticeSetupPanel } from "@/components/practice-setup-panel";

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
            <Toaster
              id={PRACTICE_SETUP_TOASTER_ID}
              position="top-right"
              richColors
              offset={16}
              style={{ zIndex: 200 }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
