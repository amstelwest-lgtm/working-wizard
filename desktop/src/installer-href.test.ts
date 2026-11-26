import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { DESKTOP_INSTALLER_VERSION, versionedInstallerHref } from "./installer-href";

const BLOB =
  "https://r4rv0dnltovpl3jd.public.blob.vercel-storage.com/desktop/Milon-Setup.exe";

test("the Windows download href is cache-busted with the desktop version", () => {
  const pkg = JSON.parse(readFileSync(path.join(__dirname, "../package.json"), "utf8")) as { version: string };
  assert.equal(DESKTOP_INSTALLER_VERSION, pkg.version);
  assert.equal(versionedInstallerHref(BLOB), `${BLOB}?v=${pkg.version}`);
  assert.equal(versionedInstallerHref(""), "");
  assert.equal(versionedInstallerHref("http://example.com/Milon-Setup.exe"), "");
  assert.equal(
    versionedInstallerHref("https://example.com/desktop/Milon-Setup.exe?x=1", "abc1234"),
    "https://example.com/desktop/Milon-Setup.exe?x=1&v=abc1234",
  );
  assert.equal(versionedInstallerHref("https://example.com/a.exe", "1.0 evil"), "https://example.com/a.exe");

  const copy = readFileSync(path.join(__dirname, "../../src/lib/landing-copy.ts"), "utf8");
  assert.match(copy, /WINDOWS_PILOT_INSTALLER_URL = versionedInstallerHref\(/);
  assert.match(copy, /WINDOWS_PILOT_DOWNLOAD_LABEL = "Download for Windows"/);
  assert.equal(copy.includes("Download for Windows (pilot)"), false);
});

test("the installer upload asks for a short cache and NSIS stops a running tray", () => {
  const publish = readFileSync(path.join(__dirname, "../../scripts/publish-windows-installer.mjs"), "utf8");
  assert.match(publish, /cacheControlMaxAge:\s*300/);
  const nsh = readFileSync(path.join(__dirname, "../build/installer.nsh"), "utf8");
  assert.match(nsh, /!macro customInit/);
  assert.match(nsh, /nsExec::Exec 'taskkill \/F \/IM Milon\.exe'/);
  const pkg = readFileSync(path.join(__dirname, "../package.json"), "utf8");
  assert.match(pkg, /"include": "build\/installer\.nsh"/);
});
