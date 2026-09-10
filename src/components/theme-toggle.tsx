import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import {
  applyPortalTheme,
  persistPortalTheme,
  resolvePortalTheme,
  type PortalTheme,
} from "@/lib/portal-theme";

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

  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle theme"
      className={`inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-focus-ring)] focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 ${className}`}
    >
      {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}
