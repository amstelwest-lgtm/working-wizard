/**
 * Advisory pack sign-off grounding for ask-ai and milon-bot.
 * Status words are signoffStatusLine. Asking does not write a pack.
 * Run: pnpm test:advisory-signoff-grounding
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { groundBrainSummaryRecord, ratiosForBrainProse } from "../src/lib/advisory-narrative.ts";
import {
  advisorySignoffGrounding,
  formatAdvisorySignoffGrounding,
  resolveAdvisorySignoffState,
} from "../src/lib/advisory-signoff.ts";
import { formatReviewDateTime } from "../src/lib/market/format.ts";
import { persistedCreateIntent } from "../src/lib/milon-bot-copy.ts";
import { PAGE_FIGURES_CHANGED_CLAUSE, signoffStatusLine } from "../src/lib/signoff-status.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const signedAt = "2026-10-08T12:19:00.000Z";
const us = { locale: "en-US", timezone: "America/New_York" };

const draft = advisorySignoffGrounding(
  resolveAdvisorySignoffState({ version: null, packStatus: null, zone: "America/New_York" }),
);
assert(draft.status === "draft", "draft status");
assert(
  draft.version === null && draft.signedBy === null && draft.signedAt === null,
  "draft has no version or signer",
);
assert(draft.firmName === null, "draft has no firm");
assert(draft.line === signoffStatusLine({ kind: "draft" }), `draft line: ${draft.line}`);
assert(draft.line === "Draft", "draft uses the strip word");

const review = advisorySignoffGrounding(
  resolveAdvisorySignoffState({
    version: 12,
    packStatus: "in_review",
    signedBy: "James Fleming",
    firmName: "Ben Accountants",
    signedAt,
    zone: "America/New_York",
  }),
);
assert(review.status === "in_review" && review.version === 12, "in review keeps the version");
assert(
  review.signedBy === null && review.signedAt === null && review.firmName === null,
  "in review drops signer fields",
);
assert(review.line === signoffStatusLine({ kind: "ready" }), `in review line: ${review.line}`);
assert(review.line === "Ready for review", "in review uses the strip word");

const signedState = resolveAdvisorySignoffState({
  version: 12,
  packStatus: "approved",
  figuresChanged: false,
  signedBy: "James Fleming",
  firmName: "Ben Accountants",
  signedAt,
  reviewedByKind: "accountant",
  zone: "America/New_York",
});
const signed = advisorySignoffGrounding(signedState);
const signedDate = formatReviewDateTime(signedAt, us, { firmTimeZone: "America/New_York" });
assert(signed.status === "signed" && signed.version === 12, "signed version");
assert(signed.signedBy === "James Fleming", "signed names the accountant");
assert(signed.signedAt === signedAt, "signed keeps the timestamp");
assert(signed.firmName === "Ben Accountants", "signed names the firm");
assert(
  signed.line === signoffStatusLine({ kind: "signed", name: "James Fleming", date: signedDate }),
  `signed line: ${signed.line}`,
);
assert(signed.line.startsWith("Signed off by James Fleming · "), "signed line names James Fleming");

const stale = advisorySignoffGrounding(
  resolveAdvisorySignoffState({
    version: 12,
    packStatus: "approved",
    figuresChanged: true,
    signedBy: "James Fleming",
    firmName: "Ben Accountants",
    signedAt,
    reviewedByKind: "accountant",
    zone: "America/New_York",
  }),
);
assert(stale.status === "signed_stale" && stale.version === 12, "stale keeps the version");
assert(
  stale.signedBy === "James Fleming" && stale.firmName === "Ben Accountants",
  "stale keeps the signer",
);
assert(stale.signedAt === signedAt, "stale keeps the timestamp");
assert(
  stale.line === signoffStatusLine({ kind: "stale", name: "James Fleming" }),
  `stale line: ${stale.line}`,
);
assert(
  stale.line === `Signed off by James Fleming · ${PAGE_FIGURES_CHANGED_CLAUSE}`,
  "stale uses the strip clause",
);

const block = formatAdvisorySignoffGrounding(signed);
assert(block.includes(`Status: ${signed.line}`), "block quotes the status line");
assert(block.includes("status: signed"), "block includes status");
assert(block.includes("version: 12"), "block includes version");
assert(block.includes("signedBy: James Fleming"), "block includes signedBy");
assert(block.includes(`signedAt: ${signedAt}`), "block includes signedAt");
assert(block.includes("firmName: Ben Accountants"), "block includes firmName");
assert(block.includes("Do not create or save a pack version"), "block forbids a new version");

assert(
  persistedCreateIntent("Is the advisory pack signed off, and what version?") === null,
  "the sign-off question does not create a pack",
);

const stored = {
  headline: "Books",
  body: "Creditor days at 73 and stretching payables significantly.",
  bullets: ["creditor days of 73"],
};
const live = groundBrainSummaryRecord(stored, { "Creditor Days": 37 }) as {
  body: string;
  bullets: string[];
};
assert(!live.body.includes("73"), `body still cites 73: ${live.body}`);
assert(live.body.includes("37"), `body should cite 37: ${live.body}`);
assert(!live.bullets[0].includes("73"), `bullet still cites 73: ${live.bullets[0]}`);
assert(live.bullets[0].includes("37"), `bullet should cite 37: ${live.bullets[0]}`);
assert(ratiosForBrainProse(null) === null, "no financials leaves the stored prose alone");
assert(
  groundBrainSummaryRecord(stored, null) === stored,
  "missing ratios do not rewrite the summary",
);

const read = (path: string) => readFileSync(resolve(path), "utf8");
const ask = read("supabase/functions/ask-ai/context-builder.ts");
const askPrompt = read("supabase/functions/ask-ai/prompt.ts");
const bot = read("supabase/functions/milon-bot/index.ts");
const execute = read("supabase/functions/milon-bot/execute.ts");
const signoff = read("src/lib/advisory-signoff.ts");
const dataRequests = read("src/lib/data-requests.ts");
const ci = read(".github/workflows/ci.yml");
const brain = read("src/components/client-brain-summary.tsx");

assert(ask.includes("getAdvisorySignoffState"), "ask-ai reads sign-off through the shared helper");
assert(
  askPrompt.includes("formatAdvisorySignoffGrounding"),
  "ask-ai puts the sign-off block in the prompt",
);
assert(
  bot.includes("getAdvisorySignoffState"),
  "milon-bot reads sign-off through the shared helper",
);
assert(
  execute.includes("getAdvisorySignoffState"),
  "milon-bot tools read sign-off through the shared helper",
);
assert(bot.includes("formatAdvisorySignoffGrounding"), "milon-bot appends the sign-off block");
assert(!signoff.includes(".insert("), "the sign-off reader does not write");
assert(!signoff.includes("advisory_pack_create"), "the sign-off reader does not create a pack");
assert(!dataRequests.includes("@/"), "data-requests has no Vite alias");
assert(
  dataRequests.includes("./deliverable-input-config.ts"),
  "data-requests uses a relative .ts import",
);
assert(
  ci.includes("deno check --no-lock supabase/functions/milon-bot/index.ts"),
  "CI checks milon-bot",
);
assert(brain.includes("groundBrainSummaryRecord"), "Books summary renders live ratio wording");
assert(brain.includes("ratiosForBrainProse"), "Books summary uses the live Overview ratios");

console.log("advisory-signoff-grounding-test: ok");
