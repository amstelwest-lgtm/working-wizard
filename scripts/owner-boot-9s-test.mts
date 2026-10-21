/**
 * Owner boot: one retry of an idempotent select, and a hung data read
 * must not delay a session read.
 * Run: pnpm test:owner-boot-9s
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tabAuthLock } from "@/integrations/supabase/tab-auth";
import {
  bindShellBackstop,
  BOOT_READ_HEDGE_MS,
  BOOT_READ_RETRY_TIMEOUT_MS,
  BOOT_READ_TIMEOUT_MS,
  bootCriticalRetryFailed,
  bootRetryInFlight,
  bootSelect,
  resetBootReadForTests,
  setShellBackstopForTests,
  shellBackstopDue,
} from "@/lib/boot-read";
import { SHELL_BOOT_CEILING_MS } from "@/lib/shell-gate";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");
const bootSrc = readFileSync(resolve(root, "src/lib/boot-read.ts"), "utf8");
const appSrc = readFileSync(resolve(root, "src/routes/app.tsx"), "utf8");
const clientSrc = readFileSync(
  resolve(root, "src/routes/_authenticated/clients.$clientId.tsx"),
  "utf8",
);

assert(
  !/getSession|refreshSession|onAuthStateChange|tabAuthLock/.test(bootSrc),
  "boot reads stay outside the auth lock",
);
assert(!bootSrc.includes("supabase"), "boot reads do not call the client");
assert(
  !/\.rpc\s*\(|\.upsert\s*\(|\.insert\s*\(|\.update\s*\(/.test(bootSrc),
  "boot reads do not issue writes or RPCs",
);

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
assert(appSrc.includes("bindShellBackstop("), "the owner shell uses the shared backstop");
assert(clientSrc.includes("bindShellBackstop("), "the accountant client uses the shared backstop");
assert(
  bootSrc.includes("bootCriticalRetryFailed"),
  "a failed critical retry does not release the backstop",
);
assert(BOOT_READ_HEDGE_MS === 2_500, "the hedge starts at about 2.5s");
assert(BOOT_READ_RETRY_TIMEOUT_MS === 6_000, "the retry waits about 6s");
assert(BOOT_READ_TIMEOUT_MS === 4_000, "the first attempt still aborts at 4s");
assert(
  BOOT_READ_TIMEOUT_MS + BOOT_READ_RETRY_TIMEOUT_MS <= SHELL_BOOT_CEILING_MS,
  "first try plus retry stays inside the 12s ceiling",
);
assert(SHELL_BOOT_CEILING_MS === 12_000, "the boot ceiling is 12s from auth");
const loadErrorAt = appSrc.indexOf('data-owner-boot="load-error"');
const timeoutAt = appSrc.indexOf('data-owner-boot="timeout"');
assert(loadErrorAt > 0 && timeoutAt > loadErrorAt, "Couldn't load is checked before the hard fail");
assert(
  appSrc.includes("if (user && (workspaceLoadFailed || criticalBootFailed))"),
  "a failed critical read uses the recoverable load screen",
);
assert(
  appSrc.includes("if (user && !authLoading && !boardReady && ownerBootTimedOut)"),
  "the hard fail is only the backstop, after the load screen",
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
  assert(
    result.ok && result.value.data?.[0]?.id === "harbour",
    "a hang then a success returns the row",
  );
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
          () =>
            resolve({ data: null, error: { message: "AbortError: The operation was aborted." } }),
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
  assert(
    !shellBackstopDue(backstopAt + 5_000, backstopAt),
    "an in-flight retry holds the original backstop",
  );
  assert(
    !shellBackstopDue(backstopAt + 5_000, backstopAt, backstopAt),
    "an in-flight retry holds the ceiling too",
  );
  assert(backstopAt === 10_000, "starting a retry does not move the backstop timestamp");
  await pending;
  assert(bootCriticalRetryFailed(), "a retry that also fails is recorded");
  assert(
    !shellBackstopDue(backstopAt, backstopAt),
    "a failed retry does not release the original backstop",
  );
  assert(
    !shellBackstopDue(backstopAt + 5_000, backstopAt),
    "a failed retry stays off the backstop after the deadline",
  );
  assert(backstopAt === 10_000, "a failed retry does not move the backstop timestamp");
  const recovered = await bootSelect(async () => ({ data: [{ id: "harbour" }], error: null }), {
    critical: true,
    timeoutMs: 20,
  });
  assert(recovered.ok, "the next critical read clears the failed retry");
  assert(!bootCriticalRetryFailed(), "Retry starts a fresh read");
  assert(
    shellBackstopDue(backstopAt, backstopAt),
    "the same timestamp is due once a later read starts",
  );
  assert(
    shellBackstopDue(12_000, 20_000, 12_000),
    "the ceiling fires after the idle window was reset",
  );
  assert(!shellBackstopDue(11_999, 20_000, 12_000), "the ceiling waits until 12s");
}

resetBootReadForTests();

{
  const pending = bootSelect(
    (signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () =>
            resolve({ data: null, error: { message: "AbortError: The operation was aborted." } }),
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

resetBootReadForTests();

{
  const started = Date.now();
  let calls = 0;
  const result = await bootSelect(
    (signal) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                data: null,
                error: { message: "AbortError: The operation was aborted." },
              }),
            { once: true },
          );
        });
      }
      return new Promise((resolve) => {
        setTimeout(() => resolve({ data: [{ id: "harbour" }], error: null }), 250);
      });
    },
    { critical: true, timeoutMs: 400 },
  );
  const elapsed = Date.now() - started;
  assert(result.ok && result.value.data?.[0]?.id === "harbour", "a hedged retry returns the row");
  assert(calls === 2, `the hedge is one second select, saw ${calls}`);
  assert(elapsed >= 450, `the retry lands near the scaled 5s, saw ${elapsed}ms`);
  assert(elapsed < 600, `the second select overlaps the first, saw ${elapsed}ms`);
  assert(!bootCriticalRetryFailed(), "a retry that returns is not a hard fail");
}

resetBootReadForTests();

{
  setShellBackstopForTests({ idleMs: 80, ceilingMs: 10_000 });
  let due = false;
  const unbind = bindShellBackstop(() => {
    due = true;
  });
  await bootSelect(async () => ({ data: [{ id: "harbour" }], error: null }), {
    critical: true,
    timeoutMs: 20,
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert(!due, "a completed read resets the idle window");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert(due, "the idle window still fires when reads stop");
  unbind();
}

resetBootReadForTests();

{
  setShellBackstopForTests({ idleMs: 10_000, ceilingMs: 70 });
  let due = false;
  const unbind = bindShellBackstop(() => {
    due = true;
  });
  const started = Date.now();
  while (!due && Date.now() - started < 400) {
    await bootSelect(async () => ({ data: [{ id: "harbour" }], error: null }), {
      critical: true,
      timeoutMs: 20,
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert(due, "a chain that keeps finishing still hits the ceiling");
  assert(Date.now() - started < 300, "the ceiling does not wait out the idle window");
  unbind();
}

console.log("owner-boot-9s-test: ok");
