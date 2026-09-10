export const PORTAL_THEME_KEY = "compass.theme";
export const LANDING_THEME_KEY = "milon.landing.theme";

export type PortalTheme = "light" | "dark";

function readStorageTheme(key: string): PortalTheme | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const saved = localStorage.getItem(key);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore quota / privacy mode */
  }
  return null;
}

/** Portal theme: explicit compass preference, else landing preference, else light. */
export function resolvePortalTheme(): PortalTheme {
  return readStorageTheme(PORTAL_THEME_KEY) ?? readStorageTheme(LANDING_THEME_KEY) ?? "light";
}

export function applyPortalTheme(theme: PortalTheme) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

export function persistPortalTheme(theme: PortalTheme) {
  try {
    localStorage.setItem(PORTAL_THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}
