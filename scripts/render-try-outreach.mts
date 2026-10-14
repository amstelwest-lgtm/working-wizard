/**
 * Render the /try outreach email to /tmp. Does not send mail.
 * Run: pnpm render:try-outreach
 */
import { statSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { render } from "@react-email/render";
import TryOutreachEmail, {
  TRY_OUTREACH_ADDRESS,
  TRY_OUTREACH_HEADERS,
  TRY_OUTREACH_SIGN_OFF,
  TRY_OUTREACH_TEXT,
  TRY_OUTREACH_TRY_URL,
  TRY_OUTREACH_UNSUBSCRIBE_URL,
} from "../emails/try-outreach";

const html = await render(createElement(TryOutreachEmail));
const text = TRY_OUTREACH_TEXT;
const headers = Object.entries(TRY_OUTREACH_HEADERS)
  .map(([name, value]) => `${name}: ${value}`)
  .join("\n");

writeFileSync("/tmp/try-outreach.html", html);
writeFileSync("/tmp/try-outreach.txt", `${text}\n`);
writeFileSync("/tmp/try-outreach.headers", `${headers}\n`);

const required = [
  TRY_OUTREACH_TRY_URL,
  "Try Milōn",
  TRY_OUTREACH_UNSUBSCRIBE_URL,
  TRY_OUTREACH_ADDRESS,
  TRY_OUTREACH_SIGN_OFF,
  "https://milonfinance.com/email/fm.png",
  "https://milonfinance.com/email/analyst.png",
  "https://milonfinance.com/email/advisor.png",
];
for (const needle of required) {
  if (!html.includes(needle)) throw new Error(`html missing ${needle}`);
  if (needle.startsWith("http") && needle.includes("/email/")) continue;
  if (!text.includes(needle) && needle !== "Try Milōn") {
    if (!text.includes(needle)) throw new Error(`text missing ${needle}`);
  }
}
if (!text.includes("Try Milōn")) throw new Error("text missing the button label");
if (!headers.includes("List-Unsubscribe:")) throw new Error("missing List-Unsubscribe header");
if (!headers.includes("List-Unsubscribe-Post:")) throw new Error("missing List-Unsubscribe-Post header");
if (/whatsapp/i.test(html) || /whatsapp/i.test(text)) throw new Error("outreach mentions WhatsApp");

for (const face of ["fm", "analyst", "advisor"]) {
  const file = `public/email/${face}.png`;
  const size = statSync(file).size;
  if (size <= 0 || size >= 60 * 1024) throw new Error(`${file} is ${size} bytes`);
}

console.log("rendered /tmp/try-outreach.html");
console.log("rendered /tmp/try-outreach.txt");
console.log("rendered /tmp/try-outreach.headers");
