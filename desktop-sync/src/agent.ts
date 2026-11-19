import { createHash } from "node:crypto";
import chokidar from "chokidar";
import { readFile } from "node:fs/promises";
import { shouldUpload } from "./filter.ts";
import { readState, saveState, type StoredState } from "./keychain.ts";
import { refreshTokens, uploadFile } from "./api.ts";

export type WatchStatus = "watching" | "disconnected";

async function sha256File(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

export async function runWatcher(onStatus?: (status: WatchStatus) => void): Promise<() => void> {
  const state = await readState();
  if (!state) {
    onStatus?.("disconnected");
    throw new Error("Not paired");
  }

  const paths = state.folderMaps.map((row) => row.watchPath);
  const watcher = chokidar.watch(paths, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
    depth: 0,
    ignored: (watchPath) => /(^|[\\/])\./.test(watchPath),
  });

  let accessToken = state.accessToken;
  let refreshToken = state.refreshToken;

  async function handle(filePath: string, folderLabel: string) {
    const stat = await readFile(filePath).catch(() => null);
    if (!stat) return;
    const size = stat.byteLength;
    if (!shouldUpload(filePath, size)) return;

    const hash = await sha256File(filePath);
  const dedupeKey = `${folderLabel}|${hash}`;
    if (state.seenHashes[dedupeKey]) return;

    let result = await uploadFile({
      apiBase: state.apiBase,
      accessToken,
      folderLabel,
      filePath,
    });
    if (!result.ok && (result.reason === "expired" || result.reason === "token")) {
      const refreshed = (await refreshTokens(state.apiBase, refreshToken)) as {
        ok?: boolean;
        accessToken?: string;
        refreshToken?: string;
      };
      if (refreshed.ok && refreshed.accessToken && refreshed.refreshToken) {
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        const next: StoredState = { ...state, accessToken, refreshToken };
        await saveState(next);
        result = await uploadFile({
          apiBase: state.apiBase,
          accessToken,
          folderLabel,
          filePath,
        });
      }
    }
    if (!result.ok) {
      if (result.reason === "revoked" || result.reason === "off") {
        onStatus?.("disconnected");
        await watcher.close();
      }
      return;
    }
    state.seenHashes[dedupeKey] = new Date().toISOString();
    await saveState({ ...state, accessToken, refreshToken });
  }

  for (const map of state.folderMaps) {
    watcher.on("add", (filePath) => {
      if (!filePath.startsWith(map.watchPath)) return;
      void handle(filePath, map.folderLabel);
    });
  }

  onStatus?.("watching");
  return () => {
    void watcher.close();
  };
}