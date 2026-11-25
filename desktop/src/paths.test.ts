import assert from "node:assert/strict";
import test from "node:test";
import {
  ignoredLocalFile,
  intakeAcceptsMime,
  mimeForFileName,
  sanitizeSourceObjectName,
  sizeError,
  sourceObjectPath,
  watchedExtension,
} from "./paths";

test("object path matches the intake rule", () => {
  const id = "AABBCCDD-1111-2222-3333-444455556666";
  assert.equal(
    sourceObjectPath(id, "Invoice March 2026.pdf"),
    "aabbccdd-1111-2222-3333-444455556666/Invoice-March-2026.pdf",
  );
  assert.equal(sanitizeSourceObjectName("a/b.pdf"), "b.pdf");
});

test("watch list includes spreadsheets that intake still rejects", () => {
  assert.equal(watchedExtension("note.CSV"), true);
  assert.equal(watchedExtension("book.XLSX"), true);
  assert.equal(watchedExtension("photo.HEIC"), true);
  assert.equal(watchedExtension("notes.txt"), false);
  assert.equal(intakeAcceptsMime(mimeForFileName("a.csv")), false);
  assert.equal(intakeAcceptsMime(mimeForFileName("a.xlsx")), false);
  assert.equal(intakeAcceptsMime(mimeForFileName("a.pdf")), true);
  assert.equal(intakeAcceptsMime(mimeForFileName("a.heic")), true);
});

test("hidden and secret files are ignored", () => {
  assert.equal(ignoredLocalFile(".env"), true);
  assert.equal(ignoredLocalFile("~$book.xlsx"), true);
  assert.equal(ignoredLocalFile("invoice.pdf"), false);
  assert.equal(sizeError(0), "This file is empty.");
  assert.equal(sizeError(20 * 1024 * 1024 + 1), "This file is over 20 MB.");
});
