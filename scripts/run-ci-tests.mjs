// Runs every `test:*` script in package.json that does not need a live
// database, sequentially, and fails if any fail. Used by CI and handy locally:
//   pnpm test:ci
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// These talk to Supabase and need SUPABASE_URL + keys; run them by hand.
const NEEDS_DB = new Set(["test:onboarding", "test:invited-member", "test:ci"]);

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const scripts = Object.keys(pkg.scripts)
  .filter((s) => s.startsWith("test:") && !NEEDS_DB.has(s))
  .sort();

const failed = [];
for (const name of scripts) {
  const started = Date.now();
  const res = spawnSync("pnpm", ["run", "-s", name], { encoding: "utf8" });
  const ok = res.status === 0;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (${secs}s)`);
  if (!ok) {
    failed.push(name);
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.split("\n").filter((l) => !/node_modules/.test(l));
    console.log(out.slice(-12).map((l) => `      ${l}`).join("\n"));
  }
}

console.log(`\n${scripts.length - failed.length}/${scripts.length} passed`);
if (failed.length) {
  console.log(`failed: ${failed.join(", ")}`);
  process.exit(1);
}
