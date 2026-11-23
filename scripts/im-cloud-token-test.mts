/**
 * IM cloud token encryption + OAuth SQL flag.
 * Run: pnpm test:im-cloud-token
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decryptImCloudSecret,
  decodeImCloudTokenKey,
  encryptImCloudSecret,
  imCloudOauthSqlReady,
  imCloudTokenKeyProblem,
  IM_CLOUD_TOKEN_KEY_BYTES,
} from "../src/lib/im-cloud-token";

const priorFlag = process.env.IM_CLOUD_OAUTH_SQL_READY;
const priorKey = process.env.IM_CLOUD_TOKEN_KEY;

const keyBytes = Buffer.alloc(IM_CLOUD_TOKEN_KEY_BYTES, 7);
process.env.IM_CLOUD_TOKEN_KEY = keyBytes.toString("base64");
assert.equal(decodeImCloudTokenKey(process.env.IM_CLOUD_TOKEN_KEY).length, 32);
assert.equal(imCloudTokenKeyProblem(), null);
process.env.IM_CLOUD_TOKEN_KEY = keyBytes.toString("hex");
assert.equal(decodeImCloudTokenKey(process.env.IM_CLOUD_TOKEN_KEY).equals(keyBytes), true);
process.env.IM_CLOUD_TOKEN_KEY = keyBytes.toString("base64url");
process.env.IM_CLOUD_OAUTH_SQL_READY = "0";
assert.equal(imCloudOauthSqlReady(), false);
process.env.IM_CLOUD_OAUTH_SQL_READY = "1";
assert.equal(imCloudOauthSqlReady(), true);

const plain = "ya29.sample-access-token-value";
const enc = encryptImCloudSecret(plain);
assert.equal(decryptImCloudSecret(enc), plain);

const tampered = enc.slice(0, -4) + (enc.endsWith("aaaa") ? "bbbb" : "aaaa");
assert.throws(() => decryptImCloudSecret(tampered));

process.env.IM_CLOUD_TOKEN_KEY = "test-im-cloud-token-key-material-32+";
assert.equal(imCloudTokenKeyProblem(), "token_key_invalid");
assert.throws(() => encryptImCloudSecret("x"), /must decode to exactly 32 bytes/);
process.env.IM_CLOUD_TOKEN_KEY = "not-a-key";
assert.throws(
  () => decodeImCloudTokenKey(process.env.IM_CLOUD_TOKEN_KEY),
  /must decode to exactly 32 bytes/,
);

delete process.env.IM_CLOUD_TOKEN_KEY;
assert.equal(imCloudTokenKeyProblem(), "token_key_missing");
assert.throws(() => encryptImCloudSecret("x"), /IM_CLOUD_TOKEN_KEY/);
assert.throws(() => decryptImCloudSecret(enc), /IM_CLOUD_TOKEN_KEY/);

const poll = readFileSync("supabase/functions/im-cloud-poll/index.ts", "utf8");
assert.ok(poll.includes("imCloudTokenKeyProblem"), "poll checks the token key");
assert.ok(poll.includes("keyProblem"), "poll fails closed when the key is not 32 bytes");

if (priorFlag === undefined) delete process.env.IM_CLOUD_OAUTH_SQL_READY;
else process.env.IM_CLOUD_OAUTH_SQL_READY = priorFlag;
if (priorKey === undefined) delete process.env.IM_CLOUD_TOKEN_KEY;
else process.env.IM_CLOUD_TOKEN_KEY = priorKey;

console.log("im-cloud-token-test: ok");
