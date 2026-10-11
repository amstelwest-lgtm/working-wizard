import { useEffect, useState, type ReactNode } from "react";
import { SettingsNavButton } from "@/components/settings-nav-button";
import { ThemeToggle } from "@/components/theme-toggle";
import "@fontsource/noto-sans/latin-400.css";
import "@fontsource/noto-sans/latin-500.css";
import "@fontsource/noto-sans/latin-600.css";
import "@fontsource/noto-sans/latin-700.css";
import "@fontsource/cormorant-garamond/latin-500.css";
import "@fontsource/cormorant-garamond/latin-600.css";
import "./owner-door.css";

export type OwnerScreen =
  | "home"
  | "chat"
  | "health"
  | "cash"
  | "budget"
  | "tasks"
  | "actions"
  | "profit"
  | "moves"
  | "accountant"
  | "deliverables"
  | "plan"
  | "first"
  | "settings";

const RAIL: { id: string; label: string; screen: OwnerScreen }[] = [
  { id: "home", label: "Home", screen: "home" },
  { id: "health", label: "Health", screen: "health" },
  { id: "cash", label: "Cash flow", screen: "cash" },
  { id: "profit", label: "Profit", screen: "profit" },
  { id: "budget", label: "Budget", screen: "budget" },
  { id: "moves", label: "Next moves", screen: "moves" },
  { id: "accountant", label: "Accountant", screen: "accountant" },
  { id: "deliverables", label: "Deliverables", screen: "deliverables" },
];

export function OwnerShell({
  screen,
  businessName,
  initials,
  workspaces,
  activeClientId,
  onSwitch,
  onNavigate,
  onSignOut,
  onSettings,
  onProfile,
  children,
}: {
  screen: OwnerScreen;
  businessName: string;
  initials: string;
  workspaces: { clientId: string; name: string }[];
  activeClientId: string | null;
  onSwitch: (clientId: string) => void;
  onNavigate: (screen: OwnerScreen) => void;
  onSignOut: () => void;
  onSettings: () => void;
  onProfile: () => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    function close(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".owner-account")) return;
      setMenuOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  function open(next: OwnerScreen) {
    setMenuOpen(false);
    onNavigate(next);
  }

  return (
    <div className="owner-door accountant-portal" data-owner-ready="true" data-screen={screen}>
      <header className="topbar">
        <div className="owner-brand">
          <span className="brand">
            <span className="gold-text">MILŌN</span>
          </span>
          <span className="owner-biz">
            <b>{businessName}</b>
          </span>
        </div>
        <span className="spacer" />
        <div className="owner-tools">
          <ThemeToggle />
          <div className="owner-account">
          <button
            type="button"
            className="profile-chip"
            aria-label="Owner menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="av">{initials}</span>
            Owner
          </button>
          {menuOpen ? (
            <div className="owner-menu" role="menu" aria-label="Settings, plan, and profile">
              <div className="owner-menu-theme">
                <ThemeToggle />
                Appearance
              </div>
              {workspaces.length > 1
                ? workspaces.map((workspace) => (
                    <button
                      key={workspace.clientId}
                      type="button"
                      role="menuitem"
                      className="owner-menu-item"
                      aria-current={workspace.clientId === activeClientId ? "true" : undefined}
                      onClick={() => {
                        setMenuOpen(false);
                        onSwitch(workspace.clientId);
                      }}
                    >
                      {workspace.name}
                    </button>
                  ))
                : null}
              <SettingsNavButton role="menuitem" className="owner-menu-item" onClick={onSettings} />
              <button
                type="button"
                role="menuitem"
                className="owner-menu-item"
                onClick={() => open("plan")}
              >
                Plan
              </button>
              <button type="button" role="menuitem" className="owner-menu-item" onClick={onProfile}>
                Profile
              </button>
              <button type="button" role="menuitem" className="owner-menu-item" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          ) : null}
          </div>
        </div>
      </header>
      <div className="client-workspace">
        <nav className="deliverable-rail" aria-label="Owner">
          {RAIL.map((item) => {
            const active = screen === item.screen || (item.screen === "home" && screen === "chat");
            return (
              <button
                key={item.id}
                type="button"
                className={`tab${active ? " on" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => onNavigate(item.screen)}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="deliverable-main">{children}</div>
      </div>
    </div>
  );
}

export function OwnerHold({
  title,
  sentence,
  action,
}: {
  title: string;
  sentence: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <section className="owner-hold">
      <h1 className="owner-title">{title}</h1>
      <p className="owner-lede">{sentence}</p>
      {action ? (
        <button type="button" className="btn gold owner-ask" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </section>
  );
}
