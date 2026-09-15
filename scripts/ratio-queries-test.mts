/**
 * Owner ratio questions: tagged to a ratio, visible as accountant queries.
 * Run: pnpm test:ratio-queries
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  countOpenRatioQueries,
  noteBelongsToRatio,
  openQueryCountForRatio,
  ratioQueryCanon,
  ratioQueryLabel,
} from "../src/lib/ratio-queries";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(ratioQueryCanon("debtorDays") === "debtorDays", "debtorDays stays itself");
assert(ratioQueryCanon("inventoryDays") === "wipDays", "inventoryDays aliases the playbook key");
assert(noteBelongsToRatio("inventoryDays", "wipDays"), "alias keys match");
assert(noteBelongsToRatio("debtorDays", "debtorDays"), "same key matches");
assert(!noteBelongsToRatio("debtorDays", "grossMargin"), "different ratios do not match");
assert(!noteBelongsToRatio(null, "debtorDays"), "missing key does not match");
assert(ratioQueryLabel("debtorDays") === "Debtor Days", "label is the display name");
assert(ratioQueryLabel("inventoryDays") === "Inventory Days", "aliased key still labels Inventory Days");

const counts = countOpenRatioQueries([
  { ratioKey: "debtorDays", resolved: false },
  { ratioKey: "debtorDays", resolved: true },
  { ratioKey: "grossMargin", resolved: false },
  { ratioKey: null, resolved: false },
]);
assert(counts.debtorDays === 1, "unresolved debtor question counts once");
assert(openQueryCountForRatio(counts, "Debtor Days") === 1, "display name looks up the count");
assert(openQueryCountForRatio(counts, "grossMargin") === 1, "ui key looks up the count");
assert(openQueryCountForRatio(counts, "Net Margin") === 0, "other ratios are zero");

const briefing = readFileSync(resolve("src/components/owner-ratio-briefing.tsx"), "utf8");
assert(briefing.includes("Ask about this ratio"), "owner types the question in the briefing");
assert(briefing.includes("ratioKey"), "question is saved against the ratio");
assert(!briefing.includes("setPinMode"), "ask does not enter pin mode");

const fns = readFileSync(resolve("src/lib/notes.functions.ts"), "utf8");
assert(fns.includes("ratioKey"), "notes API carries ratioKey");
assert(fns.includes("ratio_key"), "insert writes ratio_key");

const archive = readFileSync(resolve("src/components/note-archive.tsx"), "utf8");
assert(archive.includes("ratioQueryLabel"), "open queries name the ratio");
assert(archive.includes("Show on ${ratioLabel}"), "jump CTA names the ratio");

const drawer = readFileSync(resolve("src/components/playbook-drawer.tsx"), "utf8");
assert(drawer.includes("data-ratio-queries"), "playbook shows queries on that ratio");
assert(drawer.includes("Queries from client management"), "copy names queries from client management");

const studio = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(studio.includes("openDrawerFromUiKey"), "clicking a query opens that ratio");
assert(studio.includes("1 query"), "ratio rows badge an open query");
assert(studio.includes('queries === "open"'), "dashboard can deep-link into open queries");

const dash = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
assert(dash.includes("openClientQueries"), "Queries column is clickable");
assert(dash.includes('search: { queries: "open" }'), "Queries column opens the query list");

const hero = readFileSync(resolve("src/components/sphere-hero.tsx"), "utf8");
assert(hero.includes("queryCounts"), "orb drivers can show a query badge");
assert(hero.includes("1 query"), "badge copy is 1 query");

const layer = readFileSync(resolve("src/components/note-layer.tsx"), "utf8");
assert(layer.includes("pinNotes"), "ratio questions are not spatial pins");
assert(layer.includes("note.ratioKey"), "ratio questions skip the crosshair overlay");

const mig = readFileSync(
  resolve("supabase/migrations/20260914120000_client_notes_ratio_key.sql"),
  "utf8",
);
assert(mig.includes("ratio_key"), "migration adds ratio_key");

console.log("ratio-queries-test: ok");
