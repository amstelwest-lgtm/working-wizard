/**
 * Store listing drafts stay honest: no prices, no rand, no WhatsApp, no SARS.
 * Run: node scripts/store-listing-copy-test.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve("docs/mobile/listings");
const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
if (files.length < 3) throw new Error("expected play, app-store, and screenshots drafts");

const banned = [
  [/whatsapp/i, "WhatsApp"],
  [/SARS/, "SARS"],
  [/\brand\b/i, "rand"],
  [/\bZAR\b/, "ZAR"],
  [/\$\s?\d/, "a dollar amount"],
  [/\bR\s?\d/, "a rand amount"],
  [/£\s?\d/, "a pound amount"],
  [/€\s?\d/, "a euro amount"],
  [/\/mo\b/i, "a monthly price"],
  [/per month/i, "a monthly price"],
  [/free trial/i, "a free-trial price claim"],
  [/14-day/i, "a trial length"],
];

for (const name of files) {
  const text = readFileSync(resolve(dir, name), "utf8");
  for (const [pattern, label] of banned) {
    if (pattern.test(text)) throw new Error(`${name} mentions ${label}`);
  }
}

const shots = readFileSync(resolve(dir, "screenshots.md"), "utf8");
if (!/demo account/i.test(shots)) throw new Error("screenshot plan must name the demo account");
if (!/never a real client/i.test(shots)) throw new Error("screenshot plan must forbid real client data");

console.log("store listing copy ok");
