/**
 * IRP6 end to end on the harness: open the Tax Specialist, open IRP6, fill the
 * missing fields, approve each section, download, and check the file names.
 * Expects the harness on 127.0.0.1:4179 (pnpm harness:dev).
 * Run: pnpm e2e:irp6-download
 */
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const base = "http://127.0.0.1:4179";
const SECTIONS = ["taxpayer", "estimate", "adjustments", "credits", "result"];

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (err) => errors.push(err.message));

await page.goto(`${base}/clients/harness-client?tab=home&agent=tax_specialist`, {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector('[data-agent-stage="tax_specialist"]', { timeout: 15000 });
const irp6 = page.locator('[data-tax-form="IRP6"] button.tax-page-form');
await irp6.waitFor({ timeout: 15000 });
await irp6.click();
await page.waitForSelector('[data-irp6-sheet="true"]', { timeout: 10000 });

const gate = page.locator(".irp6-gate-line").first();
const before = (await gate.textContent())?.trim();
if (before !== "2 fields need input before you can download.")
  fail(`missing line reads "${before}"`);
if (!(await page.locator('[data-irp6-download="pdf"]').isDisabled()))
  fail("download is open before the fields are filled");
const due = await page.locator(".irp6-due-date").textContent();
if (!due?.includes("26 Feb 2027")) fail(`due date in the header reads "${due}"`);

await page.fill("#irp6-input-taxReference", "9123456789");
await page.fill("#irp6-input-provisionalPaid", "135000");
await page.click('[data-irp6-add-adjustment="true"]');
const row = page.locator("[data-irp6-adjustment]").last();
await row.locator("input").first().fill("Traffic fines, not deductible");
await row.locator("input").nth(1).fill("50000");

const after = (await gate.textContent())?.trim();
if (!after?.startsWith("Approve each section to download. 0 of 5 approved."))
  fail(`after filling, the gate reads "${after}"`);

for (const section of SECTIONS) {
  const tick = page.locator(`[data-irp6-approve="${section}"]`);
  await tick.click();
  await page.waitForFunction(
    (sel) => document.querySelector(sel)?.getAttribute("aria-pressed") === "true",
    `[data-irp6-approve="${section}"]`,
  );
  if (!(await tick.locator(".irp6-approve-box svg").count())) fail(`${section} tick is not drawn`);
}
await page.waitForSelector('[data-irp6-status="approved"]', { timeout: 5000 });
const ready = (await gate.textContent())?.trim() ?? "";
if (!ready.startsWith("Ready to download.") || !ready.includes("Approved by"))
  fail(`ready line reads "${ready}"`);

const [pdf] = await Promise.all([
  page.waitForEvent("download"),
  page.click('[data-irp6-download="pdf"]'),
]);
const pdfName = pdf.suggestedFilename();
if (pdfName !== "IRP6_Harbour_Co_Pty_Ltd_2027_P2.pdf") fail(`PDF is named ${pdfName}`);
const pdfPath = join(tmpdir(), pdfName);
await pdf.saveAs(pdfPath);
if (readFileSync(pdfPath).subarray(0, 5).toString() !== "%PDF-") fail("the PDF download is not a PDF");
await page.waitForSelector('[data-irp6-status="downloaded"]', { timeout: 5000 });

const [csv] = await Promise.all([
  page.waitForEvent("download"),
  page.click('[data-irp6-download="csv"]'),
]);
if (csv.suggestedFilename() !== "IRP6_Harbour_Co_Pty_Ltd_2027_P2.csv")
  fail(`CSV is named ${csv.suggestedFilename()}`);
const csvPath = join(tmpdir(), csv.suggestedFilename());
await csv.saveAs(csvPath);
const csvText = readFileSync(csvPath, "utf8");
if (!csvText.includes("Estimated taxable income,1250000.00")) fail("CSV estimate is wrong");

await page.click(".irp6-back");
await page.waitForSelector('[data-tax-section="activity"]');
const activity = await page.locator('[data-tax-section="activity"]').textContent();
if (!activity?.includes("IRP6 2027, period 2 downloaded on")) fail(`activity reads "${activity}"`);
const deadline = await page.locator('[data-tax-deadline="irp6-2"]').textContent();
if (!deadline?.includes("Downloaded")) fail(`deadline row reads "${deadline}"`);
if (errors.length) fail(`page errors: ${errors.join(" | ")}`);

await browser.close();
console.log(`irp6-download: ${pdfName} and the CSV downloaded after five approvals`);
