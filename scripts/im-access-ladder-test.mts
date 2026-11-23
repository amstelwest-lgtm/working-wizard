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
import { cloudIngestPaused, parseImAccessSettings } from "../src/lib/im-access-settings";
import {
  decideInboundDisposition,
  forwardingAddress,
  forwardingLocalPart,
  resolveInboundRecipient,
} from "../src/lib/im-inbound-forward";
import { validateCloudFileForIngest } from "../src/lib/im-cloud-ingest";
import { classificationStaysInReview } from "../src/lib/im-cloud-ingest";
import { sanitizeImCloudReturnPath } from "../src/lib/im-cloud-oauth-state";
import { googleRefreshFromTokenResponse } from "../src/lib/im-cloud-oauth.server";
import { buildGoogleDriveAuthUrl } from "../src/lib/google-drive-read";
import {
  IM_DOCUMENTS_COMING_SOON,
  imCloudConnectVisible,
  imCloudStatusPill,
} from "../src/lib/im-documents-status";

const client = "e8f7a440-2222-2222-2222-222222222222";
const firm = "e8f7a440-a541-422c-8e4f-82ba33dd0604";

assert.equal(IM_ACCESS_RUNG_GOOGLE, 3);
assert.equal(IM_ACCESS_RUNG_MICROSOFT, 4);

assert.throws(() => assertCloudReadOnlyMethod("delete"), /cloud_write_forbidden/);
assert.throws(() => assertCloudReadOnlyMethod("upload"), /cloud_write_forbidden/);
assert.doesNotThrow(() => assertCloudReadOnlyMethod("list"));

const scopes = googleDriveScopesForPickedFolders();
assert.deepEqual(scopes, ["https://www.googleapis.com/auth/drive.file"]);
assert.ok(!scopes.some((s) => s.includes("drive.readonly")));

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

const active = parseImAccessSettings({
  version: 1,
  picks: [pickGoogle],
  revokedAt: null,
  forwarding: { allowedSenders: [] },
});
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
const documentsCard = readFileSync(resolve("src/components/im-documents-card.tsx"), "utf8");
assert.ok(panel.includes("ImCloudAccessPanel"), "accountant panel exists");
assert.ok(panel.includes("getImCloudAuthUrl"), "connect calls the auth url");
assert.ok(
  panel.includes("Connect Google Drive") && panel.includes("Connect OneDrive"),
  "connect buttons exist",
);
assert.ok(!panel.includes("OAuth not configured"), "no oauth error placeholder");
assert.ok(!panel.includes("MILON_SOURCE_INBOUND_DOMAIN"), "no env-var names for accountants");
assert.ok(!panel.includes("folder id"), "no raw folder id field");
assert.ok(documentsCard.includes("Documents"), "one Documents card");
assert.ok(documentsCard.includes("IM_DOCUMENTS_COMING_SOON"), "the card uses the calm sentence");
assert.ok(
  IM_DOCUMENTS_COMING_SOON ===
    "Drive and OneDrive: coming soon, not needed for the pilot. Clients can upload through Send an agent.",
  "coming soon copy is the calm sentence",
);
assert.equal(
  imCloudConnectVisible({ credentials: false, oauthSqlReady: true, tokenKeyReady: true }),
  false,
);
assert.equal(
  imCloudConnectVisible({ credentials: true, oauthSqlReady: false, tokenKeyReady: true }),
  false,
);
assert.equal(
  imCloudConnectVisible({ credentials: true, oauthSqlReady: true, tokenKeyReady: false }),
  false,
);
assert.equal(
  imCloudConnectVisible({ credentials: true, oauthSqlReady: true, tokenKeyReady: true }),
  true,
);
assert.equal(
  imCloudStatusPill({ connectVisible: false, connected: false, paused: false }),
  "Not set up",
);
assert.equal(
  imCloudStatusPill({ connectVisible: true, connected: false, paused: false }),
  "Ready to connect",
);
assert.equal(
  imCloudStatusPill({ connectVisible: true, connected: true, paused: false }),
  "Connected",
);
assert.equal(imCloudStatusPill({ connectVisible: true, connected: true, paused: true }), "Paused");
assert.ok(!panel.includes("post to a ledger"), "no ledger auto-post copy");

