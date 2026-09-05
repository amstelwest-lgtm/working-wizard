/**
 * Email-confirmation landing helpers.
 * Run: pnpm test:email-confirm
 */
import {
  confirmUrlFromLocation,
  destinationAfterConfirm,
  hasAuthRedirectParams,
  humanizeConfirmError,
  marketFromSignupMeta,
  ownerDisplayName,
  parseEmailConfirmParams,
  shouldForwardToConfirm,
} from "../src/lib/email-confirm";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const pkce = parseEmailConfirmParams("?code=abc123", "");
assert(pkce.code === "abc123", "pkce code");
assert(!pkce.error, "pkce no error");

const hashTok = parseEmailConfirmParams("", "#access_token=tok&type=signup");
assert(hashTok.type === "signup", "hash type");

const denied = parseEmailConfirmParams(
  "?error=access_denied&error_description=Token%20expired",
  "",
);
assert(denied.error === "Token expired", "error_description");

assert(hasAuthRedirectParams("?code=x", ""), "has code");
assert(hasAuthRedirectParams("", "#access_token=tok"), "implicit hash");
assert(!hasAuthRedirectParams("", ""), "empty is not auth redirect");
assert(shouldForwardToConfirm("/app", "?code=x", ""), "forward /app");
assert(shouldForwardToConfirm("/dashboard", "?code=x", ""), "forward /dashboard");
assert(!shouldForwardToConfirm("/confirm", "?code=x", ""), "do not re-forward /confirm");
assert(!shouldForwardToConfirm("/auth/callback", "?code=x", ""), "leave Google callback alone");
assert(
  confirmUrlFromLocation("https://milon.co.za/", "?code=x", "") ===
    "https://milon.co.za/confirm?code=x",
  "confirm url strips slash",
);

assert(destinationAfterConfirm({ signup_type: "customer" }) === "/app", "owner dest");
assert(destinationAfterConfirm({ signup_type: "accountant" }) === "/dashboard", "firm dest");
assert(destinationAfterConfirm({ firm_name: "Acme" }) === "/dashboard", "firm_name dest");
assert(destinationAfterConfirm({ signup_type: "customer" }, "recovery") === "/reset-password", "recovery");

assert(
  marketFromSignupMeta({ market_country: "US", market_region: "NY" })?.country === "US",
  "US market from metadata",
);
assert(marketFromSignupMeta({ market_country: "US", market_region: "NY" })?.regionCode === "NY", "NY");
assert(marketFromSignupMeta({ market_country: "ZA" })?.country === "ZA", "ZA market");
assert(marketFromSignupMeta({ signup_type: "customer" }) === null, "no market fields");

assert(ownerDisplayName({ business_name: "Harbor Cafe" }, "a@b.com") === "Harbor Cafe", "business");
assert(ownerDisplayName({ full_name: "Ada" }, "ada@x.com") === "Ada", "full name");

assert(humanizeConfirmError("otp_expired").includes("expired"), "expired copy");
assert(humanizeConfirmError("Nope") === "Nope", "passthrough");

console.log("email-confirm-test: ok");
