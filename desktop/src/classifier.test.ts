import assert from "node:assert/strict";
import test from "node:test";
import {
  answerCancels,
  docTypeFromAnswer,
  reviewFile,
  type ClientRef,
} from "./classifier";

const acme: ClientRef = { id: "11111111-1111-1111-1111-111111111111", name: "Acme Studio" };
const karoo: ClientRef = { id: "22222222-2222-2222-2222-222222222222", name: "Karoo Woodwork" };

test("a named invoice in the books period needs no question", () => {
  const review = reviewFile({
    fileName: "acme-studio-invoice-2026-03.pdf",
    text: "",
    extension: "pdf",
    booksPeriod: "2026-03",
    selectedClient: acme,
    clients: [acme, karoo],
    duplicate: false,
  });
  assert.equal(review.docType, "invoice");
  assert.equal(review.period, "2026-03");
  assert.equal(review.question, null);
  assert.deepEqual(review.flags, []);
  assert.equal(review.suggestedClientName, "Acme Studio");
});

test("a bank statement in another month is flagged and asks once", () => {
  const review = reviewFile({
    fileName: "bank-statement-jan-2026.pdf",
    text: "",
    extension: "pdf",
    booksPeriod: "2026-03",
    selectedClient: acme,
    clients: [acme],
    duplicate: false,
  });
  assert.equal(review.docType, "bank statement");
  assert.equal(review.period, "2026-01");
  assert.ok(review.flags.includes("wrong-period"));
  assert.match(review.question ?? "", /Jan 2026/);
  assert.match(review.question ?? "", /Mar 2026/);
});

test("an unread scan asks before upload", () => {
  const review = reviewFile({
    fileName: "scan.pdf",
    text: "",
    extension: "pdf",
    booksPeriod: "2026-03",
    selectedClient: acme,
    clients: [acme],
    duplicate: false,
  });
  assert.ok(review.flags.includes("unreadable"));
  assert.match(review.question ?? "", /can't read/i);
});

test("a duplicate is flagged and not questioned", () => {
  const review = reviewFile({
    fileName: "acme-studio-invoice-2026-03.pdf",
    text: "Tax invoice",
    extension: "pdf",
    booksPeriod: "2026-03",
    selectedClient: acme,
    clients: [acme],
    duplicate: true,
  });
  assert.deepEqual(review.flags, ["duplicate"]);
  assert.equal(review.question, null);
});

test("text-only receipt stays low confidence", () => {
  const review = reviewFile({
    fileName: "doc.pdf",
    text: "Receipt from the till slip for coffee",
    extension: "pdf",
    booksPeriod: "2026-03",
    selectedClient: acme,
    clients: [acme],
    duplicate: false,
  });
  assert.equal(review.docType, "receipt");
  assert.ok(review.confidence < 0.75);
  assert.match(review.question ?? "", /receipt/i);
});

test("another client's name is the one question", () => {
  const review = reviewFile({
    fileName: "karoo-woodwork-invoice-2026-03.pdf",
    text: "",
    extension: "pdf",
    booksPeriod: "2026-03",
    selectedClient: acme,
    clients: [acme, karoo],
    duplicate: false,
  });
  assert.equal(review.suggestedClientName, "Karoo Woodwork");
  assert.match(review.question ?? "", /Karoo Woodwork/);
  assert.match(review.question ?? "", /Acme Studio/);
});

test("answers", () => {
  assert.equal(answerCancels("no"), true);
  assert.equal(answerCancels("skip this"), true);
  assert.equal(answerCancels("yes"), false);
  assert.equal(answerCancels(""), false);
  assert.equal(docTypeFromAnswer("It's a receipt"), "receipt");
  assert.equal(docTypeFromAnswer("bank statement"), "bank statement");
});
