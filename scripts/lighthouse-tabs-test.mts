/**
 * Lighthouse tabs must be declared in the panel module.
 * PR #174 dropped the LIGHTHOUSE_TABS declaration while its uses stayed, so
 * /ops threw "LIGHTHOUSE_TABS is not defined" (SSR 500 on ?tab=…, client crash
 * on the default sales view). tsc is report-only in CI, so guard it here.
 * Run: pnpm test:lighthouse-tabs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const src = readFileSync(resolve(process.cwd(), "src/components/lighthouse-panel.tsx"), "utf8");
assert(
  /export const LIGHTHOUSE_TABS\s*=\s*\[[^\]]*\]\s*as const/.test(src),
  "lighthouse-panel.tsx must declare LIGHTHOUSE_TABS",
);

const declared = src.match(/export const LIGHTHOUSE_TABS\s*=\s*\[([^\]]*)\]/)![1];
const tabs = [...declared.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
for (const t of ["pipeline", "playbook", "assets", "settings"]) {
  assert(tabs.includes(t), `LIGHTHOUSE_TABS includes ${t}`);
  assert(src.includes(`tab === "${t}"`), `panel renders the ${t} tab`);
}
for (const m of src.matchAll(/tab === "([a-z]+)"/g)) {
  assert(tabs.includes(m[1]), `rendered tab ${m[1]} is in LIGHTHOUSE_TABS`);
}

console.log("lighthouse tabs: ok");
