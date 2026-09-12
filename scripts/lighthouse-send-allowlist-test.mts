/**
 * Lighthouse send allowlist — Day-0 dry-run recipient gate.
 * Run: pnpm test:lighthouse-send-allowlist
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LIGHTHOUSE_DEFAULT_DRY_RUN_INBOXES,
  assertLighthouseSendRecipientAllowed,
  lighthouseSendAllowlist,
  lighthouseSendAllowlistEnforced,
} from "../src/lib/lighthouse-send-allowlist";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const savedDryRun = process.env.LIGHTHOUSE_DRY_RUN;
const savedList = process.env.LIGHTHOUSE_SEND_ALLOWLIST;

function restoreEnv() {
  if (savedDryRun === undefined) delete process.env.LIGHTHOUSE_DRY_RUN;
  else process.env.LIGHTHOUSE_DRY_RUN = savedDryRun;
  if (savedList === undefined) delete process.env.LIGHTHOUSE_SEND_ALLOWLIST;
  else process.env.LIGHTHOUSE_SEND_ALLOWLIST = savedList;
}

try {
  delete process.env.LIGHTHOUSE_DRY_RUN;
  delete process.env.LIGHTHOUSE_SEND_ALLOWLIST;
  assert(lighthouseSendAllowlist() === null, "no env → unrestricted");
  assert(!lighthouseSendAllowlistEnforced(), "no env → not enforced");
  assertLighthouseSendRecipientAllowed("anyone@example.com");

  process.env.LIGHTHOUSE_DRY_RUN = "true";
  const dryList = lighthouseSendAllowlist();
  assert(dryList !== null && dryList.length === 5, "dry-run → five defaults");
  assert(
    dryList!.every((e) =>
      (LIGHTHOUSE_DEFAULT_DRY_RUN_INBOXES as readonly string[]).includes(e),
    ),
    "defaults match Day-0 inboxes",
  );
  assert(lighthouseSendAllowlistEnforced(), "dry-run → enforced");
  assertLighthouseSendRecipientAllowed("amstel.west@gmail.com");
  assertLighthouseSendRecipientAllowed("  TEAM@milon.co.za  ");
  assertLighthouseSendRecipientAllowed("team@trymilon.com");
  let blocked = false;
  try {
    assertLighthouseSendRecipientAllowed("partner@accountingfirm.co.za");
  } catch (e) {
    blocked = e instanceof Error && e.message.includes("Send blocked");
  }
  assert(blocked, "firm email blocked under dry-run");

  delete process.env.LIGHTHOUSE_DRY_RUN;
  process.env.LIGHTHOUSE_SEND_ALLOWLIST = "one@test.com, two@test.com ";
  assert(lighthouseSendAllowlist()?.join(",") === "one@test.com,two@test.com", "explicit list trims");
  assertLighthouseSendRecipientAllowed("two@test.com");
  blocked = false;
  try {
    assertLighthouseSendRecipientAllowed("amstel.west@gmail.com");
  } catch {
    blocked = true;
  }
  assert(blocked, "explicit list overrides defaults — founder inbox not implicit");

  const fns = readFileSync(resolve("src/lib/lighthouse.functions.ts"), "utf8");
  assert(fns.includes("assertLighthouseSendRecipientAllowed"), "send fn uses allowlist guard");

  const panel = readFileSync(resolve("src/components/lighthouse-panel.tsx"), "utf8");
  assert(panel.includes("sendAllowlistEnforced"), "ops UI surfaces dry-run banner");

  console.log("lighthouse-send-allowlist-test: ok");
} finally {
  restoreEnv();
}
