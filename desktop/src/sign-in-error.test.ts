import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./public-config";
import { SESSION_RECOVER_MS } from "./session-recover";
import { desktopAuthConfigOk, redactedSignInFailure, SIGN_IN_TIMEOUT_MS, signInUserMessage } from "./sign-in-error";

test("the baked desktop config is a live anon client", () => {
  assert.equal(desktopAuthConfigOk(SUPABASE_URL, SUPABASE_ANON_KEY), true);
  assert.equal(desktopAuthConfigOk("http://example.com", SUPABASE_ANON_KEY), false);
  assert.equal(desktopAuthConfigOk(SUPABASE_URL, "not-a-jwt"), false);
});

test("sign-in failures stay plain", () => {
  assert.equal(
    signInUserMessage({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 }),
    "Wrong email or password. (auth)",
  );
  assert.equal(
    signInUserMessage({ name: "AuthRetryableFetchError", message: "This operation was aborted", status: 0 }),
    "Can't reach Milōn. Check your connection and try again. (timeout)",
  );
  assert.equal(
    signInUserMessage({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }),
    "Can't reach Milōn. Check your connection and try again. (AuthRetryableFetchError: Failed to fetch)",
  );
  assert.equal(
    signInUserMessage({ name: "TypeError", message: "Failed to fetch" }),
    "Can't reach Milōn. Check your connection and try again. (TypeError: Failed to fetch)",
  );
  assert.equal(
    signInUserMessage({ name: "TimeoutError", message: "timeout", code: "timeout", status: 0 }),
    "Can't reach Milōn. Check your connection and try again. (timeout)",
  );
  assert.equal(signInUserMessage({ code: "config" }), "This app is missing its Milōn sign-in configuration.");
  assert.equal(signInUserMessage({ message: "database schema is private", status: 400 }), "Could not sign in. (HTTP 400)");
  assert.equal(signInUserMessage({ name: "AuthApiError", status: 500, message: "upstream failed" }), "Can't reach Milōn. Check your connection and try again. (HTTP 500)");
  assert.equal(
    signInUserMessage({ message: "This PC can't encrypt the Milōn session." }),
    "This PC can't encrypt the Milōn session. The password was not saved.",
  );
  assert.equal(signInUserMessage(null), "Can't reach Milōn. Check your connection and try again. (network)");
});

test("the renderer waits longer than session recovery plus the fetch deadline", () => {
  const renderer = readFileSync(path.join(__dirname, "../src/renderer/renderer.js"), "utf8");
  const match = renderer.match(/const RENDERER_TIMEOUT_MS = (\d+);/);
  assert.ok(match);
  const rendererMs = Number(match[1]);
  assert.equal(rendererMs, 25_000);
  assert.ok(rendererMs > SESSION_RECOVER_MS + SIGN_IN_TIMEOUT_MS);
  assert.match(renderer, /Check your connection and try again\. \(timeout\)/);
  assert.match(renderer, /Check your connection and try again\. \(network\)/);
  assert.match(renderer, /reportSignInFailure/);
});

test("a failed sign-in logs the host, name, code, and a redacted message", () => {
  const error = Object.assign(
    new Error("ada@example.com hunter2 https://jxclnsbsqpixxqlbcapl.supabase.co/auth/v1/token?apikey=secret eyJhbGciOi.payload.sig"),
    { name: "AuthApiError", code: "invalid_credentials", status: 400 },
  );
  const line = redactedSignInFailure(error, "jxclnsbsqpixxqlbcapl.supabase.co");
  assert.equal(
    line,
    "[milon-desktop] sign-in host=jxclnsbsqpixxqlbcapl.supabase.co name=AuthApiError code=invalid_credentials status=400 message=",
  );
  assert.equal(line.includes("ada@example.com"), false);
  assert.equal(line.includes("hunter2"), false);
  assert.equal(line.includes("apikey"), false);
  assert.equal(line.includes("eyJ"), false);
  assert.equal(line.includes("/auth/"), false);
  const leaked = redactedSignInFailure(
    Object.assign(new Error("https://example.supabase.co/?apikey=secret"), {
      name: "https://example.supabase.co/?apikey=secret",
      code: "https://example.supabase.co/?apikey=secret",
    }),
    "not a host",
  );
  assert.equal(leaked, "[milon-desktop] sign-in host= name=Error code= status= message=");
  assert.equal(leaked.includes("apikey"), false);
  assert.equal(leaked.includes("secret"), false);
});
