import assert from "node:assert/strict";
import test from "node:test";
import { pdfLiteralText } from "./snippet";

test("pdf literal strings are readable", () => {
  const bytes = Buffer.from("BT (Tax Invoice 2026) Tj ET", "latin1");
  assert.match(pdfLiteralText(bytes), /Tax Invoice 2026/);
});
