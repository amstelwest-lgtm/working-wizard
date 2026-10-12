import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { SettingsGear } from "@/components/settings-nav-button";

export type NavDestination = {
  to: "/dashboard" | "/settings" | "/clients" | "/clients/$clientId";
  params?: { clientId: string };
  hash?: string;
  search?: (prev: Record<string, unknown>) => Record<string, unknown>;
};

export type NavSubItem = {
  id: string;
  label: string;
  to: NavDestination;
};

export type NavHeading = {
  id: string;
  label: string;
  to: NavDestination;
  items?: NavSubItem[];
  /** Home keeps the bot marker the sign-off path looks for. */
  bot?: boolean;
};

export type NavSection = {
  id: string;
  label: string;
  headings: NavHeading[];
};

type Selection = {
  headingId: string | null;
  subId: string | null;
};

function rowKey(kind: string, headingId?: string, subId?: string) {
  if (kind === "sub") return `sub:${headingId}:${subId}`;
  if (kind === "heading") return `heading:${headingId}`;
  return kind;
}

function NavLink({
  dest,
  className,
  navId,
  tabIndex,
  ariaCurrent,
  headingId,
  bot,
  children,
  onClick,
}: {
  dest: NavDestination;
  className: string;
  navId: string;
  tabIndex: number;
  ariaCurrent?: "page" | "true";
  headingId?: string;
  bot?: boolean;
  children: ReactNode;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      to={dest.to}
      params={dest.params as never}
      hash={dest.hash}
      search={dest.search as never}
      activeOptions={{ exact: true, includeSearch: true, includeHash: true }}
      className={className}
      data-nav-row=""
      data-nav-id={navId}
      data-nav-kind={navId.startsWith("sub:") ? "sub" : navId.startsWith("heading:") ? "heading" : navId}
      data-heading-id={headingId}
      data-bot-rail={bot ? "true" : undefined}
      tabIndex={tabIndex}
      aria-current={ariaCurrent}
      onClick={onClick}
    >
      {children}
    </Link>
  );
}

/**
 * Collapsible accountant rail. Kickers are labels. A heading's label navigates
 * to its default sub-item. The chevron only opens or closes that list.
 * One heading is open at a time. The heading for the current address opens
 * on its own, unless the accountant just closed it.
 */
