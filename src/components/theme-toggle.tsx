import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import {
  applyPortalTheme,
  persistPortalTheme,
  resolvePortalTheme,
  type PortalTheme,
} from "@/lib/portal-theme";

/**
 * Gold-rimmed icon control — same language as the landing #themeToggle
 * and the accountant topbar pills. Icon only; the title/aria-label name
 * the destination mode.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<PortalTheme>("light");

  useEffect(() => {
    const initial = resolvePortalTheme();
    setTheme(initial);
    applyPortalTheme(initial);
  }, []);

  const toggle = () => {
    const next: PortalTheme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyPortalTheme(next);
    persistPortalTheme(next);
  };

  const toLight = theme === "dark";

  return (
    <button
      type="button"
      data-theme-toggle
      onClick={toggle}
      title={toLight ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={toLight ? "Switch to light mode" : "Switch to dark mode"}
      className={`milon-theme-toggle ${className}`.trim()}
    >
      {toLight ? (
        <Sun aria-hidden className="milon-theme-toggle__icon" />
      ) : (
        <Moon aria-hidden className="milon-theme-toggle__icon" />
      )}
    </button>
  );
}
