/**
 * Accountant Reports tab must be the production Reports Studio, not the old
 * client gallery or the /reports/demo mock overlay.
 * Run: pnpm test:accountant-reports-studio
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReportsStudio } from "../src/routes/_authenticated/reports.index";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(typeof ReportsStudio === "function", "ReportsStudio is exported for the client workspace tab");

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(clientSrc.includes("ReportsStudioPanel"), "client Reports tab mounts ReportsStudio");
assert(clientSrc.includes("embedded"), "client workspace embeds studio chrome");
assert(!clientSrc.includes("REPORT_TEMPLATES"), "old report gallery catalogue is gone");
assert(!clientSrc.includes("rep-grid"), "old report gallery markup is gone");
assert(clientSrc.includes('setActiveTab("reports")'), "Generate report stays on the client Reports tab");

const studioSrc = readFileSync(resolve("src/routes/_authenticated/reports.index.tsx"), "utf8");
assert(studioSrc.includes("export function ReportsStudio"), "studio is a reusable panel");
assert(!studioSrc.includes("/reports/demo"), "studio no longer links to the mock preview");
assert(studioSrc.includes("embedded"), "studio supports embedded (client tab) chrome");

const demoSrc = readFileSync(resolve("src/routes/_authenticated/reports.demo.tsx"), "utf8");
assert(demoSrc.includes('to: "/reports"'), "legacy /reports/demo redirects to studio");
assert(!demoSrc.includes("MOCK_RATIO_RESULTS"), "demo mock UI is deleted, not overlaid");

const dashSrc = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
assert(dashSrc.includes('search: { tab: "reports" }'), "dashboard report icon opens the client Reports tab");
assert(dashSrc.includes('to: "/reports"'), "dashboard Reports studio still opens standalone studio");

const walkSrc = readFileSync(resolve("src/components/walkthrough-wizard.tsx"), "utf8");
assert(walkSrc.includes("same Reports Studio"), "walkthrough describes the studio on the Reports tab");

console.log("accountant-reports-studio-test: ok");
