/**
 * Owner boot: one retry of an idempotent select, and a hung data read
 * must not delay a session read.
 * Run: pnpm test:owner-boot-9s
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tabAuthLock } from "@/integrations/supabase/tab-auth";
import {
  bootRetryInFlight,
  bootSelect,
  resetBootReadForTests,
  shellBackstopDue,
} from "@/lib/boot-read";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");
const bootSrc = readFileSync(resolve(root, "src/lib/boot-read.ts"), "utf8");
const appSrc = readFileSync(resolve(root, "src/routes/app.tsx"), "utf8");

assert(!/getSession|refreshSession|onAuthStateChange|tabAuthLock/.test(bootSrc), "boot reads stay outside the auth lock");
assert(!bootSrc.includes("supabase"), "boot reads do not call the client");
assert(!/\.rpc\s*\(|\.upsert\s*\(|\.insert\s*\(|\.update\s*\(/.test(bootSrc), "boot reads do not issue writes or RPCs");

function beforeCall(source: string, needle: string, window: number): string {
  const at = source.indexOf(needle);
  assert(at > 0, `missing ${needle}`);
  return source.slice(Math.max(0, at - window), at);
}

assert(
  !beforeCall(appSrc, 'supabase.rpc("ensure_own_client"', 220).includes("bootSelect"),
  "ensure_own_client is not retried",
);
assert(
  !beforeCall(
    appSrc,
    '{ client_id: inviteClientId, user_id: u.user.id, role: "client_member" }',
    280,
  ).includes("bootSelect"),
  "the membership upsert is not retried",
);
assert(
  appSrc.includes("const backstopAt = Date.now() + SHELL_GATE_TIMEOUT_MS"),
  "the shell backstop keeps one timestamp",
);

resetBootReadForTests();

{
  let calls = 0;
  const result = await bootSelect(
    (signal) =>
      new Promise((resolve) => {
        calls += 1;
        if (calls === 1) {
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                data: null,
                error: { message: "AbortError: The operation was aborted." },
              }),
            { once: true },
          );
          return;
        }
        resolve({ data: [{ id: "harbour" }], error: null });
      }),
    { critical: true, timeoutMs: 30 },
  );
  assert(result.ok && result.value.data?.[0]?.id === "harbour", "a hang then a success returns the row");
  assert(calls === 2, `a critical hang retries once, saw ${calls}`);
  assert(!bootRetryInFlight(), "the retry window closes");
}

resetBootReadForTests();

{
  let calls = 0;
  const result = await bootSelect(
    async () => {
      calls += 1;
      throw new TypeError("Failed to fetch");
    },
    { critical: false, timeoutMs: 50 },
  );
  assert(!result.ok && result.retryable, "a non-critical Failed to fetch is a retryable miss");
  assert(calls === 1, `a non-critical read does not retry, saw ${calls}`);
}

resetBootReadForTests();

{
  let calls = 0;
  const result = await bootSelect(
    async () => {
      calls += 1;
      return { data: null, error: { message: "TypeError: Failed to fetch" } };
    },
    { critical: true, timeoutMs: 50 },
  );
  assert(!result.ok && result.retryable, "two critical network failures give up");
  assert(calls === 2, `a critical read tries twice, saw ${calls}`);
}

resetBootReadForTests();

{
  let calls = 0;
  const result = await bootSelect(
    async () => {
      calls += 1;
      return { data: null, error: { message: "permission denied for table clients" } };
    },
    { critical: true, timeoutMs: 50 },
  );
  assert(result.ok && result.value.error, "a permission error is not retried as a network miss");
  assert(calls === 1, `schema and permission errors run once, saw ${calls}`);
}

resetBootReadForTests();

{
  const backstopAt = 10_000;
  assert(shellBackstopDue(10_000, backstopAt), "the backstop is due at its original timestamp");
  assert(!shellBackstopDue(9_999, backstopAt), "the backstop waits until that timestamp");
  const pending = bootSelect(
    (signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => resolve({ data: null, error: { message: "AbortError: The operation was aborted." } }),
          { once: true },
        );
      }),
    { critical: true, timeoutMs: 40 },
  );
  const waitUntil = Date.now() + 500;
  while (!bootRetryInFlight() && Date.now() < waitUntil) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert(bootRetryInFlight(), "the second attempt is the retry window");
  assert(!shellBackstopDue(backstopAt + 5_000, backstopAt), "an in-flight retry holds the original backstop");
  assert(backstopAt === 10_000, "starting a retry does not move the backstop timestamp");
  await pending;
  assert(shellBackstopDue(backstopAt, backstopAt), "the same timestamp is due once the retry settles");
}

resetBootReadForTests();

{
  const pending = bootSelect(
    (signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => resolve({ data: null, error: { message: "AbortError: The operation was aborted." } }),
          { once: true },
        );
      }),
    { critical: true, timeoutMs: 2_000 },
  );
  const started = Date.now();
  const session = await tabAuthLock("lock:owner-boot-9s", -1, async () => "session");
  const elapsed = Date.now() - started;
  assert(session === "session", "the session read returns");
  assert(elapsed < 200, `a hung data fetch delayed the auth lock by ${elapsed}ms`);
  await pending;
}

console.log("owner-boot-9s-test: ok");
