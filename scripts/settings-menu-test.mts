/**
 * Top-right Settings menu on the owner door and the accountant portal.
 * Run: pnpm test:settings-menu
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { menuIndexForKey, moveMenuIndex } from "../src/lib/settings-menu";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

assert(moveMenuIndex(-1, 5, "next") === 0, "down from nowhere lands on the first item");
assert(moveMenuIndex(0, 5, "next") === 1, "down moves to the next item");
assert(moveMenuIndex(4, 5, "next") === 0, "down wraps to the first item");
assert(moveMenuIndex(0, 5, "prev") === 4, "up wraps to the last item");
assert(moveMenuIndex(-1, 5, "prev") === 4, "up from nowhere lands on the last item");
assert(moveMenuIndex(3, 5, "first") === 0 && moveMenuIndex(3, 5, "last") === 4, "home and end");
assert(menuIndexForKey(1, 5, "ArrowDown") === 2, "arrow down is a menu move");
assert(menuIndexForKey(1, 5, "Escape") === null, "escape is not an index move");

const menu = read("src/components/settings-menu.tsx");
const css = read("src/components/settings-menu.css");
assert(menu.includes('role="menu"'), "the popup is a menu");
assert(menu.includes('aria-haspopup="menu"'), "the trigger announces a menu");
assert(menu.includes('role="menuitemcheckbox"'), "theme is a toggle item");
assert(menu.includes('role="separator"'), "sign out sits under a divider");
assert(menu.includes("Settings"), "settings is a menu item");
assert(menu.includes("Plan & billing"), "plan and billing is a menu item");
assert(menu.includes("Theme"), "theme is a menu item");
assert(menu.includes("Help"), "help is a menu item");
assert(menu.includes('href="/faq"'), "help uses the existing FAQ");
assert(menu.includes("Sign out"), "sign out is a menu item");
assert(menu.includes('window.location.href = "/"'), "sign out returns to the landing page");
assert(menu.includes("persistPortalTheme"), "theme uses the existing theme storage");
assert(menu.includes('event.key === "Escape"'), "escape closes the menu");
assert(menu.includes("triggerRef.current?.focus()"), "escape returns focus to the trigger");
assert(menu.includes("ArrowDown") && menu.includes("ArrowUp"), "arrow keys move in the menu");
assert(menu.includes("mousedown"), "an outside click closes the menu");
assert(css.includes("#c43d4b"), "sign out uses Critical #C43D4B");
assert(css.includes("var(--cobalt"), "the menu uses cobalt for focus");
assert(css.includes("var(--ink"), "the menu uses navy text");
assert(css.includes("max-width: 767px"), "the menu stays on screen at phone width");
assert(css.includes("position: fixed"), "the phone menu is pinned to the viewport");
assert(css.includes("left: 8px"), "the phone menu keeps a margin inside the viewport");
assert(css.includes("overflow-wrap: anywhere"), "menu labels wrap long text");
assert(css.includes("white-space: normal"), "menu labels are allowed to wrap");

const ownerCss = read("src/components/owner-door/owner-door.css");
assert(ownerCss.includes("--owner-menu-top"), "the owner account menu is placed under its trigger");
assert(ownerCss.includes("overflow-wrap: anywhere"), "owner practice names wrap");
assert(
  ownerCss.includes('[data-screen="settings"]') && ownerCss.includes('[data-screen="plan"]'),
  "owner Settings and Plan tabs can wrap",
);

const portalCss = read("src/styles/accountant-portal.css");
assert(
  portalCss.includes(":not(.nav-open) .deliverable-rail{display:none"),
  "phone settings and practice nav is the drawer, not a tab bar",
);
assert(!portalCss.includes("flex:1 1 calc(50% - 4px)"), "settings tabs are not a wrapping grid");
assert(portalCss.includes("overflow-wrap:anywhere"), "practice names wrap on the phone top bar");

const settingsCss = read("src/styles/settings-portal.css");
assert(settingsCss.includes("overflow-wrap: anywhere"), "settings emails and values wrap");

const team = read("src/routes/_authenticated/settings.team.tsx");
assert(!team.includes("flex-1 truncate"), "team client names are not ellipsized");
assert(team.includes("overflow-wrap:anywhere"), "team client names wrap");

const shell = read("src/components/owner-door/owner-shell.tsx");
assert(shell.includes("<SettingsMenu"), "the owner top-right Settings control opens the menu");
assert(shell.includes("<RailSettingsButton"), "the owner sidebar Settings item stays");
assert(
  /<RailSettingsButton[\s\S]*onClick=\{onSettings\}/.test(shell),
  "the owner sidebar Settings item is still a direct link",
);

const dashboard = read("src/routes/_authenticated/dashboard.tsx");
assert(dashboard.includes("<SettingsMenu"), "the accountant dashboard Settings control opens the menu");
assert(dashboard.includes('hash: "firm-billing"'), "accountant plan opens firm billing");

const client = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(client.includes("<SettingsMenu"), "the accountant client Settings control opens the menu");
const nav = read("src/components/accountant-nav.tsx");
assert(client.includes("<ClientRail"), "the client file uses the shared rail");
assert(nav.includes('to: "/settings"'), "the accountant sidebar Settings item stays a direct link");

const settings = read("src/components/settings-shell.tsx");
assert(settings.includes("<SettingsMenu"), "settings keeps a top-right menu");
assert(settings.includes("settings-gear"), "settings keeps the gear control");
assert(settings.includes("<PracticeRail"), "settings pins the practice rail");
assert(settings.includes('id="firm-billing"') === false, "the shell does not invent the billing card");

const plan = read("src/routes/_authenticated/settings.index.tsx");
assert(plan.includes('id="firm-billing"'), "firm billing is a target on the practice settings page");

console.log("settings-menu tests passed");
