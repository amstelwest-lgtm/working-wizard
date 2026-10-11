/**
 * Light is the default. A stored gold-theme dark choice resets once.
 * Run: pnpm test:theme-pref
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import {
  LANDING_THEME_KEY,
  PORTAL_THEME_KEY,
  THEME_BOOT_SCRIPT,
  THEME_PREF_KEY,
  migrateThemePreference,
  type ThemeStorage,
} from "../src/lib/portal-theme";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function memory(initial: Record<string, string> = {}): ThemeStorage & { dump(): Record<string, string> } {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
    dump: () => ({ ...data }),
  };
}

const freshStore = memory();
const fresh = migrateThemePreference(freshStore);
assert(fresh.theme === "light", "first visit is light");
assert(fresh.migrated, "first visit writes the versioned key");
assert(fresh.profileTheme === null, "nothing is stored on a profile");
assert(freshStore.getItem(THEME_PREF_KEY) === "light", "versioned key is light after reset");

const legacy = memory({ [PORTAL_THEME_KEY]: "dark", [LANDING_THEME_KEY]: "dark" });
const reset = migrateThemePreference(legacy, "compass.theme=dark; theme=dark", "dark");
assert(reset.theme === "light", "stored dark from the gold theme becomes light");
assert(reset.migrated, "the reset runs");
assert(reset.profileTheme === null, "a profile dark value is cleared");
assert(reset.discardedProfile === "dark", "the discarded profile value is reported");
assert(legacy.getItem(PORTAL_THEME_KEY) === null, "compass.theme is removed");
assert(legacy.getItem(LANDING_THEME_KEY) === null, "landing theme key is removed");
assert(legacy.getItem(THEME_PREF_KEY) === "light", "versioned key records the reset");
assert(reset.cookiesToClear.includes("compass.theme"), "the theme cookie is cleared");
assert(reset.cookiesToClear.includes("theme"), "a generic theme cookie is cleared");

const again = migrateThemePreference(legacy, "compass.theme=dark", "dark");
assert(again.migrated === false, "the reset does not run twice");
assert(again.theme === "light", "the reset stays light");
assert(again.cookiesToClear.length === 0, "cookies are left alone after the reset");

legacy.setItem(THEME_PREF_KEY, "dark");
const chosen = migrateThemePreference(legacy, "", "light");
assert(chosen.theme === "dark", "an explicit dark choice sticks");
assert(chosen.profileTheme === "dark", "a later dark choice is what a profile would store");
assert(chosen.migrated === false, "a later dark choice is not reset");

const source = readFileSync(resolve("src/lib/portal-theme.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
assert(!source.includes("prefers-color-scheme"), "the default ignores the OS colour scheme");
assert(!THEME_BOOT_SCRIPT.includes("prefers-color-scheme"), "the boot script ignores the OS colour scheme");
assert(!THEME_BOOT_SCRIPT.includes('var t="dark"'), "the boot script does not default to dark");
assert(THEME_BOOT_SCRIPT.includes('var t="light"'), "the boot script defaults to light");
assert(THEME_BOOT_SCRIPT.includes("theme_pref_v2"), "the boot script uses the versioned key");
assert(THEME_BOOT_SCRIPT.includes('d.style.colorScheme="only dark"'), "dark landing still opts out of force-dark");

const root = readFileSync(resolve("src/routes/__root.tsx"), "utf8");
const landing = readFileSync(resolve("src/routes/index.tsx"), "utf8");
assert(root.includes("THEME_BOOT_SCRIPT"), "the document head uses the shared boot script");
assert(landing.includes("THEME_BOOT_SCRIPT"), "the landing head uses the shared boot script");
assert(!root.includes('var t="dark"'), "the root head no longer hard-codes a dark default");
assert(!landing.includes('var t="dark"'), "the landing head no longer hard-codes a dark default");

function boot(storage: Record<string, string>, pathname = "/") {
  const local = { ...storage };
  const cookies: string[] = [];
  const rootEl: Record<string, unknown> = {
    classList: {
      add(name: string) {
        rootEl.dark = name === "dark" ? true : rootEl.dark;
      },
      remove(name: string) {
        if (name === "dark") rootEl.dark = false;
      },
    },
    style: {} as Record<string, string>,
    dataset: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      rootEl.attrs = { ...(rootEl.attrs as object), [name]: value };
    },
    removeAttribute(name: string) {
      const attrs = { ...(rootEl.attrs as Record<string, string>) };
      delete attrs[name];
      rootEl.attrs = attrs;
    },
  };
  const document = {
    documentElement: rootEl,
    cookie: "",
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({ id: "", setAttribute() {}, style: {} }),
  };
  Object.defineProperty(document, "cookie", {
    set(value: string) {
      cookies.push(value);
    },
    get: () => "",
  });
  const context = vm.createContext({
    localStorage: {
      getItem: (key: string) => (key in local ? local[key] : null),
      setItem: (key: string, value: string) => {
        local[key] = value;
      },
      removeItem: (key: string) => {
        delete local[key];
      },
    },
    document,
    location: { pathname },
  });
  vm.runInContext(THEME_BOOT_SCRIPT, context);
  return { local, cookies, root: rootEl };
}

const booted = boot({ [PORTAL_THEME_KEY]: "dark" }, "/");
assert(booted.local[THEME_PREF_KEY] === "light", "boot script resets a legacy dark key");
assert(booted.local[PORTAL_THEME_KEY] === undefined, "boot script removes the legacy key");
assert(booted.root.dark !== true, "boot script does not paint dark");
assert((booted.root.attrs as { "data-theme"?: string })["data-theme"] === "light", "boot script sets light");
assert(booted.cookies.some((line) => line.startsWith("compass.theme=")), "boot script expires the theme cookie");

const kept = boot({ [THEME_PREF_KEY]: "dark" }, "/app");
assert(kept.local[THEME_PREF_KEY] === "dark", "boot script keeps an explicit dark choice");
assert(kept.root.dark === true, "boot script paints that dark choice");
assert(kept.cookies.length === 0, "boot script does not clear cookies after the reset");

console.log("theme-pref tests passed");
