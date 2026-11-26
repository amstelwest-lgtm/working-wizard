import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Cap desktop.log so a long-lived tray app cannot fill the disk. */
export const DESKTOP_LOG_MAX_BYTES = 1_000_000;

/** The only line this file accepts. Name and code, nothing else. */
const SAFE_LINE = /^\[milon-desktop\] sign-in name=[A-Za-z][A-Za-z0-9_]{0,80} code=[A-Za-z0-9_]{0,64}$/;

export function desktopLogPath(userDataDir: string): string {
  return join(userDataDir, "logs", "desktop.log");
}

/** Append one redacted sign-in line under userData/logs. Drops anything else. */
export function appendDesktopLog(userDataDir: string, line: string): void {
  if (!userDataDir) return;
  const text = line.endsWith("\n") ? line.slice(0, -1) : line;
  if (!SAFE_LINE.test(text)) return;
  const dir = join(userDataDir, "logs");
  mkdirSync(dir, { recursive: true });
  const file = desktopLogPath(userDataDir);
  appendFileSync(file, `${text}\n`, "utf8");
  const size = statSync(file).size;
  if (size <= DESKTOP_LOG_MAX_BYTES) return;
  const raw = readFileSync(file);
  const start = Math.max(0, raw.length - DESKTOP_LOG_MAX_BYTES);
  const newline = raw.indexOf(0x0a, start);
  const kept = newline >= 0 && newline + 1 < raw.length ? raw.subarray(newline + 1) : raw.subarray(start);
  writeFileSync(file, kept);
}
