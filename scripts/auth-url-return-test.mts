/**
 * Site-URL magic-link fallback: the landing page must read the hash,
 * and owner / accountant returns stay in step.
 * Run: pnpm test:auth-url-return
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AUTH_LINK_EXPIRED,
  emailReturnCookieString,
  hrefWithoutAuthReturn,
  parseAuthUrlReturn,
  pathAfterAuthReturn,
  readEmailReturnCookie,
  shouldConsumeAuthReturn,
} from "../src/lib/auth-url-return.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const prod = new URL(
  "https://www.milonfinance.com/#access_token=aaa.bbb&refresh_token=rrr&token_type=bearer&type=magiclink",
);
const landed = parseAuthUrlReturn(prod.search, prod.hash);
assert(landed?.kind === "session" && landed.method === "setSession", "landing hash uses setSession");
if (landed?.kind === "session" && landed.method === "setSession") {
  assert(landed.accessToken === "aaa.bbb", "access token is kept for setSession");
  assert(landed.refreshToken === "rrr", "refresh token is kept for setSession");
  assert(landed.type === "magiclink", "magiclink type is recognised");
}
assert(
  hrefWithoutAuthReturn(prod.href) === "/",
  "the landing hash is stripped so the tokens do not stay in the URL",
);
assert(shouldConsumeAuthReturn("/"), "the landing route consumes the auth hash");
assert(shouldConsumeAuthReturn("/for-owners"), "other marketing routes consume it too");
assert(!shouldConsumeAuthReturn("/auth/callback"), "the callback route keeps its own exchange");

const expired = parseAuthUrlReturn(
  "",
  "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
);
assert(expired?.kind === "error" && expired.message === AUTH_LINK_EXPIRED, "an expired link uses the friendly sentence");
assert(!AUTH_LINK_EXPIRED.includes("error_description"), "the friendly sentence does not echo the raw hash");
assert(
  hrefWithoutAuthReturn(
    "https://www.milonfinance.com/#error=access_denied&error_description=Email+link+is+invalid+or+has+expired",
  ) === "/",
  "an error hash is stripped",
);

const codeUrl = new URL("https://milonfinance.com/?code=pkce-code-value-1234&type=magiclink");
const coded = parseAuthUrlReturn(codeUrl.search, codeUrl.hash);
assert(
  coded?.kind === "session" && coded.method === "exchangeCodeForSession",
  "a PKCE code on the site URL uses exchangeCodeForSession",
);
assert(parseAuthUrlReturn("?code=MLN-123456", "") === null, "a client code is not a session");

const ownerCookie = emailReturnCookieString("owner", null, "www.milonfinance.com", true);
assert(ownerCookie.includes("Domain=milonfinance.com"), "the door cookie is shared by apex and www");
const storedOwner = readEmailReturnCookie(`theme=light; ${ownerCookie.split(";").slice(0, 1).join(";")}`);
assert(storedOwner.door === "owner", "the stored door survives the site-url fallback");

const withDoor = parseAuthUrlReturn(prod.search, prod.hash, storedOwner);
assert(withDoor?.kind === "session" && withDoor.door === "owner", "a stored owner door is applied to the hash");
assert(
  pathAfterAuthReturn({
    type: "magiclink",
    door: "owner",
    next: null,
    roleDestination: "/practice",
  }) === "/app",
  "a stored owner door opens /app even when the account is also a firm",
);
assert(
  pathAfterAuthReturn({
    type: "magiclink",
    door: "accountant",
    next: null,
    roleDestination: "/app",
  }) === "/clients",
  "a stored accountant door opens /clients",
);
assert(
  pathAfterAuthReturn({
    type: "magiclink",
    door: null,
    next: null,
    roleDestination: "/app",
  }) === "/app",
  "with no stored door, an owner role opens /app",
);
assert(
  pathAfterAuthReturn({
    type: "signup",
    door: null,
    next: null,
    roleDestination: "/practice",
  }) === "/clients",
  "with no stored door, an accountant role opens /clients",
);
assert(
  pathAfterAuthReturn({
    type: "magiclink",
    door: "accountant",
    next: "/ops",
    roleDestination: "/practice",
  }) === "/ops",
  "a stored next path is honoured",
);
assert(
  pathAfterAuthReturn({
    type: "recovery",
    door: "owner",
    next: "/app",
    roleDestination: "/app",
  }) === "/reset-password",
  "a recovery hash opens the password page",
);
assert(
  pathAfterAuthReturn({
    type: "magiclink",
    door: null,
    next: "https://evil.example",
    roleDestination: "/app",
  }) === "/app",
  "an off-site next is dropped",
);

const read = (path: string) => readFileSync(resolve(path), "utf8");
const root = read("src/routes/__root.tsx");
const pickup = read("src/components/auth-url-return.tsx");
assert(root.includes("<AuthUrlReturn />"), "every route, including the landing page, mounts the pickup");
assert(pickup.includes("setSession"), "implicit tokens are applied with setSession");
assert(pickup.includes("exchangeCodeForSession"), "a code param is exchanged");
assert(pickup.includes("AUTH_LINK_EXPIRED"), "a failed link shows the friendly sentence");
assert(pickup.includes('to="/auth"'), "the expired banner can send a new link");

const magic = read("supabase/templates/magic_link.html");
const verify = read("supabase/templates/verify.html");
const config = read("supabase/config.toml");
assert(magic.includes("Sign in to Milōn"), "the magic-link template is the sign-in mail");
assert(magic.includes("{{ .ConfirmationURL }}"), "the sign-in button uses ConfirmationURL");
assert(magic.includes("{{ .Token }}"), "the sign-in mail shows the 6-digit code");
assert(magic.includes("#0B5FFF") && magic.includes("#102A43") && magic.includes("#DBEAFE"), "sign-in mail uses brand v1.1");
assert(magic.includes("#d4af37"), "gold is on the wordmark");
assert(!magic.includes("#c9962b"), "the sign-in button is not gold");
assert(verify.includes("Verify your email"), "the verify template stays separate");
assert(verify.includes("{{ .ConfirmationURL }}"), "the verify template keeps its own link");
assert(config.includes('content_path = "./supabase/templates/magic_link.html"'), "config points at the sign-in template");
assert(config.includes('content_path = "./supabase/templates/verify.html"'), "config points at the verify template");
assert(
  config.includes('content_path = "./supabase/templates/confirmation.html"'),
  "confirmation stays on its own template",
);

console.log("auth-url-return-test: ok");
