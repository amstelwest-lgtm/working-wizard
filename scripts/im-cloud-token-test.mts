/**
 * IM cloud token encryption + OAuth SQL flag.
 * Run: pnpm test:im-cloud-token
 */
import assert from "node:assert/strict";
import {
  decryptImCloudSecret,
  encryptImCloudSecret,
  imCloudOauthSqlReady,
} from "../src/lib/im-cloud-token";

const priorFlag = process.env.IM_CLOUD_OAUTH_SQL_READY;
const priorKey = process.env.IM_CLOUD_TOKEN_KEY;

process.env.IM_CLOUD_TOKEN_KEY = "test-im-cloud-token-key-material-32+";
process.env.IM_CLOUD_OAUTH_SQL_READY = "0";
assert.equal(imCloudOauthSqlReady(), false);
process.env.IM_CLOUD_OAUTH_SQL_READY = "1";
assert.equal(imCloudOauthSqlReady(), true);

const plain = "ya29.sample-access-token-value";
const enc = encryptImCloudSecret(plain);
assert.equal(decryptImCloudSecret(enc), plain);

const tampered = enc.slice(0, -4) + (enc.endsWith("aaaa") ? "bbbb" : "aaaa");
assert.throws(() => decryptImCloudSecret(tampered));

delete process.env.IM_CLOUD_TOKEN_KEY;
assert.throws(() => encryptImCloudSecret("x"), /IM_CLOUD_TOKEN_KEY/);
assert.throws(() => decryptImCloudSecret(enc), /IM_CLOUD_TOKEN_KEY/);

if (priorFlag === undefined) delete process.env.IM_CLOUD_OAUTH_SQL_READY;
else process.env.IM_CLOUD_OAUTH_SQL_READY = priorFlag;
if (priorKey === undefined) delete process.env.IM_CLOUD_TOKEN_KEY;
else process.env.IM_CLOUD_TOKEN_KEY = priorKey;

console.log("im-cloud-token-test: ok");