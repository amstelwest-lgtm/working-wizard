/**
 * Accountant theme toggle + settings chrome: gold icon control,
 * no leftover slate dashboard shell.
 * Run: pnpm test:settings-theme
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const toggle = read("src/components/theme-toggle.tsx");
assert(toggle.includes("milon-theme-toggle"), "toggle uses the premium class");
assert(toggle.includes("data-theme-toggle"), "toggle is addressable in the accountant topbar");
assert(!toggle.includes("border-slate-300"), "toggle dropped the old slate pill");
assert(!toggle.includes("Switch to light mode") || toggle.includes("aria-label"), "toggle names the destination mode");
assert(!toggle.includes("hidden sm:inline"), "no leftover Light/Dark text chip");

const prim = read("src/styles/primitives.css");
assert(prim.includes(".milon-theme-toggle"), "shared gold-rim styles exist");
assert(prim.includes("border-radius: 50%"), "toggle is circular");

const portal = read("src/styles/accountant-portal.css");
assert(portal.includes("[data-theme-toggle]"), "accountant topbar still targets the toggle");
assert(portal.includes("border-radius:50%"), "mobile menu keeps the circle");

const shell = read("src/components/settings-shell.tsx");
assert(shell.includes("accountant-portal"), "settings sit on portal chrome");
assert(shell.includes('id="atmos"'), "settings have the gold atmos");

for (const page of [
  "src/routes/_authenticated/settings.index.tsx",
  "src/routes/_authenticated/settings.team.tsx",
  "src/routes/_authenticated/settings.brand.tsx",
]) {
  const src = read(page);
  assert(src.includes("<SettingsShell"), `${page} uses SettingsShell`);
  assert(!src.includes("bg-slate-950"), `${page} dropped the slate-950 shell`);
  assert(!src.includes("bg-[#07090f]"), `${page} dropped the old brand background`);
  assert(src.includes("<ThemeToggle"), `${page} has the appearance control`);
}

const index = read("src/routes/_authenticated/settings.index.tsx");
assert(index.includes('href="/privacy"'), "settings still links to privacy");
assert(index.includes("anonymised"), "settings still restates anonymisation");
assert(index.includes("settings-row"), "nav rows use the new row language");

const team = read("src/routes/_authenticated/settings.team.tsx");
assert(team.includes("Team & access"), "team page title");
assert(team.includes("Save assignments"), "per-client grant UI");
assert(team.includes("Invite team member"), "firm invite UI");
assert(team.includes("settings-gold"), "invite CTA is gold");

console.log("settings-theme: all assertions passed");
