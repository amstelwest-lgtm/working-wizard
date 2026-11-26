import assert from "node:assert/strict";
import test from "node:test";
import {
  releaseForPasswordGrant,
  SESSION_RECOVER_MS,
  watchSessionRecovery,
  type InitAuth,
} from "./session-recover";

test("session restore is capped at about 3 seconds", () => {
  assert.equal(SESSION_RECOVER_MS, 3_000);
});

test("a hung session restore clears the session and detaches initializePromise", async () => {
  const pending = new Promise(() => {});
  const auth: InitAuth = { initializePromise: pending };
  let cleared = 0;
  const watch = watchSessionRecovery(
    auth,
    pending,
    () => {
      cleared += 1;
    },
    30,
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(watch.done, true);
  assert.equal(watch.failed, true);
  assert.equal(cleared, 1);
  await auth.initializePromise;
});

test("a failed session restore clears the session file", async () => {
  const pending = Promise.reject(Object.assign(new Error("refresh failed"), { code: "unexpected" }));
  const auth: InitAuth = { initializePromise: pending };
  let cleared = 0;
  const watch = watchSessionRecovery(
    auth,
    pending,
    () => {
      cleared += 1;
    },
    3_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(watch.failed, true);
  assert.equal(cleared, 1);
  await auth.initializePromise;
});

test("a finished session restore keeps the session file", async () => {
  const pending = Promise.resolve("ok");
  const auth: InitAuth = { initializePromise: pending };
  let cleared = 0;
  const watch = watchSessionRecovery(
    auth,
    pending,
    () => {
      cleared += 1;
    },
    3_000,
  );
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(watch.failed, false);
  assert.equal(cleared, 0);
  releaseForPasswordGrant(auth, watch, () => {
    cleared += 1;
  });
  assert.equal(cleared, 0);
});

test("the password grant does not wait on initializePromise", async () => {
  let resolveInit: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    resolveInit = resolve;
  });
  const auth: InitAuth = { initializePromise: pending };
  let cleared = 0;
  const watch = watchSessionRecovery(
    auth,
    pending,
    () => {
      cleared += 1;
    },
    5_000,
  );
  const started = Date.now();
  releaseForPasswordGrant(auth, watch, () => {
    cleared += 1;
  });
  assert.ok(Date.now() - started < 500);
  assert.equal(watch.failed, true);
  assert.equal(cleared, 1);
  await auth.initializePromise;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(cleared, 1);
  resolveInit?.();
});
