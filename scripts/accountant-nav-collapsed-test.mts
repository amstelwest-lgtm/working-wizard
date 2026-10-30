/**
 * Collapsible accountant rail: storage, boot script, and the `[` shortcut.
 * Run: pnpm test:accountant-nav-collapsed
 */
import { readFileSync } from "node:fs";
import {
  NAV_COLLAPSED_BOOT_SCRIPT,
  NAV_COLLAPSED_KEY,
  isNavToggleKey,
  readNavCollapsed,
  writeNavCollapsed,
} from "../src/lib/accountant-nav-collapsed";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const store = new Map<string, string>();
const storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

assert(NAV_COLLAPSED_KEY === "milon.accountantNav.collapsed", "the storage key matches the spec");
assert(!readNavCollapsed(storage), "the rail starts open");
writeNavCollapsed(storage, true);
assert(readNavCollapsed(storage), "collapsing is remembered");
writeNavCollapsed(storage, false);
assert(!readNavCollapsed(storage) && !store.has(NAV_COLLAPSED_KEY), "expanding clears the key");
assert(!readNavCollapsed(null), "no storage reads as open");

assert(isNavToggleKey({ key: "[", target: { tagName: "BODY" } as never }), "[ toggles on the page");
assert(!isNavToggleKey({ key: "]" }), "only [ toggles");
assert(!isNavToggleKey({ key: "[", metaKey: true }), "Cmd+[ is the browser's back");
assert(!isNavToggleKey({ key: "[", ctrlKey: true }), "Ctrl+[ is left alone");
for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
  assert(!isNavToggleKey({ key: "[", target: { tagName } as never }), `[ is typed into ${tagName}`);
}
assert(
  !isNavToggleKey({ key: "[", target: { tagName: "DIV", isContentEditable: true } as never }),
  "[ is typed into rich text",
);

assert(NAV_COLLAPSED_BOOT_SCRIPT.includes(NAV_COLLAPSED_KEY), "the boot script reads the same key");
const root = readFileSync("src/routes/__root.tsx", "utf8");
assert(root.includes("NAV_COLLAPSED_BOOT_SCRIPT"), "the boot script runs before first paint");
const nav = readFileSync("src/components/accountant-nav.tsx", "utf8");
assert(
  nav.includes('"Hide menu"') && nav.includes('"Show menu"'),
  "the button names say what it does",
);
assert(nav.includes("useAccountantNavCollapsed()"), "every AccountantNav uses the one hook");
const css = readFileSync("src/styles/accountant-portal.css", "utf8");
const block = css.slice(css.indexOf("Laptop rail collapse"));
assert(block.includes("grid-template-columns:56px minmax(0,1fr)"), "collapsed is a 56px strip");
assert(
  block.includes("transition:grid-template-columns .18s"),
  "the grid animates over about 180ms",
);
assert(
  /prefers-reduced-motion:reduce\)\{[^}]*transition:none/.test(block),
  "reduced motion skips it",
);
assert(
  block.includes(".accountant-nav .nav-collapse{display:none}"),
  "phones keep the drawer only",
);

console.log("accountant-nav-collapsed-test: all assertions passed");
