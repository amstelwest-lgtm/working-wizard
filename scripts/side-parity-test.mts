/**
 * Owner/accountant parity gate.
 * Run: pnpm test:side-parity
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hasWaiver, parityGaps } from "./side-parity.mjs";

const map = JSON.parse(readFileSync(new URL("../parity-map.json", import.meta.url), "utf8"));

test("flags a one-sided edit and passes when both sides move", () => {
  const changed = ["src/lib/owner-answers.ts"];
  assert.deepEqual(parityGaps({ changed, body: "", map }), [
    { id: "cash-floor", missing: "accountant" },
  ]);
  assert.deepEqual(
    parityGaps({
      changed: ["src/lib/owner-answers.ts", "src/lib/financial-manager-brief.ts"],
      body: "",
      map,
    }),
    [],
  );
});

test("a waiver with an em dash and a reason clears every gap", () => {
  assert.equal(hasWaiver("Other side: N/A — shared helper only"), true);
  assert.equal(hasWaiver("Other side: N/A - hyphen"), false);
  assert.equal(hasWaiver("Other side: N/A —"), false);
  assert.deepEqual(
    parityGaps({
      changed: ["src/routes/app.tsx"],
      body: "Notes\n\nOther side: N/A — owner-only route copy\n",
      map,
    }),
    [],
  );
});

test("the pull request template documents the Other side line", () => {
  const template = readFileSync(new URL("../.github/pull_request_template.md", import.meta.url), "utf8");
  assert.match(template, /Other side\?/);
  assert.match(template, /Other side: N\/A —/);
  assert.equal(hasWaiver(template), false, "the blank template must not waive the check");
});
