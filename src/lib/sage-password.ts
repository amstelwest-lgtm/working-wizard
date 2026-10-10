/**
 * Sage Business Cloud Accounting (South Africa) stores the user's password
 * on sage_connections.password_enc. Connect (Eng2) must write it with
 * encryptSagePassword. Sync reads it with decryptSagePasswordDetailed.
 *
 * enc:v1 is AES-256-GCM: 12-byte iv, 16-byte tag, then ciphertext, base64url.
 * The key is SHA-256 of SAGE_SA_PASSWORD_KEY. New ciphertext is only ever
 * written with that dedicated key, so swapping the Sage API key (sandbox to
 * live) never breaks stored connections.
 *
 * Backward compatibility: rows written before the dedicated key existed were
 * encrypted with SHA-256 of SAGE_SA_API_KEY. Decrypt tries the dedicated key
 * first, then the API key. A legacy hit is reported so the caller can
 * re-encrypt with the dedicated key after the next successful Sage call.
 *
 * Never log the password, either key, or the ciphertext.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const SAGE_PASSWORD_PREFIX = "enc:v1:";

export type SagePasswordKeySource = "password_key" | "legacy_api_key";

function sha256(material: string): Buffer {
  return createHash("sha256").update(material).digest();
}

function dedicatedKeyMaterial(): string {
  return process.env.SAGE_SA_PASSWORD_KEY?.trim() ?? "";
}

function legacyKeyMaterial(): string {
  return process.env.SAGE_SA_API_KEY?.trim() ?? "";
}

export function encryptSagePassword(plain: string): string {
  const secret = plain.trim();
  if (!secret) throw new Error("Sage password is empty");
  const material = dedicatedKeyMaterial();
  if (!material) throw new Error("SAGE_SA_PASSWORD_KEY is not set");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sha256(material), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return SAGE_PASSWORD_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

function tryDecrypt(buf: Buffer, key: Buffer): string | null {
  try {
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function decryptSagePasswordDetailed(stored: string): {
  plain: string;
  keySource: SagePasswordKeySource;
  /** True when the row should be re-encrypted with SAGE_SA_PASSWORD_KEY. */
  needsReencrypt: boolean;
} {
  const raw = stored.trim();
  if (!raw.startsWith(SAGE_PASSWORD_PREFIX)) {
    throw new Error(
      "Sage password is not encrypted with enc:v1. Connect must save password_enc from encryptSagePassword.",
    );
  }
  const buf = Buffer.from(raw.slice(SAGE_PASSWORD_PREFIX.length), "base64url");
  if (buf.length < 12 + 16 + 1) throw new Error("Sage password ciphertext is incomplete");

  const dedicated = dedicatedKeyMaterial();
  const legacy = legacyKeyMaterial();
  if (!dedicated && !legacy) throw new Error("SAGE_SA_PASSWORD_KEY is not set");

  if (dedicated) {
    const plain = tryDecrypt(buf, sha256(dedicated));
    if (plain) return { plain, keySource: "password_key", needsReencrypt: false };
  }
  if (legacy) {
    const plain = tryDecrypt(buf, sha256(legacy));
    if (plain) return { plain, keySource: "legacy_api_key", needsReencrypt: Boolean(dedicated) };
  }
  throw new Error("Sage password could not be decrypted. Overview figures were left unchanged.");
}

export function decryptSagePassword(stored: string): string {
  return decryptSagePasswordDetailed(stored).plain;
}
