/**
 * Sage Business Cloud Accounting (SA) connect scaffolding.
 * No live Sage calls. Run: pnpm test:sage-connect
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyLedgerSyncFinancials,
  emptyLedgerSyncError,
  ledgerSyncWouldWipe,
} from "../src/lib/ledger-sync-financials";
import { describeLedgerLink } from "../src/lib/ledger-link-copy";
import { isDatedLedgerSource } from "../src/lib/statement-period";
import {
  SAGE_EMPTY_SYNC_MESSAGE,
  parseSageCompany,
  sageBasicAuthorization,
  sageCompanyValidateUrl,
  sageConnectionInsert,
  sageCredentialsConfigured,
  sageSyncPopulatedFields,
  sageSyncWriteDecision,
  sageValidateError,
  validateSageLogin,
} from "../src/lib/sage";
import {
  decryptSagePassword,
  decryptSagePasswordDetailed,
  encryptSagePassword,
  SAGE_PASSWORD_PREFIX,
} from "../src/lib/sage-password";

import { createCipheriv, createHash, randomBytes } from "node:crypto";
import {
  normalizeSageApiBase,
  SAGE_SA_LIVE_API_BASE,
  SAGE_SA_SANDBOX_API_BASE,
  sageApiBase,
} from "../src/lib/sage-config";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

process.env.SAGE_SA_API_KEY = "test-api-key";
delete process.env.SAGE_SA_PASSWORD_KEY;
delete process.env.SAGE_SA_BASE_URL;

assert(!sageCredentialsConfigured(), "API key alone is not enough: the password key is required");
process.env.SAGE_SA_PASSWORD_KEY = "dedicated-password-key";
assert(sageCredentialsConfigured(), "API key + password key marks Sage as configured");
delete process.env.SAGE_SA_API_KEY;
assert(!sageCredentialsConfigured(), "missing API key is not configured");
process.env.SAGE_SA_API_KEY = "test-api-key";
delete process.env.SAGE_SA_PASSWORD_KEY;

const auth = sageBasicAuthorization("owner@example.co.za", "p@ss:word");
assert(auth.startsWith("Basic "), "Basic auth prefix");
assert(!auth.includes("p@ss:word"), "password is not left in the header text");
assert(atob(auth.slice("Basic ".length)).includes("owner@example.co.za"), "email is in the basic token");

const url = sageCompanyValidateUrl("42", "test-api-key");
assert(url.startsWith("https://accounting.sageone.co.za/api/2.0.0/Company/Get/42"), "validate hits Company/Get");
assert(url.includes("apikey=test-api-key"), "API key is the apikey query parameter");
assert(url.includes("companyid=42"), "company id is sent with the company read");
assert(!url.includes("/oauth"), "validate URL is not an OAuth endpoint");

const parsed = parseSageCompany({ ID: 42, Name: "Cape Books" }, "42");
assert(parsed?.companyName === "Cape Books", "company name is read from Sage");
assert(parsed?.companyId === "42", "company id is the one the user typed");
assert(parseSageCompany({ Results: [{ ID: 7, Name: "Other" }] }, "42") === null, "a different company is not a match");
assert(
  parseSageCompany({ Results: [{ ID: 42, Name: "Listed" }] }, "42")?.companyName === "Listed",
  "a results list can confirm the company",
);

const originalFetch = globalThis.fetch;
let seenUrl = "";
let seenAuth = "";
globalThis.fetch = async (input, init) => {
  seenUrl = String(input);
  const headers = init?.headers as Record<string, string>;
  seenAuth = headers.Authorization;
  return new Response(JSON.stringify({ ID: 42, Name: "Cape Books" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const ok = await validateSageLogin({
  username: "owner@example.co.za",
  password: "s3cret",
  companyId: "42",
  apiKey: "test-api-key",
});
assert(ok.ok === true && ok.company.companyName === "Cape Books", "validate happy path returns the company");
assert(seenUrl.includes("apikey=test-api-key"), "validate sends the API key");
assert(seenAuth.startsWith("Basic "), "validate sends Basic auth");
assert(!seenUrl.includes("s3cret"), "password is not put on the URL");
assert(!seenUrl.includes("ProfitAndLoss") && !seenUrl.includes("BalanceSheet"), "validate does not pull statements");

globalThis.fetch = async () => new Response("no", { status: 401 });
const rejected = await validateSageLogin({
  username: "owner@example.co.za",
  password: "wrong",
  companyId: "42",
  apiKey: "test-api-key",
});
assert(rejected.ok === false && rejected.reason === "rejected", "401 is a rejected login");
assert(sageValidateError("rejected") === "Sage rejected that email or password.", "rejected copy names Sage");

globalThis.fetch = async () => new Response("missing", { status: 404 });
const missing = await validateSageLogin({
  username: "owner@example.co.za",
  password: "s3cret",
  companyId: "99",
  apiKey: "test-api-key",
});
assert(missing.ok === false && missing.reason === "company_not_found", "404 is an unknown company");

const unconfigured = await validateSageLogin(
  { username: "a@b.co", password: "x", companyId: "1", apiKey: "  " },
  async () => {
    throw new Error("should not call Sage without a key");
  },
);
assert(unconfigured.ok === false && unconfigured.reason === "not_configured", "blank key does not call Sage");

globalThis.fetch = originalFetch;

// No dedicated key: new ciphertext is refused (the API key is decrypt-only).
let refusedWithoutKey = false;
try {
  encryptSagePassword("s3cret");
} catch (err) {
  refusedWithoutKey = err instanceof Error && /SAGE_SA_PASSWORD_KEY is not set/.test(err.message);
}
assert(refusedWithoutKey, "encrypt refuses to use the API key when SAGE_SA_PASSWORD_KEY is unset");

// Build a legacy (API-key) ciphertext the way the old module wrote it.
const legacyCipher = (() => {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", createHash("sha256").update("test-api-key").digest(), iv);
  const ct = Buffer.concat([c.update("s3cret", "utf8"), c.final()]);
  return SAGE_PASSWORD_PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
})();
const legacyOnly = decryptSagePasswordDetailed(legacyCipher);
assert(legacyOnly.plain === "s3cret", "legacy row decrypts with the API key when no password key is set");
assert(legacyOnly.keySource === "legacy_api_key", "legacy key source is reported");
assert(!legacyOnly.needsReencrypt, "no re-encrypt without a dedicated key to move to");

process.env.SAGE_SA_PASSWORD_KEY = "dedicated-password-key";
const cipher = encryptSagePassword("s3cret");
assert(cipher.startsWith(SAGE_PASSWORD_PREFIX), "password uses enc:v1");
assert(SAGE_PASSWORD_PREFIX === "enc:v1:", "prefix matches the sync decrypt");
assert(!cipher.includes("s3cret"), "ciphertext does not contain the password");
assert(cipher !== legacyCipher, "dedicated ciphertext differs from the legacy one");
const freshDecrypt = decryptSagePasswordDetailed(cipher);
assert(freshDecrypt.plain === "s3cret" && freshDecrypt.keySource === "password_key", "dedicated key round-trips");
assert(!freshDecrypt.needsReencrypt, "dedicated ciphertext does not need re-encrypting");

const migrating = decryptSagePasswordDetailed(legacyCipher);
assert(migrating.plain === "s3cret", "legacy row still decrypts once the password key is set");
assert(migrating.keySource === "legacy_api_key" && migrating.needsReencrypt, "legacy row is flagged for re-encrypt");
const reencrypted = encryptSagePassword(migrating.plain);
assert(decryptSagePasswordDetailed(reencrypted).keySource === "password_key", "re-encrypted row uses the password key");

// Swapping the API key (sandbox -> live) keeps dedicated-key rows readable.
process.env.SAGE_SA_API_KEY = "live-api-key";
assert(decryptSagePassword(cipher) === "s3cret", "API key swap does not break password_key rows");
let swappedLegacy = false;
try {
  decryptSagePassword(legacyCipher);
} catch {
  swappedLegacy = true;
}
assert(swappedLegacy, "a legacy row cannot decrypt after the API key changes (why the dedicated key exists)");
process.env.SAGE_SA_API_KEY = "test-api-key";

// Wrong dedicated key and no matching legacy key: refused, nothing leaked.
process.env.SAGE_SA_PASSWORD_KEY = "some-other-key";
let wrongKey = "";
try {
  decryptSagePassword(cipher);
} catch (err) {
  wrongKey = err instanceof Error ? err.message : "";
}
assert(/could not be decrypted/.test(wrongKey) && !wrongKey.includes("s3cret"), "wrong key is refused without leaking");
process.env.SAGE_SA_PASSWORD_KEY = "dedicated-password-key";

// Base URL: default live, sandbox via SAGE_SA_BASE_URL, unsafe values fall back to live.
assert(sageApiBase() === SAGE_SA_LIVE_API_BASE, "unset base URL is the live host");
process.env.SAGE_SA_BASE_URL = "https://resellers.accounting.sageone.co.za/api/2.0.0/";
assert(sageApiBase() === SAGE_SA_SANDBOX_API_BASE, "sandbox base URL is honoured (trailing slash trimmed)");
assert(
  sageCompanyValidateUrl("42", "k").startsWith(`${SAGE_SA_SANDBOX_API_BASE}/Company/Get/42`),
  "validate uses the configured sandbox host",
);
assert(normalizeSageApiBase("http://resellers.accounting.sageone.co.za/api/2.0.0") === SAGE_SA_LIVE_API_BASE, "http is refused");
assert(normalizeSageApiBase("https://evil.example.com/api/2.0.0") === SAGE_SA_LIVE_API_BASE, "foreign host is refused");
assert(normalizeSageApiBase("https://sageone.co.za.evil.com/api") === SAGE_SA_LIVE_API_BASE, "lookalike host is refused");
assert(normalizeSageApiBase("not a url") === SAGE_SA_LIVE_API_BASE, "garbage falls back to live");
assert(normalizeSageApiBase("   ") === SAGE_SA_LIVE_API_BASE, "blank falls back to live");
delete process.env.SAGE_SA_BASE_URL;

const row = sageConnectionInsert({
  clientId: "11111111-1111-1111-1111-111111111111",
  username: "owner@example.co.za",
  passwordEnc: cipher,
  company: { companyId: "42", companyName: "Cape Books" },
  connectedAt: "2026-10-07T12:00:00.000Z",
});
assert(row.password_enc === cipher, "stored column is password_enc");
assert(row.username === "owner@example.co.za", "email is stored");
assert(row.company_id === "42", "company id is stored");
assert(row.sync_status === "idle", "a new connection has not synced");
assert(row.last_synced_at === null, "connect does not pretend a sync ran");
assert(!("access_token" in row) && !("refresh_token" in row), "no OAuth token columns");

const live = { statementSource: "xero", revenue: 5000, cash: 800, periodStart: "2026-09-01", periodEnd: "2026-09-30" };
const emptyDecision = sageSyncWriteDecision({}, live);
assert(emptyDecision.write === false, "no figures is not a write");
if (!emptyDecision.write) {
  assert(emptyDecision.error.includes("left unchanged"), "empty sync says figures were left unchanged");
  assert(emptyDecision.error.includes("Sage"), "empty sync names Sage");
  assert(!emptyDecision.error.includes("Xero"), "empty Sage sync is not labelled Xero");
}
assert(SAGE_EMPTY_SYNC_MESSAGE.includes("left unchanged"), "the sync stub tells the user nothing was written");
assert(
  sageSyncPopulatedFields({ populated: false, fields: { revenue: "10", periodStart: "2026-10-01" } }) ===
    null,
  "the connect stub does not hand empty-sync fields to the board",
);
const eng1Fields = {
  revenue: "1200",
  cash: "80",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-07",
};
assert(
  sageSyncPopulatedFields({ fields: eng1Fields })?.revenue === "1200",
  "Eng1 fields without a populated flag still reach auto-populate",
);
assert(sageSyncPopulatedFields({ fields: {} }) === null, "blank fields are not a populate");

const zeroSage: Record<string, string | number> = {
  statementSource: "sage",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-07",
  periodLabel: "1 Oct 2026 – 7 Oct 2026",
  revenue: 0,
  netIncome: 0,
  cash: 0,
  totalAssets: 0,
  equity: 0,
};
assert(ledgerSyncWouldWipe(live, zeroSage), "an all-zero Sage report would wipe live figures");
const kept = applyLedgerSyncFinancials(live, zeroSage, "sage");
assert(kept.statementSource === "xero", "empty Sage sync does not take the live statement");
assert(kept.revenue === 5000, "empty Sage sync keeps revenue");
assert(emptyLedgerSyncError("sage").startsWith("Sage "), "provider enum names Sage");
assert(isDatedLedgerSource("sage"), "Sage is a dated ledger source once Eng1 writes one");

const copy = describeLedgerLink(
  {
    provider: "sage",
    lastSyncedAt: null,
    syncStatus: "idle",
    figuresFromThisSync: false,
    own: null,
    board: null,
  },
  () => "unused",
);
assert(copy.statusLine.includes("Sage"), "Sage link copy uses the Sage name");
assert(!copy.statusLine.includes("QuickBooks"), "Sage is not described as QuickBooks");
assert(copy.showOwnStats === false, "a connection with no sync does not show a ratio grid");

const migration = read("supabase/migrations/20261007170000_sage_sa_connections.sql");
assert(migration.includes("CREATE TABLE IF NOT EXISTS public.sage_connections"), "connections table");
assert(migration.includes("password_enc"), "password column is password_enc");
assert(migration.includes("company_id"), "company id column");
assert(migration.includes("CREATE TABLE IF NOT EXISTS public.sage_sync_data"), "sync cache table");
assert(migration.includes("ENABLE ROW LEVEL SECURITY"), "RLS on");
assert(!/CREATE POLICY/i.test(migration), "deny-all — no policies");
assert(!/oauth|access_token|refresh_token|redirect_uri/i.test(migration), "no OAuth table or token columns");

const fn = read("src/lib/sage.functions.ts");
assert(fn.includes("validateSageLogin"), "connect validates with Sage");
assert(fn.includes('from "@/lib/sage-password"'), "connect encrypts with the shared password module");
assert(fn.includes("encryptSagePassword"), "connect encrypts the password");
assert(!fn.includes("SESSION_SECRET"), "connect does not key the password off the session secret");
assert(fn.includes("sage_connections"), "connect stores the connection");
assert(fn.includes("executeSageSync"), "sync fills the connect stub");
assert(
  read("src/lib/sage-sync.server.ts").includes("sageSyncWriteDecision"),
  "sync uses the empty-sync guard",
);
assert(!fn.includes("TODO(Eng1)"), "the connect stub is filled");
assert(!fn.includes("runAutoPopulate"), "sync does not auto-populate inside connect");
assert(!fn.includes("applyLedgerSyncFinancials"), "statement writes stay out of the connect module");
assert(!fn.includes("password_enc"), "status select does not return the password column");

const card = read("src/components/sage-connect.tsx");
assert(card.includes('brand="sage"'), "card uses the shared connect button");
assert(card.includes("Email"), "card asks for email");
assert(card.includes("Password"), "card asks for password");
assert(card.includes("Company ID"), "card asks for Company ID");
assert(card.includes("SAGE_SA_API_KEY"), "missing key shows the not-configured state");
assert(card.includes("SAGE_SA_PASSWORD_KEY"), "not-configured state names the password key too");
assert(card.includes('id="sage-empty-sync"'), "empty sync has a visible state");
assert(card.includes(': "Sync"'), "connected card has Sync");
assert(card.includes("Disconnect"), "connected card has Disconnect");
assert(!card.includes("onSyncComplete?.(result.fields)") || card.includes("result.populated"), "sync completion waits for real figures");
assert(card.includes("sageSyncPopulatedFields"), "sync completion waits for real figures");
assert(!read("src/lib/sage.ts").includes("SESSION_SECRET"), "sage.ts does not encrypt with SESSION_SECRET");
assert(read("src/lib/sage-password.ts").includes('SAGE_PASSWORD_PREFIX = "enc:v1:"'), "shared prefix is enc:v1");
assert(read("docs/SAGE_SA.md").includes("SAGE_SA_PASSWORD_KEY"), "docs name the optional password key");
assert(read("docs/SAGE_SA.md").includes("SAGE_SA_API_KEY"), "docs say the API key is the fallback cipher");
assert(!read("docs/SAGE_SA.md").includes("SESSION_SECRET"), "docs do not use the session secret as the Sage key");

const owner = read("src/routes/app.tsx");
const studio = read("src/routes/_authenticated/clients.$clientId.tsx");
const briefing = read("src/components/client-briefing.tsx");
const fresh = read("src/components/data-up-to-date.tsx");
assert(owner.includes("<SageConnectCard"), "owner app mounts Sage connect");
assert(owner.includes('id="owner-connect-sage"'), "owner data sources show Connect Sage");
assert(owner.includes('id="owner-header-sage"'), "owner header shows Sage next to Xero");
assert(owner.includes("Connect Sage"), "owner first-data offers Sage");
assert(studio.includes("<SageConnectCard"), "accountant studio mounts Sage connect");
assert(studio.includes('label="Connect Sage"'), "accountant Other ways offers Sage");
assert(studio.includes('id="accounting-connect"'), "Sage sits on the accounting connect surface");
assert(briefing.includes('id="client-connect-sage"'), "briefing shows Connect Sage");
assert(fresh.includes("<SageConnectCard"), "data step shows Sage beside Xero and QuickBooks");
assert(fresh.includes("onSageSyncComplete"), "data step can auto-populate after a Sage sync");
assert(owner.includes("auto-populate after Sage sync:"), "owner Sage sync runs auto-populate");
assert(owner.includes("runSyncAutoPopulate"), "owner sync runs auto-populate");
assert(studio.includes('populateAfterSync(inputs, "Sage")'), "accountant Sage sync shares the populate path");
assert(!existsSync(resolve("src/routes/api/sage/callback.ts")), "no Sage OAuth callback route");
assert(!read("src/routeTree.gen.ts").includes("/api/sage/callback"), "route tree has no Sage callback");
assert(!read(".env.example").includes("SAGE_CLIENT_SECRET"), "no OAuth client secret env");
assert(read(".env.example").includes("SAGE_SA_API_KEY"), "env example names the API key");
assert(read("docs/SAGE_SA.md").includes("SAGE_SA_API_KEY"), "docs tell Theo where the key goes");

console.log("sage-connect-test: ok");
