import { useState, type ReactNode } from "react";
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
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className={`accountant-portal settings-portal milon-page-enter${menuOpen ? " nav-open" : ""}`}>
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
            onSettings={() => {
              setMenuOpen(false);
              openSettings();
            }}
            onPlan={() => {
              setMenuOpen(false);
              openPlan();
            }}
          />
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
        </header>
        <div className="client-workspace">
          <nav className="deliverable-rail" aria-label="Practice">
            <PracticeRailItems onNavigate={() => setMenuOpen(false)} />
            <RailSettingsButton
              onClick={() => {
                setMenuOpen(false);
                openSettings();
              }}
            />
          </nav>
          <div className="deliverable-main">
            <div className={`settings-portal__shell settings-portal__shell--${width}`}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
