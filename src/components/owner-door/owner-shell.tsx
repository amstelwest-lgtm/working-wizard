import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AccountantMenuButton, DrawerBackdrop, DrawerCloseButton, useAccountantDrawer } from "@/components/accountant-nav";
import { overlayMayHandleKey } from "@/lib/dialog-focus";
import { PeriodPill, RailIcon } from "@/components/chrome-icons";
import { SettingsMenu } from "@/components/settings-menu";
import { RailSettingsButton, SettingsNavButton } from "@/components/settings-nav-button";
import { ThemeToggle } from "@/components/theme-toggle";
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
  { id: "accountant", label: "Accountant portal", screen: "accountant" },
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
  /** Books period end, already "Sep 2026". Omitted when the client has no books. */
  periodLabel,
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
  periodLabel?: string | null;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const root = accountRef.current;
    const chip = chipRef.current;
    if (!root || !chip) return;
    const place = () => {
      const rect = chip.getBoundingClientRect();
      root.style.setProperty("--owner-menu-top", `${Math.max(8, Math.round(rect.bottom + 8))}px`);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [menuOpen]);

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

  useEffect(() => {
    if (!menuOpen && !navOpen) return;
    function onKey(event: KeyboardEvent) {
      if (!menuOpen && !navOpen) return;
      if (!overlayMayHandleKey(event)) return;
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setNavOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen, navOpen]);
  useAccountantDrawer(navOpen, () => setNavOpen(false));

  function open(next: OwnerScreen) {
    setMenuOpen(false);
    setNavOpen(false);
    onNavigate(next);
  }

  return (
    <div
      className={`owner-door accountant-portal${navOpen ? " nav-open" : ""}`}
      data-owner-ready="true"
      data-screen={screen}
    >
      <header className="topbar">
        <AccountantMenuButton open={navOpen} onClick={() => setNavOpen((open) => !open)} />
        <div className="owner-brand">
          <span className="brand">
            <span className="gold-text">MILŌN</span>
          </span>
          <span className="owner-biz">
            <span className="owner-biz-ic" aria-hidden="true">
              <RailIcon id="building" />
            </span>
            <b>{businessName}</b>
          </span>
          <PeriodPill periodLabel={periodLabel} />
        </div>
        <span className="spacer" />
        <div className="owner-tools">
          <ThemeToggle />
          <SettingsMenu
            className="owner-settings-link"
            current={screen === "settings"}
            onSettings={() => {
              setMenuOpen(false);
              onSettings();
            }}
            onPlan={() => open("plan")}
            onSignOut={onSignOut}
          />
          <div className="owner-account" ref={accountRef}>
          <button
            ref={chipRef}
            type="button"
            className="profile-chip"
            aria-label="Owner menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="av">{initials}</span>
            Owner
            <span className="profile-caret" aria-hidden="true">
              <RailIcon id="caret" />
            </span>
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
        <DrawerBackdrop open={navOpen} onClose={() => setNavOpen(false)} />
        <nav className="deliverable-rail" aria-label="Owner">
          <DrawerCloseButton onClose={() => setNavOpen(false)} />
          <div className="rail-brand" data-shell-wordmark="milon" aria-hidden="true">
            <span className="brand">
              <span className="gold-text">MILŌN</span>
            </span>
          </div>
          {RAIL.map((item) => {
            const active = screen === item.screen || (item.screen === "home" && screen === "chat");
            return (
              <button
                key={item.id}
                type="button"
                className={`tab${active ? " on" : ""}`}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                onClick={() => open(item.screen)}
              >
                <span className="tab-ic" aria-hidden="true">
                  <RailIcon id={item.id} />
                </span>
                <span className="tab-text">{item.label}</span>
              </button>
            );
          })}
          <RailSettingsButton
            active={screen === "settings"}
            onClick={() => {
              setNavOpen(false);
              onSettings();
            }}
          />
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
