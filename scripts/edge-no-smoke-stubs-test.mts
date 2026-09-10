/**
 * Fail if any Supabase edge function source looks like a smoke stub left in prod.
 * Run: pnpm test:edge-no-smoke-stubs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export type SmokeStubHit = { file: string; reason: string };

/** Real handlers usually touch auth, DB, or async request parsing. */
const REAL_HANDLER_MARKERS =
  /has_client_access|deliverable_drafts|\.from\s*\(|\.rpc\s*\(|auth\.getUser|async\s*\(\s*req/i;

const TRIVIAL_OK_STUB =
  /Deno\.serve\s*\(\s*(?:async\s*)?\(?\s*req\s*\)?\s*=>\s*new\s+Response\s*\(\s*JSON\.stringify\s*\(\s*\{\s*ok\s*:\s*true/i;

export function findSmokeStubHits(src: string, fileLabel = "source"): SmokeStubHit[] {
  const hits: SmokeStubHit[] = [];

  if (/smoke-bdd/i.test(src)) {
    hits.push({ file: fileLabel, reason: "contains smoke-bdd" });
  }
  if (/fn\s*:\s*["']smoke-/i.test(src)) {
    hits.push({ file: fileLabel, reason: 'contains fn:"smoke-…"' });
  }

  const serveMatch = src.match(/Deno\.serve\s*\(([\s\S]*?)\)\s*;?\s*$/m);
  const serveBody = serveMatch?.[1] ?? src;
  if (/PLACEHOLDER/i.test(serveBody) && !REAL_HANDLER_MARKERS.test(src)) {
    hits.push({ file: fileLabel, reason: "PLACEHOLDER as sole Deno.serve body" });
  }

  if (TRIVIAL_OK_STUB.test(src) && !REAL_HANDLER_MARKERS.test(src)) {
    hits.push({
      file: fileLabel,
      reason: "trivial Deno.serve(() => new Response(JSON.stringify({ok:true…})) without real handlers",
    });
  }

  return hits;
}

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walkTsFiles(path));
    } else if (name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const functionsRoot = resolve("supabase/functions");
const allHits: SmokeStubHit[] = [];

for (const fnName of readdirSync(functionsRoot)) {
  const fnDir = join(functionsRoot, fnName);
  if (!statSync(fnDir).isDirectory()) continue;
  for (const file of walkTsFiles(fnDir)) {
    const rel = file.replace(`${process.cwd()}/`, "");
    const src = readFileSync(file, "utf8");
    allHits.push(...findSmokeStubHits(src, rel));
  }
}

assert(allHits.length === 0, `edge smoke stub(s) detected:\n${allHits.map((h) => `  ${h.file}: ${h.reason}`).join("\n")}`);

// brain-deliverable-draft deploy bundle contract
const bdd = readFileSync(resolve("supabase/functions/brain-deliverable-draft/index.ts"), "utf8");
assert(bdd.includes("@supabase/supabase-js@2.49.1"), "brain-deliverable-draft pins createClient @2.49.1");
assert(bdd.includes("deliverable_drafts"), "brain-deliverable-draft inserts deliverable_drafts");
assert(bdd.includes("draftInserted"), "brain-deliverable-draft returns draftInserted");
assert(!bdd.includes('from "./logic.ts"'), "brain-deliverable-draft index.ts must be self-contained");
assert(!bdd.includes("../ask-ai/"), "brain-deliverable-draft must not import sibling functions");

// fixture: detector catches a known smoke stub shape
const fakeStub = `Deno.serve(() => new Response(JSON.stringify({ ok: true, smoke: "smoke-bdd", fn: "smoke-bdd" })));`;
const fixtureHits = findSmokeStubHits(fakeStub, "fixture");
assert(fixtureHits.some((h) => h.reason.includes("smoke-bdd")), "fixture smoke-bdd must be detected");
assert(
  fixtureHits.some((h) => h.reason.includes('fn:"smoke-')),
  "fixture fn:smoke must be detected",
);

console.log("edge-no-smoke-stubs: OK (no stubs under supabase/functions/, brain-deliverable-draft bundle valid)");
