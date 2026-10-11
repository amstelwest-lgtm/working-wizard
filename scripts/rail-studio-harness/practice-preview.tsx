import { PracticeRail } from "@/components/practice-rail";

/** Practice home for the local harness. The production dashboard stays the real page. */
export function PracticePreview() {
  return (
    <div className="accountant-portal practice-home" data-rail-harness="true" data-rail-ready="true">
      <div id="atmos" aria-hidden="true">
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="grid" />
      </div>
      <main className="shell">
        <div className="topbar">
          <span className="brand">
            <span className="gold-text">MILŌN</span>
          </span>
        </div>
        <div className="client-workspace">
          <PracticeRail />
          <div className="deliverable-main">
            <h1 className="owner-title">Practice</h1>
            <p>Dashboard, clients, desk, team, and billing.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
