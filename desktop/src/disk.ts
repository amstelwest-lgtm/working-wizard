import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import { currentBooksPeriod } from "./classifier";

export type Settings = {
  folder: string | null;
  clientId: string | null;
  period: string;
};

export type HistoryEntry = {
  sha256: string;
  clientId: string;
  documentId: string | null;
  at: string;
};

function settingsFile(): string {
  return join(app.getPath("userData"), "settings.json");
}

function historyFile(): string {
  return join(app.getPath("userData"), "history.json");
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
}

export function loadSettings(): Settings {
  const fallback: Settings = { folder: null, clientId: null, period: currentBooksPeriod() };
  if (!existsSync(settingsFile())) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(settingsFile(), "utf8")) as Partial<Settings>;
    return {
      folder: typeof parsed.folder === "string" && parsed.folder.trim() ? parsed.folder : null,
      clientId: typeof parsed.clientId === "string" && parsed.clientId.trim() ? parsed.clientId : null,
      period: typeof parsed.period === "string" && /^\d{4}-\d{2}$/.test(parsed.period)
        ? parsed.period
        : fallback.period,
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings: Settings): void {
  writeJson(settingsFile(), settings);
}

export function loadHistory(): HistoryEntry[] {
  if (!existsSync(historyFile())) return [];
  try {
    const parsed = JSON.parse(readFileSync(historyFile(), "utf8")) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return [];
    return parsed.files.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const record = row as Partial<HistoryEntry>;
      if (typeof record.sha256 !== "string" || typeof record.clientId !== "string") return [];
      return [{
        sha256: record.sha256,
        clientId: record.clientId,
        documentId: typeof record.documentId === "string" ? record.documentId : null,
        at: typeof record.at === "string" ? record.at : "",
      }];
    });
  } catch {
    return [];
  }
}

export function rememberUpload(entry: HistoryEntry): void {
  const files = loadHistory().filter(
    (row) => !(row.sha256 === entry.sha256 && row.clientId === entry.clientId),
  );
  files.push(entry);
  writeJson(historyFile(), { files: files.slice(-2000) });
}

export function historyHas(sha256: string, clientId: string): boolean {
  return loadHistory().some((row) => row.sha256 === sha256 && row.clientId === clientId);
}
