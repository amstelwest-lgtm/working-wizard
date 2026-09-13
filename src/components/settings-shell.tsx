import type { ReactNode } from "react";
import "@/styles/accountant-portal.css";
import "@/styles/settings-portal.css";

type Width = "md" | "lg" | "xl";

/**
 * Shared chrome for /settings, /settings/team, /settings/brand.
 * Same atmos + gold tokens as the accountant portal so settings
 * no longer sit on a leftover slate dashboard.
 */
export function SettingsShell({ children, width = "md" }: { children: ReactNode; width?: Width }) {
  return (
    <div className="accountant-portal settings-portal milon-page-enter">
      <div id="atmos" aria-hidden="true">
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="grid" />
      </div>
      <div className={`settings-portal__shell settings-portal__shell--${width}`}>{children}</div>
    </div>
  );
}
