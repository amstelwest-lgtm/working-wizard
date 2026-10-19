/**
 * One-time consent for hello@milonfinance.com's Google Calendar.
 * Does not book an event and does not send mail.
 *
 * The OAuth client must allow the redirect URI http://127.0.0.1:8787.
 *
 *   GOOGLE_CALENDAR_CLIENT_ID=... GOOGLE_CALENDAR_CLIENT_SECRET=... \
 *     pnpm exec vite-node --config scripts/vite-test.config.ts scripts/google-calendar-auth.mts
 *
 * Approve as hello@milonfinance.com, then:
 *
 *   ... scripts/google-calendar-auth.mts --code=THE_CODE
 *
 * Or pass --listen and approve in the browser. The script prints
 * GOOGLE_CALENDAR_REFRESH_TOKEN. Store it in the host env. Do not commit it.
 */
import { createServer } from "node:http";
import {
  GOOGLE_REDIRECT_URI,
  exchangeGoogleAuthCode,
  googleConsentUrl,
} from "../src/lib/google-calendar";

const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ?? "";
const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ?? "";

if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET.");
  process.exit(1);
}

const codeFlag =
  process.argv.find((arg) => arg.startsWith("--code="))?.slice("--code=".length) ?? "";
const listen = process.argv.includes("--listen");
const url = googleConsentUrl({ clientId, redirectUri: GOOGLE_REDIRECT_URI });

async function finish(code: string) {
  const tokens = await exchangeGoogleAuthCode({
    clientId,
    clientSecret,
    code,
    redirectUri: GOOGLE_REDIRECT_URI,
    fetchImpl: fetch,
  });
  if (!tokens.refreshToken) {
    console.error("Google did not return a refresh token. Open the consent URL and approve again.");
    process.exit(1);
  }
  console.log(`GOOGLE_CALENDAR_REFRESH_TOKEN=${tokens.refreshToken}`);
  console.log("Store that value as GOOGLE_CALENDAR_REFRESH_TOKEN. Do not commit it.");
}

if (codeFlag) {
  await finish(codeFlag);
} else if (listen) {
  console.log(url);
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const host = `http://127.0.0.1:8787${req.url ?? "/"}`;
      const received = new URL(host).searchParams.get("code");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(received ? "Consent received. You can close this tab." : "Missing code.");
      server.close();
      if (received) resolve(received);
      else reject(new Error("Missing code"));
    });
    server.listen(8787, "127.0.0.1");
  });
  await finish(code);
} else {
  console.log(url);
  console.log("Approve as hello@milonfinance.com, then re-run with --code=THE_CODE");
  console.log("Or re-run with --listen and open the URL in a browser.");
}
