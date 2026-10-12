import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/theme-toggle";
import { PracticeRail } from "@/components/practice-rail";
import { MilonTeamDesk } from "@/components/milon-team/milon-team-desk";
import { emptyMilonTeamFeed } from "@/lib/milon-team-feed";
import type { MilonTeamFeedApi } from "@/hooks/use-milon-team-feed";
import { useAccountantProfile } from "@/contexts/accountant-profile";

export const Route = createFileRoute("/_authenticated/desk")({
  component: PracticeDeskPage,
  head: () => ({
    meta: [{ title: "Desk — Milōn" }],
  }),
});

const PRACTICE_FEED: MilonTeamFeedApi = {
  ...emptyMilonTeamFeed(),
  approveJob: async () => ({
    ok: false,
    reason: "error",
    message: "Open a client file to approve a draft.",
  }),
  dismissJob: async () => ({ ok: false, message: "Open a client file to dismiss a draft." }),
  refresh() {},
};

function PracticeDeskPage() {
  const navigate = useNavigate();
  const { profile } = useAccountantProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const practice = profile.firmName.trim() || "Practice";

  return (
    <div className={`accountant-portal practice-home${menuOpen ? " nav-open" : ""}`}>
      <div id="atmos">
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="grid" />
      </div>
      <div className="shell">
        <div className="topbar">
          <span className="brand">
            <span className="gold-text">MILŌN</span>
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="topbar-backdrop"
            aria-label="Close menu"
            tabIndex={menuOpen ? 0 : -1}
            onClick={() => setMenuOpen(false)}
          />
          <button
            type="button"
            className="topbar-menu-btn"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {menuOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
          <div className={`topbar-actions${menuOpen ? " open" : ""}`}>
            <button
              type="button"
              className="tb-btn"
              onClick={() => {
                setMenuOpen(false);
                void navigate({
                  to: "/reports",
                  search: { client: undefined, clientId: undefined, report: undefined, action: undefined },
                });
              }}
            >
              Reports studio
            </button>
            <ThemeToggle />
          </div>
        </div>
        <div className="client-workspace">
          <PracticeRail />
          <div className="deliverable-main">
            <p className="eyebrow">Practice desk</p>
            <h1 className="h-sec" style={{ marginTop: 4 }}>
              {practice}
            </h1>
            <p className="sub" style={{ marginTop: 6, maxWidth: "62ch" }}>
              The practice desk. Open a client file when a draft belongs to one business.
            </p>
            <div className="milon-desk-host" style={{ marginTop: 18 }}>
              <MilonTeamDesk feed={PRACTICE_FEED} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
