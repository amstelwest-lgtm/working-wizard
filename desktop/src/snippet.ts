import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { fileExtension } from "./paths";

/** Literal strings from the start of a PDF. Compressed streams stay unread. */
export function pdfLiteralText(bytes: Uint8Array): string {
  const latin = Buffer.from(bytes.subarray(0, 200_000)).toString("latin1");
  const bits: string[] = [];
  const re = /\(((?:\\.|[^\\)]){2,180})\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(latin)) && bits.length < 60) {
    const text = match[1]
      .replace(/\\n/g, " ")
      .replace(/\\r/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");
    if (/[A-Za-z]{3}/.test(text)) bits.push(text);
  }
  return bits.join(" ").replace(/\s+/g, " ").trim().slice(0, 4000);
}

function stripXml(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

async function xlsxText(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  const zip = await JSZip.loadAsync(bytes);
  const shared = await zip.file("xl/sharedStrings.xml")?.async("string");
  if (shared) return stripXml(shared);
  const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
  return sheet ? stripXml(sheet) : "";
}

/** Filename plus a short first-page (or first-sheet) read. Images stay filename-only. */
export async function firstPageText(filePath: string): Promise<string> {
  const ext = fileExtension(filePath);
  if (ext === "csv") {
    const bytes = await readFile(filePath);
    return Buffer.from(bytes.subarray(0, 8000)).toString("utf8");
  }
  if (ext === "pdf") {
    const bytes = await readFile(filePath);
    return pdfLiteralText(bytes);
  }
  if (ext === "xlsx") {
    try {
      return await xlsxText(filePath);
    } catch {
      return "";
    }
  }
  return "";
}
