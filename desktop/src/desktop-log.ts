import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Cap desktop.log so a long-lived tray app cannot fill the disk. */
export const DESKTOP_LOG_MAX_BYTES = 1_000_000;

export function desktopLogPath(logsDir: string): string {
  return join(logsDir, "desktop.log");
}

function redact(line: string): string {
  return line
    .replace(/\r?\n/g, " ")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(apikey|authorization|bearer|password|token)=([^\s&]+)/gi, "$1=[redacted]")
    .replace(/https?:\/\/([^/\s?#]+)[^\s]*/gi, "$1")
    .trim()
    .slice(0, 500);
}

function acceptable(line: string): boolean {
  if (!line.startsWith("[milon-desktop] ")) return false;
  return !/eyJ|@|apikey|bearer|password|token=|email=/i.test(line);
}

/**
 * Append one redacted line in the logs directory (`app.getPath("logs")`).
 * Creates the directory first. A rejected line or a filesystem error does not throw.
 */
export function appendDesktopLog(logsDir: string, line: string): void {
  try {
    if (!logsDir) return;
    mkdirSync(logsDir, { recursive: true });
    const text = redact(line);
    if (!acceptable(text)) return;
    const file = desktopLogPath(logsDir);
    appendFileSync(file, `${text}\n`, "utf8");
    const size = statSync(file).size;
    if (size <= DESKTOP_LOG_MAX_BYTES) return;
    const raw = readFileSync(file);
    const start = Math.max(0, raw.length - DESKTOP_LOG_MAX_BYTES);
    const newline = raw.indexOf(0x0a, start);
    const kept = newline >= 0 && newline + 1 < raw.length ? raw.subarray(newline + 1) : raw.subarray(start);
    writeFileSync(file, kept);
  } catch {
    /* Sign-in still returns if the log file cannot be written. */
  }
}

export function startupLogLine(version: string, host: string, userData: string): string {
  const safeVersion = /^[A-Za-z0-9._-]{1,40}$/.test(version) ? version : "unknown";
  const safeHost = /^[A-Za-z0-9.-]{1,253}$/.test(host) ? host : "invalid";
  const safePath = userData.replace(/[\r\n]/g, "").slice(0, 240);
  return `[milon-desktop] ready version=${safeVersion} host=${safeHost} userData=${safePath}`;
}
