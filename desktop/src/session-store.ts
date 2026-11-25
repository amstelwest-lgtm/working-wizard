/**
 * Supabase session JSON, encrypted with Electron safeStorage.
 * The password is never written. Sign-out deletes the file.
 */
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";

type SessionMap = Record<string, string>;

export function sessionFilePath(): string {
  return join(app.getPath("userData"), "session.bin");
}

export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readMap(): SessionMap {
  const file = sessionFilePath();
  if (!existsSync(file)) return {};
  try {
    const plain = safeStorage.decryptString(readFileSync(file));
    const parsed = JSON.parse(plain) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const map: SessionMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") map[key] = value;
    }
    return map;
  } catch {
    rmSync(file, { force: true });
    return {};
  }
}

function writeMap(map: SessionMap): void {
  const file = sessionFilePath();
  if (Object.keys(map).length === 0) {
    rmSync(file, { force: true });
    return;
  }
  if (!encryptionAvailable()) {
    throw new Error("This PC can't encrypt the Milōn session.");
  }
  const bytes = safeStorage.encryptString(JSON.stringify(map));
  writeFileSync(file, bytes, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows may ignore the unix mode. The DPAPI blob is still encrypted. */
  }
}

export const secureSessionStorage = {
  getItem(key: string): string | null {
    return readMap()[key] ?? null;
  },
  setItem(key: string, value: string): void {
    const map = readMap();
    map[key] = value;
    writeMap(map);
  },
  removeItem(key: string): void {
    const map = readMap();
    delete map[key];
    writeMap(map);
  },
};

export function clearSessionFile(): void {
  rmSync(sessionFilePath(), { force: true });
}
