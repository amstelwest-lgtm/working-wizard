import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const REQUIRED = [16, 24, 32, 48, 64, 128, 256];

test("the windows icon contains every required size", () => {
  const buf = readFileSync(path.join(__dirname, "../assets/icon.ico"));
  assert.equal(buf.readUInt16LE(0), 0);
  assert.equal(buf.readUInt16LE(2), 1);
  const count = buf.readUInt16LE(4);
  const sizes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const width = buf.readUInt8(6 + i * 16) || 256;
    const height = buf.readUInt8(7 + i * 16) || 256;
    sizes.push(`${width}x${height}`);
  }
  for (const size of REQUIRED) {
    assert.ok(sizes.includes(`${size}x${size}`), sizes.join(", "));
  }
});

test("the tray image is a 32px png of the same mark", () => {
  const buf = readFileSync(path.join(__dirname, "../assets/tray.png"));
  assert.equal(buf.toString("ascii", 1, 4), "PNG");
  assert.equal(buf.readUInt32BE(16), 32);
  assert.equal(buf.readUInt32BE(20), 32);
});
