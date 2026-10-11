export const PORTAL_THEME_KEY = "compass.theme";
export const LANDING_THEME_KEY = "milon.landing.theme";
/** Versioned preference. Absent means the one-time gold-theme reset has not run. */
export const THEME_PREF_KEY = "theme_pref_v2";

export const LEGACY_THEME_KEYS = [PORTAL_THEME_KEY, LANDING_THEME_KEY] as const;

/** Cookie names that may still hold a pre-v2 dark choice. No profile column stores a theme. */
export const LEGACY_THEME_COOKIES = [PORTAL_THEME_KEY, LANDING_THEME_KEY, "theme"] as const;

export type PortalTheme = "light" | "dark";

export type ThemeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type ThemeMigration = {
  theme: PortalTheme;
  migrated: boolean;
  cookiesToClear: readonly string[];
  /** Value to store if a profile column is written. Null means clear it. */
  profileTheme: PortalTheme | null;
  /** Legacy profile/DB value ignored by the one-time reset. No such column exists today. */
  discardedProfile: PortalTheme | null;
};

function isTheme(value: string | null | undefined): value is PortalTheme {
  return value === "light" || value === "dark";
}

/**
 * Light is the default. `prefers-color-scheme` is ignored.
 * A stored dark choice from the old gold theme (localStorage, cookie, or a
 * profile value) is reset to light once. After `theme_pref_v2` is written,
 * an explicit dark choice sticks.
 */
function cookieTheme(cookie: string): PortalTheme | null {
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const name = trimmed.slice(0, eq);
    if (!LEGACY_THEME_COOKIES.includes(name as (typeof LEGACY_THEME_COOKIES)[number])) continue;
    const value = trimmed.slice(eq + 1);
    if (isTheme(value)) return value;
  }
  return null;
}

export function migrateThemePreference(
  storage: ThemeStorage,
  cookie = "",
  profileTheme: string | null = null,
): ThemeMigration {
  const saved = storage.getItem(THEME_PREF_KEY);
  if (isTheme(saved)) {
    return {
      theme: saved,
      migrated: false,
      cookiesToClear: [],
      profileTheme: saved,
      discardedProfile: null,
    };
  }
  for (const key of LEGACY_THEME_KEYS) storage.removeItem(key);
  storage.setItem(THEME_PREF_KEY, "light");
  const fromProfile = isTheme(profileTheme) ? profileTheme : null;
  const fromCookie = cookieTheme(cookie);
  return {
    theme: "light",
    migrated: true,
    cookiesToClear: LEGACY_THEME_COOKIES,
    profileTheme: null,
    discardedProfile: fromProfile ?? fromCookie,
  };
}

function browserStorage(): ThemeStorage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

function clearThemeCookies(names: readonly string[]) {
  if (typeof document === "undefined") return;
  for (const name of names) {
    document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}

/** Portal theme: versioned choice, otherwise light after a one-time reset. */
export function resolvePortalTheme(): PortalTheme {
  const storage = browserStorage();
  if (!storage) return "light";
  const cookie = typeof document === "undefined" ? "" : document.cookie;
  const result = migrateThemePreference(storage, cookie);
  if (result.migrated) clearThemeCookies(result.cookiesToClear);
  return result.theme;
}

export function applyPortalTheme(theme: PortalTheme) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

export function persistPortalTheme(theme: PortalTheme) {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(THEME_PREF_KEY, theme);
    storage.setItem(PORTAL_THEME_KEY, theme);
    storage.setItem(LANDING_THEME_KEY, theme);
  } catch {
    /* ignore quota / privacy mode */
  }
}

/**
 * Blocking head script. Same rule as `migrateThemePreference`: light unless
 * `theme_pref_v2` is already dark. Does not read `prefers-color-scheme`.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var t="light";try{var v=localStorage.getItem("theme_pref_v2");if(v==="light"||v==="dark"){t=v;}else{localStorage.removeItem("compass.theme");localStorage.removeItem("milon.landing.theme");localStorage.setItem("theme_pref_v2","light");document.cookie="compass.theme=; Path=/; Max-Age=0";document.cookie="milon.landing.theme=; Path=/; Max-Age=0";document.cookie="theme=; Path=/; Max-Age=0";t="light";}}catch(e){}var light=t==="light";if(light){d.classList.remove("dark");d.setAttribute("data-theme","light");}else{d.classList.add("dark");d.removeAttribute("data-theme");}var p=location.pathname;if(p!="/"&&p!="")return;d.dataset.landing="1";if(light){d.style.backgroundColor="#f7f4ec";d.style.color="#1b1608";d.style.colorScheme="only light";}else{d.style.backgroundColor="#050507";d.style.color="#f2ecdc";d.style.colorScheme="only dark";}var m=document.getElementById("milon-color-scheme");if(!m){m=document.createElement("meta");m.id="milon-color-scheme";m.setAttribute("name","color-scheme");(document.head||d).appendChild(m);}m.setAttribute("content",light?"only light":"only dark");}catch(e){}})();`;
