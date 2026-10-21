/**
 * Mint rules for Send an agent. No database and no mail.
 * Run: pnpm test:client-agent-send-mint
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PHYSIO_ITEMS,
  SEND_AGENT_BODY,
  SEND_AGENT_ONCE,
  SEND_EXPIRY_DAYS,
  agentLink,
  newSendToken,
  sendExpiresAt,
  sendStillOpen,
  sha256Hex,
} from "../src/lib/client-agent-send.ts";
import {
  canonicalizeAccountantSearch,
  clientNavSearch,
  clientRailSelection,
} from "../src/lib/client-route-search.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const medical = PHYSIO_ITEMS.find((item) => item.itemKey === "medical_aid_certificate");
assert(medical?.totalsOnly === true, "medical item is totals only");
assert(
  PHYSIO_ITEMS.filter((item) => item.itemKey !== "medical_aid_certificate").every((item) => !item.totalsOnly),
  "other items are not totals only",
);
assert(PHYSIO_ITEMS.length === 5, "five documents");

const now = new Date("2026-10-21T09:00:00.000Z");
const expires = sendExpiresAt(now);
assert(
  expires.getTime() - now.getTime() === SEND_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  "expiry is 14 days",
);
assert(
  sendStillOpen({ revokedAt: null, expiresAt: expires.toISOString() }, now),
  "a fresh link is open",
);
assert(
  !sendStillOpen({ revokedAt: now.toISOString(), expiresAt: expires.toISOString() }, now),
  "a revoked link is closed",
);

const token = newSendToken();
const hash = await sha256Hex(token);
assert(hash.length === 64 && /^[0-9a-f]+$/.test(hash), "hash is sha256 hex");
assert(hash !== token, "the raw token is not the hash");
const link = agentLink("https://www.milonfinance.com", token);
assert(link === `https://www.milonfinance.com/a/${token}`, "link is /a/<token>");
assert(!link.includes("/talk/"), "link is not the public sample");

const copy = `${SEND_AGENT_BODY}\n${SEND_AGENT_ONCE}`;
assert(!/whatsapp/i.test(copy), "accountant copy does not mention WhatsApp");
assert(/does not fill in a form/i.test(copy), "copy says she does not fill in a form");
assert(/does not send a form back/i.test(copy), "copy says she does not return a form");
assert(/does not log into SARS/i.test(copy), "copy says she does not log into SARS");
assert(/does not make a SARS claim/i.test(copy), "copy says she makes no SARS claim");
assert(/Nothing is emailed/i.test(copy), "copy says nothing is emailed");

const fn = read("src/lib/client-agent-send.functions.ts");
const panel = read("src/components/send-agent-panel.tsx");
const route = read("src/routes/_authenticated/clients.$clientId.tsx");
for (const source of [fn, panel]) {
  assert(!/whatsapp/i.test(source), "no WhatsApp in the send-an-agent sources");
  assert(!/from ["']@\/lib\/prospect-talk/.test(source), "does not import the /talk sample");
  assert(!/resend|sendAccessEmail|nodemailer|sendTeamMail/i.test(source), "no mail sender");
}
assert(route.includes("<SendAgentPanel"), "the client file mounts the panel");
assert(route.includes("market={clientMarket}"), "the expiry uses the client market");
assert(panel.includes("formatDate("), "expiry uses the shared date formatter");
assert(!panel.includes("toLocaleDateString"), "expiry is not formatted by locale");
assert(
  route.includes('detail: "A Tax Specialist link for this client. Nothing is emailed."'),
  "the Books link does not offer mail",
);
assert(panel.includes("SilentAgentPortrait"), "the portrait is the silent avatar");
assert(panel.includes("data-send-agent-revoke"), "revoke sits with the link");
assert(panel.includes('face="tax_specialist"'), "Tax Specialist face");
assert(!panel.includes("flex-row"), "the panel stacks vertically");

const nav = clientNavSearch({ tab: "home" }, "books", "send-agent");
assert(nav.tab === "portal" && nav.section === "send-agent", "Send an agent is a Books page");
const rail = clientRailSelection({ tab: "portal", section: "send-agent" });
assert(rail.headingId === "books" && rail.subId === "send-agent", "the rail item is under Books");
const kept = canonicalizeAccountantSearch({ tab: "portal", section: "send-agent" });
assert(kept.section === "send-agent", "the section is not dropped");

const chrome = read("src/components/client-studio-chrome.tsx");
assert(chrome.includes('{ id: "send-agent", label: "Send an agent" }'), "vertical nav label");

console.log("client agent send mint test ok");
