import type { ReactNode } from "react";
import { RailSettingsButton, SettingsNavButton } from "@/components/settings-nav-button";

type Width = "md" | "lg" | "xl";

/**
 * Shared chrome for /settings, /settings/team, /settings/brand.
 * Same atmos as the accountant portal, with Settings in the top-right
 * and pinned to the bottom of the desktop sidebar.
 */
export function SettingsShell({ children, width = "md" }: { children: ReactNode; width?: Width }) {
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
          <SettingsNavButton className="tb-btn settings-gear" aria-current="page" />
        </header>
        <div className="client-workspace">
          <nav className="deliverable-rail" aria-label="Settings">
            <RailSettingsButton active onClick={() => undefined} />
          </nav>
          <div className="deliverable-main">
            <div className={`settings-portal__shell settings-portal__shell--${width}`}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
