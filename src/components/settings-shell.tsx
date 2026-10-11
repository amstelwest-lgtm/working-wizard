import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { PracticeRailItems } from "@/components/practice-rail";
import { SettingsMenu } from "@/components/settings-menu";
import { RailSettingsButton } from "@/components/settings-nav-button";

type Width = "md" | "lg" | "xl";

/**
 * Shared chrome for /settings, /settings/team, /settings/brand.
 * Same atmos as the accountant portal, with Settings in the top-right
 * and pinned to the bottom of the desktop sidebar.
 */
export function SettingsShell({
  children,
  width = "md",
  onSettings,
  onPlan,
}: {
  children: ReactNode;
  width?: Width;
  onSettings?: () => void;
  onPlan?: () => void;
}) {
  const navigate = useNavigate();
  const openSettings =
    onSettings ??
    (() => {
      void navigate({ to: "/settings" });
    });
  const openPlan =
    onPlan ??
    (() => {
      void navigate({ to: "/settings", hash: "firm-billing" });
    });
  return (
    <div className="accountant-portal settings-portal milon-page-enter">
      <div id="atmos" aria-hidden="true">
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="grid" />
      </div>
      <div className="shell">
        <header className="topbar">
          <span className="brand">
            <span className="gold-text">MILŌN</span>
          </span>
          <span className="spacer" />
          <SettingsMenu
            className="tb-btn settings-gear"
            current
            onSettings={openSettings}
            onPlan={openPlan}
          />
        </header>
        <div className="client-workspace">
          <nav className="deliverable-rail" aria-label="Practice">
            <PracticeRailItems />
            <RailSettingsButton onClick={openSettings} />
          </nav>
          <div className="deliverable-main">
            <div className={`settings-portal__shell settings-portal__shell--${width}`}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
