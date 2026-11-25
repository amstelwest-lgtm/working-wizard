import assert from "node:assert/strict";
import test from "node:test";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./public-config";
import { desktopAuthConfigOk, signInUserMessage } from "./sign-in-error";

test("the baked desktop config is a live anon client", () => {
  assert.equal(desktopAuthConfigOk(SUPABASE_URL, SUPABASE_ANON_KEY), true);
  assert.equal(desktopAuthConfigOk("http://example.com", SUPABASE_ANON_KEY), false);
  assert.equal(desktopAuthConfigOk(SUPABASE_URL, "not-a-jwt"), false);
});

test("sign-in failures stay plain", () => {
  assert.equal(
    signInUserMessage({ code: "invalid_credentials", message: "Invalid login credentials", status: 400 }),
    "Wrong email or password.",
  );
  assert.equal(
    signInUserMessage({ name: "AuthRetryableFetchError", message: "This operation was aborted", status: 0 }),
    "Can't reach Milōn. Check your connection and try again.",
  );
  assert.equal(signInUserMessage({ code: "config" }), "This app is missing its Milōn sign-in configuration.");
  assert.equal(signInUserMessage({ message: "database schema is private", status: 400 }), "Could not sign in.");
  assert.equal(
    signInUserMessage({ message: "This PC can't encrypt the Milōn session." }),
    "This PC can't encrypt the Milōn session. The password was not saved.",
  );
  assert.equal(signInUserMessage(null), "Can't reach Milōn. Check your connection and try again.");
});
