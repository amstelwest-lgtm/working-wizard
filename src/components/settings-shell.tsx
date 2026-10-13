import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AccountantMenuButton, DrawerBackdrop, useAccountantDrawer } from "@/components/accountant-nav";
import { PeriodPill } from "@/components/chrome-icons";
import { FeatureFinder } from "@/components/feature-finder";
import { FirmSwitcher } from "@/components/firm-switcher";
import { PracticeRail } from "@/components/practice-rail";
import { SettingsMenu } from "@/components/settings-menu";

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
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  useAccountantDrawer(menuOpen, () => setMenuOpen(false));
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
          <FirmSwitcher />
          <PeriodPill />
          <FeatureFinder audience="accountant" clientId={null} />
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
          <AccountantMenuButton open={menuOpen} onClick={() => setMenuOpen((open) => !open)} />
        </header>
        <div className="client-workspace">
          <DrawerBackdrop open={menuOpen} onClose={() => setMenuOpen(false)} />
          <PracticeRail onNavigate={() => setMenuOpen(false)} />
          <div className="deliverable-main">
            <div className={`settings-portal__shell settings-portal__shell--${width}`}>{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
