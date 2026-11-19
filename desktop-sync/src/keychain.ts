import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVICE = "milon-desktop-sync";
const ACCOUNT = "device-token";

const fallbackDir = join(homedir(), ".milon-desktop-sync");
const fallbackFile = join(fallbackDir, "state.json");

export type StoredState = {
  apiBase: string;
  accessToken: string;
  refreshToken: string;
  folderMaps: Array<{ folderLabel: string; watchPath: string }>;
  seenHashes: Record<string, string>;
};

async function loadKeytar() {
  try {
    return await import("keytar");
  } catch {
    return null;
  }
}

export async function saveState(state: StoredState): Promise<void> {
  const keytar = await loadKeytar();
  const payload = JSON.stringify(state);
  if (keytar?.default) {
    await keytar.default.setPassword(SERVICE, ACCOUNT, payload);
    return;
  }
  await mkdir(fallbackDir, { recursive: true, mode: 0o700 });
  await writeFile(fallbackFile, payload, { encoding: "utf8", mode: 0o600 });
}

export async function readState(): Promise<StoredState | null> {
  const keytar = await loadKeytar();
  let raw: string | null = null;
  if (keytar?.default) {
    raw = await keytar.default.getPassword(SERVICE, ACCOUNT);
  } else {
    try {
      raw = await readFile(fallbackFile, "utf8");
    } catch {
      raw = null;
    }
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredState;
  } catch {
    return null;
  }
}

export async function clearState(): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar?.default) {
    await keytar.default.deletePassword(SERVICE, ACCOUNT);
  }
  try {
    await rm(fallbackFile, { force: true });
  } catch {
    // noop
  }
}