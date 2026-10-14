/**
 * Render the /try outreach email to /tmp. Does not send mail.
 * Also writes public/email/example-result.png from the US sample figures.
 * Run: pnpm render:try-outreach
 */
import { existsSync, statSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { render } from "@react-email/render";
import { chromium } from "@playwright/test";
import { buildTrialBoard, trialReading } from "../src/lib/trial-demo";
import TryOutreachEmail, {
  TRY_OUTREACH_ADDRESS,
  TRY_OUTREACH_EXAMPLE_ALT,
  TRY_OUTREACH_EXAMPLE_SRC,
  TRY_OUTREACH_HEADERS,
  TRY_OUTREACH_PREVIEW,
  TRY_OUTREACH_SIGN_OFF,
  TRY_OUTREACH_SUBJECT,
  TRY_OUTREACH_TEXT,
  TRY_OUTREACH_TRY_URL,
  TRY_OUTREACH_UNSUBSCRIBE_URL,
} from "../emails/try-outreach";

const board = buildTrialBoard("US");
const reading = trialReading(board, new Date("2026-10-14T00:00:00Z"));
const pngPath = "public/email/example-result.png";

function resultCardHtml(): string {
  const score = board.health.score ?? "—";
  const label = board.health.label;
  const size = 148;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const shown = typeof score === "number" ? Math.max(0, Math.min(100, score)) : 0;
  const offset = circ * (1 - shown / 100);
  const center = size / 2;
  const arc =
    typeof score === "number"
      ? `<circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#c4841d" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 ${center} ${center})" />`
      : "";
  const tiles = [
    ["Gross margin", reading.grossMargin],
    ["Net margin", reading.netMargin],
    ["Current ratio", reading.currentRatio],
    ["Debtor days", reading.debtorDays],
  ]
    .map(
      ([name, value]) => `<td style="width:50%;padding:6px;">
        <div style="background:#f4f8ff;border-radius:14px;padding:14px 16px;">
          <div style="font-size:11px;line-height:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#3d5270;">${name}</div>
          <div style="margin-top:4px;font-size:22px;line-height:26px;font-weight:700;letter-spacing:-0.03em;color:#102a43;">${value}</div>
        </div>
      </td>`,
    )
    .reduce<string[]>((rows, cell, index) => {
      if (index % 2 === 0) rows.push(`<tr>${cell}`);
      else rows[rows.length - 1] += `${cell}</tr>`;
      return rows;
    }, [])
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: "Plus Jakarta Sans";
    src: url("file:///workspace/node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2") format("woff2");
    font-weight: 100 900;
    font-display: block;
  }
  html, body { margin: 0; background: #ffffff; }
  #card {
    width: 544px;
    box-sizing: border-box;
    background: #ffffff;
    font-family: "Plus Jakarta Sans", "Segoe UI", sans-serif;
    color: #102a43;
    padding: 8px 4px 4px;
  }
</style>
</head>
<body>
  <div id="card">
    <div style="font-size:11px;line-height:14px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#0b5fff;">Example result</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;">
      <tr>
        <td style="width:168px;vertical-align:middle;">
          <div style="position:relative;width:${size}px;height:${size}px;">
            <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
              <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#dbeafe" stroke-width="${stroke}" />
              ${arc}
            </svg>
            <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
              <div style="font-size:44px;line-height:44px;font-weight:700;letter-spacing:-0.04em;">${score}</div>
              <div style="margin-top:2px;font-size:12px;line-height:16px;font-weight:700;color:#8a5a12;">${label}</div>
            </div>
          </div>
        </td>
        <td style="vertical-align:middle;padding-left:8px;">
          <div style="font-size:15px;line-height:22px;color:#3d5270;">A services sample. No books connected. Cash runway is not measured, because there is no cash balance.</div>
          <div style="margin-top:8px;font-size:13px;line-height:18px;color:#5c7190;">13-week estimate closes at ${reading.cashClose}.</div>
        </td>
      </tr>
    </table>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:8px;border-collapse:separate;">
      ${tiles}
    </table>
  </div>
</body>
</html>`;
}

async function writeExamplePng() {
  const htmlPath = "/tmp/example-result.html";
  writeFileSync(htmlPath, resultCardHtml());
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({
      deviceScaleFactor: 2,
      viewport: { width: 600, height: 800 },
    });
    await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
    await page.locator("#card").screenshot({ path: pngPath, type: "png" });
  } finally {
    await browser.close();
  }
}

try {
  await writeExamplePng();
} catch (error) {
  if (!existsSync(pngPath)) throw error;
  console.warn("kept existing example-result.png");
}

const pngSize = statSync(pngPath).size;
if (pngSize < 8 * 1024 || pngSize > 180 * 1024) {
  throw new Error(`${pngPath} is ${pngSize} bytes`);
}

const html = await render(createElement(TryOutreachEmail));
const text = TRY_OUTREACH_TEXT;
const headers = Object.entries(TRY_OUTREACH_HEADERS)
  .map(([name, value]) => `${name}: ${value}`)
  .join("\n");

writeFileSync("/tmp/try-outreach.html", html);
writeFileSync("/tmp/try-outreach.txt", `${text}\n`);
writeFileSync("/tmp/try-outreach.headers", `${headers}\n`);

const required = [
  TRY_OUTREACH_SUBJECT,
  TRY_OUTREACH_PREVIEW,
  TRY_OUTREACH_TRY_URL,
  "Try Milōn",
  TRY_OUTREACH_UNSUBSCRIBE_URL,
  TRY_OUTREACH_ADDRESS,
  TRY_OUTREACH_SIGN_OFF,
  TRY_OUTREACH_EXAMPLE_SRC,
  "Example result",
  reading.grossMargin,
  reading.netMargin,
  reading.currentRatio,
  reading.debtorDays,
  "https://milonfinance.com/email/fm.png",
  "https://milonfinance.com/email/analyst.png",
  "https://milonfinance.com/email/advisor.png",
  "Holds the 13-week cash line and the profit bridge.",
  "Reads the ratios, the margins, and what is drifting.",
  "Turns that reading into the next move.",
];
for (const needle of required) {
  if (!html.includes(needle)) throw new Error(`html missing ${needle}`);
}
if (!html.includes("v:roundrect") || !html.includes('fillcolor="#d4af37"')) {
  throw new Error("the button is not a bulletproof gold button");
}
if (!/<table/i.test(html)) throw new Error("email is not a table layout");
if (/>\s*Sample\s*</i.test(html) || html.includes("SAMPLE")) {
  throw new Error("the SAMPLE tag is still in the email");
}
if (html.includes("R299") || html.includes("R2,837") || /\bR\s\d/.test(html)) {
  throw new Error("email shows a rand amount");
}
if (!text.includes(TRY_OUTREACH_SUBJECT)) throw new Error("text missing the subject");
if (!text.includes("Try Milōn")) throw new Error("text missing the button label");
if (!text.includes(TRY_OUTREACH_EXAMPLE_ALT)) throw new Error("text missing the example result");
if (!headers.includes("List-Unsubscribe:")) throw new Error("missing List-Unsubscribe header");
if (!headers.includes("List-Unsubscribe-Post:"))
  throw new Error("missing List-Unsubscribe-Post header");
if (/whatsapp/i.test(html) || /whatsapp/i.test(text)) throw new Error("outreach mentions WhatsApp");

for (const face of ["fm", "analyst", "advisor"]) {
  const file = `public/email/${face}.png`;
  const size = statSync(file).size;
  if (size <= 0 || size >= 60 * 1024) throw new Error(`${file} is ${size} bytes`);
}

console.log("rendered /tmp/try-outreach.html");
console.log("rendered /tmp/try-outreach.txt");
console.log("rendered /tmp/try-outreach.headers");
console.log(`rendered ${pngPath} (${pngSize} bytes)`);
