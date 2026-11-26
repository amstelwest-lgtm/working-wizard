// Uploads desktop/release/Milon-Setup.exe to a stable public Vercel Blob path.
// No token: exit 0. The landing link stays hidden until VITE_WINDOWS_PILOT_INSTALLER_URL is set.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PATHNAME = "desktop/Milon-Setup.exe";
const token = String(process.env.BLOB_READ_WRITE_TOKEN ?? "").trim();

if (!token) {
  console.log("Skipping public installer upload: BLOB_READ_WRITE_TOKEN is not set.");
  process.exit(0);
}

const exePath = join(process.cwd(), "desktop", "release", "Milon-Setup.exe");
if (!existsSync(exePath)) {
  console.error("desktop/release/Milon-Setup.exe was not built.");
  process.exit(1);
}

const vendor = join(tmpdir(), "milon-blob-publish");
mkdirSync(vendor, { recursive: true });
const pkgJson = join(vendor, "package.json");
if (!existsSync(pkgJson)) {
  writeFileSync(pkgJson, JSON.stringify({ name: "milon-blob-publish", private: true }) + "\n");
}

const installed = join(vendor, "node_modules", "@vercel", "blob", "package.json");
if (!existsSync(installed)) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(
    npm,
    ["install", "--silent", "--no-fund", "--no-audit", "@vercel/blob@2.9.0"],
    { cwd: vendor, stdio: "inherit", shell: process.platform === "win32" },
  );
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

const { put } = createRequire(pkgJson)("@vercel/blob");
const body = readFileSync(exePath);

let result;
try {
  result = await put(PATHNAME, body, {
    access: "public",
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: true,
    contentType: "application/vnd.microsoft.portable-executable",
    cacheControlMaxAge: 300,
  });
} catch (err) {
  const message = String(err && err.message ? err.message : err).split(token).join("[redacted]");
  console.error(message);
  process.exit(1);
}

const url = String(result.url ?? "");
const pathname = String(result.pathname ?? "").replaceAll("\\", "/");
if (!url.startsWith("https://") || url.includes(token) || pathname !== PATHNAME) {
  console.error("Upload did not return the stable public pathname.");
  process.exit(1);
}

console.log(`Published ${url}`);
console.log(`Bytes ${body.length}`);
