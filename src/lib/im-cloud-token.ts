/**
 * AES-256-GCM for im_cloud_connections token columns. Never log plaintext or keys.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const IM_CLOUD_TOKEN_PREFIX = "enc:v1:";

function sha256Key(material: string): Buffer {
  return createHash("sha256").update(material, "utf8").digest();
}

export function imCloudOauthSqlReady(): boolean {
  return (process.env.IM_CLOUD_OAUTH_SQL_READY ?? "").trim() === "1";
}

export function requireImCloudOauthSqlReady(): void {
  if (!imCloudOauthSqlReady()) {
    throw new Error("IM_CLOUD_OAUTH_SQL_READY is not enabled");
  }
}

function keyMaterial(): string {
  return process.env.IM_CLOUD_TOKEN_KEY?.trim() ?? "";
}

export function imCloudTokenKeyConfigured(): boolean {
  const material = keyMaterial();
  return material.length >= 16;
}

export function encryptImCloudSecret(plain: string): string {
  if (!plain) throw new Error("im_cloud_encrypt_empty");
  const material = keyMaterial();
  if (!material) throw new Error("IM_CLOUD_TOKEN_KEY is not set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sha256Key(material), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return IM_CLOUD_TOKEN_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptImCloudSecret(stored: string): string {
  const raw = stored.trim();
  if (!raw.startsWith(IM_CLOUD_TOKEN_PREFIX)) {
    throw new Error("im_cloud_ciphertext_invalid");
  }
  const material = keyMaterial();
  if (!material) throw new Error("IM_CLOUD_TOKEN_KEY is not set");
  const buf = Buffer.from(raw.slice(IM_CLOUD_TOKEN_PREFIX.length), "base64url");
  if (buf.length < 12 + 16 + 1) throw new Error("im_cloud_ciphertext_incomplete");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", sha256Key(material), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}