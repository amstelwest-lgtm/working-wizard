/**
 * Public /a/<token> rules. No database and no mail.
 * Run: pnpm test:client-agent-link
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEND_AGENT_FIRM_ALLOWLIST } from "../src/lib/client-agent-send-allowlist.ts";
import { isBarePublicPath } from "../src/lib/public-marketing.ts";
import {
  SEND_CONSENT_NOTICE,
  SEND_LINK_BODY,
  consentReady,
  finishItem,
  gatePresentedSend,
  mimeAllowed,
  pathBelongsToSend,
  sendAttemptLimited,
  sendStoragePath,
  sizeAllowed,
  storedMimeAllowed,
} from "../src/lib/client-agent-link.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const firm = SEND_AGENT_FIRM_ALLOWLIST[0];
const now = new Date("2026-10-21T12:00:00.000Z");
const later = new Date("2026-11-04T12:00:00.000Z");
const sendId = "88888888-8888-4888-8888-888888888888";

assert(sendAttemptLimited(30) && !sendAttemptLimited(29), "thirty attempts in the window is the limit");
assert(
  gatePresentedSend({
    limited: true,
    found: true,
    firmId: firm,
    revokedAt: null,
    expiresAt: later.toISOString(),
    now,
  }) === "limited",
  "the limit is checked first",
);
assert(
  gatePresentedSend({
    limited: false,
    found: true,
    firmId: "00000000-0000-4000-8000-000000000001",
    revokedAt: null,
    expiresAt: later.toISOString(),
    now,
  }) === "unavailable",
  "a token from another firm is not available",
);
assert(
  gatePresentedSend({
    limited: false,
    found: false,
    firmId: null,
    revokedAt: null,
    expiresAt: later.toISOString(),
    now,
  }) === "unavailable",
  "an unknown token is not available",
);
assert(
  gatePresentedSend({
    limited: false,
    found: true,
    firmId: firm,
    revokedAt: now.toISOString(),
    expiresAt: later.toISOString(),
    now,
  }) === "revoked",
  "a revoked link is refused",
);
assert(
  gatePresentedSend({
    limited: false,
    found: true,
    firmId: firm,
    revokedAt: null,
    expiresAt: now.toISOString(),
    now,
  }) === "expired",
  "an expired link is refused",
);
assert(
  gatePresentedSend({
    limited: false,
    found: true,
    firmId: firm,
    revokedAt: null,
    expiresAt: later.toISOString(),
    now,
  }) === "ok",
  "My practice can open a live link",
);

const objectId = "99999999-9999-4999-8999-999999999999";
const path = sendStoragePath(sendId, "irp5", objectId);
assert(path === `${sendId}/irp5/${objectId}`, "the path is built from the send id");
assert(pathBelongsToSend(path, sendId, "irp5"), "the path matches that send and item");
assert(!pathBelongsToSend(`${sendId}/irp5/../secret`, sendId, "irp5"), "a path cannot climb");
assert(!pathBelongsToSend(`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/irp5/${objectId}`, sendId, "irp5"), "another send is refused");

assert(mimeAllowed("image/heic") && !mimeAllowed("image/gif"), "HEIC is allowed and gif is not");
assert(sizeAllowed(20971520) && !sizeAllowed(20971521), "the cap is 20 MiB");
assert(storedMimeAllowed("image/heic", "application/octet-stream"), "a generic stored type can be HEIC");
assert(!storedMimeAllowed("image/jpeg", "image/gif"), "a gif object is refused");
assert(!consentReady(null) && consentReady("2026-10-21T12:00:00.000Z"), "consent is a timestamp");
assert(
  finishItem({ quality: "incomplete", explanation: "   ", hasFile: true }).ok === false,
  "incomplete needs an explanation",
);
assert(
  finishItem({ quality: "poor", explanation: "The scan is cut off.", hasFile: true }).ok === true,
  "a poor file is kept with the explanation",
);
assert(
  finishItem({ quality: "usable", explanation: null, hasFile: false }).ok === false,
  "usable without a file is empty",
);

const copy = `${SEND_CONSENT_NOTICE}\n${SEND_LINK_BODY}`;
assert(/does not fill in a form/i.test(copy), "copy says she does not fill in a form");
assert(/does not send a form back/i.test(copy), "copy says she does not return a form");
assert(/does not log into SARS/i.test(copy), "copy says she does not log into SARS");
assert(/does not make a SARS claim/i.test(copy), "copy says she makes no SARS claim");
assert(!/whatsapp/i.test(copy), "copy does not mention WhatsApp");

const fn = read("src/lib/client-agent-link.functions.ts");
const page = read("src/components/client-agent-link-page.tsx");
const route = read("src/routes/a.$token.tsx");
const sql = read("supabase/migrations/20261022120000_client_agent_send_storage.sql");
assert(fn.includes("sendAgentFirmAllowed") || fn.includes("gatePresentedSend"), "the server gates the firm");
assert(fn.includes("client_agent_send_attempts"), "attempts are recorded");
assert(fn.includes("createSignedUploadUrl"), "uploads are signed by the service role");
assert(!/requireSupabaseAuth/.test(fn), "the public route does not ask for a login");
assert(!/resend|sendAccessEmail|nodemailer|sendTeamMail|extract-source-document|decide_ledger/i.test(fn), "no mail, extraction, or ledger");
assert(!/whatsapp/i.test(page + route), "the page does not mention WhatsApp");
assert(page.includes("SilentAgentPortrait"), "the portrait is silent");
assert(page.includes('face="tax_specialist"'), "Tax Specialist face");
assert(!page.includes("flex-row"), "the page stacks vertically");
assert(page.includes("I agree"), "consent comes first");
assert(page.includes("This is all I have"), "the client can say that is all they have");
assert(route.includes('createFileRoute("/a/$token")'), "the public path is /a/<token>");
assert(isBarePublicPath("/a/abc"), "the link page skips the signed-in shell");
assert(sql.includes("public = false") || sql.includes("\n  false,"), "the bucket is private");
assert(!/create policy/i.test(sql), "the bucket has no anon or authenticated policy");
assert(!/to anon/i.test(sql), "the bucket does not grant anon");

console.log("client agent link test ok");
