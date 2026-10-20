/**
 * Render the warm demo outreach email.
 * Writes docs/outreach/warm-demo-email.html and /tmp/try-outreach.*.
 * Does not send mail.
 * Run: pnpm render:try-outreach
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { render } from "@react-email/render";
import { firmSignupHref } from "../src/lib/firm-signup-copy";
import { buildTrialBoard, trialReading } from "../src/lib/trial-demo";
import TryOutreachEmail, {
  TRY_OUTREACH_ADDRESS,
  TRY_OUTREACH_CTA_LABEL,
  TRY_OUTREACH_EXAMPLE_ALT,
  TRY_OUTREACH_EXAMPLE_CLOSE,
  TRY_OUTREACH_EXAMPLE_NOTE,
  TRY_OUTREACH_HEADERS,
  TRY_OUTREACH_INCENTIVES,
  TRY_OUTREACH_INCENTIVES_KICKER,
  TRY_OUTREACH_PREVIEW,
  TRY_OUTREACH_SIGN_OFF,
  TRY_OUTREACH_SIGNUP_LABEL,
  TRY_OUTREACH_SIGNUP_URL,
  TRY_OUTREACH_SUBJECT,
  TRY_OUTREACH_TEXT,
  TRY_OUTREACH_TRY_URL,
  TRY_OUTREACH_UNSUBSCRIBE_URL,
  WARM_DEMO_AGENT,
  WARM_DEMO_HERO_ALT,
  WARM_DEMO_HERO_HEIGHT,
  WARM_DEMO_HERO_SRC,
  WARM_DEMO_HERO_WIDTH,
  warmDemoCtaUrl,
} from "../emails/try-outreach";

const board = buildTrialBoard("US");
const reading = trialReading(board, new Date("2026-10-14T00:00:00Z"));
const OUT_HTML = "docs/outreach/warm-demo-email.html";

function fail(message: string): never {
  throw new Error(message);
}

function assertImages(html: string) {
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  if (imgs.length > 1) fail(`expected at most one image, found ${imgs.length}`);
  for (const tag of imgs) {
    const alt = tag.match(/\balt\s*=\s*"([^"]*)"/i);
    if (!alt) fail(`img missing alt: ${tag}`);
    if (alt[1].trim().length === 0) fail("img alt is empty");
    if (!/\bwidth\s*=\s*"\d+"/i.test(tag)) fail(`img missing width: ${tag}`);
    if (!/\bheight\s*=\s*"\d+"/i.test(tag)) fail(`img missing height: ${tag}`);
    if (!/display\s*:\s*block/i.test(tag)) fail("img missing display:block");
  }
}

function assertNoImageOnlyLinks(html: string) {
  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? [];
  for (const anchor of anchors) {
    const text = anchor
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (/<img\b/i.test(anchor) && text.length === 0) {
      fail(`image-only link: ${anchor.slice(0, 200)}`);
    }
  }
}

function assertLayoutTables(html: string) {
  const tables = html.match(/<table\b[^>]*>/gi) ?? [];
  if (tables.length === 0) fail("email is not a table layout");
  for (const table of tables) {
    if (!/role\s*=\s*"presentation"/i.test(table)) {
      fail(`layout table missing role=presentation: ${table}`);
    }
  }
}

function assertOutlookSafe(html: string, text: string) {
  const bytes = Buffer.byteLength(html, "utf8");
  if (bytes >= 102 * 1024) fail(`html is ${bytes} bytes; Gmail clips at 102KB`);
  if (/\.gif\b/i.test(html) || /image\/gif/i.test(html)) fail("html contains a gif");
  if (/<link\b/i.test(html) || /@import\b/i.test(html)) {
    fail("html uses external CSS or a link tag");
  }
  if (/color\s*:\s*(#fff\b|#ffffff\b|white)\b/i.test(html)) fail("pure-white text color");
  if (/color\s*=\s*["']#fff(?:fff)?["']/i.test(html)) fail("pure-white text attribute");
  if (!/<!--\[if mso\]>[\s\S]*?<v:roundrect\b[\s\S]*?<!\[endif\]-->/i.test(html)) {
    fail("missing an mso VML roundrect button");
  }
  const buttons = html.match(/<v:roundrect\b/gi) ?? [];
  if (buttons.length !== 1) fail(`expected one VML button, found ${buttons.length}`);
  if (!/fillcolor="#d4af37"/i.test(html)) fail("the button is not brand gold");
  if (!/color:#102A43/i.test(html)) fail("the button text is not dark navy");
  if (!html.includes('name="color-scheme"') || !html.includes('name="supported-color-schemes"')) {
    fail("missing color-scheme meta tags");
  }
  if (!html.includes("[data-ogsc]") || !/prefers-color-scheme:\s*dark/.test(html)) {
    fail("missing dark-mode selectors");
  }
  if (!/width="600"/.test(html)) fail("missing the 600px layout table");
  assertImages(html);
  assertNoImageOnlyLinks(html);
  assertLayoutTables(html);

  for (const name of ["Milōn Financial Manager", "Milōn Analyst", "Milōn Advisor"]) {
    if (!html.includes(name) || !text.includes(name)) fail(`missing agent name ${name}`);
  }
  if (/whatsapp/i.test(html) || /whatsapp/i.test(text)) fail("outreach mentions WhatsApp");
  if (/\bvat\b/i.test(html) || /\bvat\b/i.test(text)) fail("outreach mentions VAT");
  if (/\bDana\b/.test(html) || /\bDana\b/.test(text)) fail("outreach names Dana");
  if (html.includes("/outreach/sample-scorecard") || html.includes("/outreach/sample-roadmap")) {
    fail("the #355/#381 outreach images are still in the email");
  }
  if (/\.gif\b/i.test(WARM_DEMO_HERO_SRC)) fail("hero is a gif");

  const hero = statSync("public/email/warm-hero.png");
  if (hero.size <= 0 || hero.size >= 40 * 1024) fail(`warm-hero.png is ${hero.size} bytes`);
  const heroBytes = readFileSync("public/email/warm-hero.png");
  if (heroBytes[0] !== 0x89 || heroBytes[1] !== 0x50) fail("warm-hero.png is not a PNG");
}

const rendered = await render(createElement(TryOutreachEmail), { pretty: true });
const html = rendered.replace(/<link\b[^>]*rel="preload"[^>]*>\s*/g, "");
const text = TRY_OUTREACH_TEXT;
const headers = Object.entries(TRY_OUTREACH_HEADERS)
  .map(([name, value]) => `${name}: ${value}`)
  .join("\n");

