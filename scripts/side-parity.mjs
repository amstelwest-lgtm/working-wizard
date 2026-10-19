/**
 * Owner ↔ accountant parity gate.
 *
 * A pull request that edits one side of a mapped pair must also edit the
 * other side, unless the PR body contains:
 *
 *   Other side: N/A — <reason>
 *
 * The em dash is required. A non-empty reason must follow it.
 *
 *   node scripts/side-parity.mjs
 *   BASE_SHA=… HEAD_SHA=… PR_BODY=… node scripts/side-parity.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Same-line em dash plus a non-empty reason. A newline does not count as the reason. */
export const WAIVER =
  /Other side:[^\n]*N\/A[^\n]*—[ \t]*\S/;

/** @param {string} body */
export function hasWaiver(body) {
  return WAIVER.test(body ?? "");
}

/**
 * @param {{
 *   changed: string[],
 *   body?: string,
 *   map: { pairs: { id: string, owner: string[], accountant: string[] }[] },
 * }} input
 * @returns {{ id: string, missing: "owner" | "accountant" }[]}
 */
export function parityGaps({ changed, body, map }) {
  if (hasWaiver(body ?? "")) return [];
  const set = new Set(changed);
  const gaps = [];
  for (const pair of map.pairs) {
    const owner = pair.owner.some((f) => set.has(f));
    const accountant = pair.accountant.some((f) => set.has(f));
    if (owner && !accountant) gaps.push({ id: pair.id, missing: "accountant" });
    if (accountant && !owner) gaps.push({ id: pair.id, missing: "owner" });
  }
  return gaps;
}

function changedFiles(base, head) {
  const out = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
    encoding: "utf8",
  });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

function pullRequestBody() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    try {
      const event = JSON.parse(readFileSync(eventPath, "utf8"));
      if (event.pull_request && "body" in event.pull_request) {
        return event.pull_request.body ?? "";
      }
    } catch {
      // Local runs pass PR_BODY instead.
    }
  }
  return process.env.PR_BODY ?? "";
}

function main() {
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA || "HEAD";
  const body = pullRequestBody();
  if (!base) {
    console.log("side-parity: no BASE_SHA, skipping");
    return;
  }
  const map = JSON.parse(readFileSync(new URL("../parity-map.json", import.meta.url), "utf8"));
  const gaps = parityGaps({ changed: changedFiles(base, head), body, map });
  if (gaps.length === 0) {
    console.log("side-parity: ok");
    return;
  }
  console.error("side-parity: a mapped pair was edited on one side only.");
  for (const gap of gaps) {
    console.error(`  ${gap.id}: missing the ${gap.missing} side`);
  }
  console.error("Touch the other side, or add to the PR body:");
  console.error("  Other side: N/A — <reason>");
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("side-parity.mjs")) {
  main();
}
