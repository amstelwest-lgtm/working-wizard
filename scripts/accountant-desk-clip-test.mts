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
assert(
  phone.includes(".accountant-portal:has(#pane-ask.on):has(.agent-stage) .shell"),
  "the phone block releases the agent page lock",
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
assert(css.includes("height: 100dvh;"), "the desktop lock uses the dynamic viewport height");
assert(
  /\.milon-desk-agent-name,[\s\S]*?overflow-wrap:\s*anywhere/.test(css),
  "agent names wrap inside the card",
);

const openAgent = css.slice(css.indexOf("Open agent inside a client"));
assert(
  openAgent.includes(".milon-desk-host > .agent-stage"),
  "the open agent stage joins the column",
);
assert(
  /\.agent-stage \{[^}]*min-height:\s*0/.test(openAgent),
  "the open agent stage can shrink instead of clipping",
);
assert(openAgent.includes(".ask-ai-thread"), "the open agent thread is part of the column");
assert(
  /\.ask-ai-thread \{[^}]*max-height:\s*none/.test(openAgent),
  "the open agent thread is not stuck at a short cap",
);
assert(
  openAgent.includes(".owner-presence.is-stage"),
  "the stage face does not consume the column",
);
assert(phone.includes(".ask-ai-thread"), "on a phone the thread still scrolls above the composer");
assert(
  /\.ask-ai-thread \{[^}]*overflow:\s*auto/.test(phone),
  "the phone thread scrolls its own messages",
);

console.log("accountant-desk-clip-test: all assertions passed");
