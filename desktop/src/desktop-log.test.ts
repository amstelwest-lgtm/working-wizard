import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { appendDesktopLog, DESKTOP_LOG_MAX_BYTES, desktopLogPath } from "./desktop-log";
import { redactedSignInFailure } from "./sign-in-error";

test("desktop.log receives only the redacted sign-in line", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "milon-log-"));
  try {
    const error = Object.assign(
      new Error("ada@example.com hunter2 https://example.supabase.co/auth/v1/token?apikey=secret eyJhbGci.payload.sig"),
      { name: "AuthApiError", code: "invalid_credentials" },
    );
    const line = redactedSignInFailure(error);
    appendDesktopLog(dir, line);
    const file = desktopLogPath(dir);
    const text = readFileSync(file, "utf8");
    assert.equal(text, `${line}\n`);
    assert.equal(text.includes("ada@example.com"), false);
    assert.equal(text.includes("hunter2"), false);
    assert.equal(text.includes("supabase"), false);
    assert.equal(text.includes("apikey"), false);
    assert.equal(text.includes("eyJ"), false);
    assert.equal(text.includes("secret"), false);

    appendDesktopLog(dir, "password=hunter2 ada@example.com token=eyJhbGci");
    appendDesktopLog(dir, "[milon-desktop] sign-in name=AuthApiError code=invalid_credentials email=ada@example.com");
    assert.equal(readFileSync(file, "utf8"), text);

    const main = readFileSync(path.join(__dirname, "../src/main.ts"), "utf8");
    assert.match(main, /appendDesktopLog\(app\.getPath\("userData"\), line\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("desktop.log is truncated above 1MB", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "milon-log-"));
  try {
    const file = desktopLogPath(dir);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "x".repeat(DESKTOP_LOG_MAX_BYTES + 200));
    const line = "[milon-desktop] sign-in name=TimeoutError code=timeout";
    appendDesktopLog(dir, line);
    const body = readFileSync(file);
    assert.ok(body.length <= DESKTOP_LOG_MAX_BYTES);
    assert.ok(body.toString("utf8").endsWith(`${line}\n`));
    assert.equal(body.includes("ada@example.com"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
