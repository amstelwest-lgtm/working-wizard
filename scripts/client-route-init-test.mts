/**
 * /clients/:id must not read reportsIssued before it is initialized.
 * That const used to sit after the loading return, so the Home needs memo
 * threw ReferenceError in the production chunk (Sentry: Cannot access 'oa'
 * before initialization).
 * Run: pnpm test:client-route-init
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const src = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const declared = src.indexOf("const reportsIssued = client?.reports_issued_count ?? 0;");
const memo = src.indexOf("const homeNeeds = useMemo");
assert(declared !== -1, "reportsIssued is read from the client before the loading return");
assert(memo !== -1, "Home needs memo is still on the client page");
assert(declared < memo, "reportsIssued is initialized before the Home needs memo reads it");
assert(
  !src.includes("const reportsIssued = client.reports_issued_count"),
  "reportsIssued is not declared again after the loading return",
);

console.log("client-route-init-test: ok");
