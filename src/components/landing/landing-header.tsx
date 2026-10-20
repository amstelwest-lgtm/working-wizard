/**
 * Homepage header. Legal routes mount the same component with section links
 * rooted at `/#…` so Method, How it works, and Pricing leave the page.
 */
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { NAV_TRIAL_ARIA, NAV_TRIAL_LABEL } from "@/lib/landing-copy";
import { persistPortalTheme, resolvePortalTheme, type PortalTheme } from "@/lib/portal-theme";
import "./landing-nav.css";

export function LandingHeader({
  sectionBase = "",
  menuOpen,
  onMenuOpenChange,
  theme: themeProp,
  onToggleTheme,
  onLogoClick,
  onStartTrial,
  signIn,
}: {
  /** "" on `/` (`#method`). "/" on other routes (`/#method`). */
  sectionBase?: "" | "/";
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
  theme?: PortalTheme;
  onToggleTheme?: () => void;
  onLogoClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  onStartTrial?: (event: MouseEvent<HTMLAnchorElement>) => void;
  signIn: ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [ownTheme, setOwnTheme] = useState<PortalTheme>("light");
  const [scrolled, setScrolled] = useState(false);
  const open = menuOpen ?? uncontrolledOpen;
  const theme = themeProp ?? ownTheme;

  const setOpen = (next: boolean) => {
    onMenuOpenChange?.(next);
    if (menuOpen === undefined) setUncontrolledOpen(next);
  };

  useEffect(() => {
    if (themeProp) return;
    const initial = resolvePortalTheme();
    setOwnTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
    document.documentElement.dataset.theme = initial;
  }, [themeProp]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const href = (id: string) => `${sectionBase}#${id}`;

  const toggleTheme = () => {
    if (onToggleTheme) {
      onToggleTheme();
      return;
    }
    const next: PortalTheme = theme === "light" ? "dark" : "light";
    setOwnTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.dataset.theme = next;
    persistPortalTheme(next);
  };

  return (
    <nav
      id="topnav"
      className={["landing-nav", open ? "nav-open" : "", scrolled ? "scrolled" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="wrap">
        <a
          className="logo"
          href={href("hero")}
          title="MILŌN"
          onClick={(event) => {
            onLogoClick?.(event);
            setOpen(false);
          }}
        >
          <img src="/milon-centaur.svg" alt="" width={24} height={34} />
          <span className="logo-word gold-text">MILŌN</span>
        </a>
        <button
          type="button"
          className="nav-burger"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span />
          <span />
          <span />
        </button>
        <div
          className="links"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("a, button")) setOpen(false);
          }}
        >
          <a href={href("method")}>The Milōn Method</a>
          <a href={href("how")}>How it works</a>
          <a href={href("pricing")}>Pricing</a>
          <button
            id="themeToggle"
            type="button"
            title="Toggle light / dark"
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            onClick={toggleTheme}
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
          {signIn}
          <a
            className="btn btn-cobalt nav-trial"
            href={href("register")}
            aria-label={NAV_TRIAL_ARIA}
            onClick={(event) => onStartTrial?.(event)}
          >
            {NAV_TRIAL_LABEL}
          </a>
        </div>
      </div>
    </nav>
  );
}
