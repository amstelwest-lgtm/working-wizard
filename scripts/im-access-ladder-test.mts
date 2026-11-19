/**
 * IM access ladder rungs 3–4 — scope, revoke, read-only, inbound review.
 * Run: pnpm test:im-access-ladder
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  IM_ACCESS_RUNG_GOOGLE,
  IM_ACCESS_RUNG_MICROSOFT,
  assertCloudReadOnlyMethod,
  googleDriveScopesForPickedFolders,
} from "../src/lib/im-cloud-scopes";
import {
  assertFileWithinPickedFolders,
  isUnderPickedFolder,
  type CloudFileRef,
} from "../src/lib/im-cloud-folder-guard";
import {
  cloudIngestPaused,
  parseImAccessSettings,
} from "../src/lib/im-access-settings";
import {
  decideInboundDisposition,
  forwardingAddress,
  forwardingLocalPart,
  resolveInboundRecipient,
} from "../src/lib/im-inbound-forward";
import { validateCloudFileForIngest } from "../src/lib/im-cloud-ingest";
import { classificationStaysInReview } from "../src/lib/im-cloud-ingest";

const client = "e8f7a440-2222-2222-2222-222222222222";
const firm = "e8f7a440-a541-422c-8e4f-82ba33dd0604";

assert.equal(IM_ACCESS_RUNG_GOOGLE, 3);
assert.equal(IM_ACCESS_RUNG_MICROSOFT, 4);

assert.throws(() => assertCloudReadOnlyMethod("delete"), /cloud_write_forbidden/);
assert.throws(() => assertCloudReadOnlyMethod("upload"), /cloud_write_forbidden/);
assert.doesNotThrow(() => assertCloudReadOnlyMethod("list"));

const scopes = googleDriveScopesForPickedFolders();
assert.ok(scopes.some((s) => s.includes("drive.file")));
assert.ok(scopes.some((s) => s.includes("drive.readonly")));

const pickGoogle = { provider: "google" as const, folderId: "folder-root" };
const inside: CloudFileRef = {
  provider: "google",
  fileId: "file-1",
  parentFolderId: "folder-root",
};
const outside: CloudFileRef = {
  provider: "google",
  fileId: "file-2",
  parentFolderId: "other-folder",
};

assert.equal(isUnderPickedFolder(inside, [pickGoogle]), true);
assert.equal(isUnderPickedFolder(outside, [pickGoogle]), false);
assert.throws(() => assertFileWithinPickedFolders(outside, [pickGoogle]));

const revoked = parseImAccessSettings({
  version: 1,
  picks: [pickGoogle],
  revokedAt: new Date().toISOString(),
  forwarding: { allowedSenders: [] },
});
assert.equal(cloudIngestPaused(revoked), true);
const ingestRevoked = validateCloudFileForIngest(inside, revoked);
assert.equal(ingestRevoked.ok, false);
if (!ingestRevoked.ok) assert.equal(ingestRevoked.reason, "cloud_revoked");

const active = parseImAccessSettings({ version: 1, picks: [pickGoogle], revokedAt: null, forwarding: { allowedSenders: [] } });
const ingestOk = validateCloudFileForIngest(inside, active);
assert.equal(ingestOk.ok, true);
if (ingestOk.ok) assert.equal(ingestOk.reviewQueue, true);

const domain = "inbound.milonfinance.com";
const addr = forwardingAddress(client, domain);
assert.ok(addr.includes(forwardingLocalPart(client)));
assert.ok(addr.endsWith(domain));

const aliasTable = [
  {
    clientId: client,
    firmId: firm,
    allowedSenders: ["partner@example.com"],
    revokedAt: null,
  },
];

const resolved = resolveInboundRecipient(addr, domain, aliasTable);
assert.ok(resolved);
assert.equal(resolved!.clientId, client);

const unknown = decideInboundDisposition({
  from: "stranger@evil.com",
  recipient: addr,
  domain,
  aliasTable,
  attachments: [{ filename: "inv.pdf", mimeType: "application/pdf", sizeBytes: 100 }],
  holdUnknownSender: true,
});
assert.equal(unknown.kind, "held");
if (unknown.kind === "held") assert.equal(unknown.reason, "unknown_sender");

const ingest = decideInboundDisposition({
  from: "partner@example.com",
  recipient: addr,
  domain,
  aliasTable,
  attachments: [{ filename: "inv.pdf", mimeType: "application/pdf", sizeBytes: 100 }],
  holdUnknownSender: true,
});
assert.equal(ingest.kind, "ingest");
if (ingest.kind === "ingest") assert.equal(ingest.channel, "email");

assert.equal(classificationStaysInReview(), true);

const panel = readFileSync(resolve("src/components/im-cloud-access-panel.tsx"), "utf8");
assert.ok(panel.includes("ImCloudAccessPanel"), "accountant panel exists");
assert.ok(!panel.includes("post to a ledger"), "no ledger auto-post copy");
const dataUp = readFileSync(resolve("src/components/data-up-to-date.tsx"), "utf8");
assert.ok(dataUp.includes("ImCloudAccessPanel"), "accountant books embeds cloud access");
const ownerSlot = readFileSync(resolve("src/components/owner-im-cloud-access.tsx"), "utf8");
assert.ok(ownerSlot.includes("OwnerImCloudAccessPanel"), "owner export slot exists for parity wiring");

const googleRead = readFileSync(resolve("src/lib/google-drive-read.ts"), "utf8");
assert.ok(!googleRead.includes("method: \"POST\"") || !googleRead.includes("/files?"), "no write create in read module");
assert.ok(googleRead.includes("assertCloudReadOnlyMethod"), "write guard wired");

console.log("im-access-ladder-test: ok");