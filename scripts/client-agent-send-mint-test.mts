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
  SEND_DEFAULT_ITEM_KEYS,
  SEND_EXPIRY_DAYS,
  SEND_ITEM_KEYS,
  SEND_ITEM_LABELS,
  SEND_OTHER_LABEL_MAX,
  agentLink,
  chooseSendItems,
  newSendToken,
  recipientEmail,
  recipientFirstName,
  sendExpiresAt,
  sendStillOpen,
  sha256Hex,
} from "../src/lib/client-agent-send.ts";
import {
  canonicalizeAccountantSearch,
  clientNavSearch,
  clientRailSelection,
} from "../src/lib/client-route-search.ts";
import {
  SEND_AGENT_FIRM_ALLOWLIST,
  sendAgentFirmAllowed,
} from "../src/lib/client-agent-send-allowlist.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const medical = PHYSIO_ITEMS.find((item) => item.itemKey === "medical_aid_certificate");
assert(medical?.totalsOnly === true, "medical item is totals only");
assert(
  PHYSIO_ITEMS.filter((item) => item.itemKey !== "medical_aid_certificate").every(
    (item) => !item.totalsOnly,
  ),
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
assert(/address you confirm/i.test(copy), "copy says the accountant confirms the address");
assert(!/Nothing is emailed/i.test(copy), "copy no longer says nothing is emailed");

const myPractice = "fca0f102-a597-4ec6-8f45-825c57f78797";
assert(SEND_AGENT_FIRM_ALLOWLIST.length === 1, "only one firm is allowlisted");
assert(SEND_AGENT_FIRM_ALLOWLIST[0] === myPractice, "the allowlist is My practice");
assert(sendAgentFirmAllowed(myPractice), "My practice may send an agent");
assert(!sendAgentFirmAllowed("fca0f102"), "a prefix is not the firm id");
assert(!sendAgentFirmAllowed("00000000-0000-4000-8000-000000000001"), "another firm is refused");
assert(
  !sendAgentFirmAllowed(null) && !sendAgentFirmAllowed(undefined),
  "a missing firm is refused",
);

const fn = read("src/lib/client-agent-send.functions.ts");
assert(
  fn.split("sendAgentFirmAllowed").length - 1 >= 3,
  "list, mint, and revoke check the allowlist",
);
const mintBody = fn.slice(
  fn.indexOf("export const mintClientAgentSend"),
  fn.indexOf("export const revokeClientAgentSend"),
);
assert(
  mintBody.indexOf("sendAgentFirmAllowed") < mintBody.indexOf(".insert("),
  "mint refuses a firm before it writes",
);
const revokeBody = fn.slice(fn.indexOf("export const revokeClientAgentSend"));
assert(
  revokeBody.indexOf("sendAgentFirmAllowed") < revokeBody.indexOf(".update("),
  "revoke refuses a firm before it writes",
);
const panel = read("src/components/send-agent-panel.tsx");
const route = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(route.includes("sendAgentFirmAllowed(client.firm_id)"), "the client file hides the action");
assert(
  route.includes("showSendAgent={sendAgentFirmAllowed(client.firm_id)}"),
  "the rail hides the action",
);
for (const source of [fn, panel]) {
  assert(!/whatsapp/i.test(source), "no WhatsApp in the send-an-agent sources");
  assert(!/from ["']@\/lib\/prospect-talk/.test(source), "does not import the /talk sample");
  assert(!/sendAccessEmail|nodemailer|sendTeamMail/i.test(source), "no shared mail sender");
  assert(!/console\./.test(source), "the send path does not log");
}
assert(!/https:\/\/api\.resend\.com/.test(fn), "mint does not call Resend itself");
assert(panel.includes("Client first name"), "the dialog has an optional first name");
assert(panel.includes("Confirm this address"), "the accountant confirms the email");
assert(/>\s*Send\s*</.test(panel), "the button is Send");
assert(panel.includes("recipientEmail: email"), "Send posts the confirmed address");
assert(panel.includes("recipientFirstName: firstName"), "Send posts the first name");
assert(panel.includes("items: chosen.items.map"), "Send posts the chosen documents");
assert(panel.includes('type="checkbox"'), "the dialog picks documents with checkboxes");
assert(panel.includes("send-agent-other-label"), "other has a label field");
assert(panel.includes("min-h-11"), "rows keep a 44px tap target");
assert(panel.includes("SEND_DEFAULT_ITEM_KEYS"), "the current five start ticked");
assert(panel.includes("SEND_ITEM_KEYS.map"), "the picker lists every allowed document");
const effect = panel.slice(panel.indexOf("useEffect"), panel.indexOf("const open"));
assert(!effect.includes("mint("), "mail is not sent on load");
const listBody = fn.slice(
  fn.indexOf("export const listClientAgentSends"),
  fn.indexOf("export type MintAgentSendResult"),
);
const revokeBodyEarly = fn.slice(fn.indexOf("export const revokeClientAgentSend"));
assert(!listBody.includes("sendClientAgentInvite"), "listing does not email");
assert(!revokeBodyEarly.includes("sendClientAgentInvite"), "revoke does not email");
assert(
  mintBody.indexOf("sendAgentFirmAllowed") < mintBody.indexOf("sendClientAgentInvite"),
  "mail waits until the firm is allowed",
);
assert(
  mintBody.includes("recipient_first_name: firstName.name"),
  "the given name is stored trimmed",
);
assert(
  mintBody.includes("practice_display_name: storedPracticeName"),
  "a new send stores practice_display_name",
);
assert(
  mintBody.includes("sendPracticeDisplayName(firm.firmId)"),
  "the stored practice name is the firm override",
);
assert(
  mintBody.includes("recipientEmail(data.recipientEmail)"),
  "the address is trimmed on the server",
);
assert(
  mintBody.indexOf("sendAgentFirmAllowed") < mintBody.indexOf("chooseSendItems"),
  "the item list is checked after the allowlist",
);
assert(
  mintBody.indexOf("chooseSendItems") < mintBody.indexOf(".insert("),
  "a bad item list is refused before anything is written",
);
assert(mintBody.includes("label: item.label"), "the chosen label is stored");
assert(mintBody.includes("totals_only: item.totalsOnly"), "medical aid stays totals only");
assert(route.includes("<SendAgentPanel"), "the client file mounts the panel");
assert(route.includes("market={clientMarket}"), "the expiry uses the client market");
assert(panel.includes("formatDate("), "expiry uses the shared date formatter");
assert(!panel.includes("toLocaleDateString"), "expiry is not formatted by locale");
assert(
  route.includes('detail: "A Tax Specialist invite for this client."'),
  "the Books link offers the invite",
);
const nicola = recipientFirstName("  Nicola  ");
assert(nicola.ok && nicola.name === "Nicola", "the first name is trimmed");
const blank = recipientFirstName("   ");
assert(blank.ok && blank.name === null, "a blank first name is omitted");
assert(!recipientFirstName("n".repeat(61)).ok, "a long first name is refused");
assert(recipientEmail("  Nicola@Example.com ") === "nicola@example.com", "the address is trimmed");
assert(recipientEmail("not-an-email") === null, "a bad address is refused");
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

const sql = read("supabase/migrations/20261021210000_client_agent_sends.sql");
const check = sql.slice(
  sql.indexOf("item_key text NOT NULL CHECK (item_key IN ("),
  sql.indexOf("label text,"),
);
const constraintKeys = [...check.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
assert(constraintKeys.length === SEND_ITEM_KEYS.length, "the picker lists every allowed key");
for (const itemKey of SEND_ITEM_KEYS) {
  assert(constraintKeys.includes(itemKey), `${itemKey} is allowed by the database`);
}
assert(sql.includes("length(label) <= 200"), "other labels fit the 200 character check");
assert(SEND_OTHER_LABEL_MAX === 200, "the label field matches the database");

const defaults = chooseSendItems(SEND_DEFAULT_ITEM_KEYS.map((itemKey) => ({ itemKey })));
assert(defaults.ok, "the five defaults are accepted");
if (defaults.ok) {
  assert(
    defaults.items.map((item) => item.itemKey).join() === [...SEND_DEFAULT_ITEM_KEYS].join(),
    "defaults stay the current five",
  );
  assert(
    defaults.items.find((item) => item.itemKey === "medical_aid_certificate")?.totalsOnly === true,
    "the default medical item is totals only",
  );
  assert(
    defaults.items
      .filter((item) => item.itemKey !== "medical_aid_certificate")
      .every((item) => !item.totalsOnly),
    "the other defaults are not totals only",
  );
  assert(
    defaults.items.every((item) => item.label === SEND_ITEM_LABELS[item.itemKey]),
    "default labels are the plain names",
  );
}

const custom = chooseSendItems([
  { itemKey: "bank_statements", label: "ignored" },
  { itemKey: "other", label: "  Trust deed  " },
]);
assert(custom.ok, "a custom selection is accepted");
if (custom.ok) {
  assert(custom.items.length === 2, "only the ticked documents are stored");
  assert(custom.items[0]?.label === SEND_ITEM_LABELS.bank_statements, "a known label is not overwritten");
  assert(custom.items[0]?.totalsOnly === false, "bank statements are not totals only");
  assert(custom.items[1]?.itemKey === "other" && custom.items[1].label === "Trust deed", "other stores the trimmed label");
  assert(custom.items[1].totalsOnly === false, "other is not totals only");
}

const empty = chooseSendItems([]);
assert(!empty.ok && empty.reason === "empty", "an empty list is refused");
const missing = chooseSendItems(undefined);
assert(!missing.ok && missing.reason === "empty", "a missing list is refused");
const unknown = chooseSendItems([{ itemKey: "sars_return" }]);
assert(!unknown.ok && unknown.reason === "items", "an unknown key is refused");
const duplicate = chooseSendItems([{ itemKey: "irp5" }, { itemKey: "irp5" }]);
assert(!duplicate.ok && duplicate.reason === "items", "a duplicate key is refused");
const blankOther = chooseSendItems([{ itemKey: "other", label: "   " }]);
assert(!blankOther.ok && blankOther.reason === "other", "other needs a label");
const longOther = chooseSendItems([{ itemKey: "other", label: "n".repeat(201) }]);
assert(!longOther.ok && longOther.reason === "other", "a long other label is refused");

console.log("client agent send mint test ok");
