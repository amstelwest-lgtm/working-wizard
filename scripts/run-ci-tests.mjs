// Runs every `test:*` script in package.json that does not need a live
// database, sequentially, and fails if any fail. Used by CI and handy locally:
//   pnpm test:ci
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

// These talk to Supabase and need SUPABASE_URL + keys; run them by hand.
const NEEDS_DB = new Set([
  "test:onboarding",
  "test:invited-member",
  "test:upload-visibility-rls",
  "test:ci",
]);

// Own CI job. Leaving it in this serial list made every run wait on it.
const OWN_JOB = new Set(["test:landing-gold-scan"]);

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const scripts = Object.keys(pkg.scripts)
  .filter((s) => s.startsWith("test:") && !NEEDS_DB.has(s) && !OWN_JOB.has(s))
  .sort();

// A blocked child (for example a synchronous browser download) never reaches
// its own timer. Kill the process group from here so one script cannot hold
// the job open.
const TEST_TIMEOUT_MS = 8 * 60 * 1000;

function runScript(name) {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["run", "-s", name], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    const keep = (prev, chunk) => {
      const next = prev + String(chunk);
      return next.length > 200_000 ? next.slice(-100_000) : next;
    };
    child.stdout?.on("data", (chunk) => {
      stdout = keep(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = keep(stderr, chunk);
    });
    const timer = setTimeout(() => {
      stderr += `\n${name} timed out after ${TEST_TIMEOUT_MS}ms`;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    }, TEST_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? 1, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ status: 1, stdout, stderr: `${stderr}\n${err.message}` });
    });
  });
}

const failed = [];
for (const name of scripts) {
  const started = Date.now();
  const res = await runScript(name);
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
