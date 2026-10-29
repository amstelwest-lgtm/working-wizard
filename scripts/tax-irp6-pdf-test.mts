/**
 * IRP6 preparation sheet PDF: text snapshot for the demo client, the footer
 * on every page, and no SARS artwork words.
 * Run: pnpm test:tax-irp6-pdf
 * Update the snapshot: UPDATE_SNAPSHOT=1 pnpm test:tax-irp6-pdf
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { getDocumentProxy } from "unpdf";
import { Irp6PDF } from "../src/components/tax-specialist/za-irp6-pdf";
import { computeIrp6 } from "../src/lib/tax-specialist/forms/irp6.ts";
import {
  IRP6_DEMO_CLIENT,
  IRP6_DEMO_INPUTS,
  IRP6_DEMO_TODAY,
} from "../src/lib/tax-specialist/forms/irp6-demo.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type TextItem = { str: string; transform: number[] };

async function pagesText(buf: Buffer): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const buckets = new Map<number, Array<{ x: number; str: string }>>();
    for (const item of content.items as TextItem[]) {
      if (!item.str || !item.str.trim()) continue;
      const key = Math.round((item.transform[5] ?? 0) / 3) * 3;
      const row = buckets.get(key) ?? [];
      row.push({ x: item.transform[4] ?? 0, str: item.str });
      buckets.set(key, row);
    }
    const lines = [...buckets.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) =>
        parts
          .sort((a, b) => a.x - b.x)
          .map((part) => part.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
    pages.push(lines.join("\n"));
  }
  return pages;
}

const sheet = computeIrp6({
  client: IRP6_DEMO_CLIENT,
  yearOfAssessment: 2027,
  period: 2,
  inputs: IRP6_DEMO_INPUTS,
});

const { renderToBuffer } = await import("@react-pdf/renderer");
const buf = await renderToBuffer(
  createElement(Irp6PDF, {
    clientName: IRP6_DEMO_CLIENT.name,
    sheet,
    adjustments: IRP6_DEMO_INPUTS.adjustments,
    approvedByName: "Ada Mbeki",
    approvedAt: "2026-10-29T10:00:00.000Z",
    preparedOn: IRP6_DEMO_TODAY,
  }) as Parameters<typeof renderToBuffer>[0],
);
const pages = await pagesText(buf);
if (process.env.DUMP) console.log(pages.join("\n=====\n"));
const text = pages.map((page, i) => `--- page ${i + 1}\n${page}`).join("\n");

const footer =
  /Prepared by Mil\s*o\s*n for checking\. Not a SARS return\. Capture and submit on SARS eFiling\./;
pages.forEach((page, i) => assert(footer.test(page), `page ${i + 1} has the footer`));
for (const needle of [
  "IRP6 preparation sheet",
  "Harbour & Co (Pty) Ltd",
  "Taxpayer reference number",
  "9123456789",
  "Estimated taxable income",
  "R 1 000 000.00",
  "R 270 000.00",
  "Provisional tax paid for period 1",
  "R 135 000.00",
  "26 Feb 2027",
  "Approved by Ada Mbeki on 29 Oct 2026",
  "Your estimate is 100% of the actual figure so far.",
  "Traffic fines, not deductible",
  "From books sync, as of 1 Oct",
]) {
  assert(text.includes(needle), `PDF text includes ${needle}`);
}
assert(!/South African Revenue Service|SARS logo/i.test(text), "no SARS artwork words");

const snapshotPath = resolve(import.meta.dirname, "fixtures/irp6-demo-pdf.txt");
if (process.env.UPDATE_SNAPSHOT === "1" || !existsSync(snapshotPath)) {
  writeFileSync(snapshotPath, `${text}\n`);
  console.log(`tax-irp6-pdf: wrote ${snapshotPath}`);
} else {
  const expected = readFileSync(snapshotPath, "utf8").trimEnd();
  if (expected !== text.trimEnd()) {
    const a = expected.split("\n");
    const b = text.trimEnd().split("\n");
    const at = a.findIndex((line, i) => line !== b[i]);
    throw new Error(
      `PDF text changed at line ${at + 1}:\n  expected: ${a[at]}\n  actual:   ${b[at]}\nRun UPDATE_SNAPSHOT=1 pnpm test:tax-irp6-pdf if the change is intended.`,
    );
  }
}
console.log(`tax-irp6-pdf: ${pages.length} page(s), snapshot matches, footer on every page`);
