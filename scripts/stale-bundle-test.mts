/**
 * Stale-bundle guard: compare a build id, never reload by itself.
 * Run: pnpm test:stale-bundle
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { currentBuildId, versionJson } from "../src/lib/build-version";
import {
  STALE_BUNDLE_BAR_TEXT,
  STALE_BUNDLE_POLL_MS,
  remoteBuildIsNewer,
} from "../src/lib/stale-bundle";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(STALE_BUNDLE_POLL_MS === 10 * 60 * 1000, "poll is about 10 minutes");
assert(
  STALE_BUNDLE_BAR_TEXT === "A new version of Milōn is ready · Reload",
  STALE_BUNDLE_BAR_TEXT,
);
assert(remoteBuildIsNewer("aaa", { buildId: "bbb" }) === true, "a new sha is stale");
assert(remoteBuildIsNewer("aaa", { buildId: "aaa" }) === false, "the same sha is current");
assert(remoteBuildIsNewer("aaa", {}) === false, "a missing id is not a deploy");
assert(remoteBuildIsNewer("", { buildId: "bbb" }) === false, "dev with no baked id stays quiet");
assert(remoteBuildIsNewer("aaa", null) === false, "a failed read stays quiet");

const payload = JSON.parse(versionJson("abc123")) as { buildId?: string };
assert(payload.buildId === "abc123", "version.json carries the build id");
assert(currentBuildId({ VERCEL_GIT_COMMIT_SHA: "deploy-sha" }) === "deploy-sha", "deploy sha wins");
assert(currentBuildId({ GITHUB_SHA: "ci-sha" }) === "ci-sha", "CI sha is the fallback");

const bar = readFileSync(resolve("src/components/stale-bundle-bar.tsx"), "utf8");
assert(bar.includes("STALE_BUNDLE_READY"), "bar uses the shared ready copy");
assert(bar.includes("STALE_BUNDLE_RELOAD"), "bar uses the shared reload copy");
assert(bar.includes('window.addEventListener("focus"'), "check runs on window focus");
assert(bar.includes("STALE_BUNDLE_POLL_MS"), "check runs on the interval");
assert(bar.includes('data-stale-bundle="bar"'), "the bar is marked for the page");
assert(bar.includes("onClick={() => window.location.reload()}"), "reload is the button");
assert(!bar.includes("location.reload();\n"), "the effect does not reload the page");
const reloads = bar.match(/location\.reload\(\)/g) ?? [];
assert(reloads.length === 1, `reload is only the button, found ${reloads.length}`);

const root = readFileSync(resolve("src/routes/__root.tsx"), "utf8");
assert(root.includes("<StaleBundleBar />"), "the bar is mounted for every page");

const vercel = readFileSync(resolve("vercel.json"), "utf8");
assert(vercel.includes('"/version.json"'), "version.json is served with its own cache header");
assert(vercel.includes('"no-cache"'), "version.json is not cached as immutable");

const vite = readFileSync(resolve("vite.config.ts"), "utf8");
assert(vite.includes("emitVersionJson"), "the build writes version.json");
assert(vite.includes("VITE_BUILD_ID"), "the bundle carries the same build id");

console.log("stale-bundle: ok");
