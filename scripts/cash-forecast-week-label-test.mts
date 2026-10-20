/**
 * Cash-forecast PDF week rows print "Week N" with no lint marker.
 * Also checks rendered report strings for a leaked // comment.
 * Run: pnpm test:cash-forecast-week-label
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { cashForecastWeekRowLabel } from "../src/lib/cash-forecast-parity";

for (const week of [1, 2, 13]) {
  const label = cashForecastWeekRowLabel(`Week ${week}`);
  assert.equal(label, `Week ${week}`, `week row label is Week ${week}`);
  assert.equal(label.includes("//"), false, "week row label has no //");
  assert.equal(label.includes("date-ok"), false, "week row label has no date-ok marker");
}

const leaked = cashForecastWeekRowLabel("Week 1 // date-ok: week row label, not a calendar span");
assert.equal(leaked, "Week 1", "a marker stuck on the label is not printed");
assert.equal(leaked.includes("//"), false);

const pdf = readFileSync("src/reports/cash-forecast.tsx", "utf8");
assert.match(
  pdf,
  /cashForecastWeekRowLabel\(w\.period_label\)/,
  "the PDF week column uses the row label",
);

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** JSX text and string/template text that would be rendered. */
function renderedPieces(file: string): Array<{ line: number; text: string; kind: string }> {
  const src = readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  const pieces: Array<{ line: number; text: string; kind: string }> = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    let pieceKind = "";
    if (ts.isJsxText(node)) {
      text = node.text;
      pieceKind = "jsx";
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      text = node.text;
      pieceKind = "string";
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      text = node.text;
      pieceKind = "template";
    }
    if (text != null && text.trim()) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      pieces.push({ line, text, kind: pieceKind });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return pieces;
}

const problems: string[] = [];
for (const root of ["src/reports", "src/lib"]) {
  for (const file of filesUnder(root)) {
    const rel = relative(process.cwd(), file);
    for (const piece of renderedPieces(file)) {
      const commentInLabel = piece.kind === "jsx" && piece.text.includes("//");
      const markerInString =
        piece.kind !== "jsx" && (piece.text.includes("date-ok") || /\/\/[ \t]/.test(piece.text));
      if (!commentInLabel && !markerInString) continue;
      const sample = piece.text.replace(/\s+/g, " ").trim().slice(0, 120);
      problems.push(
        `${rel}:${piece.line} rendered ${piece.kind} contains a comment marker (${sample})`,
      );
    }
  }
}

assert.deepEqual(problems, [], problems.join("\n"));
console.log("cash-forecast-week-label-test: ok");
