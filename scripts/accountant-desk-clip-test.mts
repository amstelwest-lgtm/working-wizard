/**
 * Accountant agent desk: nothing is clipped on a phone or short tablet.
 * Run: pnpm test:accountant-desk-clip
 */
import { readFileSync } from "node:fs";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

const css = readFileSync(
  new URL("../src/components/milon-team/milon-team-desk.css", import.meta.url),
  "utf8",
);

const phoneAt = css.lastIndexOf("@media (max-width: 860px)");
assert(phoneAt >= 0, "the desk has a phone / tablet block");
const phone = css.slice(phoneAt);

assert(
  phone.includes(".accountant-portal:has(.milon-desk) .shell"),
  "the phone block releases the shell",
);
assert(
  phone.includes(".accountant-portal:has(.milon-desk) .milon-desk-scroll"),
  "the phone block releases the desk scroller",
);
assert(/overflow:\s*visible;/.test(phone), "released containers do not clip");
assert(/max-height:\s*none;/.test(phone), "released containers have no height cap");
assert(
  /position:\s*sticky;/.test(phone),
  "the composer sticks to the bottom instead of covering content",
);
assert(
  phone.includes("env(safe-area-inset-bottom"),
  "the sticky composer clears the home indicator",
);

assert(
  !css.includes("box-shadow: 0 -8px 18px rgba(0, 0, 0, 0.45)"),
  "the composer no longer casts a dark fade over the activity list",
);
assert(
  /\.milon-desk-agent-name,[\s\S]*?overflow-wrap:\s*anywhere/.test(css),
  "agent names wrap inside the card",
);

assert(!css.includes("Open agent inside a client"), "agent pages no longer lock the stage to the viewport");
assert(!/overscroll-behavior:\s*contain/.test(css), "nothing on the desk swallows the wheel");
assert(
  !/:has\(#pane-ask\.on\):has\(\.agent-stage\) \.shell \{[^}]*overflow:\s*hidden/.test(css),
  "the agent page shell does not clip to the viewport",
);
const single = css.slice(css.indexOf("Agent pages scroll as one page"));
assert(
  /#ask-ai-accountant \.ask-ai-thread \{[^}]*max-height:\s*min\(60vh, 560px\)/.test(single),
  "the agent chat thread is capped and is the only inner scroll area",
);
assert(
  /\.ask-ai-thread \{[^}]*overscroll-behavior:\s*auto/.test(single),
  "the thread hands the wheel back to the page at either end",
);
assert(
  /\.ask-ai-actions \{[^}]*position:\s*sticky/.test(single),
  "the composer stays visible inside the chat card",
);

console.log("accountant-desk-clip-test: all assertions passed");
