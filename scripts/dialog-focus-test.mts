/**
 * Upload-statement drawer focus trap.
 * Run: pnpm test:dialog-focus
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { focusTrapTabIndex } from "../src/lib/dialog-focus.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

eq(focusTrapTabIndex(3, 0, false), 1, "Tab from the first control moves to the second");
eq(focusTrapTabIndex(3, 1, true), 0, "Shift+Tab from the middle moves to the previous");
eq(focusTrapTabIndex(3, 2, false), 0, "Tab from the last control wraps to the first");
eq(focusTrapTabIndex(3, 0, true), 2, "Shift+Tab from the first control wraps to the last");
eq(focusTrapTabIndex(3, -1, false), 0, "Tab from outside the dialog lands on the first control");
eq(focusTrapTabIndex(3, -1, true), 2, "Shift+Tab from outside lands on the last control");
eq(focusTrapTabIndex(1, 0, false), 0, "Tab on the only control stays inside");
eq(focusTrapTabIndex(0, -1, false), -1, "an empty dialog does not invent a target");

const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const uploadEffect = studio.slice(
  studio.indexOf("const uploadDialogRef"),
  studio.indexOf("const [showBankDrafter"),
);
assert(uploadEffect.includes('event.key === "Escape"'), "Escape closes the upload dialog");
assert(uploadEffect.includes("focusTrapTabIndex"), "Tab is trapped inside the upload dialog");
assert(uploadEffect.includes("setUploadOpen(false)"), "Escape dismisses the dialog");

const modalStart = studio.indexOf("UPLOAD FINANCIALS MODAL");
const modal = studio.slice(modalStart, studio.indexOf("<PastPeriodUploadDialog", modalStart));
assert(modal.includes("ref={uploadDialogRef}"), "trap is attached to the upload dialog");
assert(modal.includes('aria-labelledby="upload-statement-title"'), "dialog names itself");
assert(modal.includes('className="close"'), "close control is still the ✕ button");

const css = readFileSync(resolve("src/styles/accountant-portal.css"), "utf8");
assert(
  css.includes(".drawer.open button.close:focus-visible"),
  "upload close button has a visible focus ring",
);

console.log("dialog-focus: all checks passed");