export function AccountantNav({
  label,
  sections,
  selection,
  settingsActive = false,
  back,
  onSettings,
  onNavigate,
}: {
  label: string;
  sections: NavSection[];
  selection: Selection;
  settingsActive?: boolean;
  back?: { label: string; to: NavDestination };
  onSettings?: () => void;
  /** Closes the phone drawer. Headings that still have a list do not. */
  onNavigate?: () => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const holdClosed = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(selection.headingId);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    holdClosed.current = null;
    setOpenId(selection.headingId);
    setFocusId(null);
  }, [selection.headingId, selection.subId]);

  function toggle(id: string) {
    setOpenId((current) => {
      if (current === id) {
        if (id === selection.headingId) holdClosed.current = id;
        return null;
      }
      if (id === selection.headingId) holdClosed.current = null;
      return id;
    });
  }

  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const row = navRef.current?.querySelector<HTMLElement>(`[data-nav-id="${id}"]`);
    row?.focus();
    setFocusId(id);
  }, [openId]);

  const defaultId =
    selection.headingId && selection.subId
      ? rowKey("sub", selection.headingId, selection.subId)
      : selection.headingId
        ? rowKey("heading", selection.headingId)
        : settingsActive
          ? "settings"
          : rowKey("heading", sections[0]?.headings[0]?.id);

  const tabId = focusId ?? defaultId;

  function visibleRows() {
    return [...(navRef.current?.querySelectorAll<HTMLElement>("[data-nav-row]") ?? [])];
  }

  function focusRow(id: string) {
    const row = navRef.current?.querySelector<HTMLElement>(`[data-nav-id="${id}"]`);
    row?.focus();
    setFocusId(id);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null;
    if (!target?.dataset.navId) return;
    const kind = target.dataset.navKind;
    const headingId = target.dataset.headingId;
    const heading = sections.flatMap((section) => section.headings).find((item) => item.id === headingId);
    const rows = visibleRows();
    const index = rows.findIndex((row) => row.dataset.navId === target.dataset.navId);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
      if (!next?.dataset.navId) return;
      focusRow(next.dataset.navId);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      const first = rows[0]?.dataset.navId;
      if (first) focusRow(first);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      const last = rows[rows.length - 1]?.dataset.navId;
      if (last) focusRow(last);
      return;
    }
    if (event.key === " " && kind === "heading" && heading?.items?.length) {
      event.preventDefault();
      toggle(heading.id);
      return;
    }
    if (event.key === "ArrowRight" && heading?.items?.length) {
      event.preventDefault();
      const first = heading.items[0];
      if (!first) return;
      if (heading.id === selection.headingId) holdClosed.current = null;
      const nextId = rowKey("sub", heading.id, first.id);
      if (openId !== heading.id) {
        pendingFocus.current = nextId;
        setOpenId(heading.id);
      } else {
        focusRow(nextId);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (kind === "sub" && headingId) {
        focusRow(rowKey("heading", headingId));
        return;
      }
      if (kind === "heading" && headingId && openId === headingId) {
        if (headingId === selection.headingId) holdClosed.current = headingId;
        setOpenId(null);
      }
    }
  }

  function closeIfLeaving(heading?: NavHeading) {
    if (!heading?.items?.length) onNavigate?.();
  }

  return (
    <nav
      ref={navRef}
      className="deliverable-rail accountant-nav"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {back ? (
        <NavLink
          dest={back.to}
          className="nav-back"
          navId="back"
          tabIndex={tabId === "back" ? 0 : -1}
          onClick={() => onNavigate?.()}
        >
          {back.label}
        </NavLink>
      ) : null}
      {sections.map((section) => (
        <div key={section.id} className="rail-group">
          <span className="rail-kicker">{section.label}</span>
          {section.headings.map((heading) => {
            const current = selection.headingId === heading.id;
            const page = current && !selection.subId;
            const open = openId === heading.id && !!heading.items?.length;
            const collapsedCurrent = current && !!selection.subId && !open;
            return (
              <div
                key={heading.id}
                className={`nav-heading${current ? " is-current" : ""}${page ? " is-page" : ""}${open ? " is-open" : ""}`}
              >
                <div className="nav-row">
                  <NavLink
                    dest={heading.to}
                    className="nav-label"
                    navId={rowKey("heading", heading.id)}
                    tabIndex={tabId === rowKey("heading", heading.id) ? 0 : -1}
                    ariaCurrent={page ? "page" : collapsedCurrent ? "true" : undefined}
                    headingId={heading.id}
                    bot={heading.bot}
                    onClick={() => closeIfLeaving(heading)}
                  >
                    {heading.label}
                  </NavLink>
                  {heading.items?.length ? (
                    <button
                      type="button"
                      className="nav-chev"
                      aria-expanded={open}
                      aria-controls={`${heading.id}-sub`}
                      aria-label={`${open ? "Collapse" : "Expand"} ${heading.label}`}
                      onClick={() => toggle(heading.id)}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M6 3.5 10.5 8 6 12.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  ) : null}
                </div>
                {open && heading.items ? (
                  <ul className="nav-sub" id={`${heading.id}-sub`}>
                    {heading.items.map((item) => {
                      const on = current && selection.subId === item.id;
                      const id = rowKey("sub", heading.id, item.id);
                      return (
                        <li key={item.id}>
                          <NavLink
                            dest={item.to}
                            className="nav-sub-link"
                            navId={id}
                            tabIndex={tabId === id ? 0 : -1}
                            ariaCurrent={on ? "page" : undefined}
                            headingId={heading.id}
                            onClick={() => onNavigate?.()}
                          >
                            {item.label}
                          </NavLink>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
      <div className="rail-settings">
        <NavLink
          dest={{ to: "/settings" }}
          className="nav-label nav-settings"
          navId="settings"
          tabIndex={tabId === "settings" ? 0 : -1}
          ariaCurrent={settingsActive ? "page" : undefined}
          onClick={() => {
            onSettings?.();
            onNavigate?.();
          }}
        >
          <SettingsGear />
          <span className="gear-label">Settings</span>
        </NavLink>
      </div>
    </nav>
  );
}

/** Phone drawer: lock the page, keep Tab inside, and return focus to Menu. */
export function useAccountantDrawer(open: boolean) {
  const wasOpen = useRef(false);
  useEffect(() => {
    const root = document.documentElement;
    if (!open) {
      root.classList.remove("nav-drawer-open");
      if (wasOpen.current) {
        wasOpen.current = false;
        document.querySelector<HTMLElement>(".topbar-menu-btn")?.focus();
      }
      return;
    }
    wasOpen.current = true;
    root.classList.add("nav-drawer-open");
    const rail = document.querySelector(".deliverable-rail");
    const current =
      rail?.querySelector<HTMLElement>("[aria-current]") ??
      rail?.querySelector<HTMLElement>("[data-nav-row]");
    current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const menu = document.querySelector<HTMLElement>(".topbar-menu-btn");
      const stop = rail?.querySelector<HTMLElement>('[data-nav-row][tabindex="0"]');
      if (!menu || !stop) return;
      const order = [menu, stop];
      const index = order.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      const next = event.shiftKey
        ? order[(index <= 0 ? order.length : index) - 1]
        : order[(index + 1) % order.length];
      next?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      root.classList.remove("nav-drawer-open");
    };
  }, [open]);
}

export function AccountantMenuButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="topbar-menu-btn"
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {open ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
      </svg>
      <span className="topbar-menu-label">Menu</span>
    </button>
  );
}
