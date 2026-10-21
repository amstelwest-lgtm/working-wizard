/**
 * Invite send. Resend is mocked. No network and no test message.
 * Run: pnpm test:client-agent-invite-mail
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  clientAgentInviteFrom,
  sendClientAgentInvite,
} from "../src/lib/client-agent-invite-mail.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
const source = readFileSync(resolve(root, "src/lib/client-agent-invite-mail.ts"), "utf8");
const mint = readFileSync(resolve(root, "src/lib/client-agent-send.functions.ts"), "utf8");

assert(
  clientAgentInviteFrom("Theo's practice", null) === "Theo's practice <noreply@milonfinance.com>",
  "the from name is the practice and the address is the fallback",
);
assert(
  clientAgentInviteFrom("Theo's practice", "Milōn <hello@milonfinance.com>") ===
    "Theo's practice <hello@milonfinance.com>",
  "RESEND_FROM_EMAIL supplies the address only",
);
assert(!/console\./.test(source), "the mailer does not log");
assert(!/console\./.test(mint), "mint does not log");
assert(mint.includes("sendClientAgentInvite"), "mint sends the rendered invite");
assert(mint.includes("firstName: firstName.name"), "mint passes the given name");
assert(
  mint.includes("practiceDisplayName"),
  "the practice name falls back when the display name is empty",
);

const calls: Array<{ url: string; init: RequestInit }> = [];
const fetchImpl: typeof fetch = async (url, init) => {
  calls.push({ url: String(url), init: init ?? {} });
  return new Response(JSON.stringify({ id: "re_test_ignored" }), { status: 200 });
};

const sent = await sendClientAgentInvite({
  practiceName: "Theo's practice",
  to: "nicola@example.com",
  firstName: "Nicola",
  link: "https://www.milonfinance.com/a/exampletokenexampletoken",
  expiresAt: "2026-11-04T23:30:00.000Z",
  idempotencyKey: "client-agent-invite/send-1",
  apiKey: "re_test_key",
  fromEmail: "noreply@milonfinance.com",
  fetchImpl,
});
assert(sent.ok, "a mocked send succeeds");
assert(calls.length === 1, "one request");
assert(calls[0]?.url === "https://api.resend.com/emails", "the request stays on Resend");
const body = JSON.parse(String(calls[0]?.init.body)) as {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
};
assert(body.from === "Theo's practice <noreply@milonfinance.com>", "from is the practice");
assert(body.to.length === 1 && body.to[0] === "nicola@example.com", "to is the confirmed address");
assert(body.subject === "Theo's practice asked for a few documents", "subject names the practice");
assert(body.html.includes("Hi Nicola,"), "the given name is the greeting");
assert(body.text.includes("Hi Nicola,"), "the text greeting uses the given name");
assert(
  body.html.includes("This link expires on 5 Nov 2026."),
  "the expiry is the Johannesburg day",
);
assert(
  body.html.includes("https://www.milonfinance.com/a/exampletokenexampletoken"),
  "the button links to the minted page",
);
const headers = new Headers(calls[0]?.init.headers);
assert(headers.get("Idempotency-Key") === "client-agent-invite/send-1", "the send is idempotent");
assert(headers.get("Authorization") === "Bearer re_test_key", "the key stays in the header");

calls.length = 0;
const skipped = await sendClientAgentInvite({
  practiceName: "Theo's practice",
  to: "nicola@example.com",
  link: "https://www.milonfinance.com/a/exampletokenexampletoken",
  expiresAt: "2026-11-04T12:00:00.000Z",
  idempotencyKey: "client-agent-invite/send-2",
  apiKey: "  ",
  fetchImpl,
});
assert(!skipped.ok && skipped.reason === "not_configured", "a missing key does not send");
assert(calls.length === 0, "a missing key makes no request");

const businessCalls: Array<{ init: RequestInit }> = [];
await sendClientAgentInvite({
  practiceName: "Theo's practice",
  to: "nicola@example.com",
  firstName: "Harbour Books",
  link: "https://www.milonfinance.com/a/exampletokenexampletoken",
  expiresAt: "2026-11-04T12:00:00.000Z",
  idempotencyKey: "client-agent-invite/send-3",
  apiKey: "re_test_key",
  fetchImpl: async (_url, init) => {
    businessCalls.push({ init: init ?? {} });
    return new Response("{}", { status: 200 });
  },
});
const business = JSON.parse(String(businessCalls[0]?.init.body)) as { html: string };
assert(business.html.includes("Hello,"), "a business name is not used as a greeting");
assert(!business.html.includes("Hi Harbour"), "the business name is not split");

console.log("client agent invite mail test ok");
