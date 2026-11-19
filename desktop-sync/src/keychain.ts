import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SERVICE = "milon-desktop-sync";
const ACCOUNT = "device-token";

const fallbackDir = join(homedir(), ".milon-desktop-sync");
const localStateFile = join(fallbackDir, "state.json");

export const KEYCHAIN_REQUIRED_MESSAGE =
  "Milōn desktop sync requires the OS keychain (keytar). Install keytar and pair again. Tokens are never stored in plain files.";

export type LocalState = {
  apiBase: string;
  folderMaps: Array<{ folderLabel: string; watchPath: string }>;
  seenHashes: Record<string, string>;
};

export type DeviceSecrets = {
  accessToken: string;
  refreshToken: string;
};

/** Working set for the agent (secrets live in the OS keychain only). */
export type StoredState = LocalState & DeviceSecrets;

async function loadKeytar() {
  try {
    const mod = await import("keytar");
    return mod?.default ? mod : null;
  } catch {
    return null;
  }
}

export async function keychainAvailable(): Promise<boolean> {
  const keytar = await loadKeytar();
  return Boolean(keytar?.default);
}

export async function assertKeychainAvailable(): Promise<void> {
  if (!(await keychainAvailable())) {
    throw new Error(KEYCHAIN_REQUIRED_MESSAGE);
  }
}

/** @internal for unit tests */
export function parseLocalStateJson(raw: string): LocalState | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.accessToken === "string" || typeof parsed.refreshToken === "string") {
      return null;
    }
    if (typeof parsed.apiBase !== "string" || !Array.isArray(parsed.folderMaps)) {
      return null;
    }
    const seenHashes =
      parsed.seenHashes && typeof parsed.seenHashes === "object" && !Array.isArray(parsed.seenHashes)
        ? (parsed.seenHashes as Record<string, string>)
        : {};
    return {
      apiBase: parsed.apiBase,
      folderMaps: parsed.folderMaps as LocalState["folderMaps"],
      seenHashes,
    };
  } catch {
    return null;
  }
}

async function readLocalState(): Promise<LocalState | null> {
  let raw: string;
  try {
    raw = await readFile(localStateFile, "utf8");
  } catch {
    return null;
  }
  const parsed = parseLocalStateJson(raw);
  if (!parsed) {
    await rm(localStateFile, { force: true });
    return null;
  }
  return parsed;
}

async function writeLocalState(local: LocalState): Promise<void> {
  await mkdir(fallbackDir, { recursive: true, mode: 0o700 });
  const payload = JSON.stringify({
    apiBase: local.apiBase,
    folderMaps: local.folderMaps,
    seenHashes: local.seenHashes,
  });
  await writeFile(localStateFile, payload, { encoding: "utf8", mode: 0o600 });
}

async function saveSecrets(secrets: DeviceSecrets): Promise<void> {
  await assertKeychainAvailable();
  const keytar = (await loadKeytar())!.default;
  await keytar.setPassword(SERVICE, ACCOUNT, JSON.stringify(secrets));
}

async function readSecrets(): Promise<DeviceSecrets | null> {
  const keytar = await loadKeytar();
  if (!keytar?.default) return null;
  const raw = await keytar.default.getPassword(SERVICE, ACCOUNT);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DeviceSecrets;
    if (typeof parsed.accessToken !== "string" || typeof parsed.refreshToken !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveState(state: StoredState): Promise<void> {
  await saveSecrets({
    accessToken: state.accessToken,
    refreshToken: state.refreshToken,
  });
  await writeLocalState({
    apiBase: state.apiBase,
    folderMaps: state.folderMaps,
    seenHashes: state.seenHashes,
  });
}

export async function readState(): Promise<StoredState | null> {
  await assertKeychainAvailable();
  const [secrets, local] = await Promise.all([readSecrets(), readLocalState()]);
  if (!secrets || !local) return null;
  return { ...local, ...secrets };
}

export async function clearState(): Promise<void> {
  const keytar = await loadKeytar();
  if (keytar?.default) {
    await keytar.default.deletePassword(SERVICE, ACCOUNT);
  }
  try {
    await rm(localStateFile, { force: true });
  } catch {
    // noop
  }
}