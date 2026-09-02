/**
 * Analytics spine Phase 1 — taxonomy mapping and GET-must-not-write contracts.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/analytics-events-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACK_GET_MUST_NOT_WRITE,
  CLIENT_WRITABLE_EVENT_KEYS,
  isClientWritableEventKey,
  mapUsageEventToSpine,
  TASK_LINK_GET_MUST_NOT_WRITE,
  userAgentLooksLikeBot,
} from "../src/lib/analytics-events";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(TASK_LINK_GET_MUST_NOT_WRITE, "task-link GET must not write");
assert(ACK_GET_MUST_NOT_WRITE, "ack GET must not write");

assert(isClientWritableEventKey("view.opened"), "view.opened is client-writable");
assert(isClientWritableEventKey("task.link.engaged"), "engaged is listed (API only)");
assert(!isClientWritableEventKey("task.assigned"), "assignment is not client-writable");
assert(!isClientWritableEventKey("report.sent"), "report.sent is not client-writable");
assert(!isClientWritableEventKey("upload.succeeded"), "upload.succeeded is not client-writable");
assert(!isClientWritableEventKey("financials_uploaded"), "old vanity name is not a spine key");
assert(CLIENT_WRITABLE_EVENT_KEYS.includes("friction.dead_click"), "dead-click allowlisted");

const page = mapUsageEventToSpine({ event: "page_viewed", path: "/app" });
assert(page.length === 1 && page[0].eventKey === "view.opened", "page_viewed → view.opened");

const plan = mapUsageEventToSpine({ event: "tab_viewed", tab: "plan" });
assert(
  plan.some((m) => m.eventKey === "view.opened") && plan.some((m) => m.eventKey === "plan.opened"),
  "firm action plan tab also emits plan.opened",
);

const tasks = mapUsageEventToSpine({ event: "tab_viewed", tab: "tasks" });
assert(tasks.some((m) => m.eventKey === "plan.opened"), "owner tasks tab emits plan.opened");

assert(
  mapUsageEventToSpine({ event: "financials_uploaded" }).length === 0,
  "client upload track is not upload.succeeded",
);
assert(
  mapUsageEventToSpine({ event: "report_downloaded" }).length === 0,
  "download stays on the delivery trigger, not client spine",
);
assert(
  mapUsageEventToSpine({ event: "playbook_opened" })[0]?.eventKey === "playbook.opened",
  "playbook maps",
);

assert(userAgentLooksLikeBot("Mozilla/5.0 GoogleImageProxy"), "gmail image proxy is a bot");
assert(userAgentLooksLikeBot("SafeLinks"), "SafeLinks is a bot");
assert(userAgentLooksLikeBot(""), "empty UA treated as bot");
assert(!userAgentLooksLikeBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"), "iphone is human");

const ackSrc = readFileSync(resolve("src/routes/ack.$token.tsx"), "utf8");
const ackEffect = ackSrc.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[token\]\);/)?.[0] ?? "";
assert(ackEffect.includes("previewDeliveryAck"), "preview is in useEffect");
assert(
  !ackEffect.includes("acknowledgeDelivery"),
  "acknowledgeDelivery must not run in useEffect (GET/prefetch)",
);
assert(ackSrc.includes("I received this"), "human confirm button exists");
assert(ackSrc.includes('type="button"'), "confirm is a button not a GET form");

const taskPage = readFileSync(resolve("src/routes/t.$token.tsx"), "utf8");
assert(taskPage.includes("/api/task-engaged"), "task page posts engagement beacon");
assert(taskPage.includes("task.link.engaged"), "engaged event is sent from the page");
assert(taskPage.includes("sendBeacon"), "uses sendBeacon");

const beacon = readFileSync(resolve("src/routes/api/task-engaged.ts"), "utf8");
assert(beacon.includes("GET:"), "GET handler exists");
assert(beacon.includes("405"), "GET is method not allowed");
assert(!/from\("action_tokens"\)[\s\S]*update/.test(beacon), "beacon does not bump last_used_at");
assert(beacon.includes('method: "POST"') || beacon.includes("POST:"), "POST handler");

const taskLink = readFileSync(resolve("supabase/functions/task-link/index.ts"), "utf8");
const getBlock = taskLink.split("if (req.method === \"GET\")")[1]?.split("if (req.method === \"POST\")")[0] ?? "";
assert(getBlock.length > 0, "task-link has a GET branch");
assert(!/from\("action_tokens"\)[\s\S]*update/.test(getBlock), "GET does not update action_tokens");
assert(!getBlock.includes("analytics"), "GET does not write analytics");
assert(taskLink.includes("A GET must NEVER change data"), "scanner comment still present");

const ingest = readFileSync(resolve("src/lib/product-usage.functions.ts"), "utf8");
assert(ingest.includes("analytics_track"), "dual-run writes analytics_track");
assert(ingest.includes("mapUsageEventToSpine"), "uses the mapping helper");

console.log("analytics-events-test: ok");
