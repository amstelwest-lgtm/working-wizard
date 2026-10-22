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
import {
  CLIENT_AGENT_LOAD_ERROR,
  CLIENT_AGENT_NEXT_HINT,
  ClientAgentLinkScreen,
} from "../src/components/client-agent-link-page.tsx";
import {
  CONSENT_LINK_BODY,
  FILE_LINK_BODY,
  GENERIC_LINK_BODY,
  LIMITED_LINK_BODY,
  REVOKED_LINK_BODY,
  closedLink,
  CLIENT_AGENT_FILE_NOTE,
  CLIENT_AGENT_PASSWORD_UNSAVED,
  SEND_CONSENT_VERSION,
  SEND_LINK_META,
  CLIENT_AGENT_CHAT_ENABLED,
  CLIENT_AGENT_FAQ_TITLE,
  checklistReady,
  clientAgentChecklistIntro,
  clientAgentExpiryLabel,
  clientAgentFaq,
  clientAgentFaqClose,
  clientAgentIntro,
  clientAgentItemHelp,
  clientAgentThanks,
  completionDecision,
  clientConsentNotice,
  acceptClientFile,
  bytesFromBase64,
  consentReady,
  consentWrite,
  confirmStoredObject,
  declareUpload,
  finishItem,
  gatePresentedSend,
  hashPresentedToken,
  linkLogPath,
  linkPrivacyHeaders,
  mimeAllowed,
  openLinkView,
  pathBelongsToSend,
  practiceDisplayName,
  readUploadGrant,
  resolvePresentedLink,
  sanitizeClientFileName,
  signUploadGrant,
  sendPracticeDisplayName,
  sendAttemptLimited,
  sendLinkLogLine,
  sendStoragePath,
  sizeAllowed,
  storeAcceptedFile,
  itemNotAvailable,
  itemSettled,
  toPublicChecklist,
  type PublicChecklistItem,
} from "../src/lib/client-agent-link.ts";
import {
  CLIENT_AGENT_CHAT_FALLBACK,
  CLIENT_AGENT_CHAT_REFUSAL,
  CLIENT_AGENT_CHAT_SYSTEM,
  clientAgentChatDecision,
  clientAgentChatReply,
  guideDocumentQuestion,
} from "../src/lib/client-agent-chat.ts";
import {
  filePasswordKey,
  openFilePassword,
  sealFilePassword,
} from "../src/lib/client-agent-file-secret.ts";

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
  sendFailureCount?: number | null;
  found?: boolean;
  firmId?: string | null;
  revokedAt?: string | null;
  expiresAt?: string;
}) {
  return resolvePresentedLink({
    ipCount: overrides.ipCount ?? 0,
    sendCount: overrides.sendCount === undefined ? 0 : overrides.sendCount,
    sendFailureCount: overrides.sendFailureCount ?? 0,
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
  !revokedLink.public.ok &&
    revokedLink.public.reason === "revoked" &&
    revokedLink.public.body === REVOKED_LINK_BODY &&
    revokedLink.public.status === 200,
  "a revoked token says the link was replaced",
);
assert(
  !JSON.stringify(revokedLink.public).includes("revoked_at") &&
    revokedLink.public.body !== GENERIC_LINK_BODY,
  "a revoked token does not leak the row",
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
const sendSuccesses = presented({ sendCount: 30, sendFailureCount: 0 });
assert(sendSuccesses.outcome === "ok", "successful attempts on an open send stay open");
assert(
  sendSuccesses.public.ok === true,
  "a full checklist of successes is not the closed page",
);
const sendFailures = presented({ sendCount: 12, sendFailureCount: 30 });
assert(sendFailures.outcome === "limited", "thirty failed attempts on one send is limited");
assert(
  !sendFailures.public.ok &&
    sendFailures.public.body === LIMITED_LINK_BODY &&
    sendFailures.public.body !== GENERIC_LINK_BODY,
  "a per-send limit asks them to wait",
);
const sendVolume = presented({ sendCount: 300, sendFailureCount: 0 });
assert(sendVolume.outcome === "limited", "three hundred attempts on one send is limited");
assert(
  !sendVolume.public.ok && sendVolume.public.body === LIMITED_LINK_BODY,
  "the higher ceiling still asks them to wait",
);
assert(
  presented({ ipCount: 29, sendCount: 299, sendFailureCount: 29 }).outcome === "ok",
  "twenty-nine failures and 299 attempts are still allowed",
);
assert(LIMITED_LINK_BODY === "Please wait a minute and try again.", "the wait sentence is exact");

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
  "stored file names are not copied onto the page",
);
const named = toPublicChecklist(
  [
    {
      sendId,
      itemKey: "bank_statements",
      label: null,
      totalsOnly: false,
      status: "received",
      quality: "usable",
      storagePath: path,
      displayNames: ["../secret/bank statement.pdf", "notes.pdf"],
      fileName: "hidden.pdf",
    },
  ],
  sendId,
);
const namedJson = JSON.stringify(named);
assert(
  named[0]?.fileNames?.[0] === "bank statement.pdf" && namedJson.includes("notes.pdf"),
  "a display name is the file name the client sees",
);
assert(!namedJson.includes("hidden.pdf") && !namedJson.includes("../"), "a stored name and a path stay off the page");
assert(sanitizeClientFileName("a\u0000b.pdf") === "ab.pdf", "a display name drops control characters");
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
assert(!declareUpload({ consented: false, size: 8, mime: "application/pdf" }).ok, "a signed upload needs consent");
const tooLarge = declareUpload({ consented: true, size: SEND_FILE_MAX_BYTES + 1, mime: "application/pdf" });
assert(!tooLarge.ok && tooLarge.reason === "size", "a declared file over 20 MB is refused");
const gifDeclared = declareUpload({ consented: true, size: 8, mime: "image/gif" });
assert(!gifDeclared.ok && gifDeclared.reason === "mime", "a declared gif is refused");
assert(declareUpload({ consented: true, size: 8 * 1024 * 1024, mime: "application/pdf" }).ok, "an 8 MB PDF may be prepared");
const grant = {
  sendId,
  itemKey: "irp5",
  path,
  size: pdfBytes.byteLength,
  mime: "application/pdf",
  exp: Date.now() + 60_000,
};
const grantToken = await signUploadGrant("test-grant-secret", grant);
const openedGrant = await readUploadGrant("test-grant-secret", grantToken);
assert(openedGrant?.path === path, "a grant opens with the server secret");
assert(openedGrant?.name === undefined, "an older grant still opens without a file name");
assert((await readUploadGrant("other-secret", grantToken)) === null, "a grant does not open with another secret");
const namedGrantToken = await signUploadGrant("test-grant-secret", { ...grant, name: "../salary.pdf" });
const openedNamedGrant = await readUploadGrant("test-grant-secret", namedGrantToken);
assert(openedNamedGrant?.name === "salary.pdf", "the grant carries the file name without its path");
const forged = confirmStoredObject({
  grant,
  claimedPath: `${sendId}/irp5/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
  sendId,
  itemKey: "irp5",
  objectSize: pdfBytes.byteLength,
  sniffed: "application/pdf",
});
assert(!forged.ok && forged.reason === "unavailable", "a path the client invents is refused");
const oversizedObject = confirmStoredObject({
  grant: { ...grant, size: SEND_FILE_MAX_BYTES + 1 },
  claimedPath: path,
  sendId,
  itemKey: "irp5",
  objectSize: SEND_FILE_MAX_BYTES + 1,
  sniffed: "application/pdf",
});
assert(!oversizedObject.ok && oversizedObject.reason === "size", "storage metadata over 20 MB is refused");
const wrongMagic = confirmStoredObject({
  grant,
  claimedPath: path,
  sendId,
  itemKey: "irp5",
  objectSize: pdfBytes.byteLength,
  sniffed: "image/png",
});
assert(!wrongMagic.ok && wrongMagic.reason === "mime", "magic bytes that disagree are refused");
const confirmed = confirmStoredObject({
  grant,
  claimedPath: path,
  sendId,
  itemKey: "irp5",
  objectSize: pdfBytes.byteLength,
  sniffed: "application/pdf",
});
assert(confirmed.ok && confirmed.size === pdfBytes.byteLength, "a matching object is confirmed");

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
const emptyMissing = finishItem({ quality: "incomplete", explanation: "", hasFile: false });
assert(
  emptyMissing.ok === true && emptyMissing.explanation === null,
  "an empty note still marks the document not available",
);
const keptMissing = finishItem({ quality: "incomplete", explanation: " Left it at home. ", hasFile: false });
assert(
  keptMissing.ok === true && keptMissing.explanation === "Left it at home.",
  "a note is stored with the mark",
);
assert(
  itemNotAvailable({ hasFile: false, status: "received", quality: "incomplete" }) &&
    !itemNotAvailable({ hasFile: false, status: "open", quality: null }) &&
    !itemNotAvailable({ hasFile: true, status: "received", quality: "incomplete" }),
  "undo clears a missing mark and a file is not that mark",
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
  REVOKED_LINK_BODY,
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
const linkRules = read("src/lib/client-agent-link.ts");
assert(
  !linkRules.includes("sample-compute"),
  "the public link does not import company tax copy",
);
assert(
  clientAgentItemHelp({ itemKey: "medical_aid_certificate" }) ===
    "The annual tax certificate from your medical aid.",
  "medical aid help does not repeat totals only",
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
  fn.includes("recentAttempts") && fn.includes("recentSendAttempts") && fn.includes("recentSendFailures"),
  "rate limits count IP attempts, send attempts, and send failures",
);
assert(fn.includes('countAttempts("ip_hash", ipHash, "failures")'), "an IP limit counts failures");
assert(fn.includes("client_agent_send_attempts"), "attempts are recorded");
assert(
  fn.includes("declareUpload") && fn.includes("confirmStoredObject"),
  "storage waits for the file decision",
);
assert(fn.includes("consentWrite"), "consent writes the notice version");
assert(!fn.includes("error.message"), "database errors are not copied into logs");
assert(fn.includes("sniffDocumentMime"), "confirm reads the magic bytes");
const confirmSlice = fn.slice(
  fn.indexOf("export const confirmClientAgentUpload"),
  fn.indexOf("export const removeClientAgentFile"),
);
assert(!confirmSlice.includes("data.mime"), "confirm does not trust the declared type");
assert(fn.includes("sendStoragePath"), "the object path is built on the server");
assert(!fn.includes("bytesFromBase64") && !fn.includes("base64"), "the server function body has no file bytes");
assert(fn.includes("createSignedUploadUrl"), "a signed upload URL is issued by the service role");
assert(fn.includes("upsert: false"), "the signed upload path is one-time");
assert(fn.includes('Range: "bytes=0-31"'), "confirm reads only the first bytes");
assert(!fn.includes(".download("), "confirm does not download the whole object");
assert(page.includes("uploadToClientAgentSignedUrl"), "the browser uploads to the signed URL");
assert(!page.includes("fileBase64") && !page.includes("base64"), "the page does not post the file body");
assert(!/method:\s*"PUT"/.test(page), "the page uses the signed upload helper");
assert(fn.includes("readUploadGrant"), "confirm checks the server-issued grant");
assert(fn.includes("pathBelongsToSend"), "a path must belong to this send");
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
const loadEffect = page.slice(page.indexOf("useEffect"), page.indexOf("const onAgree"));
assert(loadEffect.includes("setLoadFailed(true)"), "a thrown open is retryable");
assert(!loadEffect.includes("closedLink"), "a thrown open is not the closed page");
assert(page.includes("setAttempt"), "Try again runs the load again");
assert(fn.includes("outcome: opened.outcome"), "attempt logging still uses the outcome");
assert(fn.includes('outcome: "revoked"') === false, "the server does not hard-code a second revoked log");
assert(page.includes("sanitizeClientFileName(file.name)"), "a shown name is the sanitized file name");
assert(!page.includes("console."), "the page does not log the file name");
assert(route.includes("SEND_LINK_META"), "the route uses the noindex meta");
assert(
  server.includes("linkPrivacyHeaders") && server.includes("linkLogPath"),
  "the server sets privacy headers and redacts the path",
);
assert(!page.includes("SilentAgentPortrait"), "the stacked talk portrait is gone");
assert(!page.includes("<OwnerAvatar"), "the page uses the tax clip, not the still card");
assert(page.includes('data-agent="tax_specialist"'), "Tax Specialist face");
assert(page.includes("is-lg"), "the portrait uses the agent card size");
assert(page.includes("is-character"), "the portrait is the round character");
assert(page.includes("<video"), "the hero plays the tax clip");
assert(page.includes("muted") && page.includes("autoPlay"), "the clip is muted and starts itself");
assert(page.includes("playsInline") && page.includes("loop"), "the clip loops inline");
assert(!page.includes("<audio"), "the page has no audio element");
assert(
  page.includes('fmClipSources(clip, "tax_specialist")') && page.includes('showThanks ? "done" : "curious"'),
  "the checklist loops curious and the thank-you loops done",
);
assert(page.includes("usePrefersReducedMotion"), "reduced motion drops the clip");
assert(page.includes("reduced ? null"), "the clip is omitted when motion is reduced");
assert(!page.includes("flex-wrap"), "the list does not wrap into a row");
assert(page.includes("setThanks(true)"), "Next shows the thank-you after the server accepts");
assert(page.includes("completeClientAgentSend"), "Next calls the completion action");
assert(!page.includes("finishClientAgentLink"), "Next does not use the mail completion action");
assert(!fn.includes("finishClientAgentLink"), "there is no mail completion action");
assert(fn.includes("completeClientAgentSend"), "completion is a token-gated server action");
assert(fn.includes("completed_at"), "completion stores completed_at");
assert(!fn.includes("client_finished_at"), "completion does not use a second timestamp");
assert(page.includes("multiple"), "a row accepts more than one file");
assert(page.includes("CLIENT_AGENT_CHAT_ENABLED"), "the live chat sits behind a flag");
assert(page.includes("data-doc-help"), "the page shows document help");
assert(page.includes("File password (if it has one)"), "a password field is offered after upload");
assert(page.includes("I'll check with Theo's practice"), "an unsure chat falls back to the practice");
assert(!fn.includes("console."), "the link actions do not log");
assert(fn.includes("guideDocumentQuestion"), "questions use the document guide");
assert(fn.includes("ANTHROPIC_API_KEY") && fn.includes("CLAUDE_MODEL"), "the guide uses the app model");
assert(!fn.includes("callClaudeMessages"), "errors from the model client are not thrown through");
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
assert(page.includes("clientAgentChecklistIntro"), "the list uses the checklist intro");
assert(/>\s*Upload\s*</.test(page), "each item has an upload button");
assert(page.includes("min-h-11"), "tap targets are at least 44px");
assert(page.includes("Received ✓"), "an uploaded item says it was received");
assert(/>\s*Remove\s*</.test(page), "an uploaded item can be removed");
assert(page.includes("removeClientAgentFile"), "remove is a token-gated server action");
assert(!page.includes("data-upload-tick"), "the lone upload tick is gone");
assert(!page.includes("This is all I have"), "the old skip label is gone");
assert(page.includes("prepareClientAgentUpload") && page.includes("confirmClientAgentUpload"), "the page prepares and confirms the upload");
assert(page.includes(CLIENT_AGENT_NEXT_HINT) || page.includes("CLIENT_AGENT_NEXT_HINT"), "Next explains why it is off");
assert(page.includes("Password saved"), "a saved password is labelled");
assert(page.includes("onMouseDown"), "Save and Next keep a blur from swallowing the click");
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
assert(consentHtml.includes("<video") && consentHtml.includes("muted"), "the hero loops a muted clip");
assert(consentHtml.includes("playsInline") || consentHtml.includes("playsinline"), "the hero plays inline");
assert(consentHtml.includes("loop"), "the hero loops");
assert(consentHtml.includes("autoPlay") || consentHtml.includes("autoplay"), "the hero autoplays");
assert(consentHtml.includes("poster="), "the hero has a poster");
assert(!consentHtml.includes("controls"), "the hero has no audio controls");
assert(!consentHtml.includes("<audio"), "the hero has no audio element");
assert(consentHtml.includes("/avatars/tax/tax-curious"), "the clip is the Tax Specialist");
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
assert((checklistHtml.match(/data-received=/g) ?? []).length === 1, "one received line renders");
assert(checklistHtml.includes("Received ✓"), "the received line names the file as received");
assert(checklistHtml.includes("Replace") && checklistHtml.includes("Remove"), "replace and remove sit in the row");
assert(!checklistHtml.includes("data-upload-tick"), "the received row has no floating tick");
assert(
  checklistHtml.includes("I don&#x27;t have this") || checklistHtml.includes("I don't have this"),
  "the skip link renders",
);
assert(
  checklistHtml.includes("The annual tax certificate from your medical aid."),
  "the medical row help is the certificate line",
);
assert(
  (checklistHtml.match(/totals only/gi) ?? []).length === 1,
  "totals only stays in the medical label only",
);
assert(checklistHtml.includes("data-missing-note"), "the optional note renders");
assert(
  checklistHtml.includes("Hi, I&#x27;m the Tax Specialist at") ||
    checklistHtml.includes("Hi, I'm the Tax Specialist at"),
  "a missing first name still introduces the specialist",
);
assert(checklistHtml.includes("data-checklist-intro"), "the checklist intro renders");
assert(
  checklistHtml.includes("for each document to continue."),
  "a disabled Next explains what is left",
);
assert(checklistHtml.includes("data-doc-help"), "the checklist shows document help");
assert(
  checklistHtml.includes("Anything else? Theo&#x27;s practice will help.") ||
    checklistHtml.includes("Anything else? Theo's practice will help."),
  "the checklist help ends with the practice",
);
assert(!checklistHtml.includes("data-agent-chat"), "the checklist does not open the live chat");

function closedScreen(view: ReturnType<typeof closedLink> | null, loadFailed = false) {
  return renderToStaticMarkup(
    createElement(ClientAgentLinkScreen, {
      view,
      busy: false,
      notice: null,
      noteFor: null,
      explanation: "",
      loadFailed,
      onAgree: () => undefined,
      onPickFile: () => undefined,
      onOpenNote: () => undefined,
      onExplanation: () => undefined,
      onSaveNote: () => undefined,
      onRetry: () => undefined,
    }),
  );
}

const retryHtml = closedScreen(null, true);
assert(
  retryHtml.includes(CLIENT_AGENT_LOAD_ERROR) || retryHtml.includes("Couldn&#x27;t load, try again"),
  "a transport failure asks to try again",
);
assert(/>\s*Try again\s*</.test(retryHtml), "a transport failure has a Try again button");
assert(!retryHtml.includes(GENERIC_LINK_BODY), "a transport failure is not the closed page");
assert(
  (retryHtml.match(/data-client-portrait="tax_specialist"/g) ?? []).length === 1,
  "the retry state keeps the portrait",
);
const revokedHtml = closedScreen(closedLink("revoked"));
assert(revokedHtml.includes(REVOKED_LINK_BODY), "a revoked link says it was replaced");
assert(!revokedHtml.includes("Try again"), "a revoked link is not a retry");
assert(!revokedHtml.includes(GENERIC_LINK_BODY), "a revoked link is not the generic refusal");
const unavailableHtml = closedScreen(closedLink("unavailable"));
assert(unavailableHtml.includes(GENERIC_LINK_BODY), "an unknown link is not available");
assert(!unavailableHtml.includes(REVOKED_LINK_BODY), "an unknown link does not say it was replaced");
assert(!unavailableHtml.includes("Try again"), "an unknown link is not a retry");
const expiredHtml = closedScreen(closedLink("unavailable"));
assert(expiredHtml.includes(GENERIC_LINK_BODY), "an expired link is not available");
assert(
  (checklistHtml.match(/PDF, JPG, PNG or HEIC, up to 20 MB each/g) ?? []).length === 1,
  "file types appear once",
);
assert(checklistHtml.includes(CLIENT_AGENT_FILE_NOTE), "the file note is the shared sentence");
assert(consentHtml.includes("before 5 Nov 2026"), "the consent page shows the Johannesburg expiry");
assert(!/sars|fill in a form/i.test(consentHtml), "the rendered consent drops internal denials");

assert(
  itemSettled({ hasFile: true, status: "open", quality: null }) &&
    itemSettled({ hasFile: false, status: "received", quality: "incomplete" }) &&
    !itemSettled({ hasFile: false, status: "open", quality: null }),
  "a row is settled by a file or by saying it is missing",
);
assert(
  !checklistReady([
    { hasFile: true, status: "received", quality: "usable" },
    { hasFile: false, status: "open", quality: null },
  ]),
  "Next stays off while a row is open",
);
assert(
  checklistReady([
    { hasFile: true, status: "received", quality: "usable" },
    { hasFile: false, status: "received", quality: "incomplete" },
  ]),
  "Next is on when every row is uploaded or skipped",
);
assert(
  itemSettled({ hasFile: true, status: "received", quality: "usable" }) &&
    checklistReady([{ hasFile: true, status: "open", quality: null }]),
  "an uploaded file counts as complete when its password is left empty",
);
assert(
  checklistReady([
    { hasFile: false, status: "received", quality: "incomplete" },
    { hasFile: false, status: "received", quality: "poor" },
  ]),
  "two rows marked independently are enough for Next",
);
assert(
  !itemSettled({ hasFile: false, status: "open", quality: null }),
  "undo returns a row to open",
);
function nextDisabled(html: string): boolean {
  const tag = html.match(/<button[^>]*data-client-next="true"[^>]*>/)?.[0] ?? "";
  return /\sdisabled(=|\s|>)/.test(tag);
}
assert(nextDisabled(checklistHtml), "the partly done list keeps Next off");
assert(checklistHtml.includes("File password (if it has one)"), "an uploaded row offers a password");
assert(checklistHtml.includes('type="password"'), "the password is not a visible text field");

const readyHtml = renderToStaticMarkup(
  createElement(ClientAgentLinkScreen, {
    view: {
      ok: true,
      practiceName: "Theo's practice",
      expiresAt: lateExpiry,
      firstName: "Nicola",
      consented: true,
      notice: practiceNotice,
      items: [
        {
          itemKey: "irp5",
          label: "IRP5",
          totalsOnly: false,
          status: "received",
          quality: "usable",
          hasFile: true,
          passwordSaved: true,
        },
        {
          itemKey: "medical_aid_certificate",
          label: "Medical aid tax certificate (totals only)",
          totalsOnly: true,
          status: "received",
          quality: "incomplete",
          hasFile: false,
        },
      ],
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
    chatOpen: true,
    chatMessages: [{ role: "she", text: "Your employer sends the IRP5." }],
  }),
);
assert(
  readyHtml.includes('data-client-next="true"') && !nextDisabled(readyHtml),
  "a finished list enables Next",
);
assert(readyHtml.includes("Password saved"), "a stored password is labelled and not shown back");
assert(!readyHtml.includes("secret-file-pass"), "the password value is not on the page");
const emptyPasswordHtml = renderToStaticMarkup(
  createElement(ClientAgentLinkScreen, {
    view: {
      ok: true,
      practiceName: "Theo's practice",
      expiresAt: lateExpiry,
      consented: true,
      notice: practiceNotice,
      items: [
        {
          itemKey: "bank_statements",
          label: "Bank statements",
          totalsOnly: false,
          status: "received",
          quality: "usable",
          hasFile: true,
          passwordSaved: false,
          fileNames: ["statements.pdf"],
        },
        {
          itemKey: "irp5",
          label: "IRP5",
          totalsOnly: false,
          status: "received",
          quality: "incomplete",
          hasFile: false,
          explanation: null,
        },
        {
          itemKey: "it3b",
          label: "IT3(b)",
          totalsOnly: false,
          status: "received",
          quality: "incomplete",
          hasFile: false,
          explanation: "The account was closed.",
        },
      ],
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
  emptyPasswordHtml.includes('data-client-next="true"') && !nextDisabled(emptyPasswordHtml),
  "Next is on when a file has no password and every other row is not available",
);
assert(emptyPasswordHtml.includes("statements.pdf"), "the stored file name stays on the row");
assert(!emptyPasswordHtml.includes("Password saved"), "an empty password is not labelled saved");
assert(
  (emptyPasswordHtml.match(/Marked as not available/g) ?? []).length === 2,
  "two rows stay marked on their own",
);
assert(
  (emptyPasswordHtml.match(/data-undo-missing=/g) ?? []).length === 2,
  "each marked row can be undone",
);
assert(
  emptyPasswordHtml.includes("The account was closed."),
  "a saved note stays on its own row",
);
assert(
  (emptyPasswordHtml.match(/data-missing-note=/g) ?? []).length === 2,
  "each marked row can edit its note",
);
assert(readyHtml.includes('type="password"') && readyHtml.includes('value=""'), "the password field is cleared");
assert(readyHtml.includes("data-doc-help"), "a finished list shows document help");
assert(readyHtml.includes(CLIENT_AGENT_FAQ_TITLE), "the help block has its heading");
assert(
  readyHtml.includes("Anything else? Theo&#x27;s practice will help.") ||
    readyHtml.includes("Anything else? Theo's practice will help."),
  "the help block ends with the practice line",
);
assert(!readyHtml.includes("data-agent-chat"), "the live chat stays hidden");
assert(!readyHtml.includes("Ask the Tax Specialist"), "the ask button stays hidden");
assert(!/sars|filing|irp6|itr14|south africa|\brand\b|zar/i.test(readyHtml), "the help block has no filing wording");

const thanksHtml = renderToStaticMarkup(
  createElement(ClientAgentLinkScreen, {
    view: {
      ok: true,
      practiceName: "Theo's practice",
      expiresAt: lateExpiry,
      firstName: "Nicola",
      consented: true,
      notice: practiceNotice,
      items: [
        {
          itemKey: "irp5",
          label: "IRP5",
          totalsOnly: false,
          status: "received",
          quality: "usable",
          hasFile: true,
        },
      ],
    },
    busy: false,
    notice: null,
    noteFor: null,
    explanation: "",
    thanks: true,
    onAgree: () => undefined,
    onPickFile: () => undefined,
    onOpenNote: () => undefined,
    onExplanation: () => undefined,
    onSaveNote: () => undefined,
  }),
);
assert(
  thanksHtml.includes("Thank you, Nicola."),
  "the thank-you uses the first name",
);
assert(
  thanksHtml.includes("Theo&#x27;s practice is working on them now") ||
    thanksHtml.includes("Theo's practice is working on them now"),
  "the thank-you names the practice once",
);
assert(thanksHtml.includes("data-practice-name"), "the thank-you shows the practice line");
assert(
  thanksHtml.includes("Theo&#x27;s practice") || thanksHtml.includes("Theo's practice"),
  "the thank-you practice line is the stored practice name",
);
assert(thanksHtml.includes("/avatars/tax/tax-done"), "the thank-you uses the done clip");
assert(thanksHtml.includes("data-client-thanks"), "Next shows the thank-you screen");
assert(!thanksHtml.includes("data-client-next"), "the thank-you screen has no Next button");
assert(!thanksHtml.includes("Upload"), "the thank-you screen has no upload");
const plainThanks = clientAgentThanks({ firstName: null, practiceName: "Theo's practice" });
assert(plainThanks.text.startsWith("Thank you."), "a missing first name still says thank you");
assert(!plainThanks.text.startsWith("Thank you, "), "a missing first name is not a blank name");
const namedIntro = clientAgentChecklistIntro("Nicola", "Harbour Books");
assert(
  namedIntro.startsWith("Hi Nicola, I'm the Tax Specialist at Harbour Books."),
  "the checklist intro uses the first name and the practice",
);
assert(
  clientAgentChecklistIntro(null, "Harbour Books").startsWith("Hi, I'm the Tax Specialist at Harbour Books."),
  "a missing first name starts with Hi, I'm",
);

const filesSql = read("supabase/migrations/20261022180000_client_agent_send_files.sql");
const filesCode = filesSql
  .split("\n")
  .map((line) => line.split("--")[0])
  .join("\n")
  .toLowerCase();
assert(filesCode.includes("create table if not exists public.client_agent_send_files"), "files have a table");
assert(filesCode.includes("password_iv") && filesCode.includes("password_box"), "the password is two ciphertext columns");
assert(filesCode.includes("add column if not exists completed_at timestamptz"), "next stores completed_at");
assert(!filesCode.includes("client_finished_at"), "completion is completed_at only");
assert(!filesCode.includes("reviewed_at"), "this file does not add a review column");
assert(!/\bsecurity\s+definer\b/.test(filesCode), "the files migration has no security definer");
assert(
  filesCode.includes("create or replace function public.client_agent_send_guard_firm()"),
  "the firm guard is replaced in place",
);
assert(filesCode.includes("firm_client_mismatch"), "the firm check stays");
assert(filesCode.includes("consent_required"), "completion without consent is refused");
assert(filesCode.includes("completed_at_required"), "completed_at cannot be cleared");
assert(
  filesCode.includes("revoke all on function public.client_agent_send_guard_firm() from public, anon, authenticated"),
  "anon cannot run the guard",
);
assert(
  filesCode.includes("grant execute on function public.client_agent_send_guard_firm() to service_role"),
  "only the service role can run the guard",
);
assert(!/\bcreate\s+policy\b/.test(filesCode), "the files migration creates no policy");
assert(!/resend|recipient_email|contact_email/.test(filesCode), "the files migration sends no mail");
assert(filesCode.includes("revoke all on table public.client_agent_send_files from public, anon, authenticated"), "anon cannot read file rows");
const chatTable = filesCode.slice(
  filesCode.indexOf("create table if not exists public.client_agent_send_chat_turns"),
  filesCode.indexOf("create index if not exists client_agent_send_chat_turns"),
);
assert(chatTable.includes("send_id"), "chat turns are counted per send");
assert(!chatTable.includes("message") && !chatTable.includes("token"), "chat rows store no message and no token");

const passwordSql = read("supabase/migrations/20261023090000_client_agent_file_password_box.sql");
assert(passwordSql.includes("4 * ceil(336 / 3) = 448"), "the password cap comment states the bound");
assert(
  passwordSql.includes("DROP CONSTRAINT IF EXISTS client_agent_send_files_password_pair"),
  "the password pair constraint is dropped",
);
assert(
  passwordSql.includes("ADD CONSTRAINT client_agent_send_files_password_pair"),
  "the password pair constraint is added again",
);
assert(passwordSql.includes("length(password_box) BETWEEN 8 AND 448"), "the password box allows 448 characters");
assert(!passwordSql.toLowerCase().includes("security definer"), "the password migration is not security definer");
assert(!/\bgrant\b/i.test(passwordSql), "the password migration does not grant");
assert(passwordSql.includes("'rejected'"), "a failed attempt can be recorded as rejected");
const missingSql = read("supabase/migrations/20261023140000_client_agent_not_available.sql");
assert(
  missingSql.includes("DROP CONSTRAINT IF EXISTS client_agent_send_items_explanation"),
  "a missing document can be saved without a note",
);
assert(missingSql.includes("display_name text"), "the file name has its own column");
assert(missingSql.includes("length(display_name) <= 120"), "the file name is capped");
assert(!missingSql.toLowerCase().includes("security definer"), "the not-available migration is not security definer");
assert(!/\bgrant\b/i.test(missingSql), "the not-available migration does not grant");
assert(
  read("supabase/migrations/20261021210000_client_agent_sends.sql").includes(
    "length(btrim(explanation)) > 0",
  ),
  "the applied sends migration is left as it was",
);
assert(fn.includes('select("item_key")'), "a checklist save checks that a row changed");
assert(fn.includes("display_name"), "the file name is read back from the file row");
assert(fn.includes("export const undoClientAgentItem"), "undo is a token-gated server action");
assert(page.includes("undoClientAgentItem"), "undo is called from the page");
assert(page.includes("Marked as not available"), "a missing row says it was recorded");
assert(page.includes("name: file.name"), "prepare receives the file name");
assert(page.includes("scrollTo(0, y)") && page.includes("scrollY"), "a state change keeps the scroll position");
assert(page.includes("}, [token, attempt]);"), "opening the link does not refetch on every render");
assert(!page.includes("scrollRestoration: false"), "scroll restoration stays on for the rest of the app");
const throttledHtml = closedScreen(closedLink("limited"));
assert(throttledHtml.includes("Please wait a minute and try again."), "a throttle shows the wait sentence");
assert(throttledHtml.includes("Try again"), "a throttle can be tried again");
assert(throttledHtml.includes("data-link-throttled"), "a throttle is its own state");
assert(!throttledHtml.includes(GENERIC_LINK_BODY), "a throttle is not the unavailable page");
assert(!throttledHtml.includes("not available"), "a throttle never says the link is not available");

const saveFn = fn.slice(
  fn.indexOf("export const saveClientAgentFilePassword"),
  fn.indexOf("async function storeFilePassword"),
);
assert(saveFn.includes("return { ok: true }"), "a saved password returns no secret");
assert(!/return\s*\{[^}]*password/.test(saveFn), "the password is not in the response");
assert(saveFn.includes("CLIENT_AGENT_PASSWORD_UNSAVED"), "a bad key tells the client the password was not saved");
assert(
  saveFn.indexOf("filePasswordKey") < saveFn.indexOf("sealFilePassword") &&
    saveFn.indexOf("if (!key)") < saveFn.indexOf("storeFilePassword"),
  "a missing key stores nothing",
);
const uploadFn = fn.slice(
  fn.indexOf("export const prepareClientAgentUpload"),
  fn.indexOf("export const finishClientAgentItem"),
);
assert(!uploadFn.includes("filePasswordKey"), "an upload still succeeds without a password key");
assert(!uploadFn.includes("base64"), "prepare and confirm do not take file bytes");
assert(
  uploadFn.includes("deleteSendFile") && uploadFn.includes(".remove("),
  "a failed item update deletes the file row and the object",
);
const removeFn = fn.slice(
  fn.indexOf("export const removeClientAgentFile"),
  fn.indexOf("export const finishClientAgentItem"),
);
assert(removeFn.includes("deleteSendFileById"), "remove deletes the file row and its password");
assert(!removeFn.includes("completed_at"), "a finished send can still remove a file");
assert(page.includes("CLIENT_AGENT_PASSWORD_UNSAVED"), "the page shows the password note");
const releaseFn = fn.slice(
  fn.indexOf("export async function releaseClientAgentFilePassword"),
  fn.indexOf("async function markSendComplete"),
);
assert(!releaseFn.includes("createServerFn"), "opening a password is not a public action");

const rawKey = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i + 1)).toString("base64");
const key = filePasswordKey(rawKey);
assert(key?.length === 32, "the password key is 32 bytes");
const sealed = await sealFilePassword("secret-file-pass", key!);
assert(!sealed.box.includes("secret-file-pass"), "the stored password is not plaintext");
assert(!sealed.iv.includes("secret-file-pass"), "the iv is not the password");
assert((await openFilePassword(sealed, key!)) === "secret-file-pass", "the ciphertext opens with the server key");
assert(filePasswordKey(undefined) === null, "a missing key is refused");
assert(filePasswordKey("") === null, "an empty key is refused");
assert(filePasswordKey("   ") === null, "a blank key is refused");
assert(filePasswordKey("short") === null, "a short key is refused");
assert(filePasswordKey("!!!!") === null, "a key that is not base64 is refused");
assert(
  filePasswordKey(Buffer.from(Uint8Array.from({ length: 16 }, () => 1)).toString("base64")) === null,
  "a key that is not 32 bytes is refused",
);
assert(
  filePasswordKey(Buffer.from(Uint8Array.from({ length: 33 }, () => 2)).toString("base64")) === null,
  "a key longer than 32 bytes is refused",
);
assert(CLIENT_AGENT_PASSWORD_UNSAVED === "Couldn't save the password.", "the password note is the polite sentence");

assert(clientAgentChatDecision("How do I file my tax return?") === "refuse", "filing questions are refused");
assert(clientAgentChatDecision("Can you submit this to SARS?") === "refuse", "a SARS submission is refused");
assert(
  clientAgentChatDecision("How do I log in to SARS eFiling?") === "refuse",
  "a SARS login is refused",
);
assert(clientAgentChatDecision("Where do I find my IRP5?") === "answer", "a document question is answered");
assert(clientAgentChatDecision("   ") === "empty", "a blank question is empty");
assert(
  clientAgentChatReply("Log in to SARS and file the return") === CLIENT_AGENT_CHAT_REFUSAL,
  "a filing reply is replaced",
);
assert(CLIENT_AGENT_CHAT_SYSTEM.includes("Never give filing instructions."), "the prompt forbids filing steps");
assert(
  CLIENT_AGENT_CHAT_SYSTEM.includes("Never mention a SARS login, eFiling, or submitting a return."),
  "the prompt forbids SARS submission",
);
assert(CLIENT_AGENT_CHAT_SYSTEM.includes(CLIENT_AGENT_CHAT_FALLBACK), "the prompt uses the practice fallback");
assert(
  (await guideDocumentQuestion({ message: "How do I file my return?", apiKey: "secret", model: "claude" })) ===
    CLIENT_AGENT_CHAT_REFUSAL,
  "a filing question never calls the model",
);
assert(
  (await guideDocumentQuestion({ message: "Where is my IRP5?", apiKey: "", model: "" })) ===
    CLIENT_AGENT_CHAT_FALLBACK,
  "a missing model key uses the practice fallback",
);

const nextHandler = page.slice(page.indexOf("onNext={() =>"), page.indexOf("thanks={thanks}"));
assert(nextHandler.includes("await complete("), "Next waits for the server");
assert(
  nextHandler.indexOf("saveItemPassword") !== -1 &&
    nextHandler.indexOf("saveItemPassword") < nextHandler.indexOf("await complete("),
  "Next saves a typed password before it finishes",
);
assert(nextHandler.includes("setThanks(true)"), "Next shows thanks after a saved completion");
const refusalAt = nextHandler.indexOf("if (!saved.ok)");
assert(refusalAt !== -1 && nextHandler.indexOf("setThanks(true)", refusalAt) > refusalAt, "a refusal does not show thanks");

const settled = [
  { hasFile: true, status: "received", quality: "usable" },
  { hasFile: false, status: "received", quality: "incomplete" },
];
assert(
  completionDecision({ consentAt: null, completedAt: null, items: settled }).ok === false,
  "next refuses before consent",
);
assert(
  completionDecision({ consentAt: "2026-10-22T00:00:00.000Z", completedAt: null, items: [{ hasFile: false, status: "open", quality: null }] }).ok === false,
  "next refuses an open row",
);
const again = completionDecision({
  consentAt: "2026-10-22T00:00:00.000Z",
  completedAt: "2026-10-22T01:00:00.000Z",
  items: settled,
});
assert(again.ok && again.already, "a second next does not write again");
const first = completionDecision({
  consentAt: "2026-10-22T00:00:00.000Z",
  completedAt: null,
  items: settled,
});
assert(first.ok && !first.already, "a settled list can complete");

const faq = clientAgentFaq([
  { itemKey: "irp5", label: "IRP5" },
  { itemKey: "bank_statements", label: "Bank statements" },
  { itemKey: "irp5", label: "IRP5" },
]);
assert(faq.length === 2, "help is one line per item");
assert(faq[0]?.body.includes("employer"), "IRP5 help says where to find it");
assert(faq[1]?.body.includes("1 March 2025"), "bank help keeps the year window");
assert(
  clientAgentFaqClose("Theo's practice") === "Anything else? Theo's practice will help.",
  "the help block ends on that sentence",
);
assert(
  clientAgentFaqClose("Harbour Books") === "Anything else? Harbour Books will help.",
  "the help closer uses the practice on the send",
);
assert(CLIENT_AGENT_CHAT_ENABLED === false, "the document chat is off");
assert(
  !/sars|filing|irp6|itr14|south africa|\brand\b|\bzar\b/i.test(
    faq.map((row) => row.body).join(" ") + CLIENT_AGENT_FAQ_TITLE + clientAgentFaqClose("Harbour Books"),
  ),
  "document help has no filing wording",
);
const askFn = fn.slice(fn.indexOf("export const askClientAgentLink"), fn.indexOf("async function countChatTurns"));
assert(
  askFn.indexOf("CLIENT_AGENT_CHAT_ENABLED") !== -1 &&
    askFn.indexOf("CLIENT_AGENT_CHAT_ENABLED") < askFn.indexOf("guideDocumentQuestion"),
  "a chat request does not call the model while the flag is off",
);
assert(!askFn.slice(0, askFn.indexOf("guideDocumentQuestion")).includes("recordChatTurn"), "a closed chat writes no turn");
const completeFn = fn.slice(fn.indexOf("export const completeClientAgentSend"), fn.indexOf("export const askClientAgentLink"));
assert(completeFn.includes("completionDecision"), "completion uses the checklist decision");
assert(completeFn.includes("decision.already"), "a completed send is left as it is");
assert(!/resend|recipient_email|contact_email|sendAccessEmail/i.test(completeFn), "completion sends no mail");

console.log("client agent link test ok");
