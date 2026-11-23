/**
 * AES-256-GCM for im_cloud_connections token columns. Never log plaintext or keys.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const IM_CLOUD_TOKEN_PREFIX = "enc:v1:";
export const IM_CLOUD_TOKEN_KEY_BYTES = 32;

export function imCloudOauthSqlReady(): boolean {
  return (process.env.IM_CLOUD_OAUTH_SQL_READY ?? "").trim() === "1";
}

export function requireImCloudOauthSqlReady(): void {
  if (!imCloudOauthSqlReady()) {
    throw new Error("IM_CLOUD_OAUTH_SQL_READY is not enabled");
  }
}

function keyMaterial(): string {
  const fromProcess = process.env.IM_CLOUD_TOKEN_KEY?.trim() ?? "";
  if (fromProcess) return fromProcess;
  const deno = (globalThis as { Deno?: { env?: { get?: (name: string) => string | undefined } } })
    .Deno;
  return (deno?.env?.get?.("IM_CLOUD_TOKEN_KEY") ?? "").trim();
}

/** base64, base64url, or 64-char hex. Anything else is refused — the raw value is not hashed. */
export function decodeImCloudTokenKey(material: string): Buffer {
  const trimmed = material.trim();
  if (!trimmed) throw new Error("IM_CLOUD_TOKEN_KEY is not set");
  let bytes: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    bytes = Buffer.from(trimmed, "hex");
  } else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    bytes = Buffer.from(normalized + pad, "base64");
  } else {
    throw new Error("IM_CLOUD_TOKEN_KEY must decode to exactly 32 bytes");
  }
  if (bytes.length !== IM_CLOUD_TOKEN_KEY_BYTES) {
    throw new Error("IM_CLOUD_TOKEN_KEY must decode to exactly 32 bytes");
  }
  return bytes;
}

export function imCloudTokenKeyProblem(): "token_key_missing" | "token_key_invalid" | null {
  const material = keyMaterial();
  if (!material) return "token_key_missing";
  try {
    decodeImCloudTokenKey(material);
    return null;
  } catch (err) {
    if (err instanceof Error && err.message === "IM_CLOUD_TOKEN_KEY is not set")
      return "token_key_missing";
    return "token_key_invalid";
  }
}

export function imCloudTokenKeyConfigured(): boolean {
  return imCloudTokenKeyProblem() === null;
}

function tokenKeyBytes(): Buffer {
  const material = keyMaterial();
  if (!material) throw new Error("IM_CLOUD_TOKEN_KEY is not set");
  return decodeImCloudTokenKey(material);
}

export function encryptImCloudSecret(plain: string): string {
  if (!plain) throw new Error("im_cloud_encrypt_empty");
  const key = tokenKeyBytes();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return IM_CLOUD_TOKEN_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptImCloudSecret(stored: string): string {
  const raw = stored.trim();
  if (!raw.startsWith(IM_CLOUD_TOKEN_PREFIX)) {
    throw new Error("im_cloud_ciphertext_invalid");
  }
  const key = tokenKeyBytes();
  const buf = Buffer.from(raw.slice(IM_CLOUD_TOKEN_PREFIX.length), "base64url");
  if (buf.length < 12 + 16 + 1) throw new Error("im_cloud_ciphertext_incomplete");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
