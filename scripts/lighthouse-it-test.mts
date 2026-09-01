/**
 * Lighthouse IT queries: deep links and note tag plumbing.
 * Run: pnpm test:lighthouse-it
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { clientNoteProfilePath, clientNoteProfileUrl } from "../src/lib/client-note-link";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  clientNoteProfilePath("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "11111111-2222-3333-4444-555555555555", "profit") ===
    "/clients/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?note=11111111-2222-3333-4444-555555555555&tab=profit",
  "profile path includes note and tab",
);
assert(
  clientNoteProfileUrl("https://milon.co.za/", "cid", "nid", "cash").startsWith(
    "https://milon.co.za/clients/cid?",
  ),
  "absolute url strips trailing slash",
);

const layer = readFileSync(resolve("src/components/note-layer.tsx"), "utf8");
assert(layer.includes("Tag Milōn IT"), "composer and popover can tag Milōn IT");
assert(layer.includes("tagMilonIt"), "layer calls tagMilonIt");
assert(layer.includes("focusNoteId"), "layer opens a deep-linked note");

const panel = readFileSync(resolve("src/components/lighthouse-panel.tsx"), "utf8");
assert(panel.includes("IT queries"), "Lighthouse has an IT queries tab");
assert(panel.includes("LighthouseItPanel"), "IT tab renders the queries panel");

const itUi = readFileSync(resolve("src/components/lighthouse-it.tsx"), "utf8");
assert(itUi.includes("Open this note on the customer profile"), "each query has a profile link");
assert(itUi.includes("Add IT member"), "IT team list can add members");
assert(itUi.includes("master access"), "copy explains master access");

const fns = readFileSync(resolve("src/lib/notes.functions.ts"), "utf8");
assert(fns.includes("tagMilonIt"), "create note accepts tagMilonIt");
assert(fns.includes("tagClientNoteMilonIt"), "existing notes can be tagged");
assert(fns.includes("dispatchMilonItQueryEmails"), "tagging notifies IT");

const mig = readFileSync(resolve("supabase/migrations/20260901140000_milon_it_queries.sql"), "utf8");
assert(mig.includes("milon_it_members"), "migration creates IT team table");
assert(mig.includes("tagged_milon_it"), "migration adds note tag column");
assert(mig.includes("is_milon_it_member"), "migration grants IT master access helper");
assert(mig.includes("has_client_access"), "has_client_access includes IT members");

const client = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(client.includes("search.note"), "client profile reads note deep-link");
assert(client.includes("requestOpenNote"), "client profile opens the tagged note");

console.log("lighthouse-it-test: ok");
