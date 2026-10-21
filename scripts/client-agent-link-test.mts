/**
 * Public /a/<token> rules. No database and no mail.
 * Run: pnpm test:client-agent-link
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SEND_AGENT_FIRM_ALLOWLIST } from "../src/lib/client-agent-send-allowlist.ts";
import { SEND_FILE_MAX_BYTES } from "../src/lib/client-agent-send.ts";
import { isBarePublicPath } from "../src/lib/public-marketing.ts";
import { ClientAgentLinkScreen } from "../src/components/client-agent-link-page.tsx";
import {
  CONSENT_LINK_BODY,
  FILE_LINK_BODY,
  GENERIC_LINK_BODY,
  LIMITED_LINK_BODY,
  CLIENT_AGENT_FILE_NOTE,
  SEND_CONSENT_VERSION,
  SEND_LINK_META,
  clientAgentExpiryLabel,
  clientAgentIntro,
  clientAgentItemHelp,
  clientConsentNotice,
  acceptClientFile,
  bytesFromBase64,
  consentReady,
  consentWrite,
  finishItem,
  gatePresentedSend,
  hashPresentedToken,
  linkLogPath,
  linkPrivacyHeaders,
  mimeAllowed,
  openLinkView,
  pathBelongsToSend,
  practiceDisplayName,
  resolvePresentedLink,
  sendPracticeDisplayName,
  sendAttemptLimited,
  sendLinkLogLine,
  sendStoragePath,
  sizeAllowed,
  storeAcceptedFile,
  toPublicChecklist,
  type PublicChecklistItem,
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

assert(
  sendAttemptLimited(30) && !sendAttemptLimited(29),
  "thirty attempts in the window is the limit",
);
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
assert(
  !pathBelongsToSend(`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/irp5/${objectId}`, sendId, "irp5"),
  "another send is refused",
);

assert(mimeAllowed("image/heic") && !mimeAllowed("image/gif"), "HEIC is allowed and gif is not");
assert(sizeAllowed(20971520) && !sizeAllowed(20971521), "the cap is 20 MiB");
const decoded = bytesFromBase64(btoa("a"));
assert(decoded?.length === 1 && decoded[0] === 97, "file bytes decode from base64");
assert(bytesFromBase64("YQ") === null, "base64 needs padding");
assert(bytesFromBase64("!!!!") === null, "base64 stays in the standard alphabet");
assert(!consentReady(null) && consentReady("2026-10-21T12:00:00.000Z"), "consent is a timestamp");

const rawToken = "raw-token-value-not-stored-0123456789abcd";
const tokenHash = await hashPresentedToken(rawToken);
assert(
  tokenHash !== rawToken && /^[0-9a-f]{64}$/.test(tokenHash),
  "the lookup key is a hash, not the token",
);
assert((await hashPresentedToken(rawToken)) === tokenHash, "the same token hashes the same way");
assert(
  (await hashPresentedToken(`${rawToken}x`)) !== tokenHash,
  "a different token hashes differently",
);

function presented(overrides: {
  ipCount?: number;
  sendCount?: number | null;
  found?: boolean;
  firmId?: string | null;
  revokedAt?: string | null;
  expiresAt?: string;
}) {
  return resolvePresentedLink({
    ipCount: overrides.ipCount ?? 0,
    sendCount: overrides.sendCount === undefined ? 0 : overrides.sendCount,
    found: overrides.found ?? true,
    firmId: overrides.firmId === undefined ? firm : overrides.firmId,
    revokedAt: overrides.revokedAt ?? null,
    expiresAt: overrides.expiresAt ?? later.toISOString(),
    now,
  });
}

const unknownLink = presented({ found: false, firmId: null, sendCount: null, expiresAt: "" });
const expiredLink = presented({ expiresAt: now.toISOString() });
const revokedLink = presented({ revokedAt: now.toISOString() });
const otherFirmLink = presented({ firmId: "00000000-0000-4000-8000-000000000001" });
const closedBody = JSON.stringify(unknownLink.public);
assert(
  closedBody === JSON.stringify(expiredLink.public),
  "an expired token matches the unknown page",
);
assert(
  closedBody === JSON.stringify(revokedLink.public),
  "a revoked token matches the unknown page",
);
assert(
  closedBody === JSON.stringify(otherFirmLink.public),
  "another firm matches the unknown page",
);
assert(
  !unknownLink.public.ok && unknownLink.public.status === 200,
  "the closed page status is 200",
);
assert(unknownLink.public.body === GENERIC_LINK_BODY, "the closed page has one body");
assert(
  expiredLink.outcome === "expired" && revokedLink.outcome === "revoked",
  "the log outcome stays specific",
);
assert(
  unknownLink.outcome === "unknown" && otherFirmLink.outcome === "unknown",
  "another firm is recorded as unknown",
);

const ipKnown = presented({ ipCount: 30, sendCount: 0 });
const ipUnknown = presented({
  ipCount: 30,
  found: false,
  firmId: null,
  sendCount: null,
  expiresAt: "",
});
assert(
  JSON.stringify(ipKnown.public) === JSON.stringify(ipUnknown.public),
  "the IP limit looks the same for a known and an unknown token",
);
assert(
  !ipKnown.public.ok && ipKnown.public.body === LIMITED_LINK_BODY,
  "the IP limit has its own body",
);
assert(
  ipKnown.outcome === "limited" && ipUnknown.outcome === "limited",
  "both IP limits are recorded as limited",
);
const sendLimited = presented({ sendCount: 30 });
assert(sendLimited.outcome === "limited", "thirty attempts on one send is limited");
assert(JSON.stringify(sendLimited.public) === closedBody, "a per-send limit uses the generic page");
assert(
  presented({ ipCount: 29, sendCount: 29 }).outcome === "ok",
  "twenty-nine attempts are still allowed",
);

const consentRow = consentWrite(now);
assert(
  SEND_CONSENT_VERSION === "popia-client-agent-2",
  "the notice version matches the new wording",
);
assert(
  consentRow.consent_notice_version === SEND_CONSENT_VERSION &&
    consentRow.consent_at === now.toISOString(),
  "consent stores the notice version with the timestamp",
);
const practiceNotice = clientConsentNotice("Theo's practice");

const ownItem: PublicChecklistItem = {
  itemKey: "irp5",
  label: "IRP5",
  totalsOnly: false,
  status: "received",
  quality: "incomplete",
  hasFile: true,
};
const beforeConsent = openLinkView({
  consented: false,
  notice: practiceNotice,
  items: [ownItem],
});
assert(
  beforeConsent.consented === false && beforeConsent.items.length === 0,
  "consent comes before the checklist",
);
const afterConsent = openLinkView({
  consented: true,
  notice: practiceNotice,
  items: [ownItem],
});
assert(
  afterConsent.items.length === 1 &&
    afterConsent.items[0].status === "received" &&
    afterConsent.items[0].hasFile,
  "a re-open shows her own checklist status",
);

const otherSend = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const pdfBytes = new TextEncoder().encode("%PDF-1.7\n");
const checklist = toPublicChecklist(
  [
    {
      sendId,
      itemKey: "irp5",
      label: null,
      totalsOnly: false,
      status: "received",
      quality: "usable",
      storagePath: `${sendId}/irp5/${objectId}`,
      firmId: firm,
      fileName: "salary.pdf",
      bytes: pdfBytes,
    },
    {
      sendId: otherSend,
      itemKey: "it3b",
      label: "Other client",
      totalsOnly: false,
      status: "received",
      quality: "poor",
      storagePath: `${otherSend}/it3b/${objectId}`,
      firmId: firm,
      fileName: "other.pdf",
    },
  ],
  sendId,
);
const checklistJson = JSON.stringify(checklist);
assert(checklist.length === 1 && checklist[0].itemKey === "irp5", "only her send is on the page");
assert(
  checklist[0].label === "IRP5 (only if you had a salaried job)",
  "an empty IRP5 label uses the salaried-job wording",
);
assert(!checklistJson.includes(firm), "the firm id is not on the page");
assert(
  !checklistJson.includes("salary.pdf") && !checklistJson.includes("other.pdf"),
  "file names are not on the page",
);
assert(
  !checklistJson.includes("it3b") && !checklistJson.includes(otherSend),
  "another send is not on the page",
);
assert(
  !checklistJson.includes("storagePath") && !("bytes" in checklist[0]),
  "file bytes are not on the page",
);

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const heic = Uint8Array.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
]);
const avif = Uint8Array.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
]);
const gif = new TextEncoder().encode("GIF89a-not-a-photo");
assert(acceptClientFile({ consented: true, bytes: pdfBytes }).ok, "PDF magic bytes are accepted");
const jpegFile = acceptClientFile({ consented: true, bytes: jpeg });
assert(jpegFile.ok && jpegFile.mime === "image/jpeg", "JPEG bytes are accepted with no file name");
const pngFile = acceptClientFile({ consented: true, bytes: png });
assert(pngFile.ok && pngFile.mime === "image/png", "PNG magic bytes are accepted");
const heicFile = acceptClientFile({ consented: true, bytes: heic });
assert(heicFile.ok && heicFile.mime === "image/heic", "HEIC magic bytes are accepted");
assert(!acceptClientFile({ consented: true, bytes: gif }).ok, "GIF bytes are refused");
assert(!acceptClientFile({ consented: true, bytes: avif }).ok, "AVIF bytes are refused");
const tooBig = new Uint8Array(SEND_FILE_MAX_BYTES + 1);
tooBig.set(pdfBytes);
const oversized = acceptClientFile({ consented: true, bytes: tooBig });
assert(!oversized.ok && oversized.reason === "size", "size is refused before a write");
const noConsent = acceptClientFile({ consented: false, bytes: pdfBytes });
assert(!noConsent.ok && noConsent.reason === "consent", "a file before consent is refused");
let writes = 0;
const refused = await storeAcceptedFile(oversized, async () => {
  writes += 1;
  return "stored";
});
assert(!refused.ok && writes === 0, "an oversized file is not written to storage");
const held = await storeAcceptedFile(noConsent, async () => {
  writes += 1;
  return "stored";
});
assert(!held.ok && writes === 0, "a file before consent is not written to storage");
const badType = acceptClientFile({ consented: true, bytes: gif });
const skipped = await storeAcceptedFile(badType, async () => {
  writes += 1;
  return "stored";
});
assert(!skipped.ok && writes === 0, "a file with the wrong magic bytes is not written");
const kept = await storeAcceptedFile(
  acceptClientFile({ consented: true, bytes: pdfBytes }),
  async (file) => {
    writes += 1;
    return file.mime;
  },
);
assert(
  kept.ok && kept.value === "application/pdf" && writes === 1,
  "an accepted PDF is the first write",
);

const leaked = sendLinkLogLine({
  event: "link",
  reason: "save",
  token: rawToken,
  fileName: "salary.pdf",
  explanation: "My practice income was R50000",
  firmId: firm,
});
assert(!leaked.includes(rawToken), "a log line drops the raw token");
assert(!leaked.includes("salary.pdf"), "a log line drops the file name");
assert(
  !leaked.includes("R50000") && !leaked.includes(firm),
  "a log line drops client text and the firm id",
);
assert(linkLogPath(`/a/${rawToken}`) === "/a/[token]", "an access log drops the token in the path");
assert(!linkLogPath(`/a/${rawToken}`).includes(rawToken), "the redacted path has no token");
assert(linkLogPath("/clients/123") === "/clients/123", "other paths stay as they are");

const privacy = linkPrivacyHeaders(`/a/${rawToken}`);
assert(privacy?.["Referrer-Policy"] === "no-referrer", "the link response sends no referrer");
assert(privacy?.["X-Robots-Tag"] === "noindex, nofollow", "the link response is noindex");
assert(linkPrivacyHeaders("/talk/tax-specialist") === null, "other pages keep their own headers");
assert(
  SEND_LINK_META.some(
    (entry) => "name" in entry && entry.name === "robots" && entry.content.includes("noindex"),
  ),
  "the page meta is noindex",
);
assert(
  SEND_LINK_META.some(
    (entry) => "name" in entry && entry.name === "referrer" && entry.content === "no-referrer",
  ),
  "the page meta sends no referrer",
);
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

const noonExpiry = "2026-11-04T12:00:00.000Z";
const lateExpiry = "2026-11-04T23:30:00.000Z";
const intro = clientAgentIntro("Theo's practice", noonExpiry);
const copy = [
  practiceNotice,
  intro,
  clientAgentIntro("Theo's practice", lateExpiry),
  GENERIC_LINK_BODY,
  LIMITED_LINK_BODY,
  CONSENT_LINK_BODY,
  FILE_LINK_BODY,
].join("\n");
assert(
  intro.includes("Hi, I'm the Tax Specialist for Theo's practice."),
  "the intro names the practice",
);
assert(intro.includes("before 4 Nov 2026."), "a midday expiry stays on that Johannesburg day");
assert(
  clientAgentIntro("Theo's practice", lateExpiry).includes("before 5 Nov 2026."),
  "23:30 UTC is the next day in Johannesburg",
);
assert(
  clientAgentExpiryLabel(new Date(lateExpiry)) === "5 Nov 2026",
  "a Date at 23:30 UTC uses Johannesburg",
);
assert(
  practiceNotice ===
    "I agree that Theo's practice may securely store the documents I upload here for my tax file, using Milōn. Medical aid: send the tax certificate totals only.",
  "consent names the practice and drops the internal rules",
);
assert(
  !/sars|fill in a form|send a form back/i.test(copy),
  "client copy drops the internal denials",
);
assert(
  !/completed form|form is ready|return is ready|we will claim/i.test(copy),
  "copy promises no completed form",
);
assert(
  clientAgentItemHelp({ itemKey: "bank_statements" }) ===
    "All business accounts, 1 March 2025 to 28 February 2026.",
  "bank statements use the 2026 year of assessment",
);
assert(
  clientAgentItemHelp({ itemKey: "medical_aid_certificate" }) ===
    "Totals only. Do not send a line-by-line breakdown.",
  "medical aid stays totals only",
);
assert(!clientAgentItemHelp({ itemKey: "irp5" }).includes("PDF"), "a row does not list file types");
assert(!/\b(stupid|idiot|asap|illegal|failure)\b/i.test(copy), "copy stays polite");
assert(!/whatsapp/i.test(copy), "copy does not mention WhatsApp");

const fn = read("src/lib/client-agent-link.functions.ts");
const page = read("src/components/client-agent-link-page.tsx");
const route = read("src/routes/a.$token.tsx");
const server = read("src/server.ts");
const sql = read("supabase/migrations/20261022120000_client_agent_send_storage.sql");
const proof = read("scripts/client-agent-send-storage-sql-tests.sql");
const ci = read(".github/workflows/ci.yml");
assert(fn.includes("resolvePresentedLink"), "the server uses the public link decision");
assert(fn.includes("sendAgentFirmAllowed"), "the server gates the firm");
assert(
  fn.includes("recentAttempts") && fn.includes("recentSendAttempts"),
  "rate limits count IP and send attempts",
);
assert(fn.includes("client_agent_send_attempts"), "attempts are recorded");
assert(
  fn.includes("acceptClientFile") && fn.includes("storeAcceptedFile"),
  "storage waits for the file decision",
);
assert(fn.includes("consentWrite"), "consent writes the notice version");
assert(!fn.includes("error.message"), "database errors are not copied into logs");
assert(!fn.includes("data.mime"), "declared MIME is not the file check");
assert(fn.includes("sendStoragePath"), "the object path is built on the server");
assert(fn.includes("bytesFromBase64"), "the server accepts file bytes");
assert(fn.includes(".upload("), "uploads go through the service role");
assert(fn.includes(".download("), "downloads go through the service role");
assert(
  !/createSignedUploadUrl|createSignedUrl|getPublicUrl|uploadUrl/.test(fn + page),
  "the browser gets no storage URL",
);
assert(!/method:\s*"PUT"/.test(page), "the page does not write to storage itself");
assert(!/path:\s*z\.string/.test(fn), "the client does not choose the object path");
assert(!/requireSupabaseAuth/.test(fn), "the public route does not ask for a login");
assert(
  !/resend|sendAccessEmail|nodemailer|sendTeamMail|extract-source-document|decide_ledger/i.test(fn),
  "no mail, extraction, or ledger",
);
assert(!/whatsapp/i.test(page + route), "the page does not mention WhatsApp");
assert(
  !/sars|fill in a form|send a form back/i.test(page),
  "the page does not recite internal denials",
);
assert(page.includes("clientAgentIntro"), "the intro is the friendly line");
assert(page.includes("CLIENT_AGENT_FILE_NOTE"), "file types are one note");
assert(fn.includes("clientConsentNotice"), "consent wording includes the practice");
assert(fn.includes("expiresAt: send.expires_at"), "the page receives the expiry instant");
assert(!/has expired|been revoked/i.test(page), "the page has one closed sentence");
assert(!page.includes("file.name"), "the page does not read the file name");
assert(route.includes("SEND_LINK_META"), "the route uses the noindex meta");
assert(
  server.includes("linkPrivacyHeaders") && server.includes("linkLogPath"),
  "the server sets privacy headers and redacts the path",
);
assert(!page.includes("SilentAgentPortrait"), "the stacked talk portrait is gone");
assert((page.match(/<OwnerAvatar/g) ?? []).length === 1, "exactly one portrait");
assert(page.includes('agent="tax_specialist"'), "Tax Specialist face");
assert(page.includes('size="lg"'), "the portrait uses the agent card size");
assert(page.includes('variant="character"'), "the portrait is the round character");
assert(
  !page.includes("<video") && !page.includes("<audio") && !page.includes("autoPlay"),
  "the page adds no audio or autoplay",
);
assert(!/#(?:d4a550|c4a35a|b7791f)/i.test(page), "the page has no gold primary");
const portraitAt = page.indexOf("data-client-portrait");
const portraitSource = page.slice(Math.max(0, portraitAt - 240), page.indexOf("</span>", portraitAt));
assert(!portraitSource.includes("w-full"), "the portrait is not full width");
assert(portraitSource.includes("-ml-3"), "the portrait circle lines up with the text");
const avatarCss = read("src/components/owner-door/owner-door.css");
assert(
  /@media \(max-width: 760px\) \{[\s\S]*\.owner-presence\.is-lg \{\s*width: 96px;\s*height: 96px;/.test(
    avatarCss,
  ),
  "the agent card portrait is 96px on a narrow screen",
);
assert(!page.includes("flex-row"), "the page stacks vertically");
assert(page.includes("I agree"), "consent comes first");
assert(page.includes("I don't have this"), "the client can skip an item");
assert(page.includes("Only upload what you have"), "the list says to upload only what they have");
assert(/>\s*Upload\s*</.test(page), "each item has an upload button");
assert(page.includes("min-h-11"), "tap targets are at least 44px");
assert(page.includes('data-upload-tick="true"'), "an uploaded item shows a tick");
assert(!page.includes("This is all I have"), "the old skip label is gone");
assert(page.includes("uploadClientAgentFile"), "the page sends the file to the server");
assert(route.includes('createFileRoute("/a/$token")'), "the public path is /a/<token>");
assert(isBarePublicPath("/a/abc"), "the link page skips the signed-in shell");
const sqlCode = sql
  .split("\n")
  .map((line) => line.split("--")[0])
  .join("\n")
  .toLowerCase();
assert(sqlCode.includes("public = false"), "the bucket is private");
assert(!/\bcreate\s+policy\b/.test(sqlCode), "the bucket migration creates no policy");
assert(!/\bgrant\b/.test(sqlCode), "the bucket migration does not grant");
assert(!/\brevoke\b/.test(sqlCode), "the bucket migration does not revoke storage privileges");
assert(sqlCode.includes("drop policy"), "a policy that names the bucket is removed");
assert(proof.includes("SET LOCAL ROLE anon"), "the proof uses the anon role");
assert(proof.includes("SET LOCAL ROLE authenticated"), "the proof uses the authenticated role");
assert(
  proof.includes("anon must not read client-agent-sends"),
  "the proof fails when anon can read",
);
assert(
  proof.includes("authenticated must not read client-agent-sends"),
  "the proof fails when authenticated can read",
);
assert(ci.includes("apply-client-agent-send-storage-sql.sh"), "CI runs the bucket proof");

const practiceSql = read("supabase/migrations/20261022143000_client_agent_send_practice_name.sql");
assert(
  practiceSql.includes("practice_display_name text"),
  "the practice name column is nullable text",
);
assert(
  practiceSql.includes("ADD COLUMN IF NOT EXISTS practice_display_name"),
  "the column is added on the send",
);
assert(
  practiceSql.includes("Theo''s practice"),
  "existing sends for this firm show Theo's practice",
);
assert(!/update\s+public\.firms/i.test(practiceSql), "the firm row is not renamed");
assert(!/alter\s+table\s+public\.firms/i.test(practiceSql), "the firm table is not altered");
assert(practiceSql.includes("recipient_first_name text"), "the first name column is nullable text");
assert(
  /length\(btrim\(recipient_first_name\)\) >= 1[\s\S]*length\(btrim\(recipient_first_name\)\) <= 60/.test(
    practiceSql,
  ),
  "a stored first name is 1 to 60 characters once trimmed",
);
const allowlisted = SEND_AGENT_FIRM_ALLOWLIST[0];
assert(
  practiceDisplayName({
    firmId: allowlisted,
    practiceDisplayName: null,
    firmName: "My practice",
  }) === "Theo's practice",
  "an empty display name still shows Theo's practice",
);
assert(
  practiceDisplayName({
    firmId: allowlisted,
    practiceDisplayName: "Harbour Books",
    firmName: "My practice",
  }) === "Harbour Books",
  "a stored practice name wins over the firm name",
);
assert(
  practiceDisplayName({
    firmId: "00000000-0000-4000-8000-000000000001",
    practiceDisplayName: null,
    firmName: "My practice",
  }) === "My practice",
  "another firm falls back to its firm name",
);
assert(
  sendPracticeDisplayName(allowlisted) === "Theo's practice",
  "a new send stores Theo's practice",
);
assert(fn.includes("practice_display_name"), "the public lookup reads the practice name");
assert(fn.includes("practiceDisplayName"), "the page name falls back in one place");

const consentHtml = renderToStaticMarkup(
  createElement(ClientAgentLinkScreen, {
    view: {
      ok: true,
      practiceName: "Theo's practice",
      expiresAt: lateExpiry,
      consented: false,
      notice: practiceNotice,
      items: [],
    },
    busy: false,
    notice: null,
    noteFor: null,
    explanation: "",
    onAgree: () => undefined,
    onPickFile: () => undefined,
    onOpenNote: () => undefined,
    onExplanation: () => undefined,
    onSaveNote: () => undefined,
  }),
);
assert(
  (consentHtml.match(/data-client-portrait="tax_specialist"/g) ?? []).length === 1,
  "one portrait renders",
);
assert(
  (consentHtml.match(/data-agent="tax_specialist"/g) ?? []).length === 1,
  "one agent face renders",
);
assert(
  !consentHtml.includes("<video") && !consentHtml.includes("<audio"),
  "the still portrait has no media element",
);
assert(
  consentHtml.includes("Theo&#x27;s practice") || consentHtml.includes("Theo's practice"),
  "the consent page shows the practice",
);
assert(consentHtml.includes("I agree"), "consent renders the agreement button");
const checklistHtml = renderToStaticMarkup(
  createElement(ClientAgentLinkScreen, {
    view: {
      ok: true,
      practiceName: "Theo's practice",
      expiresAt: lateExpiry,
      consented: true,
      notice: practiceNotice,
      items: [
        {
          itemKey: "practice_income_expenses",
          label: "Practice income and expenses",
          totalsOnly: false,
          status: "received",
          quality: "usable",
          hasFile: true,
        },
        {
          itemKey: "medical_aid_certificate",
          label: "Medical aid tax certificate (totals only)",
          totalsOnly: true,
          status: "open",
          quality: null,
          hasFile: false,
        },
      ],
    },
    busy: false,
    notice: null,
    noteFor: "medical_aid_certificate",
    explanation: "",
    onAgree: () => undefined,
    onPickFile: () => undefined,
    onOpenNote: () => undefined,
    onExplanation: () => undefined,
    onSaveNote: () => undefined,
  }),
);
assert((checklistHtml.match(/data-upload-tick/g) ?? []).length === 1, "one uploaded tick renders");
assert(
  checklistHtml.includes("I don&#x27;t have this") || checklistHtml.includes("I don't have this"),
  "the skip link renders",
);
assert(checklistHtml.includes("data-missing-note"), "the optional note renders");
assert(checklistHtml.includes("Only upload what you have"), "the checklist intro renders");
assert(
  (checklistHtml.match(/PDF, JPG, PNG or HEIC, up to 20 MB each/g) ?? []).length === 1,
  "file types appear once",
);
assert(checklistHtml.includes(CLIENT_AGENT_FILE_NOTE), "the file note is the shared sentence");
assert(consentHtml.includes("before 5 Nov 2026"), "the consent page shows the Johannesburg expiry");
assert(!/sars|fill in a form/i.test(consentHtml), "the rendered consent drops internal denials");

console.log("client agent link test ok");
