/**
 * Hashed chunk names can contain the letters ZAR. That is not a price.
 * A real R299 or ZAR string in US chunk content still fails the scan.
 * Run: pnpm test:za-bundle-leak
 */
import assert from "node:assert/strict";
import { contentLeakHits } from "./za-bundle-leak.mjs";

const hashedFilename = [
  'import"./billing.cancel-C9FUdZAR.js";',
  'const src="/assets/billing.cancel-C9FUdZAR.js";',
  "//# sourceMappingURL=billing.cancel-C9FUdZAR.js.map",
  "var C9FUdZAR=1;",
].join("\n");
const nameHits = contentLeakHits(hashedFilename);
assert.equal(
  nameHits.length,
  0,
  `ZAR inside a hashed chunk filename must pass, saw ${JSON.stringify(nameHits)}`,
);

const usChunk = 'const price = "R299"; const currency = "ZAR";';
const usHits = contentLeakHits(usChunk);
const needles = new Set(usHits.map((hit) => hit.needle));
assert.ok(needles.has("R299"), "a real R299 string in a US chunk still fails");
assert.ok(needles.has("ZAR"), "a real ZAR string in a US chunk still fails");

const mixed = 'import"./billing.cancel-C9FUdZAR.js";\nconst currency = "ZAR";';
const mixedHits = contentLeakHits(mixed);
assert.equal(mixedHits.length, 1, "a filename hit does not hide a real ZAR string");
assert.equal(mixedHits[0]?.needle, "ZAR");

console.log("za-bundle-leak-test: ok");
