import assert from "node:assert/strict";
import test from "node:test";
import { PASSWORD_RESET_URL, allowedPasswordResetUrl } from "./external-url";

test("only the canonical reset page is allowed", () => {
  assert.equal(allowedPasswordResetUrl(PASSWORD_RESET_URL), PASSWORD_RESET_URL);
});

test("other urls are rejected", () => {
  const blocked = [
    "http://www.milonfinance.com/reset-password",
    "https://milonfinance.com/reset-password",
    "https://www.milonfinance.com/reset-password/",
    "https://www.milonfinance.com/auth",
    "https://www.milonfinance.com/reset-password?next=/",
    "https://www.milonfinance.com/reset-password#token",
    "https://evil.example/reset-password",
    "https://www.milonfinance.com.evil.example/reset-password",
    "https://user:pass@www.milonfinance.com/reset-password",
    "https://www.milonfinance.com:444/reset-password",
    "javascript:alert(1)",
    "",
  ];
  for (const url of blocked) {
    assert.equal(allowedPasswordResetUrl(url), null, url);
  }
});
