/**
 * Lighthouse sales tabs must be a real binding, and tab clicks must write ?tab=.
 * Also covers the trial-link host and Due today identity / dedupe guards.
 * Run: pnpm test:lighthouse-tabs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LIGHTHOUSE_TABS, parseLighthouseTab } from "../src/components/lighthouse-panel";
import {
  dedupeDueToday,
  dedupeLeadsById,
  emailAlreadyTouchedAtStep,
  lighthouseLeadChipLabel,
} from "../src/lib/lighthouse-due";
import {
  LIGHTHOUSE_TRIAL_SITE_URL,
  lighthouseTrialSiteUrl,
} from "../src/lib/lighthouse-trial-site";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const src = readFileSync(resolve(process.cwd(), "src/components/lighthouse-panel.tsx"), "utf8");
assert(
  /export const LIGHTHOUSE_TABS\s*=\s*\[[^\]]*\]\s*as const/.test(src),
  "lighthouse-panel.tsx must declare LIGHTHOUSE_TABS once",
);
assert(
  src.split("export const LIGHTHOUSE_TABS").length === 2,
  "LIGHTHOUSE_TABS is declared exactly once",
);

assert(
  LIGHTHOUSE_TABS.join(",") === "agent,firms,system",
  "sales console tabs are agent, firms, system",
);
assert(!LIGHTHOUSE_TABS.includes("playbook" as never), "Playbook is not a top-level tab");
assert(!LIGHTHOUSE_TABS.includes("assets" as never), "Assets is not a top-level tab");
assert(parseLighthouseTab("pipeline") === "firms", "?tab=pipeline redirects to firms");
assert(parseLighthouseTab("settings") === "system", "?tab=settings redirects to system");
assert(parseLighthouseTab("playbook") === "agent", "?tab=playbook redirects to agent");
assert(parseLighthouseTab("assets") === "agent", "?tab=assets redirects to agent");

const html = renderToStaticMarkup(
  createElement(
    "div",
    null,
    LIGHTHOUSE_TABS.map((t) => createElement("button", { key: t, type: "button" }, t)),
  ),
);
for (const tab of LIGHTHOUSE_TABS) {
  assert(html.includes(`>${tab}<`), `tab bar renders ${tab}`);
  assert(parseLighthouseTab(tab) === tab, `parseLighthouseTab accepts ${tab}`);
  assert(src.includes(`tab === "${tab}"`), `panel renders the ${tab} tab`);
}
assert(parseLighthouseTab("it") === undefined, "ops IT tab is not a sales tab");
assert(parseLighthouseTab(undefined) === undefined, "missing search tab does not throw");

assert(src.includes("search: { tab: t }"), "tab clicks navigate with search { tab }");
assert(src.includes('to: "/ops"'), "tab clicks stay on /ops");
assert(!src.includes("setTab("), "the open tab comes from the URL, not local state");
assert(
  src.includes('initialTab ?? "agent"') || src.includes("initialTab ?? 'agent'"),
  "missing ?tab= opens the agent tab",
);
assert(src.includes("LIGHTHOUSE_SENDER_NAME"), "the Team signer is shown");
assert(src.includes("auto_send off"), "auto_send is shown locked off");
assert(!src.includes("setSenderName"), "founder signer name is not editable");
assert(!src.includes("Open in mail"), "mailto bypass is gone");
assert(!src.includes("Opt-out link copied"), "unsubscribe copy control is gone");
assert(!src.includes("writeText(lead.optOutLink"), "the drawer does not copy the unsubscribe URL");
assert(!src.includes("Draft with Claude"), "the console does not brand drafts as Claude");
assert(src.includes("Send windows enforced"), "E17 windows are enforced, not a reminder");
assert(src.includes("Next up"), "the agent tab leads with Next up");
assert(src.includes("See all"), "the full due list stays reachable");
assert(src.includes("Review inbox"), "the review inbox stays");
assert(
  src.includes("Agent offline: AI key not configured (System)"),
  "a missing AI key uses neutral admin copy",
);
assert(!src.includes("function Playbook"), "the sequences panel is not mounted");
assert(!src.includes("ANTHROPIC_API_KEY"), "the panel does not name the AI key");
assert(!src.includes("RESEND_API_KEY"), "the panel does not name the mail key");

const VENDOR_UI = /\b(claude|anthropic|openai|chatgpt|gemini|gpt-?\d*)\b/i;
const KEY_UI = /ANTHROPIC_API_KEY|RESEND_API_KEY|CLAUDE_MODEL/;

function quotedStrings(body: string): string[] {
  const out: string[] = [];
  const re = /(["'`])((?:\\[\s\S]|(?!\1)[^\\])*?)\1/g;
  for (const match of body.matchAll(re)) out.push(match[2] ?? "");
  return out;
}

for (const file of [
  "src/components/lighthouse-panel.tsx",
  "src/components/lighthouse-agent-chat.tsx",
  "src/routes/_authenticated/ops.tsx",
]) {
  const body = readFileSync(resolve(process.cwd(), file), "utf8");
  const quoted = quotedStrings(body).join("\n");
  const vendorHit = quoted.split("\n").find((line) => VENDOR_UI.test(line));
  assert(!vendorHit, `${file} UI string names a model vendor: ${vendorHit ?? ""}`);
  const keyHit = quoted.split("\n").find((line) => KEY_UI.test(line));
  assert(!keyHit, `${file} UI string names an API key: ${keyHit ?? ""}`);
}

const ops = readFileSync(resolve(process.cwd(), "src/routes/_authenticated/ops.tsx"), "utf8");
assert(ops.includes('?? "agent"'), "ops defaults a missing sales tab to agent");
assert(ops.includes("AI key:"), "the console error screen labels the AI key without a vendor");
assert(!ops.includes("ANTHROPIC:"), "the console error screen does not name a vendor");

const fns = readFileSync(resolve(process.cwd(), "src/lib/lighthouse.functions.ts"), "utf8");
assert(fns.includes("lighthouseTrialSiteUrl"), "trial links use the milonfinance resolver");
assert(
  !fns.includes("https://milon.co.za"),
  "lighthouse no longer defaults the site to milon.co.za",
);
assert(
  fns.includes("emailAlreadyTouchedAtStep"),
  "send path no-ops a step already touched for that email",
);
assert(fns.includes("dedupeDueToday"), "due today is deduped before it reaches the board");
assert(fns.includes("lighthouseLeadChipLabel"), "due today chips use the distinguishing label");
const sendSlice = fns.slice(fns.indexOf("export const sendLighthouseTouch"));
const resendCall = sendSlice.indexOf('fetch("https://api.resend.com/emails"');
const skipCall = sendSlice.indexOf("emailAlreadyTouchedAtStep");
const windowCall = sendSlice.indexOf("sendBlockedReason");
const approveCall = sendSlice.indexOf('!== "approved"');
assert(skipCall > 0 && resendCall > skipCall, "the already-touched guard runs before Resend");
assert(windowCall > skipCall && resendCall > windowCall, "send is blocked outside the window before Resend");
assert(approveCall > 0 && resendCall > approveCall, "send requires an approved draft");
assert(fns.includes("next.auto_send = false"), "settings save hardcodes auto_send false");
assert(!fns.includes("next.auto_send = data.autoSend"), "the client cannot turn auto_send on");
assert(fns.includes("The draft came back unusable — try again."), "draft failures stay neutral");
assert(!fns.includes("Claude returned"), "draft failures do not name a model vendor");

assert(
  lighthouseTrialSiteUrl({}) === LIGHTHOUSE_TRIAL_SITE_URL,
  "empty env defaults to www.milonfinance.com",
);
assert(
  lighthouseTrialSiteUrl({ SITE_URL: "https://www.milon.co.za" }) === LIGHTHOUSE_TRIAL_SITE_URL,
  "milon.co.za SITE_URL is ignored for trial links",
);
assert(
  lighthouseTrialSiteUrl({
    SITE_URL: "https://milon.co.za/",
    VITE_APP_URL: "https://app.milon.co.za",
  }) === LIGHTHOUSE_TRIAL_SITE_URL,
  "non-milonfinance hosts never override the trial base",
);
assert(
  lighthouseTrialSiteUrl({ SITE_URL: "https://milonfinance.com/app/" }) ===
    "https://milonfinance.com",
  "explicit milonfinance.com host is kept, path dropped",
);
assert(
  lighthouseTrialSiteUrl({ VITE_APP_URL: "https://www.milonfinance.com/" }) ===
    "https://www.milonfinance.com",
  "www.milonfinance.com override is kept",
);
assert(
  lighthouseTrialSiteUrl({ SITE_URL: "https://staging.milonfinance.com" }) ===
    "https://staging.milonfinance.com",
  "a milonfinance.com subdomain override is kept",
);

const teamZa = {
  name: "team",
  company: "Milōn Dry Run",
  email: "team@milon.co.za",
};
const teamCom = {
  name: "team",
  company: "Milōn Dry Run",
  email: "team@milonfinance.com",
};
assert(
  lighthouseLeadChipLabel(teamZa) === "Milōn Dry Run · team@milon.co.za",
  "generic team chip shows firm and email",
);
assert(
  lighthouseLeadChipLabel(teamCom) !== lighthouseLeadChipLabel(teamZa),
  "the two team mailboxes do not share a chip label",
);
assert(
  lighthouseLeadChipLabel({
    name: "Janet Killingsworth",
    company: "Killingsworth Spencer, LLC",
    email: "info@killingsworthspencerllc.com",
  }) === "Janet Killingsworth",
  "a real name stays the chip label",
);

const queued = dedupeDueToday([
  { leadId: "a", email: "team@milon.co.za", leadName: "a", stepNo: 2 },
  { leadId: "a", email: "team@milon.co.za", leadName: "a-dup", stepNo: 2 },
  { leadId: "b", email: "TEAM@milon.co.za", leadName: "b", stepNo: 2 },
  { leadId: "c", email: "team@milonfinance.com", leadName: "c", stepNo: 2 },
]);
assert(
  queued.map((q) => q.leadId).join(",") === "a,c",
  "due today keeps one row per lead id and email",
);
assert(
  dedupeLeadsById([{ id: "a" }, { id: "a" }, { id: "b" }])
    .map((l) => l.id)
    .join(",") === "a,b",
  "repeated lead ids collapse before the board",
);
assert(
  emailAlreadyTouchedAtStep([{ email: "Team@milon.co.za", stepNo: 2 }], "team@milon.co.za", 2),
  "same email already sent at this step is a no-op",
);
assert(
  !emailAlreadyTouchedAtStep(
    [{ email: "team@milon.co.za", stepNo: 2 }],
    "team@milonfinance.com",
    2,
  ),
  "a different mailbox at the same step can still be touched",
);
assert(
  !emailAlreadyTouchedAtStep([{ email: "team@milon.co.za", stepNo: 1 }], "team@milon.co.za", 2),
  "an earlier step does not block the next step",
);

console.log("lighthouse tabs ok");
