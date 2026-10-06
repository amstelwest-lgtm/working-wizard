/**
 * Prospect and customer copy must not name an AI vendor or model.
 * Run: pnpm test:outbound-copy-no-vendor
 *
 * Scans the strings that actually go out or render on a public route:
 * golden and one-shot email bodies, the owner-invite template, cadence
 * step bodies, and route / FAQ / signup copy. System prompts and internal
 * identifiers (callClaudeMessages, ClaudeBot) are out of scope.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { templateInviteDraft } from "../src/lib/client-invite-email";
import {
  ACCOUNTANT_ONESHOT_GOLDEN,
  ACCOUNTANT_ONESHOT_TEMPLATE,
  ACCOUNTANT_V1_GOLDEN,
  fillAccountantSequenceGolden,
} from "../src/lib/lighthouse-accountant-golden";

const VENDOR = /\b(claude|anthropic|openai|gpt)\b/i;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertClean(label: string, text: string) {
  const hit = text.match(VENDOR);
  assert(!hit, `${label} names a model vendor (${hit?.[0]})`);
}

/** JSX text and prose string literals. Skips code identifiers such as "claude". */
function routeCopy(src: string): string {
  const chunks: string[] = [];
  const strings = /(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g;
  for (const match of src.matchAll(strings)) {
    const body = match[0].slice(1, -1);
    if (!/[\s]/.test(body)) continue;
    chunks.push(body);
  }
  const jsxText = />([^<{]+)</g;
  for (const match of src.matchAll(jsxText)) {
    const text = match[1].trim();
    if (text) chunks.push(text);
  }
  return chunks.join("\n");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(tsx|ts)$/.test(name)) out.push(path);
  }
  return out;
}

for (const email of ACCOUNTANT_V1_GOLDEN) {
  assertClean(`accountant_v1 step ${email.step} subject`, email.subject);
  assertClean(`accountant_v1 step ${email.step} body`, email.body);
}

assertClean("oneshot subject", ACCOUNTANT_ONESHOT_GOLDEN.subject);
assertClean("oneshot body", ACCOUNTANT_ONESHOT_GOLDEN.body);
assertClean("oneshot template subject", ACCOUNTANT_ONESHOT_TEMPLATE.subject);
assertClean("oneshot template body", ACCOUNTANT_ONESHOT_TEMPLATE.body);

const filled = fillAccountantSequenceGolden({
  sequenceKey: "accountant_oneshot_v1",
  stepNo: 1,
  name: "Thandi Molefe",
  firm: "Molefe Inc",
});
assertClean("filled oneshot subject", filled.subject);
assertClean("filled oneshot body", filled.body);

const oneshot = ACCOUNTANT_ONESHOT_GOLDEN.body;
assert(oneshot.includes("our AI agent"), "oneshot says our AI agent");
assert(oneshot.includes("https://youtu.be/J4vJki7HcIs"), "oneshot keeps the firm teaser");
assert(oneshot.includes("https://youtu.be/k3aRM4toTvU"), "oneshot keeps the owner teaser");
assert(oneshot.trimEnd().endsWith("The Milōn Team"), "oneshot signs The Milōn Team");
assert(oneshot.includes("We’ll give you a call shortly"), "oneshot keeps the follow-up call");
assert(!/\btheo\b/i.test(oneshot), "oneshot has no founder name");
assert(!/outsourced\s+cfo|\bocfo\b/i.test(oneshot), "oneshot never mentions Outsourced CFO");

const invite = templateInviteDraft({
  clientName: "Karoo Traders",
  clientCode: "MLN-AB12CD",
  inviteUrl: "https://milon.co.za/?invite=abc123&mode=signup",
  firmName: "West & Co",
  accountantName: "Theo West",
  accountantEmail: "theo@west.co.za",
});
assertClean("owner-invite template subject", invite.subject);
assertClean("owner-invite template body", invite.body);

const copyFiles = [
  "src/lib/marketing-faq.ts",
  "src/components/owner-invite-signup-panel.tsx",
  "src/lib/workflow-emails.ts",
  "src/lib/practice-access-email.ts",
  "src/lib/note-mention-email.ts",
];
for (const rel of copyFiles) {
  assertClean(rel, readFileSync(resolve(rel), "utf8"));
}

const routes = walk(resolve("src/routes"));
assert(routes.length > 10, "public route walk found the route tree");
for (const file of routes) {
  const rel = relative(resolve("."), file);
  assertClean(rel, routeCopy(readFileSync(file, "utf8")));
}

console.log("outbound-copy-no-vendor-test: ok");
