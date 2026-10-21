/**
 * Document-list invite. Rendering only. No mail is sent.
 * Run: pnpm test:client-agent-invite-email
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderClientAgentInviteEmail } from "../src/lib/client-agent-invite-email.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
const source = readFileSync(resolve(root, "src/lib/client-agent-invite-email.ts"), "utf8");
const mail = renderClientAgentInviteEmail({
  practiceName: "Theo's practice",
  link: "https://www.milonfinance.com/a/exampletokenexampletoken",
  expiresAt: "2026-11-04T12:00:00.000Z",
});

assert(mail.subject === "Theo's practice asked for a few documents", "subject names the practice");
assert(
  mail.html.includes("Only send what you have — skip anything that doesn't apply."),
  "html has the skip line",
);
assert(
  mail.text.includes("Only send what you have — skip anything that doesn't apply."),
  "text has the skip line",
);
assert(
  mail.html.includes("You'll be asked to agree before anything is stored."),
  "consent comes first",
);
assert(mail.html.includes("Open your document list"), "the button names the list");
assert(mail.html.includes('role="presentation"'), "the layout table is presentational");
assert(
  mail.html.includes('bgcolor="#0B5FFF"') && mail.html.includes("color:#ffffff"),
  "the button is cobalt with white text",
);
assert(
  mail.html.includes("https://www.milonfinance.com/a/exampletokenexampletoken"),
  "the plain link is under the button",
);
assert(
  mail.text.includes(
    "Open your document list: https://www.milonfinance.com/a/exampletokenexampletoken",
  ),
  "text has the fallback link",
);
assert(mail.html.includes("Hello,"), "a missing first name greets Hello");
assert(
  mail.text.startsWith("Theo's practice asked for a few documents\n\nHello,"),
  "text greets Hello",
);
assert(
  mail.html.includes("To help with your tax this year, we need a few documents from you."),
  "html asks for this year's documents",
);
assert(
  mail.text.includes("To help with your tax this year, we need a few documents from you."),
  "text asks for this year's documents",
);
assert(mail.html.includes("This link expires on 4 Nov 2026."), "html has the expiry");
assert(mail.text.includes("This link expires on 4 Nov 2026."), "text has the expiry");
assert(
  mail.html.includes("Kind regards,<br>Theo&#39;s practice") ||
    mail.html.includes("Kind regards,<br>Theo's practice"),
  "html signs off with the practice",
);
assert(mail.text.includes("Kind regards,\nTheo's practice"), "text signs off with the practice");
assert((mail.html.match(/Milōn/g) ?? []).length === 1, "Milōn appears once");
assert(mail.html.includes("Powered by Milōn"), "the footer is the only Milōn line");
assert(
  mail.html.includes('lang="en"') && mail.html.includes('dir="ltr"'),
  "the message has a language and direction",
);
assert(
  !/sars|whatsapp|completed form|fill in a form|\$\d|R\s?\d/i.test(
    mail.html + mail.text + mail.subject,
  ),
  "no claims, chat apps, or prices",
);
assert(!/toLocaleDateString/.test(source), "the expiry is not formatted by locale");
assert(!/formatCalendarDay/.test(source), "the expiry is not the UTC calendar prefix");
assert(!/resend|nodemailer|sendTeamMail/i.test(source), "the template does not send");
const rules = readFileSync(resolve(root, "src/lib/client-agent-link.ts"), "utf8");
assert(
  rules.includes('timezone: "Africa/Johannesburg"') &&
    rules.includes("formatDate(expiresAt, clientAgentDateMarket)"),
  "the expiry uses Africa/Johannesburg",
);

const late = renderClientAgentInviteEmail({
  practiceName: "Theo's practice",
  link: "https://www.milonfinance.com/a/exampletokenexampletoken",
  expiresAt: "2026-11-04T23:30:00.000Z",
  firstName: "Nicola",
});
assert(late.html.includes("Hi Nicola,"), "a contact first name is greeted");
assert(late.text.includes("Hi Nicola,"), "text greets the first name");
assert(
  late.html.includes("This link expires on 5 Nov 2026."),
  "23:30 UTC is the next Johannesburg day",
);
assert(late.text.includes("This link expires on 5 Nov 2026."), "text uses the Johannesburg day");

const business = renderClientAgentInviteEmail({
  practiceName: "Theo's practice",
  link: "https://www.milonfinance.com/a/exampletokenexampletoken",
  expiresAt: new Date("2026-11-04T23:30:00.000Z"),
  firstName: "Harbour Books",
});
assert(business.html.includes("Hello,"), "a business name is not split into a greeting");
assert(!business.html.includes("Hi Harbour"), "the business name is not used as a first name");
assert(
  business.html.includes("This link expires on 5 Nov 2026."),
  "a Date at 23:30 UTC uses Johannesburg",
);

const escaped = renderClientAgentInviteEmail({
  practiceName: `Theo <script> & "practice"`,
  link: "https://www.milonfinance.com/a/exampletokenexampletoken",
  expiresAt: new Date("2026-11-04T12:00:00.000Z"),
});
assert(!escaped.html.includes("<script>"), "a practice name cannot inject markup");
assert(escaped.html.includes("Theo &lt;script&gt;"), "markup in the practice name is escaped");
assert(escaped.subject.includes("Theo <script>"), "the subject keeps the typed name");

console.log("client agent invite email test ok");
