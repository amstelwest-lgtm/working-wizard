/**
 * File passwords for a client send. AES-GCM, server key only.
 * The ciphertext is what we store. The plaintext is never logged.
 */

export const CLIENT_AGENT_FILE_PASSWORD_KEY = "CLIENT_AGENT_FILE_PASSWORD_KEY";

export type SealedFilePassword = { iv: string; box: string };

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function b64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** 32 raw bytes, base64 in the env var. Anything else is unusable. */
export function filePasswordKey(raw: string | null | undefined): Uint8Array | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const bytes = b64ToBytes(trimmed);
  if (!bytes || bytes.length !== 32) return null;
  return bytes;
}

export async function sealFilePassword(
  plain: string,
  key: Uint8Array,
): Promise<SealedFilePassword> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    new TextEncoder().encode(plain),
  );
  return { iv: bytesToB64(iv), box: bytesToB64(new Uint8Array(cipher)) };
}

export async function openFilePassword(
  sealed: SealedFilePassword,
  key: Uint8Array,
): Promise<string | null> {
  const iv = b64ToBytes(sealed.iv);
  const box = b64ToBytes(sealed.box);
  if (!iv || iv.length !== 12 || !box) return null;
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, box);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