const bound = "e8f7a440-2222-2222-2222-222222222222";
const boundPath = `/clients/${bound}`;
assert.equal(sanitizeImCloudReturnPath(boundPath, bound), boundPath);
assert.equal(sanitizeImCloudReturnPath(`${boundPath}?gdrive=connected`, bound), boundPath);
assert.equal(sanitizeImCloudReturnPath(`${boundPath}/books`, bound), `${boundPath}/books`);
assert.equal(sanitizeImCloudReturnPath("/app", bound), boundPath);
assert.equal(sanitizeImCloudReturnPath("/clients/other-client", bound), boundPath);
assert.equal(sanitizeImCloudReturnPath(`${boundPath}-evil`, bound), boundPath);
assert.equal(sanitizeImCloudReturnPath(`https://evil.example${boundPath}`, bound), boundPath);
assert.equal(sanitizeImCloudReturnPath(`//evil.example${boundPath}`, bound), boundPath);
assert.equal(sanitizeImCloudReturnPath(`${boundPath}/../../admin`, bound), boundPath);

assert.throws(
  () => googleRefreshFromTokenResponse({ accessToken: "access-token", refreshToken: undefined }),
  /google_refresh_token_missing/,
);
assert.throws(
  () =>
    googleRefreshFromTokenResponse({ accessToken: "access-token", refreshToken: "access-token" }),
  /google_refresh_token_missing/,
);
assert.equal(
  googleRefreshFromTokenResponse({ accessToken: "access-token", refreshToken: "refresh-token" }),
  "refresh-token",
);
assert.equal(
  googleRefreshFromTokenResponse({
    accessToken: "access-token",
    refreshToken: undefined,
    previousRefreshToken: "kept-refresh",
  }),
  "kept-refresh",
);

const priorGoogleId = process.env.GOOGLE_DRIVE_CLIENT_ID;
process.env.GOOGLE_DRIVE_CLIENT_ID = "test-client";
const authUrl = buildGoogleDriveAuthUrl({
  state: "state-1",
  redirectUri: "https://example.com/api/google-drive/callback",
});
assert.ok(authUrl.includes("drive.file"), "auth url requests drive.file");
assert.ok(!authUrl.includes("drive.readonly"), "auth url does not request drive.readonly");
assert.ok(
  authUrl.includes("prompt=consent"),
  "auth url asks for consent so a refresh token is issued",
);
if (priorGoogleId === undefined) delete process.env.GOOGLE_DRIVE_CLIENT_ID;
else process.env.GOOGLE_DRIVE_CLIENT_ID = priorGoogleId;
const dataUp = readFileSync(resolve("src/components/data-up-to-date.tsx"), "utf8");
assert.ok(dataUp.includes("ImCloudAccessPanel"), "accountant books embeds cloud access");
const ownerSlot = readFileSync(resolve("src/components/owner-im-cloud-access.tsx"), "utf8");
assert.ok(
  ownerSlot.includes("OwnerImCloudAccessPanel"),
  "owner export slot exists for parity wiring",
);

const googleRead = readFileSync(resolve("src/lib/google-drive-read.ts"), "utf8");
assert.ok(
  !googleRead.includes('method: "POST"') || !googleRead.includes("/files?"),
  "no write create in read module",
);
assert.ok(googleRead.includes("assertCloudReadOnlyMethod"), "write guard wired");

const cloudMig = readFileSync(
  resolve("supabase/migrations/20261119103000_im_cloud_oauth_connections.sql"),
  "utf8",
);
assert.ok(!cloudMig.includes("access_token_enc  TEXT NOT NULL"), "access_token_enc is nullable");
assert.ok(!cloudMig.includes("refresh_token_enc TEXT NOT NULL"), "refresh_token_enc is nullable");
assert.ok(
  cloudMig.includes("im_cloud_connections_tokens_revoked_ck"),
  "revoke clears tokens check",
);
assert.ok(cloudMig.endsWith("\n"), "migration file has trailing newline");

console.log("im-access-ladder-test: ok");
