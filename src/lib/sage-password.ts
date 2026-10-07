/**
 * Sage Business Cloud Accounting (South Africa) stores the user's password
 * on sage_connections.password_enc. Connect (Eng2) must write it with
 * encryptSagePassword. Sync reads it with decryptSagePassword.
 *
 * enc:v1 is AES-256-GCM: 12-byte iv, 16-byte tag, then ciphertext, base64url.
 * The key is SHA-256 of SAGE_SA_PASSWORD_KEY when that is set, otherwise
 * SAGE_SA_API_KEY. Both sides must use this module so a key rotation is one
 * change. Never log the password, the key, or the ciphertext.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const SAGE_PASSWORD_PREFIX = "enc:v1:";

function keyMaterial(): string {
  const dedicated = process.env.SAGE_SA_PASSWORD_KEY?.trim() ?? "";
  if (dedicated) return dedicated;
  const apiKey = process.env.SAGE_SA_API_KEY?.trim() ?? "";
  if (apiKey) return apiKey;
  throw new Error("SAGE_SA_API_KEY is not set");
}

function keyBytes(): Buffer {
  return createHash("sha256").update(keyMaterial()).digest();
}

export function encryptSagePassword(plain: string): string {
  const secret = plain.trim();
  if (!secret) throw new Error("Sage password is empty");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return SAGE_PASSWORD_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function decryptSagePassword(stored: string): string {
  const raw = stored.trim();
  if (!raw.startsWith(SAGE_PASSWORD_PREFIX)) {
    throw new Error(
      "Sage password is not encrypted with enc:v1. Connect must save password_enc from encryptSagePassword.",
    );
  }
  try {
    const buf = Buffer.from(raw.slice(SAGE_PASSWORD_PREFIX.length), "base64url");
    if (buf.length < 12 + 16 + 1) throw new Error("Sage password ciphertext is incomplete");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    if (!plain) throw new Error("Sage password decrypted empty");
    return plain;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Sage password")) throw err;
    throw new Error("Sage password could not be decrypted. Overview figures were left unchanged.");
  }
}
