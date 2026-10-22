/**
 * Hashed chunk names can contain the letters ZAR. That is not a price.
 * A real R299 or ZAR string in US chunk content still fails the scan.
 * Run: pnpm test:za-bundle-leak
 */
import assert from "node:assert/strict";
import { bareLadderLeakHits, contentLeakHits } from "./za-bundle-leak.mjs";

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

const barePrice = 'const price = "799"; const other = "1 199/mo"; const scale = "7,999";';
const bareHits = bareLadderLeakHits(barePrice);
const bareNeedles = new Set(bareHits.map((hit) => hit.needle.replace(/\s+/g, " ")));
assert.ok(bareNeedles.has("799"), "a bare 799 next to price fails");
assert.ok([...bareNeedles].some((needle) => needle.includes("1 199")), "a bare 1 199/mo fails");
assert.ok(bareNeedles.has("7,999"), "a bare 7,999 next to price fails");

const plantedComponent = 'export function Card(){ return <p>1,999/mo</p> }';
assert.equal(bareLadderLeakHits(plantedComponent).length, 1, "1,999/mo in a component fails the bundle scan");

const hashedAmount = [
  'import"./billing.cancel-C9FUd799.js";',
  'const src="/assets/chunk-C9FUd799.js";',
  "var C9FUd799=1;",
].join("\n");
assert.equal(
  bareLadderLeakHits(hashedAmount).length,
  0,
  `799 inside a hashed filename must pass, saw ${JSON.stringify(bareLadderLeakHits(hashedAmount))}`,
);

const botAmount = "Write amounts as R 187 444: a space after R, and R 187 444,50 for cents.";
assert.equal(bareLadderLeakHits(botAmount).length, 0, "R 187 444 is not a ladder leak");
assert.equal(contentLeakHits(botAmount).length, 0, "R 187 444 does not trip the existing rand needles");

console.log("za-bundle-leak-test: ok");