mkdirSync("docs/outreach", { recursive: true });
writeFileSync(OUT_HTML, html);
writeFileSync("/tmp/try-outreach.html", html);
writeFileSync("/tmp/try-outreach.txt", `${text}\n`);
writeFileSync("/tmp/try-outreach.headers", `${headers}\n`);

const cta = warmDemoCtaUrl();
if (WARM_DEMO_AGENT !== "financial_manager") fail("the default agent is not Financial Manager");
if (cta !== TRY_OUTREACH_TRY_URL) fail(`cta is not the current demo page: ${cta}`);

const required = [
  TRY_OUTREACH_SUBJECT,
  TRY_OUTREACH_PREVIEW,
  TRY_OUTREACH_TRY_URL,
  TRY_OUTREACH_CTA_LABEL,
  TRY_OUTREACH_SIGNUP_LABEL,
  TRY_OUTREACH_UNSUBSCRIBE_URL,
  TRY_OUTREACH_ADDRESS,
  TRY_OUTREACH_SIGN_OFF,
  "Example result",
  TRY_OUTREACH_EXAMPLE_NOTE,
  TRY_OUTREACH_EXAMPLE_CLOSE,
  reading.grossMargin,
  reading.netMargin,
  reading.currentRatio,
  reading.debtorDays,
  "Holds the 13-week cash line and the profit bridge.",
  "Reads the ratios, the margins, and what is drifting.",
  "Turns that reading into the next move.",
  TRY_OUTREACH_INCENTIVES_KICKER,
  ...TRY_OUTREACH_INCENTIVES,
  WARM_DEMO_HERO_SRC,
  WARM_DEMO_HERO_ALT,
  `width="${WARM_DEMO_HERO_WIDTH}"`,
  `height="${WARM_DEMO_HERO_HEIGHT}"`,
];
const flatHtml = html.replace(/\s+/g, " ");
for (const needle of required) {
  if (!flatHtml.includes(needle.replace(/\s+/g, " "))) fail(`html missing ${needle}`);
}
if (/>\s*Sample\s*</i.test(html) || html.includes("SAMPLE")) {
  fail("the SAMPLE tag is still in the email");
}
if (html.includes("R299") || html.includes("R2,837") || /\bR\s\d/.test(html)) {
  fail("email shows a rand amount");
}
if (
  !html.includes(TRY_OUTREACH_SIGNUP_URL.replace(/&/g, "&amp;")) &&
  !html.includes(TRY_OUTREACH_SIGNUP_URL)
) {
  fail("html missing the signup link");
}
const starterSignup = `https://www.milonfinance.com${firmSignupHref("starter")}&utm_source=email`;
if (TRY_OUTREACH_SIGNUP_URL !== starterSignup) {
  fail(`signup link is not the accountant Starter plan: ${TRY_OUTREACH_SIGNUP_URL}`);
}
if (html.includes("plan=solo") || text.includes("plan=solo")) {
  fail("Start free trial still links to plan=solo");
}
if (!text.includes(TRY_OUTREACH_SUBJECT)) fail("text missing the subject");
if (!text.includes(TRY_OUTREACH_CTA_LABEL)) fail("text missing the button label");
if (!text.includes(`${TRY_OUTREACH_SIGNUP_LABEL}: ${TRY_OUTREACH_SIGNUP_URL}`)) {
  fail("text missing the signup link");
}
if (!text.includes(TRY_OUTREACH_EXAMPLE_ALT)) fail("text missing the example result");
if (!text.includes(`${TRY_OUTREACH_CTA_LABEL}: ${cta}`)) fail("text missing the demo link");
if (!headers.includes("List-Unsubscribe:")) fail("missing List-Unsubscribe header");
if (!headers.includes("List-Unsubscribe-Post:")) fail("missing List-Unsubscribe-Post header");

assertOutlookSafe(html, text);

console.log(`rendered ${OUT_HTML} (${Buffer.byteLength(html, "utf8")} bytes)`);
console.log("rendered /tmp/try-outreach.html");
console.log("rendered /tmp/try-outreach.txt");
console.log("rendered /tmp/try-outreach.headers");
