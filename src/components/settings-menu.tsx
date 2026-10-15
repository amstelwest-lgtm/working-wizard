import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import {
  applyPortalTheme,
  persistPortalTheme,
  resolvePortalTheme,
  type PortalTheme,
} from "@/lib/portal-theme";
import { overlayMayHandleKey } from "@/lib/dialog-focus";
import { menuIndexForKey } from "@/lib/settings-menu";
import { SettingsGear } from "./settings-nav-button";
import "./settings-menu.css";

function menuItems(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]'),
  );
}

/**
 * Top-right Settings control. Opens a menu for settings, plan, theme, help,
 * and sign-out. The sidebar Settings item stays a separate direct link.
 */
export function SettingsMenu({
  onSettings,
  onPlan,
  onSignOut,
  className = "",
  current = false,
}: {
  onSettings: () => void;
  onPlan: () => void;
  /** When set, the parent owns sign-out (it still returns to `/`). */
  onSignOut?: () => void;
  className?: string;
  current?: boolean;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<"start" | "end">("start");
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<PortalTheme>("light");
  const { signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const sync = () => setTheme(resolvePortalTheme());
    sync();
    window.addEventListener("milon-theme", sync);
    return () => window.removeEventListener("milon-theme", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (!open) return;
      if (!overlayMayHandleKey(event)) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const root = rootRef.current;
    if (!trigger || !root) return;
    const place = () => {
      const rect = trigger.getBoundingClientRect();
      root.style.setProperty("--settings-menu-top", `${Math.max(8, Math.round(rect.bottom + 8))}px`);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const which = pendingFocus.current;
    const items = menuItems(menuRef.current);
    const item = which === "end" ? items[items.length - 1] : items[0];
    item?.focus();
  }, [open]);

  function close() {
    setOpen(false);
  }

  function toggleTheme() {
    const next: PortalTheme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyPortalTheme(next);
    persistPortalTheme(next);
    window.dispatchEvent(new Event("milon-theme"));
  }

  function leave() {
    close();
    if (onSignOut) {
      onSignOut();
      return;
    }
    void signOut().then(() => {
      window.location.href = "/";
    });
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const end = event.key === "ArrowUp";
    pendingFocus.current = end ? "end" : "start";
    if (open) {
      const items = menuItems(menuRef.current);
      (end ? items[items.length - 1] : items[0])?.focus();
      return;
    }
    setOpen(true);
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (!overlayMayHandleKey(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    const items = menuItems(menuRef.current);
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const next = menuIndexForKey(currentIndex, items.length, event.key);
    if (next == null) return;
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <div className="settings-menu-root" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        title="Settings"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-current={current ? "page" : undefined}
        data-settings-trigger
        onClick={() => {
          pendingFocus.current = "start";
          setOpen((value) => !value);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <SettingsGear />
        <span className="gear-label">Settings</span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className="settings-menu"
          role="menu"
          aria-label="Settings"
          data-settings-menu
          onKeyDown={onMenuKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="settings-menu-item"
            onClick={() => {
              close();
              void navigate({ to: "/practice" });
            }}
          >
            My practice
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="settings-menu-item"
            onClick={() => {
              close();
              onSettings();
            }}
          >
            Settings
          </button>
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="settings-menu-item"
            onClick={() => {
              close();
              onPlan();
            }}
          >
            Plan & billing
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            tabIndex={-1}
            aria-checked={theme === "dark"}
            className="settings-menu-item"
            onClick={toggleTheme}
          >
            <span>Theme</span>
            <span className="settings-menu-theme">{theme === "dark" ? "Dark" : "Light"}</span>
          </button>
          <a role="menuitem" tabIndex={-1} className="settings-menu-item" href="/faq" onClick={close}>
            Help
          </a>
          <div role="separator" className="settings-menu-rule" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="settings-menu-item settings-menu-signout"
            onClick={leave}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
