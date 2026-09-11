/**
 * Lighthouse Resend idempotency key — content-aware so re-drafts can send.
 * Run: pnpm test:lighthouse-resend-idempotency
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lighthouseResendIdempotencyKey } from "../src/lib/lighthouse-resend-idempotency.server";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const touchId = "11111111-1111-4111-8111-111111111111";
const otherTouch = "22222222-2222-4222-8222-222222222222";

function payload(overrides: { subject?: string; text?: string } = {}): string {
  return JSON.stringify({
    from: "The Milōn Team <noreply@milon.co.za>",
    to: ["theoamstel123@gmail.com"],
    reply_to: "hello@milonfinance.com",
    subject: overrides.subject ?? "Day 0 note",
    text: overrides.text ?? "First draft body",
    tags: [
      { name: "source", value: "lighthouse" },
      { name: "touch_id", value: touchId },
    ],
  });
}

const firstBody = payload();
const firstKey = lighthouseResendIdempotencyKey(touchId, firstBody);
const sameClick = lighthouseResendIdempotencyKey(touchId, payload());

assert(firstKey === sameClick, "same touch + same body → same key (double-click safe)");
assert(firstKey.startsWith(`lighthouse/${touchId}/`), "key is scoped to the touch UUID");
assert(firstKey.length <= 256, "Resend max key length is 256");
assert(/^[0-9a-f]{32}$/.test(firstKey.split("/")[2] ?? ""), "content digest is 32 hex chars");

const redraftKey = lighthouseResendIdempotencyKey(
  touchId,
  payload({ subject: "Day 0 note (rewritten)", text: "Second draft body" }),
);
assert(redraftKey !== firstKey, "same touch + modified body → new key (avoids Resend 409)");
assert(redraftKey.startsWith(`lighthouse/${touchId}/`), "re-draft key stays on the same touch");

const otherLead = lighthouseResendIdempotencyKey(otherTouch, firstBody);
assert(otherLead !== firstKey, "identical body on a different touch must not share a key");

const fns = readFileSync(resolve("src/lib/lighthouse.functions.ts"), "utf8");
assert(fns.includes("lighthouseResendIdempotencyKey"), "send fn uses the content-aware key");
assert(!fns.includes("`lighthouse-${data.touchId}`"), "send fn no longer uses a touch-only key");

console.log("lighthouse-resend-idempotency-test: ok");
