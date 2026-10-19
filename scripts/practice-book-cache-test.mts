/**
 * All clients cache: exact firm key, empty books, and a drop on membership change.
 * Run: pnpm test:practice-book-cache
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  forgetPaintedBook,
  readPaintedBook,
  rememberPaintedBook,
} from "../src/lib/practice-book-cache.ts";

const user = "user-cache";
const firm = "firm-cache";
const otherFirm = "firm-other";

forgetPaintedBook(user, firm);
forgetPaintedBook(user, otherFirm);

rememberPaintedBook(user, firm, [{ id: "karoo" }]);
assert.deepEqual(readPaintedBook(user, firm), [{ id: "karoo" }], "the exact user and firm key is readable");
assert.equal(readPaintedBook(user, otherFirm), null, "another firm is not a fallback");
assert.equal(readPaintedBook(user, null), null, "a null firm reads nothing");
assert.equal(readPaintedBook(undefined, firm), null, "a missing user reads nothing");
rememberPaintedBook(user, null, [{ id: "orphan" }]);
assert.deepEqual(readPaintedBook(user, firm), [{ id: "karoo" }], "a null firm does not replace the firm book");

rememberPaintedBook(user, firm, []);
assert.deepEqual(readPaintedBook(user, firm), [], "an empty fetch replaces the previous book");
assert.notEqual(readPaintedBook(user, firm), null, "an empty list is a stored result");

rememberPaintedBook(user, firm, [{ id: "karoo" }]);
forgetPaintedBook(user, firm);
assert.equal(readPaintedBook(user, firm), null, "dropping the key leaves the next visit with nothing to paint");

const board = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");
const added = board.indexOf("onAdded={(created) => {");
const addedBody = board.slice(added, added + 700);
assert(addedBody.includes("forgetPaintedBook"), "adding a client drops the painted book before the reload");
assert(!board.includes("paintedBookByUser"), "there is no user-only book fallback");

console.log("practice-book-cache-test: ok");
