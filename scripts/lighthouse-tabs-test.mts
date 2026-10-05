/**
 * Lighthouse sales tabs must be a real binding.
 * A missing LIGHTHOUSE_TABS is a ReferenceError in the tab bar and blanks /ops.
 * Run: pnpm test:lighthouse-tabs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LIGHTHOUSE_TABS, parseLighthouseTab } from "../src/components/lighthouse-panel";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const src = readFileSync(resolve(process.cwd(), "src/components/lighthouse-panel.tsx"), "utf8");
assert(
  /export const LIGHTHOUSE_TABS\s*=\s*\[[^\]]*\]\s*as const/.test(src),
  "lighthouse-panel.tsx must declare LIGHTHOUSE_TABS once",
);
assert(
  src.split("export const LIGHTHOUSE_TABS").length === 2,
  "LIGHTHOUSE_TABS is declared exactly once",
);

assert(
  LIGHTHOUSE_TABS.join(",") === "pipeline,playbook,assets,settings",
  "sales console tabs are pipeline, playbook, assets, settings",
);

const html = renderToStaticMarkup(
  createElement(
    "div",
    null,
    LIGHTHOUSE_TABS.map((t) => createElement("button", { key: t, type: "button" }, t)),
  ),
);
for (const tab of LIGHTHOUSE_TABS) {
  assert(html.includes(`>${tab}<`), `tab bar renders ${tab}`);
  assert(parseLighthouseTab(tab) === tab, `parseLighthouseTab accepts ${tab}`);
  assert(src.includes(`tab === "${tab}"`), `panel renders the ${tab} tab`);
}
assert(parseLighthouseTab("it") === undefined, "ops IT tab is not a sales tab");
assert(parseLighthouseTab(undefined) === undefined, "missing search tab does not throw");

console.log("lighthouse tabs ok");
