/**
 * Overview notes sit in the page, and pack text stays clear of the share button.
 * Run: pnpm test:mobile-retest-m1-m2
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");

const client = read("src/routes/_authenticated/clients.$clientId.tsx");
const layer = read("src/components/note-layer.tsx");
const pack = read("src/components/advisory-pack-panel.tsx");
const css = read("src/styles/accountant-portal.css");

const slotAt = client.indexOf('data-notes-tray-slot=""');
const cardsAt = client.indexOf("<OverviewSectionCards");
assert(slotAt !== -1 && cardsAt !== -1 && slotAt < cardsAt, "the notes slot sits above the overview cards");
assert(client.includes('workspace="accountant"'), "the accountant notes layer stays marked");

assert(layer.includes("[data-notes-tray-slot]"), "overview looks up the in-flow slot");
assert(layer.includes("createPortal(tray, traySlot)"), "the tray mounts in that slot");
assert(layer.includes("relative z-[1]"), "the overview tray is in normal flow");
assert(layer.includes("fixed bottom-44"), "other tabs keep the floating tray");

const readLists = pack.match(/advisory-pack__read mt-4 space-y-3/g) ?? [];
assert(readLists.length >= 2, "the live pack and the harness fixture share the read list");
assert(css.includes(".advisory-pack__read{"), "pack reading has a mobile inset");
assert(
  css.includes("padding-right:calc(4.75rem + env(safe-area-inset-right, 0px))"),
  "pack text clears the share button on the right",
);
assert(
  css.includes("padding-bottom:calc(5.5rem + env(safe-area-inset-bottom, 0px))"),
  "pack text clears the share button along the bottom",
);

console.log("mobile-retest-m1-m2: ok");
